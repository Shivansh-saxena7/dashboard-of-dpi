"use client";
// Admin Home A1 (2026-11-19), behind lead_engine_settings.admin_home_mode; design: reports/admin_home_design.
// One Home for admin and super_admin. Order: header (date, Updated, Refresh) · Needs action (worst first, empty rows
// hidden, "All clear") · System (jobs, backup, errors today) · Social posts (the old dashboard, collapsed; nothing is
// read until it is opened). Every status = icon + word + colour. Read-only.
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import AdminSocialDashboard from "@/components/AdminSocialDashboard";
import { useAdminHome } from "@/lib/useAdminHome";
import { useAdminToday } from "@/lib/useAdminToday";
import { TeamToday, TodaySoFar } from "@/components/AdminTodayCards";
import { useAdminEngine } from "@/lib/useAdminEngine";
import { AdminEngineCard } from "@/components/AdminEngineCard";
import { useAdminSales } from "@/lib/useAdminSales";
import { SystemControls, VisitsBookings } from "@/components/AdminSalesCards";
import { istHeaderDate, istTime, minutesText, needsActionRows, type Severity } from "@/lib/adminHome";

const CARD = "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm";
const TITLE = "text-base font-semibold text-slate-900";
const LINK = "inline-flex min-h-11 items-center px-2 text-[13px] font-semibold text-blue-700";

const SEV: Record<Severity, { icon: string; word: string; pill: string; box: string }> = {
  critical: { icon: "✕", word: "Critical", pill: "bg-red-50 text-red-700", box: "bg-red-50 text-red-700" },
  warning: { icon: "▲", word: "Warning", pill: "bg-amber-50 text-amber-800", box: "bg-amber-50 text-amber-800" },
  info: { icon: "◆", word: "Info", pill: "bg-blue-50 text-blue-700", box: "bg-blue-50 text-blue-700" },
  ok: { icon: "✓", word: "OK", pill: "bg-emerald-50 text-emerald-700", box: "bg-emerald-50 text-emerald-700" }
};

function FadeIn({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div initial={{ opacity: reduce ? 1 : 0 }} animate={{ opacity: 1 }} transition={{ duration: reduce ? 0 : 0.15 }}>
      {children}
    </motion.div>
  );
}

function Skeleton({ className }: { className: string }) {
  return <div aria-hidden className={`animate-pulse rounded-xl bg-slate-200/70 motion-reduce:animate-none ${className}`} />;
}

function Retry({ what, onRetry, testId }: { what: string; onRetry: () => void; testId: string }) {
  return (
    <button
      type="button"
      onClick={onRetry}
      data-testid={testId}
      className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-left text-sm font-medium text-slate-700"
    >
      Couldn&apos;t load {what}. Tap to try again.
    </button>
  );
}

