#!/usr/bin/env node
// Call Quality (2026-10-28) known-answer + drift check, run in prebuild.
// The flags and the score live in SQL (supabase/sql/2026-10-28_call_quality.sql);
// lib/callQuality.ts only names them. This fails the build when the two
// disagree, when a Call button bypasses lib/logCallClick.ts, or when the pure
// helpers stop giving their known answers. No DB access.

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const problems = [];
const check = (name, ok) => {
  if (!ok) problems.push(name);
};

function loadLib(file, stubs = {}) {
  const { outputText } = ts.transpileModule(read(path.join("lib", file)), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  });
  const mod = { exports: {} };
  const req = (p) => {
    if (stubs[p]) return stubs[p];
    throw new Error(`check-call-quality: unexpected import ${p} in ${file}`);
  };
  new Function("module", "exports", "require", outputText)(mod, mod.exports, req);
  return mod.exports;
}

const sql = read("supabase/sql/2026-10-28_call_quality.sql");
const cq = loadLib("callQuality.ts");
const last = loadLib("lastCalledLead.ts");

// 1) every flag the SQL can emit has a label
const emitted = new Set([...sql.matchAll(/then '([A-Z_]+)' end/g)].map((m) => m[1]));
emitted.add("OUTCOME_NO_CLICK");
for (const f of emitted) check(`flag ${f} (emitted by SQL) has no FLAG_META entry`, Boolean(cq.FLAG_META[f]));
check("SQL emits fewer than 8 click flags (view changed?)", emitted.size >= 9);

// 2) the score's flag list is the same on both sides
const clean = sql.match(/not \(c\.flags && array\[([^\]]+)\]\)/);
const sqlScoreFlags = clean ? clean[1].split(",").map((s) => s.trim().replace(/'/g, "")) : [];
check(`SCORE_FLAGS ${cq.SCORE_FLAGS} differ from the SQL clean test ${sqlScoreFlags}`, JSON.stringify(sqlScoreFlags) === JSON.stringify(cq.SCORE_FLAGS));
const affects = Object.entries(cq.FLAG_META).filter(([, m]) => m.affectsScore).map(([f]) => f).sort();
check(`FLAG_META.affectsScore ${affects} != SCORE_FLAGS + OUTCOME_NO_CLICK`, JSON.stringify(affects) === JSON.stringify([...cq.SCORE_FLAGS, "OUTCOME_NO_CLICK"].sort()));

// 3) chip keys = the flag keys call_quality_totals_json returns
const totalsBlock = sql.slice(sql.indexOf("'flags', jsonb_build_object("), sql.indexOf("from jsonb_array_elements(coalesce(p_rows"));
const sqlKeys = [...totalsBlock.matchAll(/'([a-z_]+)', coalesce/g)].map((m) => m[1]).sort();
check(`FLAG_CHIPS keys differ from call_quality_totals_json flags ${sqlKeys}`, JSON.stringify(cq.FLAG_CHIPS.map((c) => c.key).sort()) === JSON.stringify(sqlKeys));

// 4) one owner for the call click
const offenders = [];
for (const dir of ["app", "components", "lib"]) {
  const walk = (d) => {
    for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
      const rel = path.join(d, e.name);
      if (e.isDirectory()) walk(rel);
      else if (/\.(tsx?|jsx?)$/.test(e.name) && rel.replace(/\\/g, "/") !== "lib/logCallClick.ts" && read(rel).includes('rpc("log_call_click_atomic"')) offenders.push(rel);
    }
  };
  walk(dir);
}
check(`call buttons must use lib/logCallClick.ts, not the RPC directly: ${offenders.join(", ")}`, offenders.length === 0);

// 5) pure helpers, known answers
const t0 = Date.UTC(2026, 9, 28, 6, 0, 0);
const raw = (leadId, at) => JSON.stringify({ leadId, clickId: null, at });
check("pending outcome: fresh entry returns the lead", last.parsePendingOutcome(raw("L1", t0), t0 + 60 * 1000) === "L1");
check("pending outcome: 30 min exactly still counts", last.parsePendingOutcome(raw("L1", t0), t0 + 30 * 60 * 1000) === "L1");
check("pending outcome: older than 30 min ignored", last.parsePendingOutcome(raw("L1", t0), t0 + 30 * 60 * 1000 + 1) === null);
check("pending outcome: clock moved back ignored", last.parsePendingOutcome(raw("L1", t0), t0 - 1) === null);
check("pending outcome: garbage ignored", last.parsePendingOutcome("{oops", t0) === null && last.parsePendingOutcome(JSON.stringify({ at: t0 }), t0) === null);
check("istDayKey: 23:00 UTC is the next IST day", cq.istDayKey(0, new Date(Date.UTC(2026, 9, 28, 23, 0, 0))) === "2026-10-29");
check("istDayKey: 6 days back", cq.istDayKey(6, new Date(Date.UTC(2026, 9, 28, 6, 0, 0))) === "2026-10-22");
check("score tone bands", cq.scoreTone(80) === "text-emerald-600" && cq.scoreTone(79) === "text-amber-600" && cq.scoreTone(59) === "text-red-600" && cq.scoreTone(null) === "text-slate-400");
check("missing-RPC detection", cq.isCallQualityMissing({ code: "PGRST202" }) && !cq.isCallQualityMissing({ code: "P0001", message: "call quality: not authorized" }));
const expl = cq.scoreExplanation({ quick_outcome_seconds: 10, rapid_click_seconds: 20, outcome_window_minutes: 30, outcome_link_minutes: 60, burst_window_minutes: 5, burst_min_clicks: 8, repeat_clicks_per_day: 4, min_sample: 10, office_start: "11:00:00", office_end: "18:30:00" }).join(" ");
check("explanation uses the live thresholds", ["under 10 s", "within 30 min", "under 20 s", "8+ Call taps in 5 min", "4th+", "11:00–18:30", "fewer than 10"].every((s) => expl.includes(s)));

if (problems.length) {
  console.error("check-call-quality FAILED:\n - " + problems.join("\n - "));
  process.exit(1);
}
console.log("check-call-quality: all checks pass.");
