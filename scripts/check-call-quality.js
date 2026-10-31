#!/usr/bin/env node
// Call Quality (2026-10-28; rules of 2026-10-29) known-answer + drift check, run in prebuild.
// The flags and the score live in SQL (supabase/sql/2026-10-28_call_quality.sql);
// lib/callQuality.ts only words them. This fails the build when the two disagree, when a
// Call button or the outcome sheet bypasses its one owner, when employee-facing text uses
// jargon, or when the pure helpers stop giving their known answers. No DB access.

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const problems = [];
const check = (name, ok) => {
  if (!ok) problems.push(name);
};

function loadLib(file) {
  const { outputText } = ts.transpileModule(read(path.join("lib", file)), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  });
  const mod = { exports: {} };
  const req = (p) => {
    throw new Error(`check-call-quality: unexpected import ${p} in ${file}`);
  };
  new Function("module", "exports", "require", outputText)(mod, mod.exports, req);
  return mod.exports;
}

const sql = read("supabase/sql/2026-10-28_call_quality.sql");
const cq = loadLib("callQuality.ts");
const last = loadLib("lastCalledLead.ts");
const S = {
  outcome_link_minutes: 60, reminder_after_minutes: 30, quick_connected_seconds: 25, quick_not_interested_seconds: 10,
  outcome_floor_seconds: 3, rapid_click_seconds: 20, burst_window_minutes: 5, burst_min_clicks: 8, burst_data_min_clicks: 12,
  burst_result_share_pct: 50, repeat_clicks_per_day: 4, no_dial_share_pct: 20, declared_other_share_pct: 20, score_min_clicks: 30,
  office_start: "11:00:00", office_end: "18:30:00", live_since: null, enforced: false, visible_to_employees: true, share_line: true
};

// 1) every flag the SQL can emit has plain wording
const emitted = new Set([...sql.matchAll(/case when (?:not )?g\.\w+(?: >= g\.\w+)? then '([A-Z_]+)' end/g)].map((m) => m[1]));
emitted.add("NO_DIAL");
for (const f of emitted) check(`flag ${f} (emitted by SQL) has no wording in lib/callQuality.ts`, cq.flagMetaFor(f, S).label !== f);
check(`SQL emits ${emitted.size} flags, expected 8 (view changed?)`, emitted.size === 8);

// 2) the score's flag list is the same on both sides
const blocks = [...sql.matchAll(/array_remove\(array\[([\s\S]*?)\], null\)/g)].map((m) => m[1]);
const scoreBlock = blocks.find((b) => b.includes("too_fast_scored")) || "";
const sqlScoreFlags = [...scoreBlock.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
check(`SCORE_FLAGS ${cq.SCORE_FLAGS} differ from the SQL score_flags ${sqlScoreFlags}`, JSON.stringify(sqlScoreFlags) === JSON.stringify(cq.SCORE_FLAGS));

// 3) chip keys = the flag keys call_quality_totals_json returns
const totalsBlock = sql.slice(sql.indexOf("'flags', jsonb_build_object("), sql.indexOf("from jsonb_array_elements(coalesce(p_rows"));
const sqlKeys = [...totalsBlock.matchAll(/'([a-z_]+)', coalesce/g)].map((m) => m[1]).sort();
check(`FLAG_CHIPS keys differ from call_quality_totals_json flags ${sqlKeys}`, JSON.stringify(cq.FLAG_CHIPS.map((c) => c.key).sort()) === JSON.stringify(sqlKeys));

// 4) traffic-light bands are the same on both sides
check("SQL bands are not 80 Green / 60 Amber", /p_score >= 80 then 'Green' when p_score >= 60 then 'Amber' else 'Red'/.test(sql));
check("bandOf bands", cq.bandOf(80) === "Green" && cq.bandOf(79) === "Amber" && cq.bandOf(60) === "Amber" && cq.bandOf(59) === "Red" && cq.bandOf(null) === null);

// 5) one owner each: Call taps and outcome-sheet saves
const owners = { 'rpc("log_call_click_atomic"': "lib/logCallClick.ts", 'rpc("log_lead_update_atomic"': "lib/logLeadUpdate.ts" };
for (const [needle, owner] of Object.entries(owners)) {
  const offenders = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
      const rel = path.join(d, e.name);
      if (e.isDirectory()) walk(rel);
      else if (/\.(tsx?|jsx?)$/.test(e.name) && rel.replace(/\\/g, "/") !== owner && read(rel).includes(needle)) offenders.push(rel);
    }
  };
  ["app", "components", "lib"].forEach(walk);
  check(`${needle}) must only be called from ${owner}: ${offenders.join(", ")}`, offenders.length === 0);
}

