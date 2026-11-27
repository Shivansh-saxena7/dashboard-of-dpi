#!/usr/bin/env node
// Admin card port (2026-11-27) known-answer + guard check, run in prebuild. No DB access.
// 1) The old AdminLeadCard.tsx is byte-for-byte the main version; both pages equal main once the additive lines are
//    taken out (so the flag off = the old card, and the bulk select / Reassign / Junk / select-all / confirm /
//    coordinator reassign code is untouched).
// 2) lib/adminCardText.ts (the old card's rules and words) — known answers.
// 3) admin_card_mode: off / missing / unknown / pilot-without-me = old card; on / pilot-with-me = new card.
// 4) AdminLeadCardV2: same gates and actions, old words, nothing new beyond the look + last note, English, no purple /
//    violet / indigo, no dark mode, no text hidden by width, 44 px taps.
// 5) The SQL draft has a rollback, default off, three values.
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
const cache = new Map();
// Loads a lib file and its @/lib or ./ imports (TypeScript transpiled, CommonJS).
function load(p) {
  if (cache.has(p)) return cache.get(p).exports;
  const { outputText } = ts.transpileModule(read(p), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const mod = { exports: {} };
  cache.set(p, mod);
  new Function("module", "exports", "require", outputText)(mod, mod.exports, (m) => {
    if (m === "react") return { useEffect() {}, useRef: (v) => ({ current: v }), useState: (v) => [typeof v === "function" ? v() : v, () => {}] };
    if (m === "@/lib/supabase") return { supabase: {} };
    let rel = m.startsWith("@/") ? m.slice(2) : m.startsWith("./") ? path.posix.join(path.posix.dirname(p), m) : null;
    if (!rel) throw new Error(`unexpected import ${m} in ${p}`);
    if (!rel.endsWith(".ts")) rel += ".ts";
    return load(rel);
  });
  return mod.exports;
}
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

// 1) Old card and pages.
eq("old AdminLeadCard.tsx unchanged (main f2948b6)", sha(read("components/AdminLeadCard.tsx")), "7ea7677ede486f7d9aae406a015c3fff7da67811429af537b1e9578d1d2eb0dd");
const ADMIN_ADDED = [
  'import AdminLeadCardV2 from "@/components/AdminLeadCardV2";\n',
  'import { useAdminCardMode } from "@/lib/adminCardMode";\n',
  "        leadHistoryId: lead.lead_history?.[0]?.id ?? null,\n",
  "\n  // Admin card port (2026-11-27): which card (lead_engine_settings.admin_card_mode). The list never waits for it.\n  const adminCardV2 = useAdminCardMode(adminEmployeeId);\n  const LeadCardComponent = adminCardV2 ? AdminLeadCardV2 : AdminLeadCard;\n"
];
let admin = read("app/admin/leads/page.tsx");
for (const a of ADMIN_ADDED) {
  check(`admin page: additive line present once: ${a.trim().slice(0, 70)}`, admin.split(a).length === 2);
  admin = admin.replace(a, "");
}
admin = admin.replace("lead_history!inner (\n          id, assigned_at,", "lead_history!inner (\n          assigned_at,").replace("            <LeadCardComponent\n", "            <AdminLeadCard\n");
eq("admin page = main once the additive lines are taken out (bulk select / Reassign / Junk / confirm / select-all untouched)", sha(admin), "1a02f02276ce600d63c761fa6b4a34c079df0ff50f051de7f8cabbba6f0ac0e2");
const COORD_ADDED = [
  'import AdminLeadCardV2 from "@/components/AdminLeadCardV2";\n',
  'import { useAdminCardMode } from "@/lib/adminCardMode";\n',
  "        leadHistoryId: lead.lead_history?.[0]?.id ?? null,\n",
  "  // Admin card port (2026-11-27): which card (lead_engine_settings.admin_card_mode). The list never waits for it.\n  const adminCardV2 = useAdminCardMode(viewerEmployeeId);\n  const CoordinatorCard = adminCardV2 ? AdminLeadCardV2 : AdminLeadCard;\n\n"
];
let coord = read("app/coordinator/page.tsx");
for (const a of COORD_ADDED) {
  check(`coordinator page: additive line present once: ${a.trim().slice(0, 70)}`, coord.split(a).length === 2);
  coord = coord.replace(a, "");
}
coord = coord.replace("                  <CoordinatorCard\n", "                  <AdminLeadCard\n");
eq("coordinator page = main once the additive lines are taken out (reassign / verify / remarks / exports untouched)", sha(coord), "8385344d9ea01589d68ef6e00117c6f283409da3240cad057c2f5c6a38721deb");

// 2) Old words and rules.
const t = load("lib/adminCardText.ts");
const sla = load("lib/calculateSLAStatus.ts");
const NOW = Date.parse("2026-11-25T05:30:00Z");
const daysAgo = (d) => new Date(NOW - d * 86400e3).toISOString();
const base = { status: "CONNECTED", boardStage: "FOLLOW_UP", recycleCount: 0, assignedAt: daysAgo(20), leadType: "LEAD", callCount: 0, pausedUntil: null, pauseReason: null, lastActivityAt: daysAgo(0.1), outcomeAt: daysAgo(0.1), isPersonalLead: false };
const st = (over, leave = false) => t.adminCardState({ ...base, ...over }, leave, null, NOW);
const texts = (s) => s.badges.map((b) => `${b.key}:${b.tone}:${b.text.replace(/until .*$/, "until D")}`);
eq("locked / pending (even past its date) / snoozed", [texts(st({ pausedUntil: daysAgo(-5), pauseReason: "VISIT_LOCK" })), texts(st({ pausedUntil: daysAgo(2), pauseReason: "VISIT_PENDING_VERIFICATION" })), texts(st({ pausedUntil: daysAgo(-1), pauseReason: "SNOOZE" }))],
  [["pause:green:🔒 Locked until D"], ["pause:amber:⏳ Pending verification"], ["pause:blue:😴 Snoozed until D"]]);
const warn = st({ lastActivityAt: daysAgo(sla.FOLLOWUP_INACTIVITY_WARNING_DAYS + 0.05) });
const gone = st({ lastActivityAt: daysAgo(sla.FOLLOWUP_INACTIVITY_RECYCLE_DAYS + 0.5) });
eq("follow-up warning keeps the reason and the exact time; recycle-ready pulses red with the reason",
  [warn.badges[0].key, warn.badges[0].tone, /^⏳ (\d+d )?\d+h left — Follow-up inactivity$|^⏳ Needs follow-up$/.test(warn.badges[0].text), gone.badges[0].tone, gone.badges[0].pulse, gone.badges[0].text.startsWith("⚠️ Recycling now — "), gone.recyclingNow],
  ["stale", "amber", true, "red", true, true, true]);
eq("owner on leave: the leave badge, no clock", texts(st({ lastActivityAt: daysAgo(30) }, true)), ["leave:teal:🌴 Timer Paused — Owner on Leave"]);
eq("personal / JUNK / booked: no clocks; CONVERTED alone is not terminal", [st({ isPersonalLead: true, lastActivityAt: daysAgo(30) }).badges.length, st({ status: "JUNK" }).isTerminal, st({ status: "CONVERTED", boardStage: "BOOKING" }).isTerminal, st({ status: "CONVERTED", boardStage: "VISIT" }).isTerminal],
  [0, true, true, false]);
eq("stage words, Data has none; called text", [st({}).stageText !== null && !st({}).stageText.startsWith("undefined"), st({ leadType: "DATA", boardStage: "LEADS" }).stageText, st({ callCount: 3 }).calledText, st({}).calledText], [true, null, "Called 3x", null]);
const cool = st({ status: "NOT_CONNECTED", boardStage: "LEADS", recycleCount: 1, outcomeAt: daysAgo(0.2), lastActivityAt: daysAgo(0.2) });
check("Leads-stage cooldown: own badge with a recycle reason and the exact time", (cool.badges[0].key === "cooldown" && / — (Follow-up inactivity|Not Connected cooldown|Switched Off cooldown|Not Interested cooldown)$/.test(cool.badges[0].text) && cool.badges[0].exact.startsWith("Exact time: ")));

// 3) Flag.
const m = load("lib/adminCardMode.ts");
eq("flag: who gets the new card", [m.adminCardModeAllows({ admin_card_mode: "on" }, "e1"), m.adminCardModeAllows({ admin_card_mode: "off" }, "e1"), m.adminCardModeAllows({}, "e1"), m.adminCardModeAllows({ admin_card_mode: "yes" }, "e1"),
  m.adminCardModeAllows({ admin_card_mode: "admin_pilot", admin_card_pilot_ids: ["e1"] }, "e1"), m.adminCardModeAllows({ admin_card_mode: "admin_pilot", admin_card_pilot_ids: ["e2"] }, "e1"), m.adminCardModeAllows({ admin_card_mode: "on" }, null),
  m.adminCardModeAllows({ employee_card_mode: "on" }, "e1")],
  [true, false, false, false, true, false, false, false]);
const hook = read("lib/adminCardMode.ts");
check("flag: the list never waits; a switch only before the first touch (touches counted from mount)", hook.includes("if (alive && !touched.current) setOn(v);") && hook.includes("CARD_SWAP_EVENTS") && hook.includes("CARD_MODE_TIMEOUT_MS") && !/setInterval\(|\.channel\(/.test(hook));

// 4) New card.
const v2 = read("components/AdminLeadCardV2.tsx");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
check("V2: bulk checkbox gate = old (selectable && !terminal && !readOnly)", v2.includes("{selectable && !s.isTerminal && !readOnly && ("));
check("V2: team select only for an unowned lead and never read-only", /lead\.ownerName \? \([\s\S]*?\) : \([\s\S]*?\{!readOnly && \(\s*<select/.test(v2) && v2.includes("onReserveTeam(lead.id, e.target.value || null)"));
check("V2: JUNK Reassign gate and submit = old", v2.includes('{lead.status === "JUNK" && !readOnly && onUnjunkReassign && !reassignOpen && (') && v2.includes("await onUnjunkReassign(lead.id, reassignEmployeeId, reassignReason.trim());")
  && v2.includes("if (!onUnjunkReassign || !reassignEmployeeId || !reassignReason.trim() || reassignSubmitting) return;") && v2.includes(".filter((e) => e.is_active && e.id !== lead.currentOwnerId)"));
check("V2: old words", ["View History", "🔁 Reassign", "Recover this JUNK lead and hand it to:", "Select employee...", "Reason (mandatory)", ">Owner<", ">Assigned<", "Reserved for {lead.pendingTeamName}", ">Unassigned<", "No team reserved", "🔒 Personal", "🎣 Catcher: {lead.catcherName}", "📒 Legacy", "adminCardState(lead, isOwnerOnLeave, workingCalendar, Date.now())", "adminAssignedText(lead.assignedAt)"].every((w) => v2.includes(w)));
check("V2: same shared badges (recycled + existing client in full detail, weekly-off pause) and history modal", v2.includes("<RecycledBadge reason={lead.recycleReason} fromStage={lead.recycledFromStage} fromStatus={lead.recycledFromStatus} count={lead.recycleCount} fullDetail />")
  && v2.includes("<ExistingClientBadge siblings={lead.siblings} fullDetail />") && v2.includes("clockRunning={Boolean(s.recycleCutoff)}") && v2.includes("<AdminLeadHistoryModal"));
check("V2: priority / status guard", v2.includes("lead.priority ? LEAD_PRIORITY_DISPLAY[lead.priority]?.label || lead.priority : null") && v2.includes("LEAD_STATUS_DISPLAY[lead.status]?.label || lead.status"));
check("V2: nothing new beyond the look and the last note (no countdown chip, no Call first, no copy, no details section)", !/clockParts|Call first|clipboard|LeadCardMore|ExpandSection|formatAgo|Timer\b/.test(code(v2)));
check("V2: last note only with a lead_history id", v2.includes("{lead.leadHistoryId && (") && v2.includes("id={lead.leadHistoryId}"));
check("V2: English, no purple / violet / indigo / fuchsia, no dark mode", !/purple|violet|indigo|fuchsia|dark:|#7c3aed|#8b5cf6|#a855f7|#6366f1/i.test(code(v2) + code(read("lib/adminCardText.ts"))) && !/[ऀ-ॿ]/.test(v2));
check("V2: no text hidden by width", !/hidden @\[|@max-|hidden min-\[|max-\[\d+px\]:hidden/.test(v2));
check("V2: taps 44 px (checkbox hit area, selects, buttons)", v2.includes("-m-3 p-3") && (v2.match(/\bh-11\b|min-h-11/g) || []).length >= 6);
check("V2: memo, same default export shape", v2.includes("export default memo(AdminLeadCardV2);"));

// 5) SQL.
const sqlF = "supabase/sql/2026-11-28_admin_card_mode";
check("admin_card_mode: draft with a rollback", /DRAFT,\s*(--\s*)?NOT\s*(--\s*)?APPLIED/.test(read(`${sqlF}.sql`)) && fs.existsSync(path.join(root, `${sqlF}_rollback.sql`)));
check("admin_card_mode: default off, three values, pilot ids", read(`${sqlF}.sql`).includes("default 'off'") && read(`${sqlF}.sql`).includes("in ('off', 'admin_pilot', 'on')") && read(`${sqlF}.sql`).includes("admin_card_pilot_ids uuid[]"));

if (problems.length) {
  console.error("check-admin-card-port FAILED:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log("check-admin-card-port: all known answers and guards pass.");