function Pill({ severity, text, testId }: { severity: Severity; text: string; testId?: string }) {
  const s = SEV[severity];
  return (
    <span data-testid={testId} data-severity={severity} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold ${s.pill}`}>
      <span aria-hidden>{s.icon}</span>
      {text}
    </span>
  );
}

const SYSTEM_JOBS = ["recycle-stale-leads", "check-lead-reminders", "db-backup", "backup-to-google-sheets"];

export default function AdminHomeA1({ employeeId = null }: { employeeId?: string | null } = {}) {
  const home = useAdminHome();
  // A2: Today so far + Team today (own reads; Refresh reloads both).
  const today = useAdminToday();
  // A3: Lead engine today (+ positive-history junk, counted only on Check).
  const engine = useAdminEngine(employeeId);
  // A4: Visits and bookings + System controls (display only).
  const sales = useAdminSales();
  const refreshAll = () => {
    home.refresh();
    today.refresh();
    engine.refresh();
    sales.refresh();
  };
  const [socialOpen, setSocialOpen] = useState(false);
  const now = Date.now();

  const allLoaded = !home.system.loading && !home.errors.loading && !home.approvals.loading && !home.noShift.loading;
  const anyFailed = home.system.error || home.errors.error || home.approvals.error || home.noShift.error;
  const rows = needsActionRows({
    heartbeats: home.system.data?.heartbeats,
    backup: home.system.data?.backup,
    errors: home.errors.data,
    noShift: home.noShift.data,
    transfers: home.approvals.data?.transfers,
    employeeRequests: home.approvals.data?.employeeRequests,
    positiveJunk: engine.pj.count
  });
  const worst = rows[0]?.severity;
  const hb = home.system.data?.heartbeats ?? [];
  const shownJobs = hb.filter((h) => SYSTEM_JOBS.includes(h.name) || h.severity !== "ok").sort((a, b) => SYSTEM_JOBS.indexOf(a.name) - SYSTEM_JOBS.indexOf(b.name));

  return (
    <div data-testid="admin-home-a1" className="mx-auto w-full max-w-6xl space-y-4 pb-10">
      <header className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[13px] text-slate-600">{istHeaderDate(now)}</p>
          <h1 className="text-[22px] font-bold tracking-tight text-slate-900">Today at a glance</h1>
        </div>
        <div className="flex items-center gap-2">
          {home.updatedAt && <span data-testid="admin-updated" className="text-[13px] text-slate-600">Updated {istTime(home.updatedAt)}</span>}
          <button
            type="button"
            data-testid="admin-refresh"
            onClick={refreshAll}
            className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 active:scale-[0.98] motion-reduce:transform-none"
          >
            Refresh
          </button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-12">
        <section
          aria-labelledby="admin-needs-action"
          data-testid="admin-needs-action"
          className={`${CARD} lg:col-span-8 ${worst === "critical" ? "border-red-200" : worst === "warning" ? "border-amber-200" : ""}`}
        >
          <div className="mb-2 flex items-center justify-between">
            <h2 id="admin-needs-action" className={TITLE}>Needs action</h2>
            {rows.length > 0 && worst && <Pill severity={worst} text={`${rows.length} open`} testId="admin-open-count" />}
          </div>
          {rows.length > 0 ? (
            <FadeIn>
              <ul className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <li key={r.key}>
                    <Link
                      href={r.href}
                      data-testid={`admin-row-${r.key}`}
                      data-severity={r.severity}
                      className="flex min-h-[52px] items-center gap-3 rounded-lg px-1 py-1.5 transition-colors hover:bg-slate-50 motion-reduce:transition-none"
                    >
                      <span aria-hidden className={`grid h-7 w-7 flex-none place-items-center rounded-lg text-sm font-bold ${SEV[r.severity].box}`}>{SEV[r.severity].icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-semibold text-slate-900">{r.title}</span>
                        <span className="block text-[13px] text-slate-600">{r.detail}</span>
                      </span>
                      <span className="sr-only">{SEV[r.severity].word}</span>
                      <span aria-hidden className="text-slate-500">›</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </FadeIn>
          ) : !allLoaded ? (
            <div className="space-y-2">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : !anyFailed ? (
            <p data-testid="admin-all-clear" className="flex min-h-11 items-center gap-2 text-[15px] font-medium text-emerald-700">
              <span aria-hidden>✓</span> All clear. Nothing needs your action right now.
            </p>
          ) : null}
          {allLoaded && anyFailed && (
            <p data-testid="admin-partial" className="mt-2 text-[13px] text-slate-600">
              Some checks couldn&apos;t load, so this list may be incomplete. See the cards below or tap Refresh.
            </p>
          )}
          {home.noShift.error && <div className="mt-2"><Retry what="the shift check" onRetry={home.retry.noShift} testId="admin-retry-no-shift" /></div>}
          {home.approvals.error && <div className="mt-2"><Retry what="pending approvals" onRetry={home.retry.approvals} testId="admin-retry-approvals" /></div>}
        </section>

        <section aria-labelledby="admin-system" data-testid="admin-system" className={`${CARD} lg:col-span-4`}>
          <div className="mb-1 flex items-center justify-between">
            <h2 id="admin-system" className={TITLE}>System</h2>
            <Link href="/admin/system-health" className={LINK}>System health ›</Link>
          </div>
          {home.system.loading && !home.system.data ? (
            <div className="space-y-2">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : home.system.error ? (
            <Retry what="the system status" onRetry={home.retry.system} testId="admin-retry-system" />
          ) : (
            <FadeIn>
              <ul className="divide-y divide-slate-100 text-sm">
                {shownJobs.map((h) => (
                  <li key={h.name} className="flex min-h-11 items-center justify-between gap-2" data-testid={`admin-job-${h.name}`}>
                    <span className="text-slate-800">{h.label}</span>
                    <Pill severity={h.severity} text={h.severity === "ok" ? minutesText(h.minutesAgo) : `${minutesText(h.minutesAgo)}`} />
                  </li>
                ))}
                {home.system.data?.backup && (
                  <li className="flex min-h-11 items-center justify-between gap-2" data-testid="admin-backup">
                    <span className="text-slate-800">Last backup run</span>
                    <Pill
                      severity={home.system.data.backup.severity}
                      text={home.system.data.backup.at ? `${home.system.data.backup.status === "SUCCESS" ? "OK" : "Failed"} · ${istTime(Date.parse(home.system.data.backup.at))}` : "none"}
                    />
                  </li>
                )}
              </ul>
            </FadeIn>
          )}
          <div className="mt-1 border-t border-slate-100 pt-1">
            {home.errors.loading && !home.errors.data ? (
              <Skeleton className="h-10" />
            ) : home.errors.error ? (
              <Retry what="today's errors" onRetry={home.retry.errors} testId="admin-retry-errors" />
            ) : home.errors.data ? (
              <div className="flex min-h-11 items-center justify-between gap-2 text-sm" data-testid="admin-errors">
                <span className="text-slate-800">Problems today</span>
                {home.errors.data.errors > 0 ? (
                  <Pill severity="critical" text={`${home.errors.data.errors} error${home.errors.data.errors === 1 ? "" : "s"}${home.errors.data.warnings ? ` · ${home.errors.data.warnings} warning${home.errors.data.warnings === 1 ? "" : "s"}` : ""}`} />
                ) : home.errors.data.warnings > 0 ? (
                  <Pill severity="warning" text={`${home.errors.data.warnings} warning${home.errors.data.warnings === 1 ? "" : "s"}`} />
                ) : (
                  <Pill severity="ok" text="None" />
                )}
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <TodaySoFar today={today} teamTotal={today.team.data ? today.team.data.members.length : null} />

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <TeamToday today={today} />
        </div>
        <div className="lg:col-span-4">
          <AdminEngineCard engine={engine} />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-6">
          <VisitsBookings sales={sales} />
        </div>
        <div className="lg:col-span-6">
          <SystemControls sales={sales} />
        </div>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <button
          type="button"
          onClick={() => setSocialOpen((o) => !o)}
          aria-expanded={socialOpen}
          aria-controls="admin-social"
          data-testid="admin-social-toggle"
          className={`flex min-h-12 w-full items-center justify-between px-4 text-left ${TITLE}`}
        >
          <span>
            Social posts
            <span className="block text-[13px] font-normal text-slate-600">The posts dashboard. Opens here; nothing loads until you open it.</span>
          </span>
          <span aria-hidden className={`text-slate-500 transition-transform motion-reduce:transition-none ${socialOpen ? "rotate-90" : ""}`}>›</span>
        </button>
        {socialOpen && (
          <div id="admin-social" className="border-t border-slate-100 p-2">
            <AdminSocialDashboard poll={false} />
          </div>
        )}
      </section>
    </div>
  );
}
