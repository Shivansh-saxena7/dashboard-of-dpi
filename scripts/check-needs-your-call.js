#!/usr/bin/env node
// "Needs your call" (2026-11-12) known-answer + guard check, run in prebuild. No DB access.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const problems = [];
require.extensions[".ts"] = (m, f) =>
  m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, f);
const nc = require(path.join(root, "lib/needsYourCall.ts"));
const ds = require(path.join(root, "lib/dataStatusFilter.ts"));

const eq = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const REFUSED = "2026-11-12T06:30:00Z";
const rows = [
  { lead_id: "a", positive_kind: "CONNECTED", last_refused_at: REFUSED },
  { lead_id: "b", positive_kind: "FOLLOW_UP", last_refused_at: REFUSED },
  { lead_id: "c", positive_kind: "CONVERTED", last_refused_at: REFUSED }
];
const byId = nc.needsCallByLeadId(rows);
const leads = [
  { id: "a", status: "NEW", lead_history: [{ last_activity_at: "2026-10-26T08:33:00Z", outcome_at: null, call_count: 1, assigned_at: "2026-10-26T08:30:00Z" }] },
  { id: "b", status: "NOT_CONNECTED", lead_history: [{ last_activity_at: "2026-11-12T07:00:00Z", outcome_at: null, call_count: 2, assigned_at: "2026-10-20T08:30:00Z" }] },
  { id: "c", status: "NEW", lead_history: [{ last_activity_at: "2026-10-26T08:33:00Z", outcome_at: "2026-11-12T08:00:00Z", call_count: 1, assigned_at: "2026-10-26T08:30:00Z" }] },
  { id: "d", status: "NEW", lead_history: [{ last_activity_at: "2026-10-26T08:33:00Z", outcome_at: null, call_count: 0, assigned_at: "2026-10-26T08:30:00Z" }] }
];
const ids = (r) => r.map((x) => x.id).join("");

eq("only held leads not worked since the refusal", ids(nc.needsCallFilterLeads(leads, byId)), "a");
eq("activity after the refusal takes it out", nc.workedSinceRefusal(leads[1].lead_history[0], REFUSED), true);
eq("a result after the refusal takes it out", nc.workedSinceRefusal(leads[2].lead_history[0], REFUSED), true);
eq("old activity keeps it in", nc.workedSinceRefusal(leads[0].lead_history[0], REFUSED), false);
eq("no history keeps it in", nc.workedSinceRefusal(null, REFUSED), false);
eq("bad refusal time keeps it in", nc.workedSinceRefusal(leads[1].lead_history[0], "x"), false);
eq("option text", nc.needsCallOptionText(3), "Needs your call (3)");
eq("missing function hides", nc.needsCallUnavailable({ code: "PGRST202" }), true);
eq("not allowed hides", nc.needsCallUnavailable({ code: "42501" }), true);
eq("other error shows", nc.needsCallUnavailable({ code: "500" }), false);
eq("cache fresh", nc.readNeedsCallCache(JSON.stringify({ at: 1000, leads: [] }), 1000 + nc.NEEDS_CALL_CACHE_MS - 1)?.at, 1000);
eq("cache old", nc.readNeedsCallCache(JSON.stringify({ at: 1000, leads: [] }), 1000 + nc.NEEDS_CALL_CACHE_MS), null);
eq("cache bad", nc.readNeedsCallCache("x", 1), null);

// Data page: same rule through the shared status lib
const on = { enabled: true, byLeadId: byId };
eq("data filter", ids(ds.dataFilterByStatus(leads, nc.NEEDS_CALL_FILTER, new Map(), on)), "a");
const opts = ds.dataStatusOptions(leads, false, new Map(), on);
eq("data option after All", opts.slice(0, 2).map((o) => o.label + ":" + o.count), ["All statuses:4", "Needs your call:1"]);
eq("data option hidden when off", ds.dataStatusOptions(leads, false, new Map()).some((o) => o.value === nc.NEEDS_CALL_FILTER), false);
eq("data saved value accepted", ds.isDataStatusFilterValue(nc.NEEDS_CALL_FILTER), true);
eq("data filter counts as All when off", ds.effectiveDataStatusFilter(nc.NEEDS_CALL_FILTER, true, false), "");
eq("data filter stays when on", ds.effectiveDataStatusFilter(nc.NEEDS_CALL_FILTER, true, true), nc.NEEDS_CALL_FILTER);

// SQL
const sql = read("supabase/sql/2026-11-12_my_guard_held_leads.sql");
const body = sql.slice(sql.indexOf("create or replace function"));
const output = body.slice(body.indexOf("jsonb_build_object('leads'"), body.indexOf("from leads l"));
if (/mobile|name|note|email|employee/i.test(output)) problems.push("the result must carry only lead id, kind and refusal time");
if (!/v_employee uuid := current_employee_id\(\)/.test(body)) problems.push("the owner must come from the login");
if (!/h\.employee_id = v_employee/.test(body) || !/l\.current_owner_id = v_employee/.test(body)) problems.push("only the caller's own active leads");
if (!/get_my_guard_held_leads\(\)\s*\n?returns jsonb/.test(body)) problems.push("the function must take no parameter");
if (!/revoke all on function public\.get_my_guard_held_leads\(\) from public, anon/.test(body)) problems.push("anon must not run it");
if (!/grant execute on function public\.get_my_guard_held_leads\(\) to authenticated, service_role/.test(body)) problems.push("only authenticated and service_role");
if (!/security definer set search_path/.test(body)) problems.push("search_path must be pinned");
if (/\b(insert into|update\s+\w+\s+set|delete from)\b/i.test(body)) problems.push("the function must be read-only");
const card = read("supabase/sql/2026-11-03_guard_held_leads.sql");
for (const rule of ["g.source = 'db_positive_junk_guard'", "g.action = 'JUNK_REFUSED'", "g.created_at >= h.assigned_at", "l.recycle_count >= 3", "interval '3 days'", "lead_positive_history_kind(l.id)"]) {
  if (!card.includes(rule) || !body.includes(rule)) problems.push(`same rule as the System Health card: ${rule}`);
}

// UI
const hook = read("lib/useNeedsYourCall.ts");
if (/setInterval|postgres_changes|channel\(/.test(hook)) problems.push("the hook must not poll or subscribe");
if ((hook.match(/supabase\.rpc\(/g) || []).length !== 1) problems.push("the hook must have one call");
const leadList = read("components/LeadList.tsx");
if (!leadList.includes("useNeedsYourCall(employeeId)") || !leadList.includes("needsCallFilterLeads(")) problems.push("Leads page must use the shared rule");
if (!read("components/DataList.tsx").includes("useNeedsYourCall(employeeId)")) problems.push("Data page must use the shared hook");
if (!read("lib/reportingFetch.ts").includes("/rpc/get_my_guard_held_leads")) problems.push("a missing function must not be logged as an error");

if (problems.length) {
  console.error("check-needs-your-call: FAILED");
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}
console.log("check-needs-your-call: all known answers and guards pass.");
