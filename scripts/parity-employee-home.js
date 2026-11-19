#!/usr/bin/env node
// Employee Home Phase 1 parity proof (2026-11-18). The /leads counting before this branch (copied below from
// components/LeadList.tsx at main 3b3fb25, only `Date.now()` made a parameter so both sides use the same clock) against
// lib/employeeHome.ts, which LeadList and the Home now share. Exits 1 on any difference.
//   node scripts/parity-employee-home.js                 5000 random leads, many calendars and clocks (no DB)
//   node scripts/parity-employee-home.js --live file.json  {"calendar": <get_working_calendar>, "now": iso,
//                                                          "employees": {"<id8>": [leads as /leads loads them]}}
// Prints counts only, never names or numbers.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
require.extensions[".ts"] = (m, f) =>
  m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, f);
const eh = require(path.join(root, "lib/employeeHome.ts"));
const { recyclingTomorrowCutoff } = require(path.join(root, "lib/recyclingTomorrow.ts"));
const { isUntouchedInCurrentAssignment } = require(path.join(root, "lib/newLeadFilter.ts"));
const { parseWorkingCalendar } = require(path.join(root, "lib/workingCalendar.ts"));
const { calculateSLAStatus } = require(path.join(root, "lib/calculateSLAStatus.ts"));

// ---- Reference: main 3b3fb25 components/LeadList.tsx (lines 122-141, 509-518, 633-634) ----
function refRecyclingTomorrowCutoffFor(lead, workingCalendar, now) {
  const h = lead.lead_history[0];
  return recyclingTomorrowCutoff(
    {
      status: lead.status,
      sla_deadline: lead.sla_deadline,
      recycle_count: lead.recycle_count,
      board_stage: lead.board_stage,
      paused_until: h?.paused_until ?? null,
      last_activity_at: h?.last_activity_at ?? null,
      pause_reason: h?.pause_reason ?? null,
      assigned_at: h?.assigned_at ?? null
    },
    h?.outcome_at ?? null,
    h?.call_count ?? 0,
    Boolean(lead.is_personal_lead),
    now,
    workingCalendar
  );
}
function refTabCounts(leads) {
  const counts = { LEADS: 0, FOLLOW_UP: 0, VISIT: 0, BOOKING: 0 };
  leads.forEach((lead) => {
    const stage = lead.board_stage || "LEADS";
    counts[stage] = (counts[stage] || 0) + 1;
  });
  return counts;
}
const refNewCount = (leads) => leads.filter((lead) => isUntouchedInCurrentAssignment(lead.lead_history[0])).length;
const refRecyclingCount = (leads, cal, now) => leads.filter((lead) => refRecyclingTomorrowCutoffFor(lead, cal, now) !== null).length;
// ---- end of reference ----

// ---- Reference (Phase 2): the card badge "Needs follow-up" / "Going stale". components/LeadList.tsx cardLeads
// (the flattening LeadCard receives) + components/LeadCard.tsx lines 137-156 (its calculateSLAStatus call), main 3b3fb25.
function refCardLead(lead) {
  return {
    status: lead.status,
    board_stage: lead.board_stage,
    sla_deadline: lead.sla_deadline,
    recycle_count: lead.recycle_count,
    outcome_at: lead.lead_history[0]?.outcome_at ?? null,
    assigned_at: lead.lead_history[0]?.assigned_at ?? null,
    last_activity_at: lead.lead_history[0]?.last_activity_at ?? null,
    paused_until: lead.lead_history[0]?.paused_until ?? null,
    pause_reason: lead.lead_history[0]?.pause_reason ?? null,
    is_personal_lead: lead.is_personal_lead ?? false
  };
}
function refCardSlaStatus(lead, workingCalendar) {
  return calculateSLAStatus(
    {
      status: lead.status,
      sla_deadline: lead.sla_deadline,
      recycle_count: lead.recycle_count,
      board_stage: lead.board_stage,
      paused_until: lead.paused_until,
      last_activity_at: lead.last_activity_at,
      pause_reason: lead.pause_reason,
      assigned_at: lead.assigned_at
    },
    lead.outcome_at,
    0,
    false,
    lead.is_personal_lead,
    workingCalendar
  );
}
const refOverdue = (lead, cal) => ["FOLLOWUP_INACTIVITY_WARNING", "FOLLOWUP_INACTIVITY_RECYCLE_READY"].includes(refCardSlaStatus(refCardLead(lead), cal));
// Visit due today, written out from its definition (a new rule, no older code): Visit stage, VISIT_LOCK, lock ends
// before the end of today's IST day.
function refVisitDue(lead, now) {
  const h = lead.lead_history[0];
  if ((lead.board_stage || "LEADS") !== "VISIT" || !h || h.pause_reason !== "VISIT_LOCK" || !h.paused_until) return false;
  const ist = new Date(now + 5.5 * 3600e3);
  const endOfDay = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + 1) - 5.5 * 3600e3;
  return Date.parse(h.paused_until) < endOfDay;
}

