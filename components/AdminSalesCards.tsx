"use client";
// Admin Home A4 (2026-11-20): "Visits and bookings" (each number vs yesterday at this time; zero = neutral grey) and
// "System controls" (display only: what each switch is set to; nothing can be changed here). Icon + word + colour.
import Link from "next/link";
import { type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { CONTROL_VIEW, deltaText } from "@/lib/adminHome";
import type { useAdminSales } from "@/lib/useAdminSales";

const CARD = "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm";
const TITLE = "text-base font-semibold text-slate-900";
const LINK = "inline-flex min-h-11 items-center px-2 text-[13px] font-semibold text-blue-700";
const PILL: Record<string, string> = {
  critical: "bg-red-50 text-red-700",
  warning: "bg-amber-50 text-amber-800",
  info: "bg-blue-50 text-blue-700",
  ok: "bg-emerald-50 text-emerald-700",
  mute: "bg-slate-100 text-slate-700"
};

function FadeIn({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div initial={{ opacity: reduce ? 1 : 0 }} animate={{ opacity: 1 }} transition={{ duration: reduce ? 0 : 0.15 }}>
      {children}
    </motion.div>
  );
}
const Skeleton = ({ className }: { className: string }) => <div aria-hidden className={`animate-pulse rounded-xl bg-slate-200/70 motion-reduce:animate-none ${className}`} />;
const Retry = ({ what, onRetry, testId }: { what: string; onRetry: () => void; testId: string }) => (
  <button type="button" onClick={onRetry} data-testid={testId} className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-left text-sm font-medium text-slate-700">
    Couldn&apos;t load {what}. Tap to try again.
  </button>
);

function Num({ testId, label, pair, href }: { testId: string; label: string; pair: [number, number]; href: string }) {
  const d = deltaText(pair[0], pair[1]);
  const zero = pair[0] === 0;
  return (
    <Link href={href} data-testid={testId} data-tone={zero ? "zero" : "normal"} className="flex min-h-[84px] flex-col justify-between rounded-xl bg-slate-50 p-3">
      <span className={`text-[22px] font-bold leading-none tabular-nums ${zero ? "text-slate-600" : "text-slate-900"}`}>{pair[0]}</span>
      <span className="text-[13px] font-medium text-slate-700">{label}</span>
      <span data-testid={`${testId}-delta`} className="text-xs font-bold text-slate-700">{d.text}</span>
    </Link>
  );
}

export function VisitsBookings({ sales }: { sales: ReturnType<typeof useAdminSales> }) {
  const s = sales.sales;
  return (
    <section aria-labelledby="admin-sales" data-testid="admin-sales" className={CARD}>
      <div className="mb-2 flex items-center justify-between">
        <h2 id="admin-sales" className={TITLE}>Visits and bookings</h2>
        <Link href="/admin/leaderboard" className={LINK}>Leaderboard ›</Link>
      </div>
      {s.loading && !s.data ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-[84px]" />)}
        </div>
      ) : s.error || !s.data ? (
        <Retry what="visits and bookings" onRetry={sales.retry.sales} testId="admin-retry-sales" />
      ) : (
        <FadeIn>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Num testId="admin-sales-visit" label="Site visits" pair={s.data.visits.VISIT} href="/coordinator" />
            <Num testId="admin-sales-revisit" label="Revisits" pair={s.data.visits.REVISIT} href="/coordinator" />
            <Num testId="admin-sales-booked" label="Booking visits" pair={s.data.visits.BOOKED} href="/coordinator" />
            <Num testId="admin-sales-bookings" label="Bookings today" pair={s.data.bookingsToday} href="/admin/leads" />
            <Num testId="admin-sales-month" label="Bookings this month" pair={s.data.bookingsMonth} href="/admin/leaderboard" />
          </div>
          <p className="mt-2 text-[13px] text-slate-600">Each vs yesterday at this time. Bookings = leads moved to Booking.</p>
        </FadeIn>
      )}
    </section>
  );
}

export function SystemControls({ sales }: { sales: ReturnType<typeof useAdminSales> }) {
  const c = sales.controls;
  return (
    <section aria-labelledby="admin-controls" data-testid="admin-controls" className={CARD}>
      <div className="mb-2 flex items-center justify-between">
        <h2 id="admin-controls" className={TITLE}>System controls</h2>
        <Link href="/admin/system-health" className={LINK}>System health ›</Link>
      </div>
      {c.loading && !c.data ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-9" />)}
        </div>
      ) : c.error || !c.data ? (
        <Retry what="the system controls" onRetry={sales.retry.controls} testId="admin-retry-controls" />
      ) : (
        <FadeIn>
          <ul className="divide-y divide-slate-100">
            {c.data.map((r) => {
              const v = CONTROL_VIEW[r.state];
              return (
                <li key={r.key} className="flex min-h-11 items-center justify-between gap-2" data-testid={`admin-control-${r.key}`} data-state={r.state}>
                  <span className="text-sm text-slate-800">{r.label}</span>
                  <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold ${PILL[v.severity]}`}>
                    <span aria-hidden>{v.icon}</span>
                    {v.word}
                    {r.pilots !== null && (r.state === "PILOT" || r.pilots > 0) ? ` · ${r.pilots} pilot${r.pilots === 1 ? "" : "s"}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[13px] text-slate-600">Display only. These switches are changed by a super admin in the database, not here.</p>
        </FadeIn>
      )}
    </section>
  );
}
