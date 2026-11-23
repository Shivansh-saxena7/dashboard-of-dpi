#!/usr/bin/env node
// "Previously with" tag + Journey (2026-11-23) known-answer + guard check, run in prebuild. No DB access.
// 1) lib/reassignedJourney.ts: flag (off / admin_pilot / on, missing = off), tag text, outcome words, session memory.
// 2) The page: one list call + one call per Journey tap, only the flag row read directly, no polling / realtime / id
//    list in a URL; LeadCard / DataCard change only additively (the block renders only when both new props are given).
// 3) The SQL: draft, owner-only, never returns the admin's reason / label / batch, helpers not callable by employees.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const root = path.join(__dirname, "..");
// LF everywhere, so the checks pass the same on a Windows (CRLF) checkout and on Linux.
const read = (p) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const problems = [];
const eq = (name, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g !== w) problems.push(`${name}: got ${g}, want ${w}`); };
const check = (name, ok) => { if (!ok) problems.push(name); };

const { outputText } = ts.transpileModule(read("lib/reassignedJourney.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
const mod = { exports: {} };
new Function("module", "exports", "require", outputText)(mod, mod.exports, () => { throw new Error("unexpected import"); });
const rj = mod.exports;

eq("flag: missing / off / unknown = off; on = on; pilot only for listed ids",
  [rj.journeyModeAllows(null, "e1"), rj.journeyModeAllows({}, "e1"), rj.journeyModeAllows({ reassigned_journey_mode: "off" }, "e1"), rj.journeyModeAllows({ reassigned_journey_mode: "ON" }, "e1"),
   rj.journeyModeAllows({ reassigned_journey_mode: "on" }, "e1"), rj.journeyModeAllows({ reassigned_journey_mode: "on" }, null),
   rj.journeyModeAllows({ reassigned_journey_mode: "admin_pilot", reassigned_journey_pilot_ids: ["e2"] }, "e1"), rj.journeyModeAllows({ reassigned_journey_mode: "admin_pilot", reassigned_journey_pilot_ids: ["e1"] }, "e1")],
  [false, false, false, false, true, false, false, true]);
eq("tag text", [rj.tagText("A B"), rj.tagText(""), rj.tagText(null)], ["Previously with A B", "Previously with another person", "Previously with another person"]);
eq("outcome words: strongest first", [rj.outcomeText({ converted: true, visit: true }), rj.outcomeText({ visit: true, result: "NOT_INTERESTED" }), rj.outcomeText({ followup: true }),
  rj.outcomeText({ result: "NOT_CONNECTED" }), rj.outcomeText({ result: "NOT_INTERESTED" }), rj.outcomeText({ result: null }), rj.outcomeText({ result: "CALLBACK_LATER" })],
  ["Converted", "Visit done", "Follow-up", "Not connected", "Not interested", "No result", "Callback later"]);
eq("origin words", ["FRESH", "RECYCLED", "ADMIN_GIVEN", "RESTORED", "WHATEVER"].map(rj.originText), ["Fresh", "Recycled", "Given by admin", "Given back", "Assigned"]);
const now = 1_000_000_000;
eq("remembered flag: 30 min, only real answers", [rj.readRememberedMode(JSON.stringify({ on: true, at: now - 60_000 }), now), rj.readRememberedMode(JSON.stringify({ on: true, at: now - 31 * 60_000 }), now),
  rj.readRememberedMode("bad", now), rj.readRememberedMode(JSON.stringify({ on: "yes", at: now }), now), rj.readRememberedMode(null, now)], [true, null, null, null, null]);
eq("map by lead id", [...rj.byLeadId([{ lead_id: "l1", previously_with: "A", given_at: "x" }, null, { lead_id: "" }]).keys()], ["l1"]);
eq("2 s timeout", rj.JOURNEY_MODE_TIMEOUT_MS, 2000);

// 2) Page guards.
const hook = read("lib/useReassignedJourney.ts");
const sheet = read("components/ReassignedJourneySheet.tsx");
const all = [hook, sheet, read("lib/reassignedJourney.ts")].join("\n");
eq("RPCs: one list call and one per Journey tap", [...new Set([...all.matchAll(/\.rpc\("([a-z_]+)"/g)].map((m) => m[1]))].sort(), ["get_my_reassigned_leads", "get_reassigned_lead_context"]);
eq("only the flag row read directly", [...all.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]), ["lead_engine_settings"]);
check("no polling, no realtime, no id list in a URL, no writes", !/setInterval\(|\.channel\(|\.in\(|\.(insert|update|upsert|delete)\(/.test(all));
check("the list call takes no arguments", hook.includes('supabase.rpc("get_my_reassigned_leads")'));
check("flag read in the background with a timeout", hook.includes("Promise.race([read, timeout])") && hook.includes("setTimeout(() => void load(), 0)"));
check("no purple / violet / fuchsia, no dark mode in the new files", !/purple|violet|fuchsia|dark:/i.test(all));
for (const card of ["components/LeadCard.tsx", "components/DataCard.tsx"]) {
  const s = read(card);
  check(`${card}: the new block renders only when both new props are given`, s.includes("{previouslyWith !== undefined && onJourney && (") && (s.match(/previouslyWith/g) || []).length === 4);
  check(`${card}: the Journey tap does not open the card`, s.includes("e.stopPropagation();\n              onJourney(lead.id);") || s.includes("e.stopPropagation();\r\n              onJourney(lead.id);"));
  check(`${card}: no new database call in the card`, !s.includes("get_reassigned_lead_context") && !s.includes("get_my_reassigned_leads"));
  check(`${card}: 44px Journey button`, s.includes('data-testid="reassigned-journey"') && /data-testid="reassigned-journey"\s+className="shrink-0 min-h-11/.test(s));
}
for (const list of ["components/LeadList.tsx", "components/DataList.tsx"]) {
  const s = read(list);
  check(`${list}: tags from the one hook; props only for tagged leads`, s.includes("const journey = useReassignedJourney(employeeId);") && s.includes("onJourney={journey.tags.has(cardLead.id) ? openJourney : undefined}"));
}

// 3) SQL.
const sql = read("supabase/sql/2026-11-23_reassigned_journey.sql");
const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
check("SQL: draft with rollback", sql.includes("DRAFT, NOT APPLIED") && fs.existsSync(path.join(root, "supabase/sql/2026-11-23_reassigned_journey_rollback.sql")));
check("SQL: flag default off", code.includes("reassigned_journey_mode text not null default 'off'"));
check("SQL: only the current owner, only while the current assignment is the report's", (code.match(/l\.current_owner_id = me/g) || []).length === 2 && (code.match(/bl\.new_stint_id = (h|cur)\.id/g) || []).length >= 2 && (code.match(/pb\.mode in \('give', 'give_back'\)/g) || []).length === 2 && code.includes("order by h.assigned_at desc, h.id desc limit 1;"));
check("SQL: never selects the reason, label, batch id, admin or notes for employees", !/(?<!= )\b(b|bl|pb)\.(reason|label|batch_id|created_by|idempotency_key)|lead_notes|reassign_note/.test(code.slice(code.indexOf("get_my_reassigned_leads()"))));
check("SQL: anon / PUBLIC revoked; helpers revoked from authenticated", code.includes("revoke all on function public.reassigned_journey_allowed(uuid), public.reassigned_stint_origin(uuid) from public, anon, authenticated;") && code.includes("revoke all on function public.get_my_reassigned_leads(), public.get_reassigned_lead_context(uuid) from public, anon;"));

if (problems.length) {
  console.error("check-reassigned-journey FAILED:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log("check-reassigned-journey: OK");
