// Lead card look — design C "Pass", restrained palette (2026-10-09).
// Rule: neutrals + ONE urgency accent per card + small semantic touches
// (HOT red, WARM amber, "Call first", recycle under 12h). No purple /
// violet / indigo anywhere. Every other tag is a neutral pill with a small
// coloured dot. Presentation only: no SLA / recycle rule lives here.

import type { CSSProperties } from "react";

export const INK = "#16202e";
export const TEXT2 = "#475569";
// Muted labels: neutral slate dark enough for AA (>= 4.9:1) on every card tint (was #94a3b8, 2.4:1).
export const MUTED = "#5b6779";
export const HAIRLINE = "#e8edf3";
export const GOLD = "#9a7733";
// Champagne detail (2026-10-10): tiny accents only, never body text colour.
// text #7d6028 is >= 5.0:1 on every card tint; icon #9a7733 is >= 3.5:1 (graphics).
export const CHAMPAGNE = { text: "#7d6028", icon: "#9a7733", line: "#e6d9bb" };

// Raised surface (2026-10-09 depth pass 2): a soft gloss on the top half over
// a white-to-tint gradient, a 1px white highlight on top, a slightly darker
// inner bottom edge, a 1px tone ring, and a two-layer shadow (one tight, one
// soft). No blur filters, so long lead lists stay smooth.
export function raised(bg: string, ring: string, color?: string): CSSProperties {
  return {
    background: `linear-gradient(180deg, rgba(255,255,255,.9) 0%, rgba(255,255,255,0) 55%), linear-gradient(180deg, #ffffff 0%, ${bg} 100%)`,
    ...(color ? { color } : {}),
    boxShadow: `inset 0 1px 0 rgba(255,255,255,.95), inset 0 -1px 0 rgba(15,23,42,.06), inset 0 0 0 1px ${ring}, 0 1px 1px rgba(15,23,42,.06), 0 2px 5px -2px rgba(15,23,42,.12)`
  };
}

