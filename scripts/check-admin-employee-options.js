#!/usr/bin/env node
// Admin employee filter (2026-11-13): known answers + page guards, run in prebuild. No DB.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const problems = [];
require.extensions[".ts"] = (m, f) =>
  m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, f);
const { splitAdminEmployeeOptions, adminEmployeeLabel } = require(path.join(root, "lib/adminEmployeeOptions.ts"));
const eq = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const list = [
  { id: "1", name: "Yogesh", is_active: true },
  { id: "2", name: "Muskan", is_active: false },
  { id: "3", name: "Kashish", is_active: true },
  { id: "4", name: "Suraj", is_active: false },
  { id: "5", name: "", is_active: false }
];
const g = splitAdminEmployeeOptions(list);
eq("active first, by name", g.active.map((e) => e.id), ["3", "1"]);
eq("inactive separate, by name", g.inactive.map((e) => e.id), ["5", "2", "4"]);
eq("nobody lost", g.active.length + g.inactive.length, list.length);
eq("input not changed", list.map((e) => e.id), ["1", "2", "3", "4", "5"]);
eq("active label", adminEmployeeLabel(list[0]), "Yogesh");
eq("inactive label", adminEmployeeLabel(list[1]), "Muskan (inactive)");
eq("empty list", splitAdminEmployeeOptions([]), { active: [], inactive: [] });

const page = read("app/admin/leads/page.tsx");
if (!page.includes('<optgroup label="Inactive employees">')) problems.push("the Admin Leads filter must list inactive employees in their own group");
if (!page.includes("splitAdminEmployeeOptions(employees)")) problems.push("the Admin Leads filter must use splitAdminEmployeeOptions");
// The "Assign to..." picker must stay active-only: a lead must never be handed to someone who has left.
const assign = page.slice(page.indexOf('<option value="">Assign to...</option>'), page.indexOf('<option value="">Assign to...</option>') + 400);
if (!assign.includes(".filter((e) => e.is_active)")) problems.push('the "Assign to..." picker must list active employees only');
const layout = read("app/admin/layout.tsx");
if (!/data\.role !== "admin" && data\.role !== "super_admin"/.test(layout)) problems.push("the Admin area must stay admin / super_admin only");

if (problems.length) {
  console.error("check-admin-employee-options: FAILED");
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}
console.log("check-admin-employee-options: all known answers and guards pass.");
