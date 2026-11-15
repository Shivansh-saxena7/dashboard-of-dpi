#!/usr/bin/env node
// Result save on a bad network + friendly delete refusals (2026-11-14): known answers + guards, run in prebuild.
// No DB, no network: the save is driven with fake send / check functions.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const problems = [];
require.extensions[".ts"] = (m, f) =>
  m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, f);
const rs = require(path.join(root, "lib/resilientLeadUpdate.ts"));
const { fkBlockingTable, deleteBlockedMessage } = require(path.join(root, "lib/fkErrorMessage.ts"));
const eq = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const NET = { error: { code: "", message: "TypeError: Load failed" }, status: 0 };
const OK = { error: null, status: 204 };
const SERVER = { error: { code: "P0001", message: "log_lead_update_atomic: lead is not yours" }, status: 400 };
const EXPIRED = { error: { code: "SESSION_EXPIRED", message: "expired" }, status: 0 };

// 1) What counts as a network failure
eq("status 0", rs.isNetworkFailure(NET), true);
eq("Failed to fetch, no status", rs.isNetworkFailure({ error: { message: "TypeError: Failed to fetch" } }), true);
eq("server answer", rs.isNetworkFailure(SERVER), false);
eq("expired login is not network", rs.isNetworkFailure(EXPIRED), false);
eq("PGRST error with status", rs.isNetworkFailure({ error: { code: "PGRST202", message: "x" }, status: 404 }), false);
eq("no error", rs.isNetworkFailure(OK), false);

