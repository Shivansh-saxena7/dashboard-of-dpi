#!/usr/bin/env node
// /api/data access (2026-11-02) known-answer + guard check, run in prebuild. No DB access.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const problems = [];

const { outputText } = ts.transpileModule(read("lib/apiDataAccess.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
});
const mod = { exports: {} };
new Function("module", "exports", outputText)(mod, mod.exports);
const { decideApiDataAccess: d } = mod.exports;

const emp = { id: "E1", role: "employee", is_active: true };
const day = "2026-11-02";
const cases = [
  ["no employee row", d(null, null, day), { ok: false, status: 403, error: "Not allowed" }],
  ["inactive employee", d({ ...emp, is_active: false }, "E1", day), { ok: false, status: 403, error: "Not allowed" }],
  ["employee, own row + date", d(emp, "E1", day), { ok: true, employeeId: "E1", date: day }],
  ["employee, no id: forced to own", d(emp, null, day), { ok: true, employeeId: "E1", date: day }],
  ["employee asks for someone else", d(emp, "E2", day), { ok: false, status: 403, error: "Not allowed" }],
  ["employee without a date (was the whole table)", d(emp, "E1", null), { ok: false, status: 400, error: "A date is required" }],
  ["employee with an empty date", d(emp, "E1", ""), { ok: false, status: 400, error: "A date is required" }],
  ["bad date", d(emp, "E1", "x' or 1=1"), { ok: false, status: 400, error: "Invalid date" }],
  ["team leader: own only", d({ ...emp, role: "team_leader" }, "E2", day), { ok: false, status: 403, error: "Not allowed" }],
  ["hr: own only", d({ ...emp, role: "hr" }, "E1", day), { ok: true, employeeId: "E1", date: day }],
  ["admin, everything", d({ ...emp, role: "admin" }, null, null), { ok: true, employeeId: null, date: null }],
  ["super_admin, everything", d({ ...emp, role: "super_admin" }, null, null), { ok: true, employeeId: null, date: null }],
  ["admin, one employee + date", d({ ...emp, role: "admin" }, "E2", day), { ok: true, employeeId: "E2", date: day }],
  ["inactive admin", d({ ...emp, role: "admin", is_active: false }, null, null), { ok: false, status: 403, error: "Not allowed" }]
];
for (const [name, got, want] of cases) {
  if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

const route = read("app/api/data/route.ts");
if (/SERVICE_ROLE|supabaseAdmin/.test(route)) problems.push("app/api/data/route.ts must not use the service_role key");
for (const needle of ['request.headers.get("Authorization")', "auth.getUser(", "decideApiDataAccess(", "fetchAllRows("]) {
  if (!route.includes(needle)) problems.push(`app/api/data/route.ts is missing ${needle}`);
}
for (const file of ["app/admin/analytics/page.tsx", "app/admin/employees/[id]/page.tsx", "app/admin/page.tsx", "components/EmployeeDetails.tsx", "components/PostsTrackingView.tsx"]) {
  const src = read(file);
  if (/[^d]fetch\(\s*[`"]\/api\/data/.test(src)) problems.push(`${file} calls /api/data without the login token (use authedFetch)`);
}
if (/setInterval\([^)]*5000\)/.test(read("components/PostsTrackingView.tsx"))) problems.push("PostsTrackingView polls every 5 seconds again");

if (problems.length) {
  console.error("check-api-data-auth: FAILED\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log(`check-api-data-auth: all ${cases.length} known answers and guards pass.`);
