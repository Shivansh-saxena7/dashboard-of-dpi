// Call Quality (Phase 1, 2026-10-28; plain-language rules 2026-10-29) — display side only.
// Every flag and the score come from the DB (call_quality_click_rows / call_quality_outcome_rows,
// RPCs get_call_quality_summary / get_call_quality_details); this file only words them, in one
// plain language shared by the employee and the admin. scripts/check-call-quality.js fails the
// build if a flag the SQL can emit has no entry here, or if the score flags / bands drift.

export type CallQualityFlag =
  | "NO_RESULT"
  | "TOO_FAST"
  | "MANY_DIALS"
  | "NO_DIAL"
  | "REPEAT_DIALS"
  | "OUTSIDE_HOURS"
  | "NO_SHIFT_START"
  | "REDIAL";

export type ContactMethod = "CRM_CALL" | "CUSTOMER_CALLED" | "OTHER_PHONE" | "WHATSAPP_CALL";

export interface FlagMeta {
  label: string;
  what: string;
  why: string;
  fix: string;
  // Can lower the score. Some rows of a "can" flag are context only (see score_flags on each row).
  canLowerScore: boolean;
  chipClass: string;
}

export interface CallQualitySettings {
  outcome_link_minutes: number;
  reminder_after_minutes: number;
  quick_connected_seconds: number;
  quick_not_interested_seconds: number;
  outcome_floor_seconds: number;
  rapid_click_seconds: number;
  burst_window_minutes: number;
  burst_min_clicks: number;
  burst_data_min_clicks: number;
  burst_result_share_pct: number;
  repeat_clicks_per_day: number;
  no_dial_share_pct: number;
  declared_other_share_pct: number;
  score_min_clicks: number;
  office_start: string;
  office_end: string;
  live_since: string | null;
  enforced: boolean;
  visible_to_employees: boolean;
  share_line: boolean;
}

const RED = "bg-red-50 text-red-700 border-red-200";
const AMBER = "bg-amber-50 text-amber-800 border-amber-200";
const GREY = "bg-slate-50 text-slate-600 border-slate-200";

export function flagMetaFor(flag: string, s: CallQualitySettings): FlagMeta {
  const office = `${hhmm(s.office_start)}–${hhmm(s.office_end)}`;
  const all: Record<CallQualityFlag, FlagMeta> = {
    NO_RESULT: {
      label: "No result saved",
      what: `You tapped Call, but no result was saved on that lead within ${s.outcome_link_minutes} minutes.`,
      why: "A dial with no saved result looks like a tap, not a call.",
      fix: "After every call, save the result right away. The lead opens for you when you come back.",
      canLowerScore: true,
      chipClass: RED
    },
    TOO_FAST: {
      label: "Result saved too fast",
      what: `You saved "Connected" only a few seconds after tapping Call (less than ${s.quick_connected_seconds} seconds).`,
      why: `A real talk takes longer than ${s.quick_connected_seconds} seconds.`,
      fix: "Save the result after the call ends, not before you talk.",
      canLowerScore: true,
      chipClass: RED
    },
    MANY_DIALS: {
      label: "Many dials in a row",
      what: "You tapped Call on lead after lead without saving results in between.",
      why: "Nobody can really dial that fast. It looks like taps, not calls.",
      fix: "Call one lead, save the result, then call the next.",
      canLowerScore: true,
      chipClass: RED
    },
    NO_DIAL: {
      label: "Result without a dial",
      what: "You saved a result without tapping Call or WhatsApp in the CRM first.",
      why: `The CRM cannot see a call it did not start. It lowers your score only on days when this is ${s.no_dial_share_pct}% or more of your results.`,
      fix: 'Always dial from the CRM. If the customer called you or you used another phone, pick that under "How did you talk?".',
      canLowerScore: true,
      chipClass: AMBER
    },
    REPEAT_DIALS: {
      label: "Same lead dialed many times",
      what: `You dialed the same lead ${s.repeat_clicks_per_day} or more times in one day.`,
      why: "Shown so you and your manager know. It does not lower your score.",
      fix: "If a number never answers, save the result and try again later.",
      canLowerScore: false,
      chipClass: GREY
    },
    OUTSIDE_HOURS: {
      label: "Outside office hours",
      what: `You dialed outside office hours (${office}) or on your weekly off.`,
      why: "Shown for context only. It does not lower your score.",
      fix: "Nothing to fix.",
      canLowerScore: false,
      chipClass: GREY
    },
    NO_SHIFT_START: {
      label: "No shift start",
      what: "You dialed on a day you did not start your shift in the CRM.",
      why: "Shown for context only. It does not lower your score.",
      fix: "Start your shift in the CRM every working day.",
      canLowerScore: false,
      chipClass: GREY
    },
    REDIAL: {
      label: "Dialed again",
      what: "You dialed the same lead again soon after, with nothing saved in between (for example, the call got cut).",
      why: "A redial never counts against you.",
      fix: "Nothing to fix. Save the result after the last try.",
      canLowerScore: false,
      chipClass: "bg-sky-50 text-sky-700 border-sky-200"
    }
  };
  return (
    all[flag as CallQualityFlag] ?? { label: flag, what: "", why: "", fix: "", canLowerScore: false, chipClass: GREY }
  );
}