// 2) The save, step by step
const params = { p_lead_id: "lead-40", p_lead_history_id: "h-40", p_new_status: "NOT_CONNECTED", p_note: null, p_reminder_value: null, p_reminder_unit: null };
function run(sends, checks, options = {}) {
  const log = { sent: 0, checked: 0, waited: 0, saved: 0 };
  const deps = {
    send: async () => { log.sent += 1; return sends.shift(); },
    checkLanded: async () => { log.checked += 1; return checks.shift(); },
    wait: async (ms) => { log.waited += ms; },
    now: () => 1_000_000,
    onSaved: () => { log.saved += 1; }
  };
  return rs.saveLeadUpdateResilient(params, "CRM_CALL", deps, options).then((out) => ({ out, log }));
}
(async () => {
  let r = await run([OK], []);
  eq("first try saves", [r.out, r.log], [{ kind: "saved", via: "first" }, { sent: 1, checked: 0, waited: 0, saved: 1 }]);
  r = await run([NET, OK], ["no"]);
  eq("network, not landed -> retry once, saved", [r.out, r.log], [{ kind: "saved", via: "retry" }, { sent: 2, checked: 1, waited: 3000, saved: 1 }]);
  r = await run([NET], ["yes"]);
  eq("network but it had landed -> no second write", [r.out, r.log.sent, r.log.saved], [{ kind: "saved", via: "already" }, 1, 1]);
  r = await run([NET, NET], ["no"]);
  eq("network twice -> kept (draft)", [r.out, r.log.sent, r.log.saved], [{ kind: "network", checkUnknown: false }, 2, 0]);
  r = await run([NET], ["unknown"]);
  eq("cannot tell if it landed -> do not send again", [r.out, r.log.sent], [{ kind: "network", checkUnknown: true }, 1]);
  r = await run([SERVER], []);
  eq("server answer -> no retry", [r.out.kind, r.log.sent, r.log.waited], ["server", 1, 0]);
  r = await run([EXPIRED], []);
  eq("expired login -> no retry, caller keeps its draft", [r.out.kind, r.log.sent], ["server", 1]);
  r = await run([NET, SERVER], ["no"]);
  eq("network then server answer -> server", [r.out.kind, r.log.sent], ["server", 2]);
  r = await run([], ["yes"], { checkFirstSince: 900_000 });
  eq("retrying a kept draft that had landed -> nothing sent", [r.out, r.log.sent], [{ kind: "saved", via: "already" }, 0]);
  r = await run([OK], ["no"], { checkFirstSince: 900_000 });
  eq("retrying a kept draft that had not landed -> sent once", [r.out, r.log.sent, r.log.checked], [{ kind: "saved", via: "first" }, 1, 1]);
  r = await run([], ["unknown"], { checkFirstSince: 900_000 });
  eq("retrying a kept draft, still offline -> nothing sent", [r.out.kind, r.log.sent], ["network", 0]);

  // 3) Did it land?
  const since = Date.parse("2026-11-14T06:00:00Z");
  eq("same status after the attempt -> yes", rs.landedFromRows(params, since, { outcome: "NOT_CONNECTED", outcome_at: "2026-11-14T06:00:05Z" }, false), "yes");
  eq("within the 2 min clock skew -> yes", rs.landedFromRows(params, since, { outcome: "NOT_CONNECTED", outcome_at: "2026-11-14T05:58:30Z" }, false), "yes");
  eq("old outcome -> no", rs.landedFromRows(params, since, { outcome: "NOT_CONNECTED", outcome_at: "2026-11-14T05:50:00Z" }, false), "no");
  eq("other status -> no", rs.landedFromRows(params, since, { outcome: "CONNECTED", outcome_at: "2026-11-14T06:00:05Z" }, false), "no");
  eq("no row -> no", rs.landedFromRows(params, since, null, false), "no");
  eq("note only, found -> yes", rs.landedFromRows({ p_new_status: null, p_note: "x" }, since, null, true), "yes");
  eq("nothing to save -> no", rs.landedFromRows({ p_new_status: null, p_note: null }, since, null, true), "no");

  // 4) Kept drafts (localStorage), across a restart
  const store = new Map();
  global.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const d = require(path.join(root, "lib/leadUpdateDraft.ts"));
  const t = Date.parse("2026-11-14T06:00:00Z");
  d.saveLeadUpdateDraft("lead-40", { status: "NOT_CONNECTED", note: "n", reminderValue: "", reminderUnit: "days", contactMethod: "CRM_CALL", pendingSince: t - 4000 }, null, t);
  eq("kept draft read back with pendingSince", d.loadLeadUpdateDraft("lead-40", t + 1000)?.pendingSince, t - 4000);
  eq("kept draft still there after 3 days", d.loadLeadUpdateDraft("lead-40", t + 3 * 86400000)?.status, "NOT_CONNECTED");
  eq("kept draft gone after 8 days", d.loadLeadUpdateDraft("lead-40", t + 8 * 86400000), null);
  d.saveLeadUpdateDraft("lead-41", { status: "CONNECTED", note: "", reminderValue: "", reminderUnit: "days", contactMethod: null }, null, t);
  eq("login-expired draft keeps its 24 h", d.loadLeadUpdateDraft("lead-41", t + 25 * 3600000), null);

  // 5) Delete refusals
  const empMsg = 'update or delete on table "employees" violates foreign key constraint "company_sim_assignments_created_by_employee_id_fkey" on table "company_sim_assignments"';
  eq("blocking table", fkBlockingTable(empMsg), "company_sim_assignments");
  eq("employee message", deleteBlockedMessage("employee", { code: "23503", message: empMsg }), "This employee still has records in company sim assignments. Deactivate the employee instead of deleting.");
  eq("candidate message", deleteBlockedMessage("candidate", { code: "23503", message: 'update or delete on table "candidates" violates foreign key constraint "x" on table "employee_creation_requests"' }), "This candidate still has records in employee creation requests. Remove those first, then delete.");
  eq("no table in message", deleteBlockedMessage("employee", { code: "23503", message: "fk" }), "This employee still has records in other parts of the system. Deactivate the employee instead of deleting.");
  eq("other errors untouched", deleteBlockedMessage("employee", { code: "42501", message: "x" }), null);

  // 6) Guards
  for (const f of ["components/LeadDetailModal.tsx", "components/DataDetailModal.tsx"]) {
    const src = read(f);
    if (!src.includes("const outcome = await saveLeadUpdate(")) problems.push(`${f} must save through saveLeadUpdate`);
    if (src.includes("await logLeadUpdate(")) problems.push(`${f} must not call logLeadUpdate directly`);
    if (!src.includes("pendingSince: kept?.pendingSince ?? startedAt")) problems.push(`${f} must keep a network draft with pendingSince`);
    if (!src.includes("Discard kept update")) problems.push(`${f} must let the employee discard a kept update`);
  }
  for (const f of ["components/LeadCard.tsx", "components/DataCard.tsx"]) if (/resultSave|resilientLeadUpdate/.test(read(f))) problems.push(`${f} must not change`);
  const click = read("lib/logCallClick.ts");
  if (!click.includes("if (!isRetry && isNetworkFailure({ error, status }))")) problems.push("a call click retries once, only on a network failure");
  if (!read("app/api/delete-employee/route.ts").includes('deleteBlockedMessage("employee", deleteEmployeeError)')) problems.push("delete-employee must name the blocking table");
  if (!read("app/hr/candidates/page.tsx").includes('deleteBlockedMessage("candidate", error)')) problems.push("candidate delete must name the blocking table");

  // Lead moved away while its card was open (2026-11-15): never retried, never kept, clear message, card dropped.
  eq("moved away: not owned", rs.isLeadMovedAwayError({ message: "log_lead_update_atomic: lead x is not owned by the calling employee" }), true);
  eq("moved away: history not mine", rs.isLeadMovedAwayError({ message: "log_lead_update_atomic: lead_history y does not belong to the calling employee for this lead" }), true);
  eq("moved away: terminal is not", rs.isLeadMovedAwayError({ message: "log_lead_update_atomic: lead x is already in a terminal status and cannot be updated" }), false);
  eq("moved away: network is not", rs.isLeadMovedAwayError({ message: "TypeError: Load failed" }), false);
  eq("moved away: no error", rs.isLeadMovedAwayError(null), false);
  eq("moved away message", rs.LEAD_MOVED_AWAY_MESSAGE, "This lead has been reassigned to someone else, so your update was not saved.");
  const moved = await run([{ error: { code: "P0001", message: "log_lead_update_atomic: lead x is not owned by the calling employee" }, status: 400 }], []);
  eq("moved away: a server answer, sent once, not retried", [moved.out.kind, moved.log.sent, moved.log.waited], ["server", 1, 0]);
  for (const f of ["components/LeadDetailModal.tsx", "components/DataDetailModal.tsx"]) {
    const m = read(f).replace(/\r\n/g, "\n");
    const i = m.indexOf("if (error && isLeadMovedAwayError(error)) {");
    const block = i < 0 ? "" : m.slice(i, m.indexOf("return;", i));
    if (i < 0) problems.push(`${f}: a moved-away refusal must be handled before the other server errors`);
    for (const need of ["clearLeadUpdateDraft(lead.id);", "setKeptDraft(false);", "showLeadMovedAwayToast(noteText);", 'severity: "info"', "onLeadGone()"])
      if (!block.includes(need)) problems.push(`${f}: moved-away handling must include ${need}`);
    if (/saveLeadUpdateDraft|showSaveKeptToast/.test(block)) problems.push(`${f}: a moved-away update must not be kept for a retry`);
  }
  for (const f of ["components/LeadList.tsx", "components/DataList.tsx"]) {
    if (!read(f).includes("setLeads((prev) => prev.filter((l) => l.id !== goneId));")) problems.push(`${f}: onLeadGone must drop the card`);
  }
  const rfSrc = read("lib/reportingFetch.ts");
  const libRe = (read("lib/resilientLeadUpdate.ts").match(/const MOVED_AWAY = (\/[^\n]+\/i);/) || [])[1];
  if (!libRe || !rfSrc.includes(`${libRe}.test(body.message || "")`)) problems.push("reportingFetch must skip the moved-away refusal with the same rule as isLeadMovedAwayError");
  if (/^import /m.test(rfSrc)) problems.push("lib/reportingFetch.ts must stay import-free (Edge Functions load it)");

  // /data realtime (2026-11-15): same channel pattern as LeadList; an ended assignment drops the card, an open card
  // closes the way a refused save does; channel only once there is an employee id (after the login check).
  const dl = read("components/DataList.tsx").replace(/\r\n/g, "\n");
  for (const need of [
    "if (!employeeId) return;",
    ".channel(`data-list-${employeeId}`)",
    '{ event: "*", schema: "public", table: "leads", filter: `current_owner_id=eq.${employeeId}` }',
    '{ event: "*", schema: "public", table: "lead_history", filter: `employee_id=eq.${employeeId}` }',
    "if (row.is_active === false && row.lead_id) {",
    "setGoneLeadId(goneId);",
    "supabase.removeChannel(channel);",
    "leadGone={goneLeadId === selectedLead.id}"
  ])
    if (!dl.includes(need)) problems.push(`components/DataList.tsx: realtime must include ${need}`);
  if (/setInterval\(\s*\(\)\s*=>\s*loadLeads/.test(dl)) problems.push("components/DataList.tsx: no polling, realtime only");
  const dm = read("components/DataDetailModal.tsx").replace(/\r\n/g, "\n");
  const gi = dm.indexOf("if (!leadGone) return;");
  const gone = gi < 0 ? "" : dm.slice(gi, dm.indexOf("}, [leadGone]);", gi));
  for (const need of ["clearLeadUpdateDraft(lead.id);", "showLeadMovedAwayToast(noteTextRef.current, LEAD_TAKEN_WHILE_OPEN_MESSAGE);", "onLeadGone()"])
    if (!gone.includes(need)) problems.push(`components/DataDetailModal.tsx: a lead gone while open must ${need}`);
  eq("taken while open message", rs.LEAD_TAKEN_WHILE_OPEN_MESSAGE, "This lead has been reassigned to someone else, so it was closed.");

  if (problems.length) {
    console.error("check-result-save: FAILED");
    for (const p of problems) console.error("  " + p);
    process.exit(1);
  }
  console.log("check-result-save: all known answers and guards pass.");
})();
