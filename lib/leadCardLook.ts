// Lead card look — design C "Pass", restrained palette (2026-10-09).
// Rule: neutrals + ONE urgency accent per card + small semantic touches
// (HOT red, WARM amber, "Call first", recycle under 12h). No purple /
// violet / indigo anywhere. Every other tag is a neutral pill with a small
// coloured dot. Presentation only: no SLA / recycle rule lives here.

import type { CSSProperties } from "react";

export const INK = "#0f172a";
export const TEXT2 = "#475569";
export const MUTED = "#94a3b8";
export const HAIRLINE = "#e8edf3";
export const GOLD = "#b7791f";

export const CARD_BG = "linear-gradient(180deg, #ffffff 0%, #f9fbfe 100%)";
export const CARD_SHADOW = "inset 0 1px 0 rgba(255,255,255,.8), 0 1px 2px rgba(15,23,42,.04), 0 12px 28px -16px rgba(15,23,42,.16)";
export const CARD_SHADOW_HOVER = "inset 0 1px 0 rgba(255,255,255,.8), 0 2px 4px rgba(15,23,42,.05), 0 16px 32px -16px rgba(15,23,42,.22)";

export type PassTone = "NEW" | "FOLLOW_UP" | "OVERDUE" | "QUIET";

export const PASS: Record<
  PassTone,
  { accent: string; header: string; line: string; project: string; call: string; callShadow: string; update: { background: string; color: string } }
> = {
  NEW: {
    accent: "#2563eb",
    header: "linear-gradient(90deg, #f2f7ff 0%, #ffffff 100%)",
    line: "linear-gradient(90deg, #3b82f6 0%, #06b6d4 100%)",
    project: "#1e40af",
    call: "linear-gradient(135deg, #2f6df6 0%, #1e55d8 100%)",
    callShadow: "0 8px 16px -10px rgba(37,99,235,.55)",
    update: { background: "#eef4ff", color: "#1d4ed8" }
  },
  FOLLOW_UP: {
    accent: "#0d9488",
    header: "linear-gradient(90deg, #effcf9 0%, #ffffff 100%)",
    line: "linear-gradient(90deg, #14b8a6 0%, #22d3ee 100%)",
    project: "#0f766e",
    call: "linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)",
    callShadow: "0 8px 16px -10px rgba(13,148,136,.55)",
    update: { background: "#e9f8f5", color: "#0f766e" }
  },
  OVERDUE: {
    accent: "#d1343a",
    header: "linear-gradient(90deg, #fff4f0 0%, #ffffff 100%)",
    line: "linear-gradient(90deg, #fb923c 0%, #ef4444 100%)",
    project: "#b42318",
    call: "linear-gradient(135deg, #f0663a 0%, #dc3545 100%)",
    callShadow: "0 8px 16px -10px rgba(220,53,69,.55)",
    update: { background: "#fff1ee", color: "#b42318" }
  },
  QUIET: {
    accent: "#64748b",
    header: "linear-gradient(90deg, #f4f6f9 0%, #ffffff 100%)",
    line: "linear-gradient(90deg, #94a3b8 0%, #cbd5e1 100%)",
    project: "#334155",
    call: "linear-gradient(135deg, #64748b 0%, #475569 100%)",
    callShadow: "0 8px 16px -10px rgba(71,85,105,.5)",
    update: { background: "#f1f5f9", color: "#334155" }
  }
};

// Status pill: soft tint + dark text in a non-purple tone.
const STATUS_PILL: Record<string, { bg: string; text: string }> = {
  NEW: { bg: "#eaf2ff", text: "#1d4ed8" },
  CONNECTED: { bg: "#e6f8f5", text: "#0f766e" },
  CONVERTED: { bg: "#e6f8f5", text: "#0f766e" },
  NOT_CONNECTED: { bg: "#fff4e0", text: "#92400e" },
  SWITCHED_OFF: { bg: "#fff4e0", text: "#92400e" },
  NOT_INTERESTED: { bg: "#fff0ee", text: "#b42318" },
  JUNK: { bg: "#f1f5f9", text: "#475569" }
};
export const statusPillStyle = (status: string): CSSProperties => {
  const c = STATUS_PILL[status] || { bg: "#f1f5f9", text: TEXT2 };
  return { background: c.bg, color: c.text };
};