// Same list as the SQL score_flags array (scripts/check-call-quality.js compares them).
export const SCORE_FLAGS: CallQualityFlag[] = ["NO_RESULT", "TOO_FAST", "MANY_DIALS"];

// Chip order everywhere (key = totals.flags key from the RPC).
export const FLAG_CHIPS: { key: string; flag: CallQualityFlag }[] = [
  { key: "no_result", flag: "NO_RESULT" },
  { key: "too_fast", flag: "TOO_FAST" },
  { key: "many_dials", flag: "MANY_DIALS" },
  { key: "no_dial", flag: "NO_DIAL" },
  { key: "repeat_dials", flag: "REPEAT_DIALS" },
  { key: "outside_hours", flag: "OUTSIDE_HOURS" },
  { key: "no_shift_start", flag: "NO_SHIFT_START" }
];

export const CONTACT_METHODS: { value: ContactMethod; label: string }[] = [
  { value: "CRM_CALL", label: "Called from CRM" },
  { value: "CUSTOMER_CALLED", label: "Customer called me" },
  { value: "OTHER_PHONE", label: "Called from another phone" },
  { value: "WHATSAPP_CALL", label: "WhatsApp call" }
];

export function contactMethodLabel(m: string | null): string {
  return CONTACT_METHODS.find((c) => c.value === m)?.label ?? "Called from CRM";
}

export interface CallQualityTotals {
  dial_clicks: number;
  results_saved: number;
  logged_calls: number;
  connected: number;
  judged: number;
  clean: number;
  pending: number;
  redials: number;
  estimated_clicks: number;
  declared_other: number;
  too_fast_scored: number;
  no_dial_scored: number;
  genuine_score: number | null;
  band: Band | null;
  flags: Record<string, number>;
}

export interface CallQualityEmployee {
  employee_id: string;
  employee_name: string;
  totals: CallQualityTotals;
  by_card_type: { LEAD: CallQualityTotals; DATA: CallQualityTotals };
  no_dial_pattern_days: number;
  declared_other_high: boolean;
  days: (CallQualityTotals & { date: string })[];
}

export interface CallQualitySummary {
  from: string;
  to: string;
  live_since: string | null;
  estimated: boolean;
  enforced: boolean;
  visible_to_employees: boolean;
  settings: CallQualitySettings;
  employees: CallQualityEmployee[];
}

export interface CallQualityRow {
  kind: "CLICK" | "NO_DIAL";
  click_id: string | null;
  lead_id: string;
  lead_name: string | null;
  card_type: string | null;
  at: string;
  clicked_at: string | null;
  outcome: string | null;
  outcome_at: string | null;
  gap_seconds: number | null;
  contact_method: string | null;
  result_kind: "STATUS" | "FOLLOW_UP" | "NOTE" | "WHATSAPP" | null;
  result_at: string | null;
  flags: CallQualityFlag[];
  score_flags: CallQualityFlag[];
  estimated: boolean;
  pending: boolean;
  prev_click_gap_seconds: number | null;
  prev_click_had_result: boolean | null;
  burst_clicks: number | null;
  burst_with_result: number | null;
  nth_on_lead_today: number | null;
}

export interface CallQualityDetails {
  employee_id: string;
  employee_name: string | null;
  from: string;
  to: string;
  settings: CallQualitySettings;
  rows: CallQualityRow[];
}

export type Band = "Green" | "Amber" | "Red";

// Same bands as SQL call_quality_band (checked by scripts/check-call-quality.js).
export function bandOf(score: number | null): Band | null {
  if (score === null) return null;
  if (score >= 80) return "Green";
  if (score >= 60) return "Amber";
  return "Red";
}

