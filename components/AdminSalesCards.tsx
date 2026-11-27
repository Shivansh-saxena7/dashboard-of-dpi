"use client";
// Admin Home A4 (2026-11-20): "Visits and bookings" (each number vs yesterday at this time; zero = neutral grey) and
// "System controls" (display only: what each switch is set to; nothing can be changed here). Icon + word + colour.
import Link from "next/link";
import { BODY, CARD, DELTA, FadeIn, FOCUS, LINK, NUM, PILL, PILL_BASE, PRESS, Retry, Skeleton, TITLE } from "@/components/AdminHomeUi";
import { CONTROL_VIEW, deltaText } from "@/lib/adminHome";
import type { useAdminSales } from "@/lib/useAdminSales";

function Num({ testId, label, pair, href }: { testId: string; label: string; pair: [number, number]; href: string }) {
  const d = deltaText(pair[0], pair[1]);
  const zero = pair[0] === 0;
  return (
    <Link href={href} data-testid={testId} data-tone={zero ? "zero" : "normal"} className={`flex min-h-[92px] flex-col justify-between rounded-xl bg-slate-50 p-3 hover:bg-slate-100 ${PRESS} ${FOCUS}`}>
      <span className={`${NUM} ${zero ? "text-slate-600" : "text-slate-900"}`}>{pair[0]}</span>
      <span className="text-[13px] font-medium text-slate-700">{label}</span>
      <span data-testid={`${testId}-delta`} className={DELTA}>{d.text}</span>
    </Link>
  );
}

export function VisitsBookings({ sales }: { sales: ReturnType<typeof useAdminSales> }) {
  const s = sales.sales;
  return (
    <section aria-labelledby="admin-sales" data-testid="admin-sales" className={CARD}>
      <div className="mb-3 flex min-h-11 items-center justify-between">
        <h2 id="admin-sales" className={TITLE}>Visits and bookings</h2>
        <Link href="/admin/leaderboard" className={LINK}>Leaderboard ›</Link>
      </div>
      {s.loading && !s.data ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-[92px]" />)}
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
      <div className="mb-3 flex min-h-11 items-center justify-between">
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
                  <span className={`text-slate-800 ${BODY}`}>{r.label}</span>
                  <span className={`${PILL_BASE} ${PILL[v.severity as keyof typeof PILL]}`}>
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
