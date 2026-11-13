#!/usr/bin/env node
// Per-owner recycle cap (2026-11-13): known answers + guards, run in prebuild and by check-recycle-deploy. No DB.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const problems = [];
require.extensions[".ts"] = (m, f) =>
  m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, f);
const { pickRecycleOwnerCapped, recordRecycleGiven, hasRecycleRoom, RECYCLE_PER_OWNER_CAP_PER_SWEEP } = require(path.join(root, "lib/recyclePerOwnerCap.ts"));
const { pickRecycleOwner } = require(path.join(root, "lib/pickRecycleOwner.ts"));

const eq = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const first = (pool) => pool[0] ?? null;
const g = (o) => new Map(Object.entries(o));
const prev = (o) => new Map(Object.entries(o));

eq("cap is 3", RECYCLE_PER_OWNER_CAP_PER_SWEEP, 3);
eq("room at 2", hasRecycleRoom(g({ a: 2 }), "a"), true);
eq("no room at 3", hasRecycleRoom(g({ a: 3 }), "a"), false);
{ const m = new Map(); recordRecycleGiven(m, "a"); recordRecycleGiven(m, "a"); eq("record counts", m.get("a"), 2); }

// Nothing given yet: exactly the same pick as before
eq("empty map = old pick", pickRecycleOwnerCapped(["a", "b"], undefined, new Map(), first).employeeId, pickRecycleOwner(["a", "b"], undefined, first).employeeId);
eq("empty map, previous owner skipped = old pick", pickRecycleOwnerCapped(["a", "b"], prev({ a: 1 }), new Map(), first).employeeId, "b");
eq("empty map, only previous owners = old fallback", pickRecycleOwnerCapped(["a", "b"], prev({ a: 5, b: 1 }), new Map(), first), { employeeId: "b", usedFallback: true, excludedCount: 2, capped: false });
// Full receiver is skipped, the next one gets it
eq("a full -> b", pickRecycleOwnerCapped(["a", "b"], undefined, g({ a: 3 }), first).employeeId, "b");
// Everyone full: lead waits
eq("all full -> wait", pickRecycleOwnerCapped(["a", "b"], undefined, g({ a: 3, b: 3 }), first), { employeeId: null, usedFallback: false, excludedCount: 0, capped: true });
// The fresh receiver is full: never fall back to a previous owner because of the cap
eq("fresh full, previous has room -> wait", pickRecycleOwnerCapped(["a", "b"], prev({ a: 1 }), g({ b: 3 }), first), { employeeId: null, usedFallback: false, excludedCount: 1, capped: true });
// One fresh full, one fresh with room -> the one with room
eq("one fresh full, other fresh ok", pickRecycleOwnerCapped(["a", "b", "c"], prev({ a: 1 }), g({ b: 3 }), first).employeeId, "c");
// A fresh receiver with room that assign refuses, while another fresh is full: wait, not a previous owner
eq("assign refuses open fresh, other fresh full -> wait", pickRecycleOwnerCapped(["a", "b", "c"], prev({ a: 1 }), g({ b: 3 }), (pool) => pool.find((x) => x !== "c") ?? null).capped, true);
// Nobody eligible at all is not a cap skip
eq("empty pool -> not capped", pickRecycleOwnerCapped([], undefined, new Map(), first), { employeeId: null, usedFallback: false, excludedCount: 0, capped: false });
eq("custom cap 1", pickRecycleOwnerCapped(["a", "b"], undefined, g({ a: 1 }), first, 1).employeeId, "b");

// A sweep: 10 due leads, 3 receivers in round robin -> 3 each, 1 waits; previous owners still left out
{
  const recv = ["r1", "r2", "r3"];
  let pointer = -1;
  const given = new Map();
  const rr = (pool) => { for (let k = 1; k <= recv.length; k++) { const c = recv[(pointer + k) % recv.length]; if (pool.includes(c)) { pointer = recv.indexOf(c); return c; } } return null; };
  const out = [];
  for (let i = 0; i < 10; i++) {
    const p = pickRecycleOwnerCapped(recv, i === 0 ? prev({ r1: 1 }) : undefined, given, rr);
    if (p.employeeId) recordRecycleGiven(given, p.employeeId);
    out.push(p.employeeId ?? "wait");
  }
  eq("sweep of 10: dealt one by one, 3 each, 1 waits", out, ["r2", "r3", "r1", "r2", "r3", "r1", "r2", "r3", "r1", "wait"]);
  eq("sweep of 10: counts", Object.fromEntries(given), { r2: 3, r3: 3, r1: 3 });
}

// Guards on the sweep
const fn = read("supabase/functions/recycle-stale-leads/index.ts");
if (!fn.includes('from "../../../lib/recyclePerOwnerCap.ts"')) problems.push("the sweep must import lib/recyclePerOwnerCap.ts");
if (/\bpickRecycleOwner\(/.test(fn)) problems.push("the sweep must pick recycle owners only through pickRecycleOwnerCapped");
if ((fn.match(/pickRecycleOwnerCapped\(/g) || []).length !== 2) problems.push("both recycle paths (project rule and round robin) must use pickRecycleOwnerCapped");
if ((fn.match(/recordRecycleGiven\(recycleGivenThisSweep, /g) || []).length !== 3) problems.push("every successful recycle (holder, project rule, round robin) must be counted");
if ((fn.match(/reason: "PER_OWNER_CAP_REACHED"/g) || []).length < 2) problems.push("a capped lead must be skipped with PER_OWNER_CAP_REACHED on both paths");
const map = fn.indexOf("const recycleGivenThisSweep = new Map");
if (map < 0 || map > fn.indexOf("for (const lead of sweepOrder)")) problems.push("the per-owner count must be one map for the whole sweep");
// The cap must not touch junk, guards, leave or the shift rule
const junkAt = fn.indexOf("mark_lead_junk_atomic");
if (fn.slice(Math.max(0, junkAt - 4000), junkAt).includes("recycleGivenThisSweep")) problems.push("the cap must not affect junking");
for (const needle of ["shiftStartedEmployeeIds.has(id)", "ownerLeaveSkipReason(lead.current_owner_id, onLeaveEmployeeIds)", "restoreHoldApplies(slaStatus, lead.lead_type, protectedUntil)", "decideSiblingGuard(", "BACKLOG_RECYCLE_CAP_PER_SWEEP = 10", "SLA_BREACHED_RECYCLE_CAP_PER_SWEEP = 30"]) {
  if (!fn.includes(needle)) problems.push(`the sweep lost an existing rule: ${needle}`);
}

if (problems.length) {
  console.error("check-recycle-per-owner-cap: FAILED");
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}
console.log("check-recycle-per-owner-cap: all known answers and guards pass.");
