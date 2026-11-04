#!/usr/bin/env node
// Data page history boxes (2026-11-04) known-answer + guard check, run in prebuild. No DB access.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const problems = [];
require.extensions[".ts"] = (m, f) =>
  m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, f);
const { previousPositiveByLeadId, previousPositiveText, readPreviousPositiveCache, PREVIOUS_POSITIVE_CACHE_MS } = require(path.join(root, "lib/dataPreviousPositive.ts"));

const eq = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const row = { lead_id: "a", last_positive: { kind: "CONNECTED", at: "2026-10-12T06:00:00Z", is_you: false }, after: { outcome: "NOT_CONNECTED", at: "2026-10-15T06:00:00Z" } };
eq("team member", previousPositiveText(row).lastPositive, "Last positive conversation: Connected, 12 Oct, by a team member");
eq("after", previousPositiveText(row).after, "After that: Not connected, 15 Oct");
eq("you", previousPositiveText({ ...row, last_positive: { ...row.last_positive, is_you: true } }).lastPositive, "Last positive conversation: Connected, 12 Oct, by you");
eq("no after", previousPositiveText({ ...row, after: null }).after, null);
eq("map", previousPositiveByLeadId([row]).get("a")?.lead_id, "a");
eq("map empty", previousPositiveByLeadId(null).size, 0);
eq("cache fresh", readPreviousPositiveCache(JSON.stringify({ at: 1000, leads: [] }), 1000 + PREVIOUS_POSITIVE_CACHE_MS - 1)?.at, 1000);
eq("cache old", readPreviousPositiveCache(JSON.stringify({ at: 1000, leads: [] }), 1000 + PREVIOUS_POSITIVE_CACHE_MS), null);
eq("cache bad", readPreviousPositiveCache("x", 1), null);
eq("cache none", readPreviousPositiveCache(null, 1), null);

const sql = read("supabase/sql/2026-11-04_data_previous_positive.sql");
const body = sql.slice(sql.indexOf("create or replace function"));
const output = body.slice(body.indexOf("jsonb_build_object('leads', coalesce"), body.indexOf("from mine m"));
if (/mobile|name|note|email/i.test(output)) problems.push("the function result must carry no number, name or note");
if (!/l\.current_owner_id = v_employee/.test(body) || !/h\.employee_id = v_employee/.test(body)) problems.push("the function must read only the caller's own leads");
if (!/v_employee uuid := current_employee_id\(\)/.test(body)) problems.push("the owner must come from the login, not a parameter");
if (!/get_data_previous_positive\(\)\s*\n?returns jsonb/.test(body)) problems.push("the function must take no parameter");
if (!/revoke all on function public\.get_data_previous_positive\(\) from public, anon/.test(body)) problems.push("anon must not run the function");
if (!/grant execute on function public\.get_data_previous_positive\(\) to authenticated, service_role/.test(body)) problems.push("only authenticated and service_role may run the function");
if (!/security definer set search_path/.test(body)) problems.push("the function must pin search_path");
if (/\b(insert into|update\s+\w+\s+set|delete from)\b/i.test(body)) problems.push("the function must be read-only");

const hook = read("lib/useDataPreviousPositive.ts");
if (/setInterval|postgres_changes|channel\(/.test(hook)) problems.push("the hook must not poll or subscribe");
if ((hook.match(/supabase\.rpc\(/g) || []).length !== 1) problems.push("the hook must have one call");
if (/mobile|employee_name/i.test(read("components/PreviousPositiveBox.tsx"))) problems.push("the box must show no number or employee name");
if (!read("lib/reportingFetch.ts").includes("/rpc/get_data_previous_positive")) problems.push("reportingFetch must not log the expected hidden state");
const modal = read("components/DataDetailModal.tsx");
if (!modal.includes("GivenLeadContextBox") || !modal.includes("PreviousPositiveBox")) problems.push("the Data detail view must show both boxes");
const list = read("components/DataList.tsx");
if (!list.includes("useGivenLeadContext(employeeId)") || !list.includes("useDataPreviousPositive(employeeId)")) problems.push("the Data page must use the shared hooks");
if (/setInterval/.test(list)) problems.push("the Data page must not poll");

if (problems.length) {
  console.error("check-data-previous-positive: FAILED");
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}
console.log("check-data-previous-positive: all known answers and guards pass.");
