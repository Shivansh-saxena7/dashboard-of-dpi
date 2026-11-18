"use client";
// Employee Home, Phase 1 (2026-11-18), behind lead_engine_settings.employee_home_mode (lib/employeeHome.ts).
// Order: Today tiles, My leads, then the social posts card collapsed (it loads, and polls, only when opened).
// Read-only: numbers and links. The Start Shift card, header, tab bar and call-return strip stay as before (app/page.tsx).
import Link from "next/link";
import { useEffect, useState } from "react";
import PostsTrackingView from "@/components/PostsTrackingView";
import { useEmployeeHome } from "@/lib/useEmployeeHome";
import { HOME_LINKS, type HomeStage } from "@/lib/employeeHome";

const STAGE_LABELS: { stage: HomeStage; label: string }[] = [
  { stage: "LEADS", label: "Leads" },
  { stage: "FOLLOW_UP", label: "Follow-up" },
  { stage: "VISIT", label: "Visit" },
  { stage: "BOOKING", label: "Booking" }
];

const SOCIAL_OPEN_KEY = "employee-home-social-open";

function readSocialOpen(): boolean {
  try {
    return sessionStorage.getItem(SOCIAL_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSocialOpen(open: boolean) {
  try {
    sessionStorage.setItem(SOCIAL_OPEN_KEY, open ? "1" : "0");
  } catch {
    // ignore: a private window simply does not remember it
  }
}

function Skeleton({ className }: { className: string }) {
  return <div aria-hidden className={`animate-pulse rounded-xl bg-slate-200/70 motion-reduce:animate-none ${className}`} />;
}

function RetryBox({ onRetry }: { onRetry: () => void }) {
  return (
    <button
      type="button"
      onClick={onRetry}
      className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-medium text-slate-700"
    >
      Couldn&apos;t load. Tap to retry
    </button>
  );
}

function Tile({ href, value, label, tone, testId }: { href: string; value: number; label: string; tone: "blue" | "amber" | "slate" | "emerald"; testId: string }) {
  const tones = {
    blue: "border-blue-100 bg-blue-50 text-blue-900",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    slate: "border-slate-200 bg-white text-slate-900",
    emerald: "border-emerald-100 bg-emerald-50 text-emerald-900"
  }[tone];
  return (
    <Link
      href={href}
      data-testid={testId}
      aria-label={`${value} ${label}, open`}
      className={`flex min-h-[76px] flex-col justify-between rounded-2xl border p-3 shadow-sm transition active:scale-[0.98] motion-reduce:transition-none ${tones}`}
    >
      <span className="text-2xl font-bold tabular-nums leading-none">{value}</span>
      <span className="text-sm font-medium opacity-80">{label}</span>
    </Link>
  );
}

export default function EmployeeHomeP1({ employeeId, employeeName }: { employeeId: string; employeeName?: string | null }) {
  const { counts, today, leadsError, todayError, loading, reload } = useEmployeeHome(employeeId);
  const [socialOpen, setSocialOpen] = useState(false);

  useEffect(() => {
    setSocialOpen(readSocialOpen());
  }, []);

  const toggleSocial = () => {
    setSocialOpen((open) => {
      writeSocialOpen(!open);
      return !open;
    });
  };

  return (
    <div data-testid="employee-home-p1" className="mx-auto w-full max-w-xl space-y-4 px-4 pb-8 pt-4">
      <section aria-labelledby="home-today" className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="home-today" className="text-base font-semibold text-slate-900">Today</h2>
          <Link href={HOME_LINKS.report} className="flex min-h-11 items-center px-2 text-sm font-medium text-blue-700">
            Report ›
          </Link>
        </div>
        {loading ? (
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-[76px]" />
            <Skeleton className="h-[76px]" />
            <Skeleton className="h-[76px]" />
            <Skeleton className="h-[76px]" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {counts ? (
              <>
                <Tile testId="tile-new" href={HOME_LINKS.newLeads} value={counts.newCount} label="New leads" tone="blue" />
                <Tile testId="tile-recycling" href={HOME_LINKS.recyclingTomorrow} value={counts.recyclingTomorrow} label="Recycle tomorrow" tone="amber" />
              </>
            ) : (
              <div className="col-span-2">{leadsError && <RetryBox onRetry={reload} />}</div>
            )}
            {today ? (
              <>
                <Tile testId="tile-calls" href={HOME_LINKS.report} value={today.calls} label="Calls today" tone="slate" />
                <Tile testId="tile-saved" href={HOME_LINKS.report} value={today.results_saved} label="Results saved" tone="emerald" />
              </>
            ) : (
              <div className="col-span-2">{todayError && <RetryBox onRetry={reload} />}</div>
            )}
          </div>
        )}
        {!loading && today && (
          <p data-testid="today-line" className="mt-3 text-sm text-slate-600">
            Connected <b className="tabular-nums text-slate-900">{today.connected}</b> · Follow-ups{" "}
            <b className="tabular-nums text-slate-900">{today.followUps}</b> · Visits <b className="tabular-nums text-slate-900">{today.visits}</b>
          </p>
        )}
      </section>

      <section aria-labelledby="home-my-leads" className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="home-my-leads" className="text-base font-semibold text-slate-900">My leads</h2>
          <Link href="/leads" className="flex min-h-11 items-center px-2 text-sm font-medium text-blue-700">
            {counts ? `All ${counts.total} ›` : "Open ›"}
          </Link>
        </div>
        {loading ? (
          <Skeleton className="h-12" />
        ) : counts ? (
          <div className="grid grid-cols-4 gap-2">
            {STAGE_LABELS.map(({ stage, label }) => (
              <Link
                key={stage}
                href={HOME_LINKS.stage(stage)}
                data-testid={`stage-${stage}`}
                aria-label={`${counts.stages[stage]} in ${label}, open`}
                className="flex min-h-14 flex-col items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-1 text-center"
              >
                <span className="text-lg font-bold tabular-nums text-slate-900">{counts.stages[stage]}</span>
                <span className="text-xs font-medium text-slate-600">{label}</span>
              </Link>
            ))}
          </div>
        ) : (
          leadsError && <RetryBox onRetry={reload} />
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white/90 shadow-sm">
        <button
          type="button"
          onClick={toggleSocial}
          aria-expanded={socialOpen}
          aria-controls="home-social"
          data-testid="social-toggle"
          className="flex min-h-12 w-full items-center justify-between px-4 text-left text-base font-semibold text-slate-900"
        >
          <span>Social posts</span>
          <span aria-hidden className={`text-slate-500 transition-transform motion-reduce:transition-none ${socialOpen ? "rotate-90" : ""}`}>›</span>
        </button>
        {socialOpen && (
          <div id="home-social" className="border-t border-slate-100">
            <PostsTrackingView employeeId={employeeId} employeeName={employeeName ?? ""} />
          </div>
        )}
      </section>
    </div>
  );
}