// Tags. Coloured ones are the only semantic exceptions; everything else is
// the neutral pill + a dot.
const TAG_BASE = "inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 text-[11px] font-bold leading-none whitespace-nowrap";
export const TAG = TAG_BASE;
export const NEUTRAL_TAG: CSSProperties = { background: "#f3f6fa", color: TEXT2, boxShadow: `inset 0 0 0 1px ${HAIRLINE}` };
export const TINT_TAG = {
  hot: { background: "#fff1f1", color: "#b42318", boxShadow: "inset 0 0 0 1px #fde2e2" },
  warm: { background: "#fff7e6", color: "#92400e", boxShadow: "inset 0 0 0 1px #fdecc8" },
  callFirst: { background: "#fff1f1", color: "#b42318", boxShadow: "inset 0 0 0 1px #fde2e2" },
  recycleSoon: { background: "#fff7e6", color: "#92400e", boxShadow: "inset 0 0 0 1px #fdecc8" }
} satisfies Record<string, CSSProperties>;

export const DOT = {
  slate: "#94a3b8",
  gold: GOLD,
  teal: "#14b8a6",
  blueGrey: "#7c93b0",
  sky: "#38bdf8",
  amber: "#f59e0b"
};

// Source dot colour (99 Acres orange, Housing.com cyan, Meta blue; others slate).
export function sourceDot(source: string | null | undefined): string {
  const s = (source || "").toLowerCase();
  if (s.includes("99")) return "#f97316";
  if (s.includes("housing")) return "#06b6d4";
  if (/meta|facebook|instagram|\bfb\b|\big\b/.test(s)) return "#3b82f6";
  return DOT.slate;
}

// Sizes (decent): name 18, number 15, project 13.5, facts 12.5 / labels 10, tags 11, buttons 14.
export const SIZE = {
  name: "text-[18px] leading-[1.25]",
  number: "text-[15px] leading-tight tracking-[.03em]",
  project: "text-[13.5px] leading-snug",
  factLabel: "text-[10px] tracking-[.08em] uppercase",
  factValue: "text-[12.5px] leading-snug",
  button: "text-[14px]"
};

export const ICON_BUTTON =
  "shrink-0 h-11 w-11 rounded-[13px] flex items-center justify-center transition-[filter,transform] hover:brightness-[.97] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-slate-400";
export const CALL_BUTTON =
  "flex-1 min-w-0 h-11 rounded-[13px] flex items-center justify-center gap-1.5 font-extrabold whitespace-nowrap transition-[filter,transform] hover:brightness-[.96] active:scale-[.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-slate-500";
export const BUTTON_BG = {
  whatsapp: { background: "#e9fbf1" },
  quickDial: { background: "#f3f6fa", color: "#334155" },
  chevronClosed: { background: "#f3f6fa", color: "#334155" },
  chevronOpen: { background: INK, color: "#ffffff" }
};

