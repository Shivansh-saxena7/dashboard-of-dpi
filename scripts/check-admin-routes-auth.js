#!/usr/bin/env node
// Admin API routes (2026-11-02) known-answer + guard check, run in prebuild. No DB or network access:
// resolveAdminCaller runs against stubs of the token check and of the employee lookup.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const problems = [];

const ROUTES = [
  "admin/update-user", "create-employee", "delete-employee", "update-employee-email",
  "admin/update-lead-engine-settings", "admin/update-shift-timing", "admin/update-sla-office-hours", "admin/update-work-report-settings"
];
const CALLERS = {
  "app/admin/settings/page.tsx": ["admin/update-sla-office-hours", "admin/update-shift-timing", "admin/update-work-report-settings", "admin/update-lead-engine-settings", "admin/update-user"],
  "app/admin/employees/page.tsx": ["update-employee-email", "delete-employee"],
  "app/admin/components/AddEmployeeesModal.tsx": ["create-employee"]
};

// Every route checks the caller before it reads the body or touches the database.
for (const r of ROUTES) {
  const src = read(`app/api/${r}/route.ts`);
  const body = src.slice(src.indexOf("export async function POST"));
  const guard = body.indexOf("resolveAdminCaller(req)");
  const firstWork = body.search(/req\.json\(\)|supabaseAdmin/);
  if (guard === -1) problems.push(`${r} has no resolveAdminCaller check`);
  else if (firstWork !== -1 && firstWork < guard) problems.push(`${r} does work before checking the caller`);
  if (!body.includes("if (auth.errorResponse) return auth.errorResponse;")) problems.push(`${r} does not stop on a refused caller`);
}
// Every caller sends the login token.
for (const [file, paths] of Object.entries(CALLERS)) {
  const src = read(file);
  for (const r of paths) {
    if (!src.includes(`authedFetch("/api/${r}"`)) problems.push(`${file} calls /api/${r} without the login token`);
  }
}

const { outputText } = ts.transpileModule(read("lib/resolveAdminCaller.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
});
let tokenResult, employeeResult;
const stubs = {
  "@supabase/supabase-js": { createClient: () => ({ auth: { getUser: async () => tokenResult } }) },
  "next/server": { NextResponse: { json: (body, init) => ({ body, status: init.status }) } },
  "./supabaseAdmin": { supabaseAdmin: { from: () => ({ select: () => ({ eq: () => ({ single: async () => employeeResult }) }) }) } }
};
const mod = { exports: {} };
new Function("module", "exports", "require", "process", outputText)(mod, mod.exports, (m) => stubs[m], { env: {} });
const { resolveAdminCaller } = mod.exports;

const USER = { data: { user: { id: "U1" } }, error: null };
const BAD = { data: { user: null }, error: new Error("invalid JWT") };
const emp = (role, is_active = true) => ({ data: { id: "E1", role, is_active }, error: null });
const NONE = { data: null, error: new Error("no row") };
const cases = [
  ["no token", null, BAD, NONE, 401],
  ["bad token", "Bearer x", BAD, NONE, 401],
  ["anon key as token (no user)", "Bearer anon", BAD, NONE, 401],
  ["logged in, no employee row", "Bearer t", USER, NONE, 403],
  ["employee token", "Bearer t", USER, emp("employee"), 403],
  ["team leader token", "Bearer t", USER, emp("team_leader"), 403],
  ["hr token", "Bearer t", USER, emp("hr"), 403],
  ["payroll token", "Bearer t", USER, emp("payroll"), 403],
  ["sales coordinator token", "Bearer t", USER, emp("sales_coordinator"), 403],
  ["inactive admin", "Bearer t", USER, emp("admin", false), 403],
  ["admin token", "Bearer t", USER, emp("admin"), "E1"],
  ["super_admin token", "Bearer t", USER, emp("super_admin"), "E1"]
];
(async () => {
  for (const [name, header, token, employee, want] of cases) {
    tokenResult = token;
    employeeResult = employee;
    const r = await resolveAdminCaller({ headers: { get: () => header } });
    const got = r.errorResponse ? r.errorResponse.status : r.employeeId;
    if (got !== want) problems.push(`${name}: got ${got}, want ${want}`);
    if (r.errorResponse && !(r.errorResponse.body.message && r.errorResponse.body.error)) problems.push(`${name}: refusal has no message`);
  }
  if (problems.length) {
    console.error("check-admin-routes-auth: FAILED\n  " + problems.join("\n  "));
    process.exit(1);
  }
  console.log(`check-admin-routes-auth: all ${cases.length} known answers and ${ROUTES.length} routes pass.`);
})();
