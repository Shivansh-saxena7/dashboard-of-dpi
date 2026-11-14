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
const fnSrc = src.slice(src.indexOf("export function isAuthNetworkError"), src.indexOf("export async function getCurrentUser"));
const js = ts.transpileModule(fnSrc, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
new Function("module", "exports", js)(mod, mod.exports);
const { isAuthNetworkError } = mod.exports;

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

if (problems.length) {
  console.error("check-current-user: FAILED");
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}
console.log("check-current-user: all known answers and guards pass.");