// 6) plain language: no jargon in anything the employee reads
const jargon = /\b(orphan|burst|outcome|threshold|flagged)\b/i;
const texts = [];
for (const f of [...emitted]) {
  const m = cq.flagMetaFor(f, S);
  texts.push(m.label, m.what, m.why, m.fix);
}
texts.push(...cq.scoreExplanation(S), ...["Green", "Amber", "Red", null].map((b) => cq.bandMeaning(b, S)));
// every string literal and JSX text in the employee panel (class names and imports skipped)
for (const file of ["components/MyCallQuality.tsx", "components/HowDidYouTalk.tsx"]) {
  const src = ts.createSourceFile(file, read(file), ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX);
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isJsxAttribute(node) && node.name.getText() === "className") return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const t = node.text.trim();
      if (/\s/.test(t)) texts.push(t);
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
}
const bad = texts.filter((t) => t && jargon.test(t));
check(`jargon in employee-facing text: ${bad.slice(0, 3).join(" | ")}`, bad.length === 0);

// 7) pure helpers, known answers
const t0 = Date.UTC(2026, 9, 28, 6, 0, 0);
const raw = (leadId, at) => JSON.stringify({ leadId, clickId: null, at });
check("pending: fresh entry returns the lead", last.parsePendingOutcome(raw("L1", t0), t0 + 60 * 1000) === "L1");
check("pending: 30 min exactly still counts", last.parsePendingOutcome(raw("L1", t0), t0 + 30 * 60 * 1000) === "L1");
check("pending: older than 30 min ignored", last.parsePendingOutcome(raw("L1", t0), t0 + 30 * 60 * 1000 + 1) === null);
check("pending: clock moved back / garbage ignored", last.parsePendingOutcome(raw("L1", t0), t0 - 1) === null && last.parsePendingOutcome("{oops", t0) === null);
check("istDayKey: 23:00 UTC is the next IST day", cq.istDayKey(0, new Date(Date.UTC(2026, 9, 28, 23, 0, 0))) === "2026-10-29");
check("istDayKey: 6 days back", cq.istDayKey(6, new Date(Date.UTC(2026, 9, 28, 6, 0, 0))) === "2026-10-22");
check("duration", cq.duration(160) === "2 min 40 s" && cq.duration(12) === "12 s" && cq.duration(120) === "2 min");
check("share line", cq.shareLine(20, 18, 90) === "Dials 20 | Results saved 18 | Score 90 (Green)" && cq.shareLine(5, 5, null) === "Dials 5 | Results saved 5 | Score not enough data yet");
check("missing-RPC detection", cq.isCallQualityMissing({ code: "PGRST202" }) && !cq.isCallQualityMissing({ code: "P0001", message: "call quality: not authorized" }));

const row = (o) => ({
  kind: "CLICK", click_id: "c", lead_id: "l", lead_name: "Amit", card_type: "LEAD", at: "2026-10-28T05:32:00Z", clicked_at: "2026-10-28T05:32:00Z",
  outcome: null, outcome_at: null, gap_seconds: null, contact_method: null, result_kind: null, result_at: null, flags: [], score_flags: [],
  estimated: false, pending: false, prev_click_gap_seconds: null, prev_click_had_result: null, burst_clicks: null, burst_with_result: null, nth_on_lead_today: 1, ...o
});
const okLine = cq.timelineLine(row({ outcome: "CONNECTED", outcome_at: "2026-10-28T05:34:40Z", gap_seconds: 160, result_kind: "STATUS", result_at: "2026-10-28T05:34:40Z" }), S);
check(`timeline OK line: ${okLine.text}`, okLine.time === "11:02" && okLine.text === "Tapped Call on Amit → 11:04 Saved result: Connected (2 min 40 s later)" && okLine.status === "ok");
const noRes = cq.timelineLine(row({ flags: ["NO_RESULT"], score_flags: ["NO_RESULT"] }), S);
check(`timeline no-result line: ${noRes.text}`, noRes.status === "bad" && noRes.text.endsWith("→ no result saved") && noRes.notes[0].text === "No result saved: No result was saved in the next 60 minutes.");
check("example sentence", cq.flagExample("NO_RESULT", row({}), S) === "11:02 You tapped Call on Amit. No result was saved in the next 60 minutes.");
check("too-fast reason", cq.flagReason("TOO_FAST", row({ outcome: "CONNECTED", gap_seconds: 12 }), S) === '"Connected" was saved 12 s after the dial (needs at least 25 s).');
check("many-dials reasons", cq.flagReason("MANY_DIALS", row({ prev_click_gap_seconds: 8, prev_click_had_result: false }), S) === "Dialed 8 s after the last dial, which had no saved result."
  && cq.flagReason("MANY_DIALS", row({ burst_clicks: 8, burst_with_result: 2 }), S) === "8 dials in 5 minutes, only 2 with a saved result.");
check("declared method shown", cq.timelineLine(row({ outcome: "CONNECTED", gap_seconds: 90, result_kind: "STATUS", result_at: "2026-10-28T05:33:30Z", contact_method: "OTHER_PHONE" }), S).text.includes("(Called from another phone)"));
const expl = cq.scoreExplanation(S).join(" ");
check("explanation uses the live thresholds", ["within 60 minutes", "less than 25 seconds", "less than 20 seconds", "8+ dials in 5 minutes", "Data cards 12+", "50%", "20% or more", "under 10 seconds", "11:00–18:30", "fewer than 30 dials"].every((x) => expl.includes(x)));

if (problems.length) {
  console.error("check-call-quality FAILED:\n - " + problems.join("\n - "));
  process.exit(1);
}
console.log("check-call-quality: all checks pass.");