export function bandMeaning(band: Band | null, s: CallQualitySettings): string {
  if (band === "Green") return "Good. Almost every dial has a saved result.";
  if (band === "Amber") return "Can be better. Save a result after every call.";
  if (band === "Red") return "Needs attention. Many dials have no saved result.";
  return `Not enough data yet. Your score shows after ${s.score_min_clicks} dials in 7 days.`;
}

export function bandClasses(band: Band | null): { dot: string; text: string; box: string } {
  if (band === "Green") return { dot: "bg-emerald-500", text: "text-emerald-700", box: "bg-emerald-50 border-emerald-200" };
  if (band === "Amber") return { dot: "bg-amber-500", text: "text-amber-700", box: "bg-amber-50 border-amber-200" };
  if (band === "Red") return { dot: "bg-red-500", text: "text-red-700", box: "bg-red-50 border-red-200" };
  return { dot: "bg-slate-300", text: "text-slate-500", box: "bg-slate-50 border-slate-200" };
}

export function scoreText(score: number | null): string {
  return score === null ? "—" : String(score);
}

const OUTCOME_LABEL: Record<string, string> = {
  CONNECTED: "Connected",
  NOT_CONNECTED: "Not connected",
  SWITCHED_OFF: "Switched off",
  NOT_INTERESTED: "Not interested",
  CONVERTED: "Converted"
};

