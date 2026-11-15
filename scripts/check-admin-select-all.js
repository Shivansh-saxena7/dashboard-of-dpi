#!/usr/bin/env node
// Admin Leads "Select all matching" (2026-11-13): known answers + guards, run in prebuild. No DB or network access:
// the query is only built (postgrest-js), never sent.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const problems = [];
require.extensions[".ts"] = (m, f) =>
  m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, f);
const { ADMIN_SELECT_ALL_SELECT } = require(path.join(root, "lib/adminLeadsSelect.ts"));
const { PostgrestClient } = require("@supabase/postgrest-js");

const eq = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const page = read("app/admin/leads/page.tsx");

// 1) Every lead_history column the filters use is embedded, with !inner, in both the list and the Select-all query.
const fStart = page.indexOf("function applyLeadFilters(");
const fBody = page.slice(fStart, page.indexOf("\n  }\n", fStart));
const filterCols = [...new Set([...fBody.matchAll(/"lead_history\.([a-z_]+)"/g)].map((m) => m[1]))].sort();
eq("filters use these lead_history columns", filterCols, ["assigned_at", "is_active", "recycle_reason"]);
const embedCols = (select) => {
  const m = select.match(/lead_history!inner\s*\(([^)]*)\)/);
  return m ? m[1].split(",").map((c) => c.trim()).filter((c) => /^[a-z_]+$/.test(c)) : null;
};
const listSelect = page.slice(page.indexOf("const LEADS_SELECT = `"), page.indexOf("`;", page.indexOf("const LEADS_SELECT = `")));
for (const [name, select] of [["Select all", ADMIN_SELECT_ALL_SELECT], ["list", listSelect]]) {
  const cols = embedCols(select);
  if (!cols) problems.push(`${name} query must embed lead_history!inner`);
  else for (const c of filterCols) if (!cols.includes(c)) problems.push(`${name} query embed is missing lead_history.${c}`);
}
for (const c of ["id", "status", "board_stage"]) if (!ADMIN_SELECT_ALL_SELECT.split(",").map((x) => x.trim()).includes(c)) problems.push(`Select all must still read ${c}`);

// 2) fetchAllMatching is only called with a select that carries the embed.
const calls = [...page.matchAll(/fetchAllMatching\(([^)]*)\)/g)].map((m) => m[1].trim()).filter((a) => !a.startsWith("selectString"));
for (const a of calls) if (!["LEADS_SELECT", "ADMIN_SELECT_ALL_SELECT"].includes(a)) problems.push(`fetchAllMatching(${a}) must use LEADS_SELECT or ADMIN_SELECT_ALL_SELECT`);
if (!calls.includes("ADMIN_SELECT_ALL_SELECT")) problems.push("Select all must use ADMIN_SELECT_ALL_SELECT");

// 3) Query shape, built with postgrest-js exactly as the page builds it (never sent).
const db = new PostgrestClient("http://localhost.invalid/rest/v1");
const params = (q) => new URL(q.url.toString()).searchParams;
const withFilter = params(db.from("leads").select(ADMIN_SELECT_ALL_SELECT).eq("lead_history.is_active", true).not("lead_history.recycle_reason", "is", null).range(0, 999));
eq("with filter: select embeds lead_history!inner", /lead_history!inner\(is_active,recycle_reason,assigned_at\)/.test(withFilter.get("select")), true);
eq("with filter: is_active filter sent", withFilter.get("lead_history.is_active"), "eq.true");
eq("with filter: recycle_reason filter sent", withFilter.get("lead_history.recycle_reason"), "not.is.null");
const noFilter = params(db.from("leads").select(ADMIN_SELECT_ALL_SELECT).range(0, 999));
eq("no filter: same select", noFilter.get("select"), withFilter.get("select"));
eq("no filter: no lead_history filter", [...noFilter.keys()].filter((k) => k.startsWith("lead_history.")), []);
// The old shape (the bug): a lead_history filter with no lead_history in the select is what PostgREST rejects (PGRST108).
const old = params(db.from("leads").select("id, status, board_stage").eq("lead_history.is_active", true));
eq("old shape had no embed (the bug)", /lead_history/.test(old.get("select")), false);