// "18m ago" / "3h ago" / "2d ago".
export function formatAgo(msAgo: number): string {
  const minutes = Math.max(0, Math.floor(msAgo / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// "9 Oct, 10:42 AM" — one time format everywhere on the card.
export function formatAssignedExact(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}
export const formatExactTime = formatAssignedExact;

// Header clock chip text in three parts so a narrow card can drop the
// words and keep the number: "Overdue " + "3h 10m", "1h 41m" + " left".
export interface ClockParts { lead: string | null; main: string; tail: string | null }
export function clockParts(clock: { label: string; value: string; sub?: string } | null): ClockParts | null {
  if (!clock) return null;
  if (clock.label === "FIRST CALL") return { lead: null, main: clock.value, tail: " left" };
  if (clock.label === "OVERDUE") return clock.value === "Now" ? { lead: null, main: "Overdue", tail: null } : { lead: "Overdue ", main: clock.value, tail: null };
  if (clock.label.endsWith(" UNTIL")) {
    const word = clock.label.replace(" UNTIL", "");
    return { lead: `${word.charAt(0)}${word.slice(1).toLowerCase()} · `, main: clock.value, tail: null };
  }
  if (clock.label === "VISIT") return { lead: null, main: "Visit pending", tail: null };
  if (clock.sub === "until recycle") return { lead: "Recycles in ", main: clock.value, tail: null };
  return { lead: null, main: clock.value, tail: null };
}


// Card surface (2026-10-09 final): a visible but soft 3-stop diagonal
// gradient per tone, an accent glow top-right, a white sheen top-left,
// a 1px gradient border (accent tint → hairline) and tinted layered shadows.
const TONE_RGB: Record<PassTone, string> = { NEW: "37,99,235", FOLLOW_UP: "13,148,136", OVERDUE: "229,72,77", QUIET: "100,116,139" };
const TONE_STOPS: Record<PassTone, [string, string, string]> = {
  NEW: ["#ffffff", "#f2f7ff", "#e7f0ff"],
  FOLLOW_UP: ["#ffffff", "#effaf7", "#e1f4ef"],
  OVERDUE: ["#ffffff", "#fff6f1", "#ffe9e1"],
  QUIET: ["#ffffff", "#f5f7fa", "#eaeff5"]
};
export function cardSurface(tone: PassTone): CSSProperties {
  const rgb = TONE_RGB[tone];
  const [a, b, c] = TONE_STOPS[tone];
  return {
    background: [
      `radial-gradient(60% 60% at 100% 0%, rgba(${rgb},.16) 0%, rgba(${rgb},0) 70%) padding-box`,
      `radial-gradient(55% 45% at 0% 0%, rgba(255,255,255,.9) 0%, rgba(255,255,255,0) 70%) padding-box`,
      `linear-gradient(160deg, ${a} 0%, ${b} 55%, ${c} 100%) padding-box`,
      `linear-gradient(160deg, rgba(${rgb},.35) 0%, ${HAIRLINE} 45%) border-box`
    ].join(", "),
    borderColor: "transparent",
    ["--card-shadow" as string]: `inset 0 1px 0 rgba(255,255,255,.9), 0 1px 2px rgba(15,23,42,.04), 0 10px 24px -12px rgba(${rgb},.24), 0 24px 48px -28px rgba(15,23,42,.18)`,
    ["--card-shadow-hover" as string]: `inset 0 1px 0 rgba(255,255,255,.9), 0 2px 4px rgba(15,23,42,.05), 0 14px 28px -12px rgba(${rgb},.30), 0 28px 52px -28px rgba(15,23,42,.22)`
  };
}
// White-glass box for facts row / last log / notes, so they read clearly on the gradient.
export const GLASS_BOX: CSSProperties = { background: "rgba(255,255,255,.7)", boxShadow: `inset 0 0 0 1px ${HAIRLINE}` };

// Lead name in ink. The Call button takes the card's own tone as a soft
// premium gradient (a step deeper than the card tint so it still reads as
// THE action). Text/icon contrast on the deeper end: NEW 6.8:1,
// FOLLOW_UP 5.2:1, OVERDUE 4.9:1, QUIET 7.2:1 (AA).
export const NAME_COLOR = INK;
const CALL_TONE: Record<PassTone, { from: string; to: string; text: string; ring: string; glow: string }> = {
  NEW: { from: "#d6e6ff", to: "#b9d2ff", text: "#1e3a8a", ring: "rgba(37,99,235,.22)", glow: "rgba(37,99,235,.30)" },
  FOLLOW_UP: { from: "#cdf1e9", to: "#a8e2d5", text: "#0f5f55", ring: "rgba(13,148,136,.24)", glow: "rgba(13,148,136,.28)" },
  OVERDUE: { from: "#ffdccf", to: "#ffc0ae", text: "#9a2d12", ring: "rgba(209,52,58,.22)", glow: "rgba(209,52,58,.28)" },
  QUIET: { from: "#e4e9f0", to: "#cfd8e3", text: "#334155", ring: "rgba(100,116,139,.24)", glow: "rgba(71,85,105,.22)" }
};
export function callStyle(tone: PassTone): CSSProperties {
  const c = CALL_TONE[tone];
  return {
    background: `linear-gradient(135deg, ${c.from} 0%, ${c.to} 100%)`,
    color: c.text,
    boxShadow: `inset 0 1px 0 rgba(255,255,255,.7), inset 0 0 0 1px ${c.ring}, 0 8px 16px -10px ${c.glow}`
  };
}

// Header: soft tint + 3px accent line, with a glassy top/bottom highlight.
export const HEADER_GLASS = "shadow-[inset_0_1px_0_rgba(255,255,255,.85),inset_0_-1px_0_rgba(232,237,243,.9)]";
