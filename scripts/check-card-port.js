#!/usr/bin/env node
// Card redesign port (2026-11-26) known-answer + guard check, run in prebuild. No DB access.
// 1) The old LeadCard.tsx / DataCard.tsx are byte-for-byte the main versions (flag off = the old card exactly).
// 2) lib/cardText.ts gives the old card's words (SLA / recycle badge, data stage and attempts) — known answers.
// 3) employee_card_mode: off / missing / unknown / pilot-without-me = old card; on / pilot-with-me = new card.
// 4) The new cards: Call through lib/logCallClick, "Previously with" + Journey, priority guard, no text hidden by width,
//    no booking chip or new countdown, English, no purple / violet, no dark mode, 44 px taps.
// 5) Last note: one RPC (get_last_notes) in the POST body, batched, no table read, no id list in a URL, no polling.
// 6) The lists only choose the card (additive); SQL drafts have rollbacks; get_last_notes is security invoker, 200 cap.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const problems = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) problems.push(`${name}: got ${g}, want ${w}`);
};
const check = (name, ok) => { if (!ok) problems.push(name); };
const load = (p) => {
  const { outputText } = ts.transpileModule(read(p), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const mod = { exports: {} };
  new Function("module", "exports", "require", outputText)(mod, mod.exports, (m) => {
    if (m === "react") return { useEffect() {}, useState: (v) => [typeof v === "function" ? v() : v, () => {}] };
    if (m === "@/lib/supabase") return { supabase: {} };
    throw new Error(`unexpected import ${m}`);
  });
  return mod.exports;
};

// 1) Old cards unchanged.
const sha = (p) => crypto.createHash("sha256").update(read(p)).digest("hex");
eq("old LeadCard.tsx unchanged (main d7c7f16)", sha("components/LeadCard.tsx"), "e37ce455bb14488b72703f595fc3048ca2a4132596a994dc7a6afbf2bf71fcfd");
eq("old DataCard.tsx unchanged (main d7c7f16)", sha("components/DataCard.tsx"), "d105f7799b745acfdba8e2779510d479431db9fb689203acba0ffd7f4c03fcda");

// 2) Old words.
const t = load("lib/cardText.ts");
const now = new Date("2026-11-25T05:30:00Z");
const cut = (h, reason) => ({ cutoffAt: new Date(now.getTime() + h * 3600e3), reason });
const L = { sla_deadline: null, paused_until: null, pause_reason: null };
eq("badge: within first-call time", t.oldSlaBadge("WITHIN_SLA", { ...L, sla_deadline: "2026-11-25T06:50:00Z" }, null, now), { label: "1h 20m left" });
eq("badge: overdue pulses", t.oldSlaBadge("SLA_BREACHED", L, null, now), { label: "Overdue", pulse: true });
eq("badge: cooldown keeps its reason", t.oldSlaBadge("COOLDOWN", L, cut(51, "NOT_CONNECTED_COOLDOWN"), now), { label: "2d 3h left — Not Connected cooldown" });
eq("badge: cooldown over says Recycling now with the reason (never 'Recycles in Recycling now')", t.oldSlaBadge("RECYCLE_READY", L, cut(-1, "SWITCHED_OFF_COOLDOWN"), now), { label: "Recycling now — Switched Off cooldown" });
eq("badge: locked / pending / snoozed", [t.oldSlaBadge("PAUSED", { ...L, paused_until: "2026-12-15T05:30:00Z", pause_reason: "VISIT_LOCK" }, null, now).label.startsWith("🔒 Locked until "),
  t.oldSlaBadge("PAUSED", { ...L, paused_until: "2026-11-27T05:30:00Z", pause_reason: "VISIT_PENDING_VERIFICATION" }, null, now).label,
  t.oldSlaBadge("PAUSED", { ...L, paused_until: "2026-11-28T05:30:00Z", pause_reason: "SNOOZE" }, null, now).label.includes("Snoozed until")], [true, "⏳ Pending verification", true]);
eq("badge: follow-up warning / going stale / nothing", [t.oldSlaBadge("FOLLOWUP_INACTIVITY_WARNING", L, cut(50, "FOLLOWUP_INACTIVITY"), now).label, t.oldSlaBadge("FOLLOWUP_INACTIVITY_RECYCLE_READY", L, null, now), t.oldSlaBadge("FOLLOWUP_WITHIN_WINDOW", L, cut(50, "FOLLOWUP_INACTIVITY"), now)],
  ["2d 2h left — Follow-up inactivity", { label: "Going stale", pulse: true }, null]);
eq("data: stage words (any other stage = Booked, as before)", ["FOLLOW_UP", "VISIT", "BOOKING", "NEGOTIATION", "LEADS", null].map(t.oldDataStageText), ["📞 Follow-up", "🏠 Visit", "✅ Booked", "✅ Booked", null, null]);
eq("data: calls / attempts", [t.oldDataCallsText(0, true, 4), t.oldDataCallsText(3, true, 1), t.oldDataCallsText(2, true, 2), t.oldDataCallsText(2, false, 2)], [null, "Called 3x · 1 attempt left", "Called 2x · 2 attempts left", "Called 2x"]);

// 3) Flag.
const m = load("lib/employeeCardMode.ts");
eq("flag: who gets the new card", [m.cardModeAllows({ employee_card_mode: "on" }, "e1"), m.cardModeAllows({ employee_card_mode: "off" }, "e1"), m.cardModeAllows({}, "e1"), m.cardModeAllows({ employee_card_mode: "yes" }, "e1"),
  m.cardModeAllows({ employee_card_mode: "admin_pilot", employee_card_pilot_ids: ["e1"] }, "e1"), m.cardModeAllows({ employee_card_mode: "admin_pilot", employee_card_pilot_ids: ["e2"] }, "e1"), m.cardModeAllows({ employee_card_mode: "on" }, null)],
  [true, false, false, false, true, false, false]);
eq("flag: 2 s timeout, remembered 30 min", [m.CARD_MODE_TIMEOUT_MS, m.CARD_MODE_REMEMBER_MS, m.readRememberedCardMode(JSON.stringify({ on: true, at: 0 }), 29 * 60e3), m.readRememberedCardMode(JSON.stringify({ on: true, at: 0 }), 31 * 60e3), m.readRememberedCardMode("x", 0)], [2000, 1800000, true, null, null]);

// 4) New cards.
const lv2 = read("components/LeadCardV2.tsx"), dv2 = read("components/DataCardV2.tsx");
const cards = lv2 + dv2 + read("components/LastLogPanel.tsx") + read("components/LeadCardMore.tsx") + read("lib/leadCardLook.ts");
for (const [name, src] of [["LeadCardV2", lv2], ["DataCardV2", dv2]]) {
  check(`${name}: Call through logCallClick (call-return, pending result, retry), never the RPC directly`, src.includes("logCallClick(lead.leadHistoryId, lead.id);") && !src.includes("log_call_click_atomic"));
  check(`${name}: "Previously with" + Journey, same test ids and condition`, src.includes("previouslyWith !== undefined && onJourney") && src.includes('data-testid="reassigned-tag"') && src.includes('data-testid="reassigned-journey"') && src.includes("tagText(previouslyWith)"));
  check(`${name}: no text hidden by width`, !/hidden @\[|@max-|hidden min-\[/.test(src));
}
check("LeadCardV2: the old badge words (lib/cardText.ts) and the priority guard", lv2.includes("oldSlaBadge(slaStatus, lead, recycleCutoff, now)") && lv2.includes("lead.priority ? LEAD_PRIORITY_DISPLAY[lead.priority]?.label || lead.priority : null"));
check("DataCardV2: old stage and attempts words", dv2.includes("oldDataStageText(lead.board_stage)") && dv2.includes("oldDataCallsText(lead.call_count, stillAtRisk, attemptsLeft)"));
check("new cards: no booking chip, no new countdown or new status words", !/BookingPendingChip|RecycleChip|Recycles in|Call first|"Contacted"|Last attempt|isBookingPending/.test(lv2 + dv2));
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
check("new cards: English, no purple / violet / fuchsia, no dark mode", !/purple|violet|fuchsia|dark:|#7c3aed|#8b5cf6|#a855f7/i.test(code(cards)) && !/[ऀ-ॿ]/.test(cards));
check("new cards: icon buttons and Journey are 44 px", read("lib/leadCardLook.ts").includes("shrink-0 h-11 w-11") && read("lib/leadCardLook.ts").includes("h-11 rounded-[13px]") && (lv2.match(/min-h-11/g) || []).length >= 2);

// 5) Last note.
const ll = read("lib/useLastLog.ts");
check("last note: one RPC in the POST body, 200 a call, batched, no table read, no id list in a URL, no polling", ll.includes('supabase.rpc("get_last_notes", { p_history_ids:') && ll.includes("LAST_LOG_CHUNK = 200")
  && ll.includes("setTimeout(flush, LAST_LOG_BATCH_MS)") && !/\.from\(|\.in\(|setInterval\(|\.channel\(/.test(ll));
check("last note: function missing or an error hides the panel", ll.includes("missingFn(error)") && read("components/LastLogPanel.tsx").includes('if (log === "off") return null;'));

// 6) Lists and SQL.
check("LeadList: only chooses the card", read("components/LeadList.tsx").includes("const CardComponent = useEmployeeCardMode(employeeId) ? LeadCardV2 : LeadCard;"));
check("DataList: only chooses the card + passes assigned_at", read("components/DataList.tsx").includes("const CardComponent = useEmployeeCardMode(employeeId) ? DataCardV2 : DataCard;") && read("components/DataList.tsx").includes("assigned_at: lead.lead_history[0]?.assigned_at ?? null"));
for (const f of ["2026-11-27_employee_card_mode", "2026-11-27_get_last_notes", "2026-11-27_employee_card_pilot_testing"]) {
  check(`${f}: draft with a rollback`, /DRAFT,\s*(--\s*)?NOT\s*(--\s*)?APPLIED/.test(read(`supabase/sql/${f}.sql`)) && fs.existsSync(path.join(root, `supabase/sql/${f}_rollback.sql`)));
}
const gl = read("supabase/sql/2026-11-27_get_last_notes.sql");
check("get_last_notes: security invoker (row-level security decides), 200 cap, anon revoked", gl.includes("SECURITY INVOKER") && gl.includes("security invoker") && gl.includes("p_history_ids[1:200]") && gl.includes("from public, anon;"));
check("employee_card_mode: default off, three values", read("supabase/sql/2026-11-27_employee_card_mode.sql").includes("default 'off'") && read("supabase/sql/2026-11-27_employee_card_mode.sql").includes("in ('off', 'admin_pilot', 'on')"));
check("pilot: exactly one active 'testing' employee, mode still off", read("supabase/sql/2026-11-27_employee_card_pilot_testing.sql").includes("ilike '%testing%' and is_active) = 1") && read("supabase/sql/2026-11-27_employee_card_pilot_testing.sql").includes("employee_card_mode = 'off'"));

if (problems.length) {
  console.error("check-card-port FAILED:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log("check-card-port: all known answers and guards pass.");
