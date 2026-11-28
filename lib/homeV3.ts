// Employee Home v3 (2026-11-29): pure helpers for the new look. Every number comes from useEmployeeHome (the same
// source as the old Home); these functions only pick and word them, so "Do this now", progress and follow-ups can never
// show two different numbers for the same thing.
import type { AttentionCounts, UpNextItem } from "@/lib/employeeHome";
import type { HomeToday } from "@/lib/useEmployeeHome";

const IST_OFFSET_MS = 5.5 * 3600e3;

export function istHour(now: number = Date.now()): number {
  return new Date(now + IST_OFFSET_MS).getUTCHours();
}

export function greeting(now: number = Date.now()): "Good morning" | "Good afternoon" | "Good evening" {
  const h = istHour(now);
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

// Placeholder "Message of the day" lines (a light real-estate smile), one per IST day, no repeat for 36 days. The strip
// takes a text prop, so an admin-written message can replace this later without touching the layout.
export const DAILY_LINES: string[] = [
  "A callback promised is a site visit waiting to happen.",
  "Every 'call me later' is a 'yes' that is still deciding.",
  "Follow-ups are like plants: water them daily and watch them grow into bookings.",
  "The best time to call a prospect was yesterday. The second best is now.",
  "A site visit beats a hundred brochures.",
  "Today's 'just looking' can be tomorrow's housewarming invite.",
  "Location, location, follow-up.",
  "Nobody ever booked a flat from a missed call.",
  "Smile while you dial: they can hear it.",
  "The keys to a new home start with your first 'Hello'.",
  "Every no gets you closer to the next yes.",
  "A good note today saves a confused call tomorrow.",
  "Prospects forget. Reminders do not.",
  "Square feet are sold one conversation at a time.",
  "Be the call they are happy to pick up.",
  "Today's follow-up is tomorrow's booking amount.",
  "If the client says 'send details', send them before the tea gets cold.",
  "The site looks even better when you are the one showing it.",
  "Consistency builds homes. Calls build bookings.",
  "Fortune favours the one who calls back on time.",
  "Every lead is someone's dream address.",
  "Booking day is just many good follow-up days stacked together.",
  "A warm lead cools fast. Call while it is hot.",
  "Your next call could be someone's biggest decision of the year.",
  "Visits are where interest turns into intent.",
  "Small talk, big tickets.",
  "Ask about their family; the right flat size follows.",
  "Late callback? A quick sorry and a clear next step works wonders.",
  "Plans change. Your follow-up should not.",
  "The best brochure is a happy visitor.",
  "Today is a great day to turn a 'maybe' into a site visit.",
  "Good prospects remember who called them back.",
  "Every booking starts with a number dialled.",
  "Clear the late ones first, then enjoy the rest of the list.",
  "A full calendar of visits is the best kind of busy.",
  "Close the day with zero overdue: future you will thank you."
];

export function messageOfTheDay(now: number = Date.now(), lines: string[] = DAILY_LINES): string {
  const day = Math.floor((now + IST_OFFSET_MS) / 86400e3);
  return lines[((day % lines.length) + lines.length) % lines.length];
}

// "Do this now": the first thing to do, in the queue's own order of urgency, with its count. One main action.
export interface HeroModel {
  state: "work" | "clear" | "empty";
  title: string;
  detail: string;
  count: number;
}
export function heroModel(attention: AttentionCounts | null, newCount: number, queueLength: number): HeroModel {
  if (!attention) return { state: "empty", title: "", detail: "", count: 0 };
  const late = attention["reminders-missed"] + attention["followup-overdue"];
  const pick: [number, string, string][] = [
    [attention["pending-result"], "Save results for calls you made", "Called, no result yet"],
    [late, "Call your late follow-ups", "Overdue callbacks"],
    [attention["reminders-today"], "Call today's callbacks", "Callbacks due today"],
    [attention["visits-today"], "Confirm today's site visits", "Visits due today"],
    [newCount, "Call your new leads", "New leads waiting"]
  ];
  const first = pick.find(([n]) => n > 0);
  if (!first || queueLength === 0) return { state: "clear", title: "All caught up", detail: "Nothing is due right now. Nice work!", count: 0 };
  return { state: "work", title: first[1], detail: first[2], count: first[0] };
}

// Today's progress: done = results saved today; left = what is still due now in the queue (not plain New leads).
export function progressModel(today: HomeToday | null, dueNow: number): { done: number; left: number; pct: number; finished: boolean } {
  const done = today?.results_saved ?? 0;
  const left = Math.max(dueNow, 0);
  const total = done + left;
  return { done, left, pct: total === 0 ? 0 : Math.round((done / total) * 100), finished: left === 0 && done > 0 };
}

// Today's follow-ups: callbacks and follow-ups that are late or due today, late first, then today's by time.
export type FollowUpWhen = { kind: "late" | "today"; at: number | null };
export function followUpItems(items: UpNextItem[], todayAt: Map<string, number>, missedAt: Map<string, number>): (UpNextItem & { when: FollowUpWhen })[] {
  const out: (UpNextItem & { when: FollowUpWhen })[] = [];
  for (const it of items) {
    if (it.reason === "MISSED") out.push({ ...it, when: { kind: "late", at: missedAt.get(it.lead.id) ?? null } });
    else if (it.reason === "OVERDUE") out.push({ ...it, when: { kind: "late", at: lastTouch(it) } });
    else if (it.reason === "REMINDER") out.push({ ...it, when: { kind: "today", at: todayAt.get(it.lead.id) ?? null } });
  }
  const t = (x: { when: FollowUpWhen }) => x.when.at ?? Number.POSITIVE_INFINITY;
  return out.sort((a, b) => (a.when.kind === b.when.kind ? t(a) - t(b) : a.when.kind === "late" ? -1 : 1));
}
function lastTouch(it: UpNextItem): number | null {
  const v = it.lead.lead_history?.[0]?.last_activity_at;
  const n = v ? Date.parse(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function followUpCount(attention: AttentionCounts | null): { late: number; today: number; total: number } {
  if (!attention) return { late: 0, today: 0, total: 0 };
  const late = attention["reminders-missed"] + attention["followup-overdue"];
  return { late, today: attention["reminders-today"], total: late + attention["reminders-today"] };
}

export function istClock(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

export function whenText(w: FollowUpWhen, reason: UpNextItem["reason"], now: number = Date.now()): string {
  if (w.kind === "today") return w.at ? `Due ${istClock(w.at)}` : "Due today";
  if (reason === "MISSED") return w.at ? `Missed yesterday ${istClock(w.at)}` : "Missed yesterday";
  if (!w.at) return "Overdue";
  const days = Math.max(1, Math.floor((now - w.at) / 86400e3));
  return `Overdue · no update for ${days} day${days === 1 ? "" : "s"}`;
}

export const STAGE_WORD: Record<string, string> = { LEADS: "Leads", FOLLOW_UP: "Follow-up", VISIT: "Visit", BOOKING: "Booking" };

// Preview / local only (never the live domain): ?home=p1 shows the previous Home, to compare without a database change.
export function homeVariantFromUrl(search: string, hostname: string, remembered: string | null = null): "v3" | "p1" {
  const preview = hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".vercel.app");
  if (!preview) return "v3";
  const asked = new URLSearchParams(search).get("home");
  if (asked === "p1" || asked === "v3") return asked;
  return remembered === "p1" ? "p1" : "v3";
}
export const HOME_VARIANT_KEY = "home-variant:v1";
