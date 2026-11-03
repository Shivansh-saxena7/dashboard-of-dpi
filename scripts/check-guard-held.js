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
const { guardHeldUnavailable, positiveLabel, refusedForText, shortDateIst } = mod.exports;

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