export function outcomeLabel(outcome: string | null): string {
  if (!outcome) return "—";
  return OUTCOME_LABEL[outcome] ?? outcome.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export function hhmm(t: string | null | undefined): string {
  return t ? t.slice(0, 5) : "";
}

// Clock time in IST, e.g. "11:02".
export function clock(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
}

// "2 min 40 s", "12 s"
export function duration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return "";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m} min` : `${m} min ${r} s`;
}

function resultLabel(row: CallQualityRow): string {
  if (row.result_kind === "STATUS" || (row.outcome && row.result_kind === null)) return `Saved result: ${outcomeLabel(row.outcome)}`;
  if (row.result_kind === "FOLLOW_UP") return "Moved to Follow-up";
  if (row.result_kind === "NOTE") return "Saved a note";
  if (row.result_kind === "WHATSAPP") return "Opened WhatsApp";
  return "Saved result";
}

function secondsBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000);
}

// One flag on one row, in plain words, with the rule that applied.
export function flagReason(flag: CallQualityFlag, row: CallQualityRow, s: CallQualitySettings): string {
  const name = row.lead_name ?? "a lead";
  switch (flag) {
    case "NO_RESULT":
      return `No result was saved in the next ${s.outcome_link_minutes} minutes.`;
    case "TOO_FAST": {
      const need =
        row.outcome === "CONNECTED" || row.outcome === "CONVERTED"
          ? s.quick_connected_seconds
          : row.outcome === "NOT_INTERESTED"
            ? s.quick_not_interested_seconds
            : s.outcome_floor_seconds;
      return `"${outcomeLabel(row.outcome)}" was saved ${duration(row.gap_seconds)} after the dial (needs at least ${need} s).`;
    }
    case "MANY_DIALS":
      if (row.prev_click_gap_seconds !== null && row.prev_click_gap_seconds < s.rapid_click_seconds && row.prev_click_had_result === false)
        return `Dialed ${duration(row.prev_click_gap_seconds)} after the last dial, which had no saved result.`;
      return `${row.burst_clicks ?? "Many"} dials in ${s.burst_window_minutes} minutes, only ${row.burst_with_result ?? 0} with a saved result.`;
    case "NO_DIAL":
      return `"${outcomeLabel(row.outcome)}" was saved on ${name} with no dial in the CRM in the ${s.outcome_link_minutes} minutes before.`;
    case "REPEAT_DIALS":
      return `Dial number ${row.nth_on_lead_today} on this lead today.`;
    case "OUTSIDE_HOURS":
      return `Office hours are ${hhmm(s.office_start)}–${hhmm(s.office_end)}; the weekly off counts as outside too.`;
    case "NO_SHIFT_START":
      return "The shift was not started in the CRM that day.";
    case "REDIAL":
      return "Dialed this lead again soon after; this dial is left out of the score.";
  }
}

// Example sentence for the employee's flag card ("Your example today").
export function flagExample(flag: CallQualityFlag, row: CallQualityRow, s: CallQualitySettings): string {
  const name = row.lead_name ?? "a lead";
  const t = clock(row.at);
  if (flag === "NO_DIAL") return `${t} You saved "${outcomeLabel(row.outcome)}" on ${name}, with no dial in the CRM before it.`;
  return `${t} You tapped Call on ${name}. ${flagReason(flag, row, s)}`;
}

export interface TimelineLine {
  time: string;
  text: string;
  status: "ok" | "bad" | "info" | "waiting";
  notes: { flag: CallQualityFlag; text: string; lowersScore: boolean }[];
}

// "11:02 Tapped Call on Amit → 11:04 Saved result: Connected (2 min 40 s later)"
export function timelineLine(row: CallQualityRow, s: CallQualitySettings): TimelineLine {
  const name = row.lead_name ?? "a lead";
  const how = row.contact_method && row.contact_method !== "CRM_CALL" ? ` (${contactMethodLabel(row.contact_method)})` : "";
  const notes = row.flags
    .filter((f) => f !== "REDIAL")
    .map((f) => ({ flag: f, text: `${flagMetaFor(f, s).label}: ${flagReason(f, row, s)}`, lowersScore: row.score_flags.includes(f) }));
  if (row.kind === "NO_DIAL") {
    return {
      time: clock(row.at),
      text: `Saved result: ${outcomeLabel(row.outcome)} on ${name}${how}, with no dial before it`,
      status: row.score_flags.length > 0 ? "bad" : "info",
      notes
    };
  }
  let text = `Tapped Call on ${name}`;
  let status: TimelineLine["status"] = row.score_flags.length > 0 ? "bad" : "ok";
  if (row.result_at) {
    const gap = row.result_kind === "STATUS" && row.gap_seconds !== null ? row.gap_seconds : secondsBetween(row.clicked_at, row.result_at);
    text += ` → ${clock(row.result_at)} ${resultLabel(row)}${how} (${duration(gap)} later)`;
  } else if (row.flags.includes("REDIAL")) {
    text += " → dialed again soon after";
    if (status === "ok") status = "info";
  } else if (row.pending) {
    text += " → waiting for a result";
    if (status === "ok") status = "waiting";
  } else {
    text += " → no result saved";
  }
  return { time: clock(row.clicked_at), text, status, notes };
}

// "How is this calculated?" — built from the live thresholds so the text never disagrees with the DB.
export function scoreExplanation(s: CallQualitySettings): string[] {
  return [
    "Score = dials that look like real calls ÷ all dials (plus results saved without a dial, on days when that happens a lot).",
    `A dial is counted once ${s.outcome_link_minutes} minutes have passed. Dialing the same lead again (call got cut) is left out.`,
    `A dial lowers the score when: no result is saved within ${s.outcome_link_minutes} minutes; "Connected" is saved less than ${s.quick_connected_seconds} seconds after the dial; or it is one of many dials in a row (less than ${s.rapid_click_seconds} seconds after a dial with no result, or ${s.burst_min_clicks}+ dials in ${s.burst_window_minutes} minutes (Data cards ${s.burst_data_min_clicks}+) with fewer than ${s.burst_result_share_pct}% of them saved).`,
    `A result without a dial lowers the score only on a day when it is ${s.no_dial_share_pct}% or more of the results. "Customer called me", "Called from another phone" and "WhatsApp call" never count.`,
    `Shown for context only: "Not interested" saved in under ${s.quick_not_interested_seconds} seconds, same lead dialed many times, outside office hours (${hhmm(s.office_start)}–${hhmm(s.office_end)}), no shift start.`,
    `Leads and Data cards get separate scores. With fewer than ${s.score_min_clicks} dials in the period, the score shows "Not enough data yet".`,
    "Green 80+, Amber 60–79, Red below 60. All times are the server's own clock. Days before Call Quality went live are marked Estimated."
  ];
}

// IST calendar day key, N days before today (0 = today).
export function istDayKey(daysAgo: number, now: Date = new Date()): string {
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000 - daysAgo * 24 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

export function longDate(day: string): string {
  return new Date(`${day}T12:00:00+05:30`).toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

// The RPC is missing before the DB part is applied: show "not switched on" instead of an error.
export function isCallQualityMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || error.code === "42883";
}

export function isCallQualityHidden(error: { message?: string } | null): boolean {
  return Boolean(error?.message && /not visible to employees/.test(error.message));
}

// Extra line for the WhatsApp work report, e.g. "Dials 20 | Results saved 18 | Score 90 (Green)".
export function shareLine(dials: number, saved: number, score: number | null): string {
  const band = bandOf(score);
  return `Dials ${dials} | Results saved ${saved} | Score ${score === null ? "not enough data yet" : `${score} (${band})`}`;
}