const problems = [];
function compare(label, leads, cal, now) {
  const ref = { stages: refTabCounts(leads), newCount: refNewCount(leads), recyclingTomorrow: refRecyclingCount(leads, cal, now) };
  const got = eh.myLeadCounts(leads, cal, now);
  const shared = eh.stageCounts(leads);
  if (JSON.stringify(ref.stages) !== JSON.stringify(got.stages) || JSON.stringify(ref.stages) !== JSON.stringify(shared)) problems.push(`${label}: tabs ${JSON.stringify(ref.stages)} vs ${JSON.stringify(got.stages)}`);
  if (ref.newCount !== got.newCount) problems.push(`${label}: New ${ref.newCount} vs ${got.newCount}`);
  if (ref.recyclingTomorrow !== got.recyclingTomorrow) problems.push(`${label}: Recycling tomorrow ${ref.recyclingTomorrow} vs ${got.recyclingTomorrow}`);
  let perLead = 0;
  for (const lead of leads) {
    const a = refRecyclingTomorrowCutoffFor(lead, cal, now);
    const b = eh.recyclingTomorrowCutoffFor(lead, cal, now);
    if ((a && a.getTime()) !== (b && b.getTime())) perLead++;
  }
  if (perLead) problems.push(`${label}: ${perLead} leads with a different recycle cutoff`);
  // Phase 2: Needs attention. The Home count and the /leads filter run homeFilterLeads; it must equal the card badge
  // (overdue) and the written-out rule (visits), lead by lead.
  const reminders = new Map(leads.filter((_, i) => i % 7 === 0).map((l, i) => [l.id, now + i * 60e3]));
  const ctx = { calendar: cal, reminders, now };
  const att = eh.attentionCounts(leads, ctx);
  const refOver = leads.filter((l) => refOverdue(l, cal));
  const refVisit = leads.filter((l) => refVisitDue(l, now));
  const list = (f) => eh.homeFilterLeads(leads, f, ctx).map((l) => l.id).join();
  if (list("followup-overdue") !== refOver.map((l) => l.id).join()) problems.push(`${label}: overdue follow-ups differ from the card badge`);
  if (list("visits-today") !== refVisit.map((l) => l.id).join()) problems.push(`${label}: visits due today differ`);
  if (list("reminders-today") !== leads.filter((l) => reminders.has(l.id)).map((l) => l.id).join()) problems.push(`${label}: reminders today differ`);
  if (att["followup-overdue"] !== refOver.length || att["visits-today"] !== refVisit.length || att["reminders-today"] !== reminders.size) problems.push(`${label}: Home attention counts ${JSON.stringify(att)}`);
  const next = eh.upNext(leads, ctx, 5);
  if (new Set(next.map((x) => x.lead.id)).size !== next.length || next.length > 5) problems.push(`${label}: Up next repeats a lead or is too long`);
  return { ...ref, overdue: refOver.length, visitsDue: refVisit.length, total: leads.length };
}