// Small coloured dot (source, status): a white ring and a soft glow in its own colour.
export function dotStyle(color: string): CSSProperties {
  return {
    background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,.55) 0%, rgba(255,255,255,0) 55%), ${color}`,
    boxShadow: `0 0 0 1.5px rgba(255,255,255,.95), 0 0 0 3px color-mix(in srgb, ${color} 22%, transparent), 0 0 6px color-mix(in srgb, ${color} 45%, transparent)`
  };
}

// The one-off accent chip on the right of a header (clock, attempts, ago,
// history badge): white raised pill in the card's accent colour.
// Text uses the tone's deeper shade (same as its project / Update colour) so every tone passes AA.
const CHIP_TEXT: Record<string, string> = { "#2563eb": "#1d4ed8", "#0d9488": "#0f766e", "#d1343a": "#b42318", "#64748b": "#475569" };
export function headerChip(color: string): CSSProperties {
  return raised("#f6f8fb", HAIRLINE, CHIP_TEXT[color] || color);
}

export const CARD_BG = "linear-gradient(180deg, #ffffff 0%, #f9fbfe 100%)";
export const CARD_SHADOW = "inset 0 1px 0 rgba(255,255,255,.8), 0 1px 2px rgba(15,23,42,.04), 0 12px 28px -16px rgba(15,23,42,.16)";
export const CARD_SHADOW_HOVER = "inset 0 1px 0 rgba(255,255,255,.8), 0 2px 4px rgba(15,23,42,.05), 0 16px 32px -16px rgba(15,23,42,.22)";

export type PassTone = "NEW" | "FOLLOW_UP" | "OVERDUE" | "QUIET";

export const PASS: Record<
  PassTone,
  { accent: string; header: string; line: string; project: string; call: string; callShadow: string; update: CSSProperties }
> = {
  NEW: {
    accent: "#2563eb",
    header: "linear-gradient(180deg, rgba(37,99,235,.13) 0px, rgba(37,99,235,0) 7px), linear-gradient(112deg, rgba(255,255,255,0) 28%, rgba(255,255,255,.6) 44%, rgba(37,99,235,.06) 60%, rgba(37,99,235,0) 78%), linear-gradient(180deg, rgba(255,255,255,.75) 0%, rgba(255,255,255,0) 55%), linear-gradient(0deg, rgba(37,99,235,.06) 0%, rgba(37,99,235,0) 70%), linear-gradient(90deg, #f2f7ff 0%, #ffffff 100%)",
    line: "linear-gradient(180deg, rgba(255,255,255,.7) 0px, rgba(255,255,255,0) 1.5px), linear-gradient(90deg, rgba(96,165,250,.25) 0%, #60a5fa 14%, #2563eb 45%, #06b6d4 82%, rgba(34,211,238,.25) 100%)",
    project: "#475569",
    call: "linear-gradient(135deg, #2f6df6 0%, #1e55d8 100%)",
    callShadow: "0 8px 16px -10px rgba(37,99,235,.55)",
    update: raised("#eef4ff", "rgba(37,99,235,.22)", "#1d4ed8")
  },
  FOLLOW_UP: {
    accent: "#0d9488",
    header: "linear-gradient(180deg, rgba(13,148,136,.13) 0px, rgba(13,148,136,0) 7px), linear-gradient(112deg, rgba(255,255,255,0) 28%, rgba(255,255,255,.6) 44%, rgba(13,148,136,.06) 60%, rgba(13,148,136,0) 78%), linear-gradient(180deg, rgba(255,255,255,.75) 0%, rgba(255,255,255,0) 55%), linear-gradient(0deg, rgba(13,148,136,.06) 0%, rgba(13,148,136,0) 70%), linear-gradient(90deg, #effcf9 0%, #ffffff 100%)",
    line: "linear-gradient(180deg, rgba(255,255,255,.7) 0px, rgba(255,255,255,0) 1.5px), linear-gradient(90deg, rgba(94,234,212,.3) 0%, #5eead4 14%, #0d9488 48%, #22d3ee 84%, rgba(34,211,238,.25) 100%)",
    project: "#475569",
    call: "linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)",
    callShadow: "0 8px 16px -10px rgba(13,148,136,.55)",
    update: raised("#e9f8f5", "rgba(13,148,136,.24)", "#0f766e")
  },
  OVERDUE: {
    accent: "#d1343a",
    header: "linear-gradient(180deg, rgba(229,72,77,.13) 0px, rgba(229,72,77,0) 7px), linear-gradient(112deg, rgba(255,255,255,0) 28%, rgba(255,255,255,.6) 44%, rgba(229,72,77,.06) 60%, rgba(229,72,77,0) 78%), linear-gradient(180deg, rgba(255,255,255,.75) 0%, rgba(255,255,255,0) 55%), linear-gradient(0deg, rgba(229,72,77,.06) 0%, rgba(229,72,77,0) 70%), linear-gradient(90deg, #fff4f0 0%, #ffffff 100%)",
    line: "linear-gradient(180deg, rgba(255,255,255,.7) 0px, rgba(255,255,255,0) 1.5px), linear-gradient(90deg, rgba(253,186,116,.3) 0%, #fdba74 14%, #f97316 42%, #e5484d 78%, rgba(239,68,68,.25) 100%)",
    project: "#475569",
    call: "linear-gradient(135deg, #f0663a 0%, #dc3545 100%)",
    callShadow: "0 8px 16px -10px rgba(220,53,69,.55)",
    update: raised("#fff1ee", "rgba(209,52,58,.22)", "#b42318")
  },
  QUIET: {
    accent: "#64748b",
    header: "linear-gradient(180deg, rgba(100,116,139,.13) 0px, rgba(100,116,139,0) 7px), linear-gradient(112deg, rgba(255,255,255,0) 28%, rgba(255,255,255,.6) 44%, rgba(100,116,139,.06) 60%, rgba(100,116,139,0) 78%), linear-gradient(180deg, rgba(255,255,255,.75) 0%, rgba(255,255,255,0) 55%), linear-gradient(0deg, rgba(100,116,139,.06) 0%, rgba(100,116,139,0) 70%), linear-gradient(90deg, #f4f6f9 0%, #ffffff 100%)",
    line: "linear-gradient(180deg, rgba(255,255,255,.7) 0px, rgba(255,255,255,0) 1.5px), linear-gradient(90deg, rgba(203,213,225,.3) 0%, #cbd5e1 16%, #64748b 50%, #cbd5e1 84%, rgba(203,213,225,.3) 100%)",
    project: "#475569",
    call: "linear-gradient(135deg, #64748b 0%, #475569 100%)",
    callShadow: "0 8px 16px -10px rgba(71,85,105,.5)",
    update: raised("#f1f5f9", "rgba(100,116,139,.24)", "#334155")
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
  return raised(c.bg, `${c.text}2e`, c.text);
};

// Tags. Coloured ones are the only semantic exceptions; everything else is
// the neutral pill + a dot.
const TAG_BASE = "inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 text-[11px] font-bold leading-none whitespace-nowrap";
export const TAG = TAG_BASE;
export const NEUTRAL_TAG: CSSProperties = raised("#eef2f7", "#e2e8f0", TEXT2);
export const TINT_TAG = {
  hot: raised("#ffeaea", "#fbd5d5", "#b42318"),
  warm: raised("#fff3dc", "#fbe3b6", "#92400e"),
  callFirst: raised("#ffeaea", "#fbd5d5", "#b42318"),
  recycleSoon: raised("#fff3dc", "#fbe3b6", "#92400e")
} satisfies Record<string, CSSProperties>;

// Recycle countdown chip (2026-10-10): far = neutral, within 24h = amber,
// under 12h = coral. Text >= 5.7:1 on each background.
export function recycleChipStyle(msLeft: number): CSSProperties {
  if (msLeft < 12 * 3600000) return TINT_TAG.hot;
  if (msLeft < 24 * 3600000) return TINT_TAG.warm;
  return NEUTRAL_TAG;
}
export function formatRecycleLeft(msLeft: number): string {
  const totalHours = Math.floor(Math.max(0, msLeft) / 3600000);
  if (totalHours < 1) return "<1h";
  const days = Math.floor(totalHours / 24);
  return days > 0 ? `${days}d ${totalHours % 24}h` : `${totalHours}h`;
}

export const DOT = {
  slate: "#94a3b8",
  gold: GOLD,
  teal: "#14b8a6",
  blueGrey: "#7c93b0",
  sky: "#38bdf8",
  amber: "#f59e0b"
};

// Source label (2026-10-10): one display name per source, shared by every
// lead card. Raw values seen in the DB: "99 Acre", "Housing", "Meta",
// "Personal", "Catcher", "Manual Booking Entry"; the rest are mapped for
// manual entry / future imports. Empty or missing -> null (no chip shown).
export function sourceLabel(source: string | null | undefined): string | null {
  const raw = (source || "").trim();
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (/99\s*acre/.test(s)) return "99acres";
  if (s.includes("housing")) return "Housing.com";
  if (s.includes("magic")) return "MagicBricks";
  if (/instagram|\big\b/.test(s)) return "Instagram";
  if (/facebook|\bfb\b/.test(s)) return "Facebook";
  if (s.includes("meta")) return "Meta";
  if (s.includes("google")) return "Google";
  if (s.includes("website") || s === "web") return "Website";
  if (/walk[\s-]?in/.test(s)) return "Walk-in";
  if (s.includes("referr")) return "Referral";
  if (s.includes("catcher")) return "Catcher";
  if (s.includes("personal")) return "Personal";
  if (s.includes("legacy")) return "Legacy";
  if (s.includes("manual")) return "Manual entry";
  return raw;
}

// Source dot colour (99 Acres orange, Housing.com cyan, Meta blue; others slate).
export function sourceDot(source: string | null | undefined): string {
  const s = (source || "").toLowerCase();
  if (s.includes("99")) return "#f97316";
  if (s.includes("housing")) return "#06b6d4";
  if (/meta|facebook|instagram|\bfb\b|\big\b/.test(s)) return "#3b82f6";
  return DOT.slate;
}

// Sizes (decent): name 18, number 15, project 13.5, facts 12.5 / labels 10, tags 11, buttons 14.
// Name 600 and number 500 (lighter than the old 800 / 700); the number stays tabular at each call site.
export const SIZE = {
  name: "text-[18px] leading-[1.25] font-bold tracking-[-0.012em]",
  number: "text-[15px] leading-tight tracking-[.03em] font-semibold",
  project: "text-[13.5px] leading-snug",
  factLabel: "text-[10px] tracking-[.06em] uppercase",
  factValue: "text-[12.5px] leading-snug",
  button: "text-[14px]"
};

// Action row (dock). On a card narrower than 20rem (a 320px phone, or larger
// browser text) Call takes the full first line and the icon buttons share the
// second line equally, so nothing is squeezed or pushed out of the card. rem so
// it follows the browser text size.
// Facts row (Assigned | Calls | Last activity). On a card narrower than 24rem
// the Assigned date takes the whole first line and the other two share the
// second; under 18rem every fact gets its own line, so nothing wraps or spills.
export const FACTS = "grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 gap-y-2 @max-[24rem]:grid-cols-[auto_minmax(0,1fr)] @max-[24rem]:gap-x-6 @max-[18rem]:grid-cols-1 @max-[24rem]:[&>*:first-child]:col-span-full rounded-[12px] px-3 py-2";

// Text hierarchy (2026-10-10): rich neutrals, not all black.
//   name   #16202e 700 (INK)      number #2c3a4e 600 (cool slate-ink)
//   label  #6f6553 warm champagne-grey, small caps   value #334155 600 (graphite)
// Every pair measured >= 4.9:1 on the card tints and facts box.
export const NUMBER_INK = "#2c3a4e";
export const FACT_LABEL = `${SIZE.factLabel} inline-flex items-center gap-1.5 whitespace-nowrap font-bold text-[#6f6553]`;
export const FACT_VALUE = `${SIZE.factValue} mt-0.5 font-semibold text-[#334155]`;
// Facts box: soft white glass with a warm champagne hairline.
export const FACTS_BOX: CSSProperties = { background: "rgba(255,255,255,.72)", boxShadow: "inset 0 0 0 1px #ece3cf, 0 1px 2px rgba(15,23,42,.03)" };

export const DOCK = "flex flex-wrap items-center gap-2 @max-[20rem]:[&>*]:flex-1 @max-[20rem]:[&>*:first-child]:basis-full";

export const ICON_BUTTON =
  "shrink-0 h-11 w-11 rounded-[13px] flex items-center justify-center transition-[filter,transform] hover:-translate-y-px hover:brightness-[.98] active:translate-y-0 active:scale-95 motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-slate-400";
export const CALL_BUTTON =
  "flex-1 min-w-0 h-11 rounded-[13px] flex items-center justify-center gap-1.5 font-bold whitespace-nowrap [&_svg]:shrink-0 [&_svg]:text-(--call-icon) transition-[filter,transform] hover:-translate-y-px hover:brightness-[.97] active:translate-y-0 active:scale-[.98] motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-slate-500";
export const BUTTON_BG = {
  whatsapp: raised("#e2f7eb", "#c9ecd8"),
  quickDial: raised("#eef2f7", "#e2e8f0", "#334155"),
  chevronClosed: raised("#eef2f7", "#e2e8f0", "#334155"),
  chevronOpen: { background: "linear-gradient(180deg, #1e293b 0%, #0f172a 100%)", color: "#ffffff", boxShadow: "inset 0 1px 0 rgba(255,255,255,.12), 0 2px 6px -2px rgba(15,23,42,.45)" } as CSSProperties
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
const TONE_INK: Record<PassTone, string> = { NEW: "#1d4ed8", FOLLOW_UP: "#0f766e", OVERDUE: "#b42318", QUIET: "#475569" };
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
    ["--tone-tint" as string]: `rgba(${rgb},.12)`,
    ["--tone-ring" as string]: `rgba(${rgb},.22)`,
    ["--tone-ink" as string]: TONE_INK[tone],
    ["--card-shadow" as string]: `inset 0 1px 0 rgba(255,255,255,.9), 0 1px 2px rgba(15,23,42,.04), 0 10px 24px -12px rgba(${rgb},.24), 0 24px 48px -28px rgba(15,23,42,.18)`,
    ["--card-shadow-hover" as string]: `inset 0 1px 0 rgba(255,255,255,.9), 0 2px 4px rgba(15,23,42,.05), 0 14px 28px -12px rgba(${rgb},.30), 0 28px 52px -28px rgba(15,23,42,.22)`
  };
}
// White-glass box for facts row / last log / notes, so they read clearly on the gradient.
export const GLASS_BOX: CSSProperties = { background: "rgba(255,255,255,.7)", boxShadow: `inset 0 0 0 1px ${HAIRLINE}` };

