import fs from "fs";
type Row = Record<string, unknown>;
// Same ids as perfReportFixture (kept here so the two files do not import each other).
const A = "00000000-0000-4000-8000-0000000000a1", B = "00000000-0000-4000-8000-0000000000a2", D = "00000000-0000-4000-8000-0000000000a4";

// Fake answers for the Lead Journey tab (get_perf_journey / get_perf_journey_rows). Counts are fixed; the SQL itself is
// tested in PGlite (supabase/sql/tests/2026-11-26_perf_lead_journey.test.mjs). With LJ_LIVE=<file> the tab is fed a
// saved read-only live answer instead (local screenshots only; the file never leaves this machine).
export const LJ_SHOTS = "C:/work/reports/perf_journey_design/build";
const live = process.env.LJ_LIVE ? (JSON.parse(fs.readFileSync(process.env.LJ_LIVE, "utf8")) as { report: Row; rows: Row[] }) : null;

const emp = (id: string, name: string, o: Row): Row => ({ employee_id: id, name, active: true, assignments: o.leads, fresh: 0, recycled: 0, calls_avg: 1.6, first_action_h: 5.2, days_held_avg: 6, ...o });
const EMPS: Row[] = [
  emp(A, "Employee A", { leads: 120, positive: 18, moved_no_pos: 60, missed: 30, not_counted: 6, won: 4, assist: 3 }),
  emp(B, "Employee B", { leads: 80, positive: 30, moved_no_pos: 20, missed: 6, not_counted: 2, won: 22, assist: 1, active: false }),
  emp(D, "Employee D", { leads: 12, positive: 2, moved_no_pos: 5, missed: 2, not_counted: 1, won: 0, assist: 0 })
];
const TEAM: Row = { leads: 212, assignments: 215, positive: 50, moved_no_pos: 85, missed: 38, not_counted: 9, won: 26, assist: 4, calls_avg: 1.7, first_action_h: 4.8, days_held_avg: 6, distinct_leads: 190 };
const step = (seq: number, id: string, name: string, o: Row): Row => ({
  seq, employee_id: id, name, origin: seq === 1 ? "FRESH" : "RECYCLED", assigned_at: `2026-10-${String(seq * 3).padStart(2, "0")}T05:00:00Z`, ended_at: null, days: 4, calls: 1,
  worked: true, positive: false, result: "NOT_CONNECTED", move: null, excused: null, in_range: true, missed: false, won: false, assist: false, ...o
});
// Journeys: A fresh, no positive, recycled to B who connects (A missed, B won); every 5th also via D; every 7th
// A had a positive too (assist, both sides). 260 by default; 1,234 for the big Excel (3 pages of 500).
function makeRows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => {
    const assist = i % 7 === 3, viaD = i % 5 === 1;
    const steps = [step(1, A, "Employee A", { ended_at: "2026-10-05T05:00:00Z", move: "system", positive: assist, pos_at: assist ? "2026-10-03T05:00:00Z" : null,
      result: assist ? "CONNECTED" : "NOT_CONNECTED", missed: !assist, assist })];
    if (viaD) steps.push(step(2, D, "Employee D", { ended_at: "2026-10-09T05:00:00Z", move: "system", excused: i % 10 === 1 ? "leave" : null }));
    steps.push(step(steps.length + 1, B, "Employee B", { positive: true, pos_at: "2026-10-12T05:00:00Z", result: i % 3 ? "FOLLOWUP" : "CONNECTED", won: !assist, assist }));
    const id = `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`;
    return { lead_id: id, lead_short: id.slice(0, 8), first_at: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}T05:00:00Z`, lead_type: i % 4 ? "DATA" : "LEAD",
      source: i % 2 ? "99acres" : "Meta", project: "P1", status: "CONNECTED", stage: i % 3 ? "FOLLOW_UP" : "LEADS", available: true, positive_now: true,
      got_by: B, got_by_name: "Employee B", owners: steps.length, steps, lead_name: `Client ${i}`, mobile: `+9190000${String(i).padStart(5, "0")}` };
  });
}
export const ROWS = makeRows(260);
const BIG = makeRows(1234);
// Summary counts that match a row set exactly (Excel lists = counts).
export function countsOf(rows: Row[]) {
  const by = [A, B, D].map((id) => {
    const mine = rows.filter((r) => (r.steps as Row[]).some((s) => s.in_range && s.employee_id === id));
    const flag = (k: string) => mine.filter((r) => (r.steps as Row[]).some((s) => s.in_range && s.employee_id === id && s[k])).length;
    const base = EMPS.find((e) => e.employee_id === id)!;
    return { ...base, leads: mine.length, assignments: mine.length, missed: flag("missed"), won: flag("won"), assist: flag("assist"), positive: flag("positive") };
  });
  const sum = (k: string) => by.reduce((x, e) => x + Number(e[k as keyof typeof e] ?? 0), 0);
  return { by, team: { ...TEAM, leads: sum("leads"), missed: sum("missed"), won: sum("won"), assist: sum("assist"), positive: sum("positive"), distinct_leads: rows.length } };
}
const pick = (rowsIn: Row[], view: string, employee: string | null) => rowsIn.filter((r) => (r.steps as Row[]).some((s) => s.in_range && (!employee || s.employee_id === employee)
  && (view === "all" || view === "positive" ? (view === "all" || s.positive) : view === "not_counted" ? !!s.excused : !!s[view])));
export interface JourneyMode { consistent?: boolean; big?: boolean; exportMissing?: boolean }

export function journeyAnswer(rpc: string, body: Row, mode: JourneyMode = {}): Row | null {
  const f = (body.p_filters ?? {}) as Row;
  if (live) {
    if (rpc === "get_perf_journey") return live.report;
    if (rpc === "get_perf_journey_export") { const o = Number(body.p_offset ?? 0); return { total: live.rows.length, rows: live.rows.slice(o, o + Number(body.p_limit ?? 500)) }; }
    const rows = live.rows.filter((r) => (r.steps as Row[]).some((s) => s.in_range && (!body.p_employee || s.employee_id === body.p_employee) && (body.p_view === "all" || !!s[String(body.p_view)])));
    const off = Number(body.p_offset ?? 0), lim = Number(body.p_limit ?? 200);
    return { view: body.p_view, employee_id: body.p_employee ?? null, total: rows.length, rows: rows.slice(off, off + lim) };
  }
  const set = mode.big ? BIG : ROWS;
  const cc = mode.consistent || mode.big ? countsOf(set) : null;
  const all = cc ? cc.by : EMPS;
  const emps = Array.isArray(f.employee_ids) ? all.filter((e) => (f.employee_ids as string[]).includes(String(e.employee_id))) : all;
  const strip = (r: Row) => { const { lead_name: _n, mobile: _m, ...rest } = r; void _n; void _m; return rest; };
  if (rpc === "get_perf_journey_export") {
    if (mode.exportMissing) return null;
    const off = Number(body.p_offset ?? 0), lim = Number(body.p_limit ?? 500);
    return { total: set.length, rows: set.slice(off, off + lim) };
  }
  if (rpc === "get_perf_journey")
    return {
      api: "journey1", def_version: 3, from: body.p_from, to: body.p_to, today: "2026-11-26", as_of: "2026-11-26T04:07:00Z",
      by_employee: emps, team: cc ? cc.team : TEAM, journeys: { view: "all", employee_id: null, total: set.length, rows: set.slice(0, 50).map(strip) },
      definitions: [
        { key: "journey_missed", label: "Missed by me", rule: "My assignment had no positive; the system moved the lead on (recycle); I had it at least 3 days or did at least 1 call or action on it; and someone else made it positive within 60 days after it left me." },
        { key: "journey_pct", label: "% of leads given", rule: "Each count divided by the leads given in that row (each lead once). Never over 100%." },
        { key: "journey_won", label: "Won from others", rule: "My assignment had a positive, and an earlier assignment of the same lead (another employee) had none." }
      ],
      options: { employees: EMPS.map((e) => ({ id: e.employee_id, name: e.name, active: e.active })), sources: ["99acres", "Meta"] }
    };
  const rows = pick(set, String(body.p_view ?? "all"), (body.p_employee as string | null) ?? null);
  const off = Number(body.p_offset ?? 0), lim = Number(body.p_limit ?? 200);
  return { view: body.p_view, employee_id: body.p_employee ?? null, total: rows.length, rows: rows.slice(off, off + lim).map(strip) };
}
