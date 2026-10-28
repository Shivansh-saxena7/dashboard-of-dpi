// Call Quality (Phase 1, 2026-10-28) — display side only. Every flag and the
// score itself come from the DB (views call_quality_clicks / call_quality_flags,
// RPCs get_call_quality_summary / get_call_quality_details); this file only
// names them. scripts/check-call-quality.js fails the build if a flag the SQL
// can emit has no entry here, or if SCORE_FLAGS drifts from the SQL's list.

export type CallQualityFlag =
  | "QUICK_OUTCOME"
  | "ORPHAN_CLICK"
  | "OUTCOME_NO_CLICK"
  | "RAPID_CLICK"
  | "BURST"
  | "REPEAT_CLICKS"
  | "OUTSIDE_OFFICE_HOURS"
  | "NO_SHIFT_START"
  | "REDIAL";

export interface FlagMeta {
  label: string;
  // What it means, in one line, for the employee and the admin alike.
  hint: string;
  // Lowers the score (true) or is shown for context only (false).
  affectsScore: boolean;
  chipClass: string;
}

export const FLAG_META: Record<CallQualityFlag, FlagMeta> = {
  QUICK_OUTCOME: {
    label: "Quick outcome",
    hint: "Outcome logged within a few seconds of tapping Call: too fast for a real call.",
    affectsScore: true,
    chipClass: "bg-red-50 text-red-700 border-red-200"
  },
  ORPHAN_CLICK: {
    label: "Click without outcome",
    hint: "Call tapped, but nothing was logged on that lead within the outcome window.",
    affectsScore: true,
    chipClass: "bg-amber-50 text-amber-800 border-amber-200"
  },
  OUTCOME_NO_CLICK: {
    label: "Outcome without click",
    hint: "Status logged without tapping Call or WhatsApp in the CRM first.",
    affectsScore: true,
    chipClass: "bg-amber-50 text-amber-800 border-amber-200"
  },
  RAPID_CLICK: {
    label: "Rapid clicks",
    hint: "Call tapped within a few seconds of the previous Call tap.",
    affectsScore: true,
    chipClass: "bg-red-50 text-red-700 border-red-200"
  },
  BURST: {
    label: "Burst",
    hint: "Many Call taps in a few minutes: more than anyone can really dial.",
    affectsScore: true,
    chipClass: "bg-red-50 text-red-700 border-red-200"
  },
  REPEAT_CLICKS: {
    label: "Repeat clicks",
    hint: "The same lead dialed many times in one day.",
    affectsScore: true,
    chipClass: "bg-orange-50 text-orange-700 border-orange-200"
  },
  OUTSIDE_OFFICE_HOURS: {
    label: "Outside office hours",
    hint: "Dialed outside office hours or on the weekly off. Shown for context, does not lower the score.",
    affectsScore: false,
    chipClass: "bg-slate-50 text-slate-600 border-slate-200"
  },
  NO_SHIFT_START: {
    label: "No shift start",
    hint: "Dialed on a day with no Shift Start. Shown for context, does not lower the score.",
    affectsScore: false,
    chipClass: "bg-slate-50 text-slate-600 border-slate-200"
  },
  REDIAL: {
    label: "Redial",
    hint: "Dialed the same lead again shortly after (dropped or unanswered call). Never counts against you.",
    affectsScore: false,
    chipClass: "bg-sky-50 text-sky-700 border-sky-200"
  }
};

// Same list, same order as the SQL (call_quality_daily's "clean" test plus OUTCOME_NO_CLICK).
export const SCORE_FLAGS: CallQualityFlag[] = ["QUICK_OUTCOME", "ORPHAN_CLICK", "RAPID_CLICK", "BURST", "REPEAT_CLICKS"];

// Chip order in the admin table and the employee panel (key = totals.flags key from the RPC).
export const FLAG_CHIPS: { key: string; flag: CallQualityFlag }[] = [
  { key: "quick_outcome", flag: "QUICK_OUTCOME" },
  { key: "orphan_click", flag: "ORPHAN_CLICK" },
  { key: "outcome_no_click", flag: "OUTCOME_NO_CLICK" },
  { key: "rapid_click", flag: "RAPID_CLICK" },
  { key: "burst", flag: "BURST" },
  { key: "repeat_clicks", flag: "REPEAT_CLICKS" },
  { key: "outside_office_hours", flag: "OUTSIDE_OFFICE_HOURS" },
  { key: "no_shift_start", flag: "NO_SHIFT_START" }
];