// Lead name in ink. The Call button is part of the card's own tone: a
// light gradient from the card's tint (same family as the Update /
// chevron buttons), a hairline border in the tone and accent-coloured
// text/icon. Contrast (text on the darker end): NEW 5.6:1, FOLLOW_UP
// 4.7:1, OVERDUE 5.4:1, QUIET 8.6:1 (AA).
export const NAME_COLOR = INK;
const CALL_TONE: Record<PassTone, { from: string; to: string; text: string; ring: string; glow: string }> = {
  NEW: { from: "#f7faff", to: "#e2ecff", text: "#1d4ed8", ring: "rgba(37,99,235,.28)", glow: "rgba(37,99,235,.22)" },
  FOLLOW_UP: { from: "#f4fcfa", to: "#dcf3ec", text: "#0f766e", ring: "rgba(13,148,136,.30)", glow: "rgba(13,148,136,.20)" },
  OVERDUE: { from: "#fff8f5", to: "#ffe4da", text: "#b42318", ring: "rgba(209,52,58,.28)", glow: "rgba(209,52,58,.22)" },
  QUIET: { from: "#f9fafc", to: "#e6ebf1", text: "#334155", ring: "rgba(100,116,139,.30)", glow: "rgba(71,85,105,.18)" }
};
export function callStyle(tone: PassTone): CSSProperties {
  const c = CALL_TONE[tone];
  return {
    background: `linear-gradient(180deg, ${c.from} 0%, ${c.to} 100%)`,
    color: INK,
    ["--call-icon" as string]: c.text,
    boxShadow: `inset 0 1px 0 rgba(255,255,255,.9), inset 0 0 0 1px ${c.ring}, 0 1px 2px rgba(15,23,42,.05), 0 6px 14px -8px ${c.glow}`
  };
}

// Header: soft tint + 3px accent line, with a glassy top/bottom highlight.
export const HEADER_GLASS = "min-h-[36px] shadow-[inset_0_1px_0_rgba(255,255,255,.95),inset_0_-1px_0_rgba(226,232,240,.95),inset_0_-4px_5px_-4px_rgba(15,23,42,.09),0_1px_2px_rgba(15,23,42,.04)]";
