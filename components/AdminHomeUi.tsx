"use client";
// Admin Home A5 (2026-11-20): one set of building blocks for every Home card, so spacing, radius, type scale and
// states match design.md: 16px radius / padding / gaps, 1px border, type 22 page title / 16 card title / 28 numbers /
// 15 body / 13 labels; status = icon + word + colour (red only for act now); 150 ms fade-in, none with reduced motion;
// 44px+ targets; hover tint (desktop), press scale 0.98 (phone); a visible keyboard focus ring.
import { type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { Severity } from "@/lib/adminHome";

export const CARD = "h-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm";
export const TITLE = "text-base font-semibold text-slate-900";
export const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700";
export const LINK = `inline-flex min-h-11 items-center rounded-lg px-2 text-[13px] font-semibold text-blue-700 hover:underline ${FOCUS}`;
export const PRESS = "transition active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none";
export const NUM = "text-[28px] font-bold leading-none tabular-nums";
export const BODY = "text-[15px]";
export const LABEL = "text-[13px]";

export type Tone = Severity | "mute";
export const PILL: Record<Tone, string> = {
  critical: "bg-red-50 text-red-700",
  warning: "bg-amber-50 text-amber-800",
  info: "bg-blue-50 text-blue-700",
  ok: "bg-emerald-50 text-emerald-700",
  mute: "bg-slate-100 text-slate-700"
};
export const PILL_BASE = "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[13px] font-bold";

export function CardHeader({ id, title, right }: { id: string; title: string; right?: ReactNode }) {
  return (
    <div className="mb-3 flex min-h-11 flex-wrap items-center justify-between gap-2">
      <h2 id={id} className={TITLE}>{title}</h2>
      {right && <div className="flex items-center gap-1">{right}</div>}
    </div>
  );
}

export function FadeIn({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div initial={{ opacity: reduce ? 1 : 0 }} animate={{ opacity: 1 }} transition={{ duration: reduce ? 0 : 0.15 }}>
      {children}
    </motion.div>
  );
}

export function Skeleton({ className }: { className: string }) {
  return <div aria-hidden data-skeleton className={`animate-pulse rounded-xl bg-slate-200/70 motion-reduce:animate-none ${className}`} />;
}

// What failed + one tap to try again; never a blank card.
export function Retry({ what, onRetry, testId }: { what: string; onRetry: () => void; testId: string }) {
  return (
    <button
      type="button"
      onClick={onRetry}
      data-testid={testId}
      className={`min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-left text-[15px] font-medium text-slate-700 ${FOCUS}`}
    >
      Couldn&apos;t load {what}. Tap to try again.
    </button>
  );
}

// Change vs yesterday: a direction, not a judgement, so neutral (red is only for "act now").
export const DELTA = "text-[13px] font-bold text-slate-700";