export interface CallQualityTotals {
  dial_clicks: number;
  logged_calls: number;
  connected: number;
  judged: number;
  clean: number;
  pending: number;
  redials: number;
  estimated_clicks: number;
  genuine_score: number | null;
  flags: Record<string, number>;
}

export interface CallQualityEmployee {
  employee_id: string;
  employee_name: string;
  totals: CallQualityTotals;
  by_card_type: { LEAD: CallQualityTotals; DATA: CallQualityTotals };
  days: (CallQualityTotals & { date: string })[];
}

export interface CallQualitySettings {
  quick_outcome_seconds: number;
  rapid_click_seconds: number;
  outcome_window_minutes: number;
  outcome_link_minutes: number;
  burst_window_minutes: number;
  burst_min_clicks: number;
  repeat_clicks_per_day: number;
  min_sample: number;
  office_start: string;
  office_end: string;
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

export interface CallQualityDetailRow {
  kind: "CLICK" | "OUTCOME_NO_CLICK";
  click_id: string | null;
  lead_id: string;
  lead_name: string | null;
  card_type: string | null;
  at: string;
  clicked_at: string | null;
  outcome: string | null;
  outcome_at: string | null;
  gap_seconds: number | null;
  flags: CallQualityFlag[];
  estimated: boolean;
  pending: boolean;
}

export function flagMeta(flag: string): FlagMeta {
  return (
    FLAG_META[flag as CallQualityFlag] ?? {
      label: flag,
      hint: "",
      affectsScore: false,
      chipClass: "bg-slate-50 text-slate-600 border-slate-200"
    }
  );
}

export function scoreTone(score: number | null): string {
  if (score === null) return "text-slate-400";
  if (score >= 80) return "text-emerald-600";
  if (score >= 60) return "text-amber-600";
  return "text-red-600";
}

export function formatScore(score: number | null): string {
  return score === null ? "—" : `${score}%`;
}

// "How is this calculated?" — built from the live thresholds so the text never
// disagrees with what the DB actually used.
export function scoreExplanation(s: CallQualitySettings): string[] {
  return [
    "Genuine score = clean calls ÷ (judged calls + outcomes logged without a click).",
    `A call is judged once its ${s.outcome_window_minutes}-minute outcome window has passed. Redials (the same lead dialed again within that window with nothing logged in between) are left out.`,
    `A judged call is clean when it has none of: Quick outcome (under ${s.quick_outcome_seconds} s), Click without outcome (nothing logged within ${s.outcome_window_minutes} min), Rapid clicks (under ${s.rapid_click_seconds} s after the previous Call tap), Burst (${s.burst_min_clicks}+ Call taps in ${s.burst_window_minutes} min), Repeat clicks (${s.repeat_clicks_per_day}th+ dial of one lead in a day).`,
    `Outcome without click = a status logged with no Call or WhatsApp tap on that lead in the ${s.outcome_link_minutes} minutes before.`,
    `Outside office hours (${s.office_start.slice(0, 5)}–${s.office_end.slice(0, 5)}) and No shift start are shown for context only and never lower the score.`,
    `With fewer than ${s.min_sample} judged calls the score is not shown, so one or two flags never decide it.`,
    "All times are the server's own clock. Before Call Quality went live, outcomes are matched to calls by time and marked Estimated."
  ];
}

// IST calendar day key, N days before today (0 = today).
export function istDayKey(daysAgo: number, now: Date = new Date()): string {
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000 - daysAgo * 24 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

// The RPC is missing before the DB part is applied: show "not switched on" instead of an error.
export function isCallQualityMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || error.code === "42883" || /get_call_quality_/.test(error.message ?? "") && /not find|does not exist/i.test(error.message ?? "");
}

export function isCallQualityHidden(error: { message?: string } | null): boolean {
  return Boolean(error?.message && /not visible to employees/.test(error.message));
}

export function formatClock(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}