// 4) Bulk Reassign safety: at most 500 a click, confirm dialog names the count and the employee.
const { ADMIN_REASSIGN_MAX_PER_CALL, canBulkReassign, reassignConfirmTitle } = require(path.join(root, "lib/adminReassign.ts"));
const { ADMIN_JUNK_MAX_PER_CALL } = require(path.join(root, "lib/adminJunk.ts"));
eq("reassign limit", ADMIN_REASSIGN_MAX_PER_CALL, 500);
eq("junk limit unchanged", ADMIN_JUNK_MAX_PER_CALL, 50);
eq("reassign 0", canBulkReassign(0), false);
eq("reassign 1", canBulkReassign(1), true);
eq("reassign 500", canBulkReassign(500), true);
eq("reassign 501", canBulkReassign(501), false);
eq("reassign 3198", canBulkReassign(3198), false);
eq("title plural", reassignConfirmTitle(12, "Rama"), "Reassign 12 leads to Rama?");
eq("title singular", reassignConfirmTitle(1, "Rama"), "Reassign 1 lead to Rama?");
eq("title no name", reassignConfirmTitle(3, null), "Reassign 3 leads to this employee?");
if (!page.includes("onClick={() => setReassignDialogOpen(true)}")) problems.push("Reassign must open the confirm dialog first");
if (!page.includes("!canBulkReassign(selectedLeadIds.size)}")) problems.push("Reassign must be disabled above the limit");
if (!page.includes("Select at most {ADMIN_REASSIGN_MAX_PER_CALL} leads")) problems.push('the "Select at most 500 leads" message is missing');
if (!/async function handleBulkReassign\(\) \{\r?\n\s+if \(!canBulkReassign\(selectedLeadIds\.size\)/.test(page)) problems.push("handleBulkReassign must refuse above the limit too");

// 5) Server-side limit (2026-11-15): the page calls admin_reassign_leads, which enforces the same rules in the database.
const { ADMIN_REASSIGN_RPC, summarizeAdminReassignResult } = require(path.join(root, "lib/adminReassign.ts"));
eq("reassign rpc", ADMIN_REASSIGN_RPC, "admin_reassign_leads");
eq("summary all ok", summarizeAdminReassignResult({ requested: 2, reassigned: 2, results: [{ lead_id: "aaaaaaaa-1", success: true }, { lead_id: "bbbbbbbb-2", success: true }] }), { reassigned: 2, failed: [] });
eq(
  "summary partial",
  summarizeAdminReassignResult({ reassigned: 1, results: [{ lead_id: "aaaaaaaa-1", success: true }, { lead_id: "bbbbbbbb-2", success: false, error: "force_reassign_lead_atomic: lead x is already assigned to that employee" }] }),
  { reassigned: 1, failed: ["bbbbbbbb lead x is already assigned to that employee"] }
);
eq("summary empty answer", summarizeAdminReassignResult(null), { reassigned: 0, failed: [] });
if (!page.includes("supabase.rpc(ADMIN_REASSIGN_RPC, {")) problems.push("bulk Reassign must call admin_reassign_leads");
// One receiver for every chunk: captured once before the first call.
if (!page.includes("const toEmployeeId = bulkTargetEmployeeId;") || !page.includes("p_to_employee_id: toEmployeeId")) problems.push("bulk Reassign must pass p_to_employee_id");
for (const dir of ["app", "components", "lib"]) {
  const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${d}/${e.name}`] : []));
  for (const f of walk(dir)) if (read(f).includes("bulk_reassign_leads_atomic")) problems.push(`${f} still calls bulk_reassign_leads_atomic (no server limit)`);
}
const sqlFile = "supabase/sql/2026-11-15_admin_reassign_leads.sql";
const sql = read(sqlFile);
if (!sql.includes(`cardinality(v_ids) > ${ADMIN_REASSIGN_MAX_PER_CALL} then`)) problems.push(`${sqlFile}: server limit must match ADMIN_REASSIGN_MAX_PER_CALL`);
if (!sql.includes("not coalesce(is_admin(), false)")) problems.push(`${sqlFile}: must check is_admin()`);
if (!sql.includes("p_to_employee_id is null or not exists (select 1 from employees where id = p_to_employee_id and is_active)")) problems.push(`${sqlFile}: receiver must be active`);
if (!sql.includes("if v_reason = '' then")) problems.push(`${sqlFile}: reason must be required`);
if (!sql.includes("revoke all on function public.admin_reassign_leads(uuid[], uuid, text) from public, anon;")) problems.push(`${sqlFile}: anon must be revoked`);
if (/\bdrop\b/i.test(sql.replace(/--.*$/gm, ""))) problems.push(`${sqlFile}: must be additive (no drop)`);
if (!fs.existsSync(path.join(root, "supabase/sql/2026-11-15_admin_reassign_leads_rollback.sql"))) problems.push("rollback SQL is missing");

// 6) Stage mode (2026-11-15): positive leads keep their stage by default; the UI's counts use the SQL's rule.
const { ADMIN_REASSIGN_DEFAULT_STAGE_MODE, KEEP_STAGE_PROTECTION_DAYS, isPositiveForReassign, reassignStageSplit, reassignStageSummary, reassignKeptCount } =
  require(path.join(root, "lib/adminReassign.ts"));
eq("default stage mode", ADMIN_REASSIGN_DEFAULT_STAGE_MODE, "auto");
eq("protection days", KEEP_STAGE_PROTECTION_DAYS, 14);
eq("positive: follow-up", isPositiveForReassign("NEW", "FOLLOW_UP"), true);
eq("positive: visit", isPositiveForReassign("CONNECTED", "VISIT"), true);
eq("positive: booking", isPositiveForReassign("CONVERTED", "BOOKING"), true);
eq("positive: connected on leads", isPositiveForReassign("CONNECTED", "LEADS"), true);
eq("not positive: new", isPositiveForReassign("NEW", "LEADS"), false);
eq("not positive: not connected", isPositiveForReassign("NOT_CONNECTED", null), false);
const mix = [{ status: "CONNECTED", board_stage: "FOLLOW_UP" }, { status: "NEW", board_stage: "LEADS" }, { status: "NOT_INTERESTED", board_stage: "LEADS" }];
eq("split auto", reassignStageSplit(mix, "auto"), { kept: 1, reset: 2 });
eq("split reset", reassignStageSplit(mix, "reset"), { kept: 0, reset: 3 });
eq("summary mixed", reassignStageSummary({ kept: 1, reset: 2 }), "1 lead will keep its stage, 2 leads will be reset to New.");
eq("summary all reset", reassignStageSummary({ kept: 0, reset: 2 }), "2 leads will be reset to New.");
eq("summary all kept", reassignStageSummary({ kept: 3, reset: 0 }), "3 leads will keep their stage.");
eq("kept count", reassignKeptCount({ kept: 4 }), 4);
eq("kept count missing", reassignKeptCount(null), 0);
if (!page.includes("const stageMode = bulkStageMode;") || !page.includes("p_stage_mode: stageMode")) problems.push("bulk Reassign must send p_stage_mode");
if (!page.includes("useState<AdminReassignStageMode>(ADMIN_REASSIGN_DEFAULT_STAGE_MODE)")) problems.push("stage mode must default to ADMIN_REASSIGN_DEFAULT_STAGE_MODE");
if (!page.includes("Keep stage for positive leads (default)") || !page.includes("Reset all leads to New")) problems.push("stage selector options are missing");
if (!page.includes("Kept leads are protected from recycling for {KEEP_STAGE_PROTECTION_DAYS} days.")) problems.push("confirm dialog must mention the protection");
const stageSqlFile = "supabase/sql/2026-11-15_admin_reassign_stage_mode.sql";
const stageSql = read(stageSqlFile);
if (!stageSql.includes("create function public.admin_reassign_leads(p_lead_ids uuid[], p_to_employee_id uuid, p_reason text, p_stage_mode text)")) problems.push(`${stageSqlFile}: 4-parameter overload missing (and p_stage_mode must have no default: a default makes 3-argument calls ambiguous)`);
if (/p_stage_mode text default/i.test(stageSql)) problems.push(`${stageSqlFile}: p_stage_mode must have no database default`);
if (!stageSql.includes(`cardinality(v_ids) > ${ADMIN_REASSIGN_MAX_PER_CALL} then`)) problems.push(`${stageSqlFile}: server limit must match ADMIN_REASSIGN_MAX_PER_CALL`);
if (!stageSql.includes("v_positive := coalesce(v_stage, 'LEADS') in ('FOLLOW_UP', 'VISIT', 'BOOKING') or v_status in ('CONNECTED', 'CONVERTED');")) problems.push(`${stageSqlFile}: positive rule must match isPositiveForReassign`);
if (!stageSql.includes("revoke all on function public.admin_reassign_leads(uuid[], uuid, text, text) from public, anon;")) problems.push(`${stageSqlFile}: anon must be revoked`);
if (/\bdrop\b/i.test(stageSql.replace(/--.*$/gm, ""))) problems.push(`${stageSqlFile}: must be additive (no drop)`);
if (!fs.existsSync(path.join(root, "supabase/sql/2026-11-15_admin_reassign_stage_mode_rollback.sql"))) problems.push("stage mode rollback SQL is missing");

// 7) Chunked bulk Reassign (2026-11-15): 100 leads per call, one after the other; a call that fails stops the rest.
const { ADMIN_REASSIGN_CHUNK, chunkLeadIds, runChunkedReassign } = require(path.join(root, "lib/adminReassign.ts"));
eq("chunk size", ADMIN_REASSIGN_CHUNK, 100);
const ids250 = Array.from({ length: 250 }, (_, i) => `id${i}`);
eq("chunks of 250", chunkLeadIds(ids250).map((c) => c.length), [100, 100, 50]);
eq("chunks of 100", chunkLeadIds(ids250.slice(0, 100)).map((c) => c.length), [100]);
eq("chunks of 0", chunkLeadIds([]), []);
if (!page.includes("const result = await runChunkedReassign(")) problems.push("bulk Reassign must go through runChunkedReassign");
if (/supabase\.rpc\(ADMIN_REASSIGN_RPC, \{\s*p_lead_ids: ids,/.test(page)) problems.push("bulk Reassign must not send every selected lead in one call");
if (!page.includes("setSelectedLeadIds(new Set(result.notProcessed));")) problems.push("leads that were not processed must stay selected");
if (!page.includes("`Reassigning ${bulkProgress.sent} of ${bulkProgress.total}...`")) problems.push("bulk Reassign must show progress");
const okAnswer = (chunk) => ({ data: { reassigned: chunk.length, kept: 1, results: chunk.map((lead_id) => ({ lead_id, success: true })) }, error: null });
const asyncChecks = [
  (async () => {
    const seen = [];
    let inFlight = 0;
    let overlap = false;
    const r = await runChunkedReassign(ids250, async (chunk) => {
      inFlight += 1;
      if (inFlight > 1) overlap = true;
      seen.push(chunk.length);
      await new Promise((res) => setTimeout(res, 5));
      inFlight -= 1;
      return okAnswer(chunk);
    });
    eq("runner: sizes in order", seen, [100, 100, 50]);
    eq("runner: sequential", overlap, false);
    eq("runner: totals", { reassigned: r.reassigned, kept: r.kept, calls: r.calls, notProcessed: r.notProcessed.length, stopped: r.stoppedError }, { reassigned: 250, kept: 3, calls: 3, notProcessed: 0, stopped: null });
  })(),
  (async () => {
    let n = 0;
    const r = await runChunkedReassign(ids250, async (chunk) => (++n === 2 ? { data: null, error: { message: "statement timeout" } } : okAnswer(chunk)));
    eq("runner: stops after a failed call", { calls: r.calls, reassigned: r.reassigned, notProcessed: r.notProcessed.length, first: r.notProcessed[0], stopped: r.stoppedError }, { calls: 2, reassigned: 100, notProcessed: 150, first: "id100", stopped: "statement timeout" });
  })(),
  (async () => {
    const r = await runChunkedReassign(ids250.slice(0, 120), async (chunk) => {
      if (chunk.length === 20) throw new Error("Failed to fetch");
      return okAnswer(chunk);
    });
    eq("runner: a thrown network error stops too", { reassigned: r.reassigned, notProcessed: r.notProcessed.length, stopped: r.stoppedError }, { reassigned: 100, notProcessed: 20, stopped: "Failed to fetch" });
  })(),
  (async () => {
    const r = await runChunkedReassign(ids250.slice(0, 2), async () => ({
      data: { reassigned: 1, results: [{ lead_id: "aaaaaaaa-1", success: true }, { lead_id: "bbbbbbbb-2", success: false, error: "admin_reassign_leads: lead not found" }] },
      error: null
    }));
    eq("runner: per-lead failures are added up", { reassigned: r.reassigned, failed: r.failed }, { reassigned: 1, failed: ["bbbbbbbb lead not found"] });
  })()
];

Promise.all(asyncChecks).then(() => {
  if (problems.length) {
    console.error("check-admin-select-all: FAILED");
    for (const p of problems) console.error("  " + p);
    process.exit(1);
  }
  console.log("check-admin-select-all: all known answers and guards pass.");
});
