#!/usr/bin/env node
// "Given by admin" (2026-11-02) known-answer + guard check, run in prebuild. No DB access: the rows
// below are the shapes get_given_lead_context returned for the real leads in the rolled-back SQL tests.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const loaded = {};
const load = (file) => {
  if (loaded[file]) return loaded[file];
  const { outputText } = ts.transpileModule(read(`lib/${file}.ts`), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const mod = { exports: {} };
  loaded[file] = mod.exports;
  new Function("module", "exports", "require", outputText)(mod, mod.exports, (p) => load(path.basename(p).replace(/\.ts$/, "")));
  return (loaded[file] = mod.exports);
};
const { hasCallOrResult, givenBoxText, givenBoxVisible, givenFilterLeads, givenFilterCount, contextByLeadId, givenFlagAllows, givenFeatureUnavailable, readGivenCache, GIVEN_CACHE_MS, GIVEN_OFF_CACHE_MS } = load("givenLeadContext");

const problems = [];
const check = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${name}:\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`);
};
const at = (day) => `2026-${day}T06:00:00.000Z`;
const row = (over) => ({ lead_id: "L", lead_type: "LEAD", given_at: at("11-02"), protected_until: at("11-16"), in_filter: false, last_positive: null, note: null, after: null, your_notes: [], ...over });

check("19e4d6c7 own positive, exact note", givenBoxText(row({ last_positive: { kind: "CONNECTED", at: at("10-10"), is_you: true }, note: { text: "Postpone", at: at("10-10"), match: "exact" } })), {
  lastPositive: "Last positive conversation: Connected, 10 Oct, by you", note: 'Note: "Postpone"', after: null, protectedUntil: "Protected until 16 Nov", yourNotes: []
});
check("04b70632 someone else's: no name, no 'by'", givenBoxText(row({ last_positive: { kind: "CONNECTED", at: at("10-03"), is_you: false }, note: { text: "Not interested", at: at("10-03"), match: "exact" }, after: { outcome: "NOT_CONNECTED", at: at("10-21") } })), {
  lastPositive: "Last positive conversation: Connected, 3 Oct", note: 'Note: "Not interested"', after: "After that: Not connected, 21 Oct", protectedUntil: "Protected until 16 Nov", yourNotes: []
});
check("3e15afd4 overwritten outcome, own earlier note", givenBoxText(row({ last_positive: { kind: "FOLLOW_UP", at: at("10-13"), is_you: true }, note: { text: "Need 2bhk", at: at("10-13"), match: "exact" }, after: { outcome: "NOT_CONNECTED", at: at("10-16") }, your_notes: [{ at: at("10-16"), note: "Not piked", outcome: "NOT_CONNECTED" }] })), {
  lastPositive: "Last positive conversation: Follow-up, 13 Oct, by you", note: 'Note: "Need 2bhk"', after: "After that: Not connected, 16 Oct", protectedUntil: "Protected until 16 Nov", yourNotes: ["16 Oct · Not connected · Not piked"]
});
check("1d2439fb visit with no note", givenBoxText(row({ last_positive: { kind: "VISIT", at: at("09-06"), is_you: false }, after: { outcome: "NOT_INTERESTED", at: at("10-24") }, your_notes: [{ at: at("10-24"), note: "Ni", outcome: null }] })), {
  lastPositive: "Last positive conversation: Visit, 6 Sep", note: "No note was saved with this conversation.", after: "After that: Not interested, 24 Oct", protectedUntil: "Protected until 16 Nov", yourNotes: ["24 Oct · Ni"]
});
check("note saved at another time shows its own date", givenBoxText(row({ last_positive: { kind: "CONNECTED", at: at("10-10"), is_you: false }, note: { text: "Call later", at: at("10-12"), match: "other_time" } })).note, 'Note (12 Oct): "Call later"');
check("no positive conversation", givenBoxText(row({})), { lastPositive: "No earlier positive conversation was found.", note: null, after: null, protectedUntil: "Protected until 16 Nov", yourNotes: [] });

const now = Date.parse(at("11-10"));
check("box while protected, also out of the filter", givenBoxVisible(row({ in_filter: false }), now), true);
check("no box after protection", givenBoxVisible(row({ protected_until: at("11-09") }), now), false);
check("no box without context", givenBoxVisible(null, now), false);

// Count = list, and only leads the database put in the filter that are on this board.
const map = contextByLeadId([row({ lead_id: "A", in_filter: true }), row({ lead_id: "B", in_filter: false }), row({ lead_id: "D", in_filter: true, lead_type: "DATA" })]);
const leads = [{ id: "A" }, { id: "B" }, { id: "C" }];
check("filter list: in_filter and on the board", givenFilterLeads(leads, map).map((l) => l.id), ["A"]);
check("count = list", givenFilterCount(leads, map), givenFilterLeads(leads, map).length);
check("nothing loaded", givenFilterCount(leads, contextByLeadId(null)), 0);

// Rule v2: only a first call or a result takes a lead out.
const A0 = "2026-11-02T08:00:00.000Z";
const a = (over) => ({ call_count: 0, first_call_at: null, outcome_at: null, assigned_at: A0, last_activity_at: A0, ...over });
check("untouched", hasCallOrResult(a({})), false);
check("note only (last activity moved)", hasCallOrResult(a({ last_activity_at: "2026-11-02T09:00:00.000Z" })), false);
check("reminder only (last activity moved)", hasCallOrResult(a({ last_activity_at: "2026-11-03T09:00:00.000Z" })), false);
check("stage move only (last activity moved)", hasCallOrResult(a({ last_activity_at: "2026-11-02T10:00:00.000Z" })), false);
check("pause-expiry sweep (last activity moved)", hasCallOrResult(a({ last_activity_at: "2026-11-09T10:00:00.000Z" })), false);
check("restore: outcome set when assigning", hasCallOrResult(a({ outcome_at: A0 })), false);
check("call", hasCallOrResult(a({ call_count: 1, first_call_at: "2026-11-02T09:00:00.000Z" })), true);
check("first_call_at alone", hasCallOrResult(a({ first_call_at: "2026-11-02T09:00:00.000Z" })), true);
check("result saved", hasCallOrResult(a({ outcome_at: "2026-11-02T09:00:00.000Z" })), true);
const m2 = contextByLeadId([row({ lead_id: "N", in_filter: true }), row({ lead_id: "C", in_filter: true })]);
const l2 = [{ id: "N", lead_history: [a({ last_activity_at: "2026-11-02T09:00:00.000Z" })] }, { id: "C", lead_history: [a({ call_count: 1 })] }];
check("page: note stays, call leaves straight away", givenFilterLeads(l2, m2).map((l) => l.id), ["N"]);
check("page: count = list", givenFilterCount(l2, m2), 1);
const ruleSql = read("supabase/sql/2026-11-02_given_lead_context_rule_v2.sql");
const inFilter = ruleSql.slice(ruleSql.indexOf("'in_filter'"), ruleSql.indexOf("'last_positive'"));
if (inFilter.includes("last_activity_at")) problems.push("in_filter must not read last_activity_at");
if (read("lib/givenLeadContext.ts").slice(0).match(/hasCallOrResult[\s\S]*?\n}/)?.[0].includes("history.last_activity_at")) problems.push("hasCallOrResult must not read last_activity_at");

// Flag: no call at all unless the employee is included. Columns missing (SQL not applied) = off.
check("settings without the columns (SQL not applied)", givenFlagAllows({ id: 1 }, "E1"), false);
check("no settings row", givenFlagAllows(null, "E1"), false);
check("off", givenFlagAllows({ given_lead_context_mode: "off", given_lead_context_pilot_ids: ["E1"] }, "E1"), false);
check("pilot, in the list", givenFlagAllows({ given_lead_context_mode: "admin_pilot", given_lead_context_pilot_ids: ["E1"] }, "E1"), true);
check("pilot, not in the list", givenFlagAllows({ given_lead_context_mode: "admin_pilot", given_lead_context_pilot_ids: ["E2"] }, "E1"), false);
check("on", givenFlagAllows({ given_lead_context_mode: "on" }, "E1"), true);
check("on, no employee", givenFlagAllows({ given_lead_context_mode: "on" }, null), false);
// Function missing or not allowed: hidden quietly. Anything else is a real error and stays reported.
check("PGRST202 / 42501 / 42883 hide the feature", [givenFeatureUnavailable({ code: "PGRST202" }), givenFeatureUnavailable({ code: "42501" }), givenFeatureUnavailable({ code: "42883" })], [true, true, true]);
check("another error is not 'unavailable'", [givenFeatureUnavailable({ code: "500" }), givenFeatureUnavailable(null)], [false, false]);
const reporting = read("lib/reportingFetch.ts");
if (!reporting.includes('url.includes("/rpc/get_given_lead_context") && ["PGRST202", "42501", "42883"].includes(code)')) problems.push("reportingFetch would log the missing function as an error");
// Session cache.
const entry = (at, enabled) => JSON.stringify({ at, enabled, leads: [] });
check("cache: fresh", readGivenCache(entry(1000, true), 1000 + GIVEN_CACHE_MS - 1) !== null, true);
check("cache: old", readGivenCache(entry(1000, true), 1000 + GIVEN_CACHE_MS), null);
check("cache: 'off' lasts longer", readGivenCache(entry(1000, false), 1000 + GIVEN_OFF_CACHE_MS - 1) !== null, true);
check("cache: broken text", readGivenCache("{oops", 1000), null);
check("cache: nothing", readGivenCache(null, 1000), null);
const hook = read("lib/useGivenLeadContext.ts");
if (hook.indexOf("givenFlagAllows(settings, employeeId)") === -1 || hook.indexOf("givenFlagAllows(settings, employeeId)") > hook.indexOf('rpc("get_given_lead_context")')) problems.push("the function must not be called before the flag check");
if (!read("components/LeadList.tsx").includes("givenContext.refresh()")) problems.push("LeadList does not refresh after a saved result");

// Guards: where this is allowed to live, and what it must never do.
const list = read("components/LeadList.tsx");
for (const n of ["useGivenLeadContext(employeeId)", "givenFilterLeads(result, givenContext.byLeadId)", "givenFilterCount(leads, givenContext.byLeadId)", "givenContext.enabled &&"]) {
  if (!list.includes(n)) problems.push(`LeadList.tsx is missing ${n}`);
}
if (!read("components/LeadDetailModal.tsx").includes("<GivenLeadContextBox")) problems.push("LeadDetailModal.tsx does not show the box");
if (/given/i.test(read("components/LeadCard.tsx"))) problems.push("the lead card must not know about this feature");
if (/given/i.test(read("lib/newLeadFilter.ts"))) problems.push("the New filter must not know about this feature");
const sql = read("supabase/sql/2026-11-02_given_lead_context.sql");
const fnBody = sql.slice(sql.indexOf("create or replace function public.given_lead_context_for"));
if (/\b(insert\s+into|update\s+\w+\s+set|delete\s+from)\b/i.test(fnBody)) problems.push("the context functions must not write");
if (/\bemployees\b|employee_name|\.name\b/i.test(fnBody)) problems.push("the context functions must not touch employee names");
if (/from public, anon, authenticated/.test(sql) === false) problems.push("given_lead_context_for must be closed to authenticated");
for (const f of ["lib/givenLeadContext.ts", "components/GivenLeadContextBox.tsx"]) {
  if (/owner_name|employee_name|by_name/.test(read(f))) problems.push(`${f} refers to an employee name`);
}

if (problems.length) {
  console.error("check-given-context: FAILED\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log("check-given-context: all known answers and guards pass.");
