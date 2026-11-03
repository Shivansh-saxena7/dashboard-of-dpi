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
for (const lib of ["lib/autoJunkGuard.ts", "lib/recycleSiblingGuard.ts", "lib/positiveLead.ts", "lib/reminderHold.ts", "lib/restoreHold.ts"]) {
  if (!fs.existsSync(path.join(root, lib))) problems.push(`${lib} is missing`);
}
const fn = read("supabase/functions/recycle-stale-leads/index.ts");
for (const needle of ["autoJunkDecision(", "autoRecycleEnabled(", "decideSiblingGuard(", "../../../lib/calculateSLAStatus.ts"]) {
  if (!fn.includes(needle)) problems.push(`recycle-stale-leads/index.ts does not use ${needle}`);
}
// Reminder hold (2026-10-29): read from settings, held status only in "enforce", every saved lead logged.
for (const needle of ["reminderHoldMode(settings.reminder_hold_mode)", "slaFor(null)", 'holdMode === "enforce" ? slaStatusHeld : slaStatusPlain', '"REMINDER_HOLD"']) {
  if (!fn.includes(needle)) problems.push(`recycle-stale-leads/index.ts is missing the reminder hold piece: ${needle}`);
}
// Junk refusals (2026-11-02): only a real junk counts toward the cap, a refused lead is not tried again for a day.
for (const needle of ["junkAttemptResult(afterJunk?.status)", "recentlyRefused.has(lead.id)", 'reason: "JUNK_REFUSED_RECENTLY"']) {
  if (!fn.includes(needle)) problems.push(`recycle-stale-leads/index.ts is missing the junk refusal piece: ${needle}`);
}
// Restore hold (2026-10-30): read from settings, skipped only in "enforce", every held lead logged.
for (const needle of ["restoreHoldMode(settings.restore_hold_mode)", "restoreHoldApplies(slaStatus, lead.lead_type, protectedUntil)", 'restoreMode === "enforce"', 'reason: "RESTORE_HOLD"', '"RESTORE_HOLD"', 'from("lead_restore_log")']) {
  if (!fn.includes(needle)) problems.push(`recycle-stale-leads/index.ts is missing the restore hold piece: ${needle}`);
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

  // Reminder hold: without the two fields nothing changes (what "off" / "shadow" pass); with them a
  // pending reminder keeps an idle follow-up lead (what "enforce" passes).
  const idle = { status: "CONNECTED", recycle_count: 0, lead_type: "LEAD", board_stage: "FOLLOW_UP", sla_deadline: null, assigned_at: at(-24 * 11), last_activity_at: at(-24 * 10) };
  if (calculateSLAStatus(idle, null, 0, false, false, null) !== "FOLLOWUP_INACTIVITY_RECYCLE_READY") problems.push("idle follow-up lead without reminder fields is no longer recycle-ready (shadow/off would change behaviour)");
  if (calculateSLAStatus({ ...idle, next_reminder_at: at(24 * 5), reminder_hold_max_days: 30 }, null, 0, false, false, null) !== "FOLLOWUP_WITHIN_WINDOW") problems.push("a pending reminder does not hold the lead in enforce mode");
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
console.log("check-recycle-deploy: OK — trap fix, junk breaker, sibling guard, reminder hold, restore hold and junk refusals present.");
