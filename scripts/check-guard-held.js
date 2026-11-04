#!/usr/bin/env node
// "Leads held by the guard" card (2026-11-03) known-answer + guard check, run in prebuild. No DB access.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const problems = [];

const { outputText } = ts.transpileModule(read("lib/guardHeldLeads.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
});
const mod = { exports: {} };
new Function("module", "exports", outputText)(mod, mod.exports);
const { guardHeldUnavailable, positiveLabel, refusedForText, shortDateIst, heldLeadIdRange, heldReassignTargets, heldReassignOutcome, HELD_REASSIGN_REASON } = mod.exports;

const eq = (name, got, want) => {
  if (got !== want) problems.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
eq("missing function hides", guardHeldUnavailable({ code: "PGRST202" }), true);
eq("not allowed hides", guardHeldUnavailable({ code: "42501" }), true);
eq("other error shows", guardHeldUnavailable({ code: "500" }), false);
eq("no error", guardHeldUnavailable(null), false);
eq("connected", positiveLabel("CONNECTED"), "Connected");
eq("follow-up", positiveLabel("FOLLOW_UP"), "Follow-up");
eq("empty kind", positiveLabel(null), "-");
eq("today", refusedForText(0), "Today");
eq("one day", refusedForText(1), "1 day");
eq("days", refusedForText(4), "4 days");
eq("no value", refusedForText(null), "Today");
eq("date is IST", shortDateIst("2026-11-02T19:00:00Z"), "3 Nov");
eq("no date", shortDateIst(null), "-");
eq("bad date", shortDateIst("x"), "-");

// Reassign action (2026-11-04)
eq("id range from", heldLeadIdRange("1e6bf2f9")?.from, "1e6bf2f9-0000-0000-0000-000000000000");
eq("id range to", heldLeadIdRange("1e6bf2f9")?.to, "1e6bf2f9-ffff-ffff-ffff-ffffffffffff");
eq("bad id", heldLeadIdRange("1e6bf2f9' or 1=1"), null);
eq("short id", heldLeadIdRange("1e6b"), null);
const people = [
  { id: "a", name: "Zed", role: "employee", department: "sales", is_active: true },
  { id: "b", name: "Amy", role: "team_leader", department: "sales", is_active: true },
  { id: "c", name: "Owner", role: "employee", department: "sales", is_active: true },
  { id: "d", name: "Off", role: "employee", department: "sales", is_active: false },
  { id: "e", name: "HR", role: "hr", department: "hr", is_active: true },
  { id: "f", name: "Boss", role: "admin", department: "sales", is_active: true }
];
eq("targets", heldReassignTargets(people, "c").map((p) => p.id).join(","), "b,a");
eq("success", heldReassignOutcome({ result: "REASSIGNED", employee_name: "Amy " }, null).message, "Lead reassigned to Amy.");
eq("success ok", heldReassignOutcome({ result: "REASSIGNED" }, null).ok, true);
eq("already ok", heldReassignOutcome({ result: "ALREADY" }, null).ok, true);
eq("held fails", heldReassignOutcome({ result: "HELD", employee_name: "Amy" }, null).ok, false);
eq("held hides the holder", /Amy/.test(heldReassignOutcome({ result: "HELD", employee_name: "Amy" }, null).message), false);
eq("non-admin", heldReassignOutcome(null, { code: "P0001", message: "reassign_keep_state_atomic: admin only" }).message, "Only an admin can reassign this lead.");
eq("junk", heldReassignOutcome(null, { message: "lead 1 is junk or merged (use Restore for junk leads)" }).ok, false);
eq("expired session", heldReassignOutcome(null, { code: "SESSION_EXPIRED", message: "Your session has expired. Please log in again." }).message, "Your session has expired. Please log in again.");
eq("unknown result", heldReassignOutcome({ result: "X" }, null).ok, false);
eq("reason long enough", HELD_REASSIGN_REASON.length >= 5, true);

const dialog = read("components/GuardHeldReassignDialog.tsx");
if (/mobile/i.test(dialog)) problems.push("the dialog must not read or show a mobile number");
if (!dialog.includes('supabase.rpc("reassign_keep_state_atomic"')) problems.push("the dialog must use reassign_keep_state_atomic");
if (/force_reassign_lead_atomic|bulk_reassign_leads_atomic/.test(dialog)) problems.push("the dialog must not use a reassign that resets status");
if (!/history and status will not change/.test(dialog)) problems.push("the dialog must say history and status stay");
if (!read("components/GuardHeldLeadsCard.tsx").includes("GuardHeldReassignDialog")) problems.push("the card must offer the dialog");

const sql = read("supabase/sql/2026-11-03_guard_held_leads.sql");
const body = sql.slice(sql.indexOf("create or replace function"));
if (/mobile/i.test(body)) problems.push("the function must not read a mobile number");
if (!/not in \('admin', 'super_admin'\)/.test(body)) problems.push("the function must allow only admin and super_admin");
if (!/coalesce\(current_employee_role\(\), ''\)/.test(body)) problems.push("the role check must not pass on a NULL role");
if (!/revoke all on function public\.get_guard_held_leads\(\) from public, anon/.test(body)) problems.push("anon must not run the function");
if (!/security definer set search_path/.test(body)) problems.push("the function must pin search_path");
if (/\b(insert|update|delete)\s+(into\s+)?(leads|lead_history|lead_guard_events|lead_engine_settings)\b/i.test(body)) problems.push("the function must be read-only");
if (/mobile/i.test(read("components/GuardHeldLeadsCard.tsx"))) problems.push("the card must not show a mobile number");
if (!read("lib/reportingFetch.ts").includes("/rpc/get_guard_held_leads")) problems.push("reportingFetch must not log the expected hidden state");
if (!read("app/admin/system-health/page.tsx").includes("GuardHeldLeadsCard")) problems.push("system-health must show the card");

if (problems.length) {
  console.error("check-guard-held: FAILED");
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}
console.log("check-guard-held: all known answers and guards pass.");
