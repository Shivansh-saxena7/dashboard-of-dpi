#!/usr/bin/env node
// Pre-deploy guard for recycle-stale-leads (2026-10-18). Run by
// `npm run deploy:recycle` before `supabase functions deploy`, so an old
// checkout (one without the 3rd-recycle trap fix, the junk breaker or the
// sibling guard) can't be deployed over the live function by mistake.
// The DB guard in mark_lead_junk_atomic (supabase/sql/2026-10-18_db_auto_junk_guard.sql)
// still blocks the trap even if this check is skipped.
//
// Checks: 1) the source still has the pieces, 2) the trap case behaves
// correctly (a lead 15 minutes after its 3rd recycle is NOT junk-eligible),
// 3) the full known-answer suite passes.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const problems = [];

const sla = read("lib/calculateSLAStatus.ts");
if (!sla.includes("RECYCLE_DUE_STATUSES") || !sla.includes("function calculateBaseSLAStatus")) {
  problems.push("lib/calculateSLAStatus.ts has no max-recycles wrapper (3rd-recycle trap fix missing)");
}
for (const lib of ["lib/autoJunkGuard.ts", "lib/recycleSiblingGuard.ts", "lib/positiveLead.ts"]) {
  if (!fs.existsSync(path.join(root, lib))) problems.push(`${lib} is missing`);
}
const fn = read("supabase/functions/recycle-stale-leads/index.ts");
for (const needle of ["autoJunkDecision(", "autoRecycleEnabled(", "decideSiblingGuard(", "../../../lib/calculateSLAStatus.ts"]) {
  if (!fn.includes(needle)) problems.push(`recycle-stale-leads/index.ts does not use ${needle}`);
}

// Behaviour: the exact trap case from 2026-10-16.
if (problems.length === 0) {
  const loaded = {};
  const loadLib = (file) => {
    if (loaded[file]) return loaded[file];
    const { outputText } = ts.transpileModule(read(path.join("lib", file)), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    });
    const mod = { exports: {} };
    loaded[file] = mod.exports;
    new Function("module", "exports", "require", outputText)(mod, mod.exports, (p) => loadLib(path.basename(p).replace(/(.ts)?$/, ".ts")));
    return mod.exports;
  };
  const { calculateSLAStatus } = loadLib("calculateSLAStatus.ts");
  const at = (h) => new Date(Date.now() + h * 3600000).toISOString();
  const trap = { status: "NEW", recycle_count: 3, lead_type: "LEAD", board_stage: "LEADS", sla_deadline: at(24), assigned_at: at(-0.25), last_activity_at: at(-0.25), call_count: 0 };
  const got = calculateSLAStatus(trap, null, 0, false, false, null);
  if (got === "JUNK_ELIGIBLE") problems.push("a lead 15 minutes after its 3rd recycle is JUNK_ELIGIBLE (the trap is back)");
}

if (problems.length === 0) {
  try {
    execFileSync(process.execPath, [path.join(__dirname, "check-working-calendar.js")], { stdio: "inherit" });
  } catch {
    problems.push("known-answer tests failed");
  }
}

if (problems.length > 0) {
  console.error("check-recycle-deploy: REFUSING to deploy recycle-stale-leads:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("check-recycle-deploy: OK — trap fix, junk breaker and sibling guard present.");
