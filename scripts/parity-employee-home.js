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
  return { ...ref, total: leads.length };
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
  const pauses = [null, null, null, "VISIT_LOCK", "VISIT_PENDING_VERIFICATION", "SIBLING_HOLD", "REMINDER_HOLD"];
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
        pause_reason: pick(pauses)
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
      }
    }
  }
  // One 5000-lead list in one go too.
  const all = Array.from({ length: 5000 }, () => makeLead(n++));
  const big = compare("one 5000-lead list", all, calendars[4], base);
  console.log(`random: ${totals.leads} leads x ${calendars.length} calendars x 4 clocks; recycling hits ${totals.recycling}, New hits ${totals.newCount}; one list of 5000: ${JSON.stringify(big)}`);
}

if (problems.length) {
  console.error("parity-employee-home FAILED:\n  " + problems.slice(0, 20).join("\n  "));
  process.exit(1);
}
console.log("parity-employee-home: OK, old and new counting agree");
