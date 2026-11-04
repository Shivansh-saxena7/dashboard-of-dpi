#!/usr/bin/env node
// Data page status chips (2026-11-04) known-answer + guard check, run in prebuild. No DB access.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const problems = [];
require.extensions[".ts"] = (m, f) =>
  m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, f);
const { dataFilterByStatus, dataStatusChips, effectiveDataStatusFilter, isDataStatusFilterValue } = require(path.join(root, "lib/dataStatusFilter.ts"));

const eq = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const T = "2026-11-01T10:00:00Z";
const fresh = { call_count: 0, assigned_at: T, last_activity_at: T };
const leads = [
  { id: "a", status: "NEW", lead_history: [fresh] },
  { id: "b", status: "NEW", lead_history: [{ ...fresh, call_count: 1 }] },
  { id: "c", status: "CONNECTED", lead_history: [fresh] },
  { id: "d", status: "NOT_CONNECTED", lead_history: [{ ...fresh, call_count: 2, outcome_at: "2026-11-02T10:00:00Z" }] },
  { id: "e", status: "CONVERTED", lead_history: [{ ...fresh, call_count: 1 }] },
  { id: "f", status: "NOT_INTERESTED", lead_history: [{ ...fresh, call_count: 1 }] },
  { id: "g", status: "SWITCHED_OFF", lead_history: [{ ...fresh, call_count: 1 }] }
];
const given = new Map([["c", { lead_id: "c", in_filter: true }], ["d", { lead_id: "d", in_filter: true }], ["a", { lead_id: "a", in_filter: false }]]);
const ids = (rows) => rows.map((r) => r.id).join("");

eq("all", ids(dataFilterByStatus(leads, "", given)), "abcdefg");
eq("new is untouched, not status NEW", ids(dataFilterByStatus(leads, "NEW", given)), "ac");
eq("connected", ids(dataFilterByStatus(leads, "CONNECTED", given)), "c");
eq("not connected", ids(dataFilterByStatus(leads, "NOT_CONNECTED", given)), "d");
eq("converted", ids(dataFilterByStatus(leads, "CONVERTED", given)), "e");
eq("not interested", ids(dataFilterByStatus(leads, "NOT_INTERESTED", given)), "f");
eq("switched off", ids(dataFilterByStatus(leads, "SWITCHED_OFF", given)), "g");
eq("given: in filter and no call yet", ids(dataFilterByStatus(leads, "GIVEN_BY_ADMIN", given)), "c");

const chips = dataStatusChips(leads, true, given);
eq("chip order", chips.map((c) => c.label), ["All", "Given by admin", "New", "Connected", "Not Connected", "Switched Off", "Not Interested", "Converted"]);
eq("chip counts", chips.map((c) => c.count), [7, 1, 2, 1, 1, 1, 1, 1]);
eq("no given chip when off", dataStatusChips(leads, false, new Map()).some((c) => c.value === "GIVEN_BY_ADMIN"), false);
eq("each chip count matches its list", chips.every((c) => c.count === dataFilterByStatus(leads, c.value, given).length), true);

eq("given stays when on", effectiveDataStatusFilter("GIVEN_BY_ADMIN", true), "GIVEN_BY_ADMIN");
eq("given is All when off", effectiveDataStatusFilter("GIVEN_BY_ADMIN", false), "");
eq("other stays", effectiveDataStatusFilter("NEW", false), "NEW");
eq("saved value ok", isDataStatusFilterValue("CONNECTED"), true);
eq("saved junk refused", isDataStatusFilterValue("JUNK"), false);
eq("saved nonsense refused", isDataStatusFilterValue("x"), false);
eq("saved null refused", isDataStatusFilterValue(null), false);

const list = read("components/DataList.tsx");
if (!list.includes('.eq("current_owner_id", employeeId)')) problems.push("DataList must stay scoped to the employee's own leads");
if (!list.includes('.eq("lead_type", "DATA")')) problems.push("DataList must stay on DATA leads");
if (!list.includes('.eq("lead_history.employee_id", employeeId)')) problems.push("DataList must stay on the employee's own assignment");
if (!list.includes("useGivenLeadContext(employeeId)")) problems.push("the Given by admin chip must use the shared hook");
if (/setInterval/.test(list)) problems.push("the Data page must not poll");

if (problems.length) {
  console.error("check-data-status-filter: FAILED");
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}
console.log("check-data-status-filter: all known answers and guards pass.");