if (process.argv[2] === "--live") {
  const input = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
  const cal = input.calendar ? parseWorkingCalendar(input.calendar) : null;
  const now = Date.parse(input.now);
  for (const [id8, leads] of Object.entries(input.employees)) {
    const r = compare(`live ${id8}`, leads, cal, now);
    console.log(`${id8}: total ${r.total}, tabs ${JSON.stringify(r.stages)}, New ${r.newCount}, Recycling tomorrow ${r.recyclingTomorrow}`);
  }
} else {
  let seed = 20261118;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const base = Date.parse("2026-11-18T06:30:00Z");
  const H = 3600e3, D = 24 * H;
  const iso = (ms) => new Date(ms).toISOString();
  const maybe = (ms) => pick([null, null, iso(ms)]);
  const ist = (ymd) => Date.parse(`${ymd}T00:00:00+05:30`);
  const calendars = [
    null,
    { weeklyOffDay: 2, ranges: [], timersEnabled: true },
    { weeklyOffDay: 2, ranges: [], timersEnabled: false },
    { weeklyOffDay: 0, ranges: [], timersEnabled: true },
    { weeklyOffDay: 2, ranges: [{ id: "h1", startsAt: ist("2026-11-19"), endsAt: ist("2026-11-21"), reason: "Holiday", kind: "HOLIDAY" }], timersEnabled: true },
    { weeklyOffDay: 2, ranges: [{ id: "h2", startsAt: ist("2026-11-07"), endsAt: ist("2026-11-11"), reason: "Diwali", kind: "HOLIDAY" }, { id: "p1", startsAt: base - 5 * H, endsAt: base + 20 * H, reason: "Pause", kind: "TIMER_PAUSE" }], timersEnabled: true }
  ];
  const statuses = ["NEW", "CONNECTED", "NOT_CONNECTED", "SWITCHED_OFF", "NOT_INTERESTED", "CONVERTED", "JUNK"];
  const stages = ["LEADS", "FOLLOW_UP", "VISIT", "BOOKING", null, undefined, "", "OTHER_STAGE"];
  const pauses = [null, null, null, "VISIT_LOCK", "VISIT_PENDING_VERIFICATION", "SIBLING_HOLD", "REMINDER_HOLD", "SNOOZE"];
  const makeLead = (i) => {
    const assigned = base - rnd() * 12 * D;
    const touched = rnd() < 0.55;
    const lastAct = touched ? assigned + rnd() * 10 * D : assigned + pick([0, 1000, 1999, 2001, 60e3]);
    return {
      id: `r${i}`,
      status: pick(statuses),
      board_stage: pick(stages),
      sla_deadline: pick([null, undefined, iso(base + (rnd() - 0.4) * 3 * D)]),
      recycle_count: pick([0, 1, 2, 3, 4, null, undefined]),
      is_personal_lead: pick([false, false, true, null, undefined]),
      lead_history: [{
        call_count: touched ? pick([1, 2, 3, 6]) : pick([0, 0, null, undefined]),
        outcome_at: touched ? maybe(lastAct) : null,
        assigned_at: pick([iso(assigned), iso(assigned), null]),
        first_call_at: touched ? maybe(assigned + H) : null,
        first_whatsapp_at: pick([null, null, null, iso(assigned + 2 * H)]),
        last_activity_at: pick([iso(lastAct), iso(lastAct), null]),
        paused_until: pick([null, null, iso(base + (rnd() - 0.3) * 4 * D)]),
        pause_reason: pick(pauses),
        last_call_click_at: touched ? pick([null, iso(lastAct), iso(lastAct - H), iso(lastAct + H)]) : null
      }]
    };
  };
  let n = 0;
  const totals = { leads: 0, recycling: 0, newCount: 0 };
  // 5000 leads in 50 employee-sized sets, each set checked under every calendar and 4 clocks.
  for (let set = 0; set < 50; set++) {
    const leads = Array.from({ length: 100 }, () => makeLead(n++));
    totals.leads += leads.length;
    for (const [ci, cal] of calendars.entries()) {
      for (const now of [base, base + 7 * H, base + 2 * D + 3 * H, base - 3 * D]) {
        const r = compare(`set ${set} cal ${ci} now ${iso(now)}`, leads, cal, now);
        totals.recycling += r.recyclingTomorrow;
        totals.newCount += r.newCount;
        totals.overdue = (totals.overdue || 0) + r.overdue;
        totals.visits = (totals.visits || 0) + r.visitsDue;
      }
    }
  }
  // One 5000-lead list in one go too.
  const all = Array.from({ length: 5000 }, () => makeLead(n++));
  const big = compare("one 5000-lead list", all, calendars[4], base);
  console.log(`random: ${totals.leads} leads x ${calendars.length} calendars x 4 clocks; recycling hits ${totals.recycling}, New hits ${totals.newCount}, overdue hits ${totals.overdue}, visit-due hits ${totals.visits}; one list of 5000: ${JSON.stringify(big)}`);

  // Phase 3: the queue holds every lead of its own rules once, in rule order, and Up next is its head.
  const qctx = {
    calendar: calendars[1],
    reminders: new Map(all.filter((_, i) => i % 11 === 0).map((l, i) => [l.id, base + i * 60e3])),
    // E4: yesterday's reminders (some leads worked since, some not)
    missed: new Map(all.filter((_, i) => i % 13 === 0).map((l, i) => [l.id, base - 20 * 3600e3 + i * 60e3])),
    // E6: leads an admin gave (the /leads Given by admin set)
    given: new Set(all.filter((_, i) => i % 17 === 0).map((l) => l.id)),
    now: base
  };
  const q = eh.queueOrder(all, qctx);
  const ids = q.map((x) => x.lead.id);
  if (new Set(ids).size !== ids.length) problems.push("queue repeats a lead");
  const rank = { PENDING: 0, MISSED: 1, REMINDER: 2, RECYCLING: 3, OVERDUE: 4, VISIT: 5, GIVEN: 6, NEW: 7 };
  if (q.some((x, i) => i > 0 && rank[x.reason] < rank[q[i - 1].reason])) problems.push("queue is not in rule order");
  if (q.some((x) => !eh.isQueueable(x.lead, base))) problems.push("queue holds a closed or paused lead");
  const shouldHave = all.filter((l) => eh.isQueueable(l, base) && (eh.isPendingResult(l) || eh.isMissedReminder(l, qctx.missed) || qctx.reminders.has(l.id) || eh.recyclingTomorrowCutoffFor(l, qctx.calendar, base) || eh.isFollowUpOverdue(l, qctx.calendar) || eh.isVisitDueToday(l, base) || qctx.given.has(l.id) || isUntouchedInCurrentAssignment(l.lead_history[0])));
  if (shouldHave.length !== q.length) problems.push(`queue length ${q.length}, rules say ${shouldHave.length}`);
  if (JSON.stringify(eh.upNext(all, qctx, 5).map((x) => x.lead.id)) !== JSON.stringify(ids.slice(0, 5))) problems.push("Up next is not the head of the queue");
  // E4: the Start button's "due now" is the queue minus plain New; the two new attention rows equal their /leads filters.
  const sum = eh.queueSummary(q);
  if (sum.total !== q.length || sum.urgent !== q.filter((x) => x.reason !== "NEW").length) problems.push(`Start button summary ${JSON.stringify(sum)}`);
  const att = eh.attentionCounts(all, qctx);
  const refPending = all.filter((l) => eh.isQueueable(l, base) && (() => { const h = l.lead_history[0]; const c = h.last_call_click_at ? Date.parse(h.last_call_click_at) : NaN; if (!Number.isFinite(c)) return false; const o = h.outcome_at ? Date.parse(h.outcome_at) : NaN; return !Number.isFinite(o) || o < c; })());
  const refMissed = all.filter((l) => eh.isQueueable(l, base) && qctx.missed.has(l.id) && !(Date.parse(l.lead_history[0].last_activity_at) >= qctx.missed.get(l.id)));
  if (att["pending-result"] !== refPending.length || eh.homeFilterLeads(all, "pending-result", qctx).length !== refPending.length) problems.push(`Called, no result: ${att["pending-result"]} vs ${refPending.length}`);
  if (att["reminders-missed"] !== refMissed.length || eh.homeFilterLeads(all, "reminders-missed", qctx).length !== refMissed.length) problems.push(`Missed reminders: ${att["reminders-missed"]} vs ${refMissed.length}`);
  // E6: "Snooze ends today" = a SNOOZE whose end falls in today's IST day, written out from its definition.
  const istStart = (ms) => { const d = new Date(ms + 5.5 * 3600e3); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 5.5 * 3600e3; };
  const refSnooze = all.filter((l) => { const h = l.lead_history[0]; if (h.pause_reason !== "SNOOZE" || !h.paused_until) return false; const u = Date.parse(h.paused_until); return u >= istStart(base) && u < istStart(base) + 24 * 3600e3; });
  if (eh.homeFilterLeads(all, "snooze-ends-today", qctx).map((l) => l.id).join() !== refSnooze.map((l) => l.id).join() || eh.attentionCounts(all, qctx)["snooze-ends-today"] !== refSnooze.length) problems.push("Snooze ends today differs");
  console.log(`E6: snooze ends today ${refSnooze.length}; given in queue ${q.filter((x) => x.reason === "GIVEN").length}`);
  console.log(`E4: due now ${sum.urgent} of ${sum.total}; called no result ${refPending.length}; missed reminders ${refMissed.length}`);

  // Phase 3: data-only counts against DataCard (reference: main 3b3fb25 components/DataCard.tsx lines 65-69, fed by
  // DataList's card fields: call_count = lead_history[0]?.call_count ?? 0).
  const refStillAtRisk = (lead) => {
    const inLeadsStage = !lead.board_stage || lead.board_stage === "LEADS";
    return inLeadsStage && (lead.status === "NEW" || lead.status === "NOT_CONNECTED" || lead.status === "SWITCHED_OFF");
  };
  const refAttemptsLeft = (lead) => Math.max(4 - (lead.lead_history[0]?.call_count ?? 0), 0);
  const dataSet = all.map((l) => ({ ...l, lead_history: [{ ...l.lead_history[0], call_count: pick([0, 1, 2, 3, 4, 5, null, undefined]) }] }));
  const atRisk = dataSet.filter(refStillAtRisk);
  const dc = eh.dataCounts(dataSet);
  const refCallsLeft = atRisk.reduce((s, l) => s + refAttemptsLeft(l), 0);
  const refLast = atRisk.filter((l) => refAttemptsLeft(l) <= 1).length;
  if (dc.callsLeft !== refCallsLeft || dc.lastAttempt !== refLast || dc.total !== dataSet.length) problems.push(`data counts ${JSON.stringify(dc)} vs DataCard ${refCallsLeft}/${refLast}`);
  console.log(`queue: ${q.length} of 5000 (${Object.entries(q.reduce((m, x) => ((m[x.reason] = (m[x.reason] || 0) + 1), m), {})).map(([k, v]) => `${k} ${v}`).join(", ")}); data: calls left ${dc.callsLeft}, last attempt ${dc.lastAttempt}`);
}

if (problems.length) {
  console.error("parity-employee-home FAILED:\n  " + problems.slice(0, 20).join("\n  "));
  process.exit(1);
}
console.log("parity-employee-home: OK, old and new counting agree");
