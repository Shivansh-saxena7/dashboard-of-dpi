#!/usr/bin/env node
// Network-safe login check (2026-11-14): known answers + page guards, run in prebuild. No network.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const problems = [];
const eq = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// isAuthNetworkError is pure; load just that function without the Supabase client.
const src = read("lib/currentUser.ts");
const fnSrc =
  src.slice(src.indexOf("export function isAuthNetworkError"), src.indexOf("export async function getCurrentUser")) +
  src.slice(src.indexOf("export function isQueryNetworkError"), src.indexOf("export async function withNetworkRetry"));
const js = ts.transpileModule(fnSrc, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
new Function("module", "exports", js)(mod, mod.exports);
const { isAuthNetworkError, isQueryNetworkError } = mod.exports;

// Layout employee/role query (PostgREST): only a dropped connection counts as a network failure.
eq("query: Chrome dropped connection", isQueryNetworkError({ error: { message: "TypeError: Failed to fetch" }, status: 0 }), true);
eq("query: iPhone dropped connection", isQueryNetworkError({ error: { message: "TypeError: Load failed" }, status: 0 }), true);
eq("query: no employee row is a real answer", isQueryNetworkError({ error: { message: "JSON object requested, multiple (or no) rows returned" }, status: 406 }), false);
eq("query: permission denied is a real answer", isQueryNetworkError({ error: { message: "permission denied for table employees" }, status: 403 }), false);
eq("query: success", isQueryNetworkError({ error: null, status: 200 }), false);

eq("retryable fetch error", isAuthNetworkError({ name: "AuthRetryableFetchError", status: 0, message: "Load failed" }), true);
eq("iPhone Load failed", isAuthNetworkError({ message: "TypeError: Load failed" }), true);
eq("Chrome Failed to fetch", isAuthNetworkError({ message: "Failed to fetch" }), true);
eq("no session is not network", isAuthNetworkError({ name: "AuthSessionMissingError", status: 400, message: "Auth session missing!" }), false);
eq("expired / invalid token is not network", isAuthNetworkError({ name: "AuthApiError", status: 403, message: "invalid JWT" }), false);
eq("no error", isAuthNetworkError(null), false);

const LOGIN_CHECK_PAGES = [
  "app/leads/page.tsx",
  "app/data/page.tsx",
  "app/page.tsx",
  "app/attendance/page.tsx",
  "app/documents/page.tsx",
  "app/expenses/page.tsx",
  "app/leaderboard/page.tsx",
  "app/report/page.tsx",
  "app/team/page.tsx",
  "app/tickets/page.tsx"
];
for (const f of LOGIN_CHECK_PAGES) {
  const page = read(f);
  if (!page.includes("const user = await getCurrentUser();")) problems.push(`${f} must use the network-safe login check`);
  if (/await supabase\.auth\.getUser\(\)/.test(page)) problems.push(`${f} must not call auth.getUser() directly`);
}

// Any new page or component: an auth.getUser() answer that leads to a /login redirect within the next few lines must
// use getCurrentUser() instead, or a dropped connection sends a logged-in employee to /login.
const walk = (dir) =>
  fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((d) => {
    const rel = `${dir}/${d.name}`;
    if (d.isDirectory()) return d.name === "api" || d.name === "node_modules" ? [] : walk(rel);
    return /\.tsx?$/.test(d.name) ? [rel] : [];
  });
for (const f of [...walk("app"), ...walk("components")]) {
  const lines = read(f).split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!/await supabase\.auth\.getUser\(\)/.test(line)) return;
    if (lines.slice(i, i + 12).some((l) => /(router\.(replace|push)|location\.(href\s*=|replace|assign))\(?\s*[`"']\/login/.test(l)))
      problems.push(`${f}:${i + 1} sends to /login on an auth.getUser() answer; use getCurrentUser() from lib/currentUser.ts`);
  });
}
if (!/if \(!isAuthNetworkError\(first\.error\)\) return null;/.test(src)) problems.push("a real 'not logged in' answer must still return no user");

// Admin / HR / Payroll / Coordinator layouts: session read and employee/role query go through withNetworkRetry, a network failure
// shows the retry notice, and the access rules themselves are unchanged.
const LAYOUTS = [
  { f: "app/admin/layout.tsx", roles: ['data.role !== "admin" && data.role !== "super_admin"'] },
  { f: "app/hr/layout.tsx", roles: ['data.role !== "hr" && data.role !== "admin" && data.role !== "super_admin"'] },
  { f: "app/payroll/layout.tsx", roles: ['data.role !== "payroll" && data.role !== "admin" && data.role !== "super_admin"'] },
  { f: "app/coordinator/layout.tsx", roles: ['data.role !== "admin" && data.role !== "super_admin" && data.role !== "sales_coordinator"'] }
];
for (const { f, roles } of LAYOUTS) {
  const s = read(f).replace(/\r\n/g, "\n");
  const flat = s.replace(/\s+/g, " ");
  if (!/withNetworkRetry\(async ?\(\) ?=> ?\{ const r = await supabase\.auth\.getSession\(\);/.test(flat)) problems.push(`${f}: session read must go through withNetworkRetry`);
  if (!/withNetworkRetry\(\(\) ?=> ?supabase ?\.from\("employees"\)/.test(flat)) problems.push(`${f}: employee/role query must go through withNetworkRetry`);
  if ((s.match(/networkFailed\)\s*\{\s*setConnectionLost\(true\);\s*return;/g) || []).length !== 2) problems.push(`${f}: a network failure must show the retry notice and stop (twice)`);
  if (!s.includes("<ConnectionRetryNotice onRetry=")) problems.push(`${f}: must render ConnectionRetryNotice`);
  if (/await supabase\.auth\.getSession\(\);\s*\n\s*if ?\(!session\)/.test(s)) problems.push(`${f}: bare getSession() before the /login check`);
  for (const r of roles) if (!flat.includes(r)) problems.push(`${f}: role check changed (${r})`);
  if (!/if ?\(!session\) ?\{ router\.replace\("\/login"\);/.test(flat)) problems.push(`${f}: no session must still go to /login`);
  if (!/is_active/.test(s) || !/supabase\.auth\.signOut\(\)/.test(s)) problems.push(`${f}: inactive check must stay`);
}

// Pre-session queries (2026-11-15): each section layout renders its page only after the access check passed, so no
// page query goes out with the anon key on a visit without a session.
for (const { f, gate } of [
  { f: "app/admin/layout.tsx", gate: "{accessChecked || connectionLost ? children : " },
  { f: "app/hr/layout.tsx", gate: "{accessChecked || connectionLost ? children : " },
  { f: "app/payroll/layout.tsx", gate: "{accessChecked || connectionLost ? children : " },
  { f: "app/coordinator/layout.tsx", gate: "{accessChecked || connectionLost ? children : " }
]) {
  const s = read(f);
  if (!s.includes(gate)) problems.push(`${f}: page must render only after the access check (${gate.trim()})`);
  if ((s.match(/setAccessChecked\(true\)/g) || []).length !== 1) problems.push(`${f}: setAccessChecked(true) exactly once, after the role check`);
  if (/^\s*\{children\}\s*$/m.test(s)) problems.push(`${f}: bare {children} renders the page before the access check`);
}

if (problems.length) {
  console.error("check-current-user: FAILED");
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}
console.log("check-current-user: all known answers and guards pass.");
