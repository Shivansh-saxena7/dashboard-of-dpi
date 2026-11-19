"use client";
// Employee Home, Phases 1-2 (2026-11-18), behind lead_engine_settings.employee_home_mode (lib/employeeHome.ts).
// Order: Needs attention, Today tiles, Up next, My leads, then the social posts card collapsed (it loads, and polls,
// only when opened). Numbers and links only, plus the Up next Call button, which is LeadCard's own Call: tel: link +
// rememberCalledCard + logCallClick. The Home registers itself as the list on screen (lib/activeCall.ts), so a call
// from here comes back through the existing call-return flow (ResumeCallStrip / cold-start resume to
// /leads?openLead=), which opens the lead with its result form. The Start Shift card, header, tab bar and call-return
// strip stay as before (app/page.tsx).
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import PostsTrackingView from "@/components/PostsTrackingView";
import { useEmployeeHome } from "@/lib/useEmployeeHome";
import { useTeamToday } from "@/lib/useTeamToday";
import { logCallClick } from "@/lib/logCallClick";
import { rememberCalledCard } from "@/lib/lastCalledLead";
import { registerActiveCallContext } from "@/lib/activeCall";
import {
  HOME_ATTENTION_LINKS,
  HOME_FILTER_LABELS,
  HOME_LINKS,
  UP_NEXT_LABELS,
  type HomeFilter,
  type HomeStage,
  type UpNextItem
} from "@/lib/employeeHome";

// E4: "Called, no result" first (the result form is one tap away), then yesterday's missed reminders.
const ATTENTION_ROWS: HomeFilter[] = ["pending-result", "reminders-missed", "reminders-today", "followup-overdue", "visits-today"];

// Up next: the lead opens on /leads (same modal, same result form); Call is LeadCard's handleCallClick, unchanged.
function UpNextRow({ item }: { item: UpNextItem }) {
  const { lead, reason } = item;
  const historyId = lead.lead_history?.[0]?.id ?? null;
  const onCall = () => {
    rememberCalledCard(lead.id);
    if (historyId) logCallClick(historyId, lead.id);
  };
  return (
    <li data-testid={`up-next-${lead.id}`} className="flex items-center gap-2 py-1.5">
      <Link
        href={`/leads?openLead=${encodeURIComponent(lead.id)}`}
        className="flex min-h-12 min-w-0 flex-1 flex-col justify-center rounded-xl px-2 active:bg-slate-50"
      >
        <span className="truncate text-sm font-semibold text-slate-900">{lead.name || "Lead"}</span>
        <span className="truncate text-xs text-slate-600">
          {UP_NEXT_LABELS[reason]}
          {lead.project ? ` · ${lead.project}` : ""}
        </span>
      </Link>
      {lead.mobile && historyId && (
        <a
          href={`tel:${lead.mobile}`}
          onClick={onCall}
          data-testid={`up-next-call-${lead.id}`}
          aria-label={`Call ${lead.name || "lead"}`}
          className="flex min-h-12 min-w-[72px] items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm active:bg-blue-700"
        >
          Call
        </a>
      )}
    </li>
  );
}

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

export default function EmployeeHomeP1({
  employeeId,
  employeeName,
  role,
  teamId
}: {
  employeeId: string;
  employeeName?: string | null;
  role?: string | null;
  teamId?: string | null;
}) {
  const { counts, attention, upNext, queueLength, queueUrgent, pendingIds, data, dataQueueLength, today, leadsError, todayError, remindersError, loading, reload } = useEmployeeHome(employeeId);
  // Phase 3 variants: a data-only employee (no LEAD leads, some DATA leads) sees DATA numbers instead of the lead
  // sections; a team leader also gets "My team today" (their own team only, RLS).
  const isDataOnly = Boolean(data);
  const isTeamLeader = role === "team_leader" && Boolean(teamId);
  const teamToday = useTeamToday(teamId, isTeamLeader);
  const [socialOpen, setSocialOpen] = useState(false);
  const upNextRef = useRef(upNext);
  upNextRef.current = upNext;

  useEffect(() => {
    setSocialOpen(readSocialOpen());
  }, []);

  // The Home is the list on screen for a Call tap from Up next (the Leads list registers itself the same way).
  // Coming back lands on /leads?openLead=<id> with the default list (Leads tab, no filter).
  useEffect(
    () =>
      registerActiveCallContext({
        employeeId,
        listType: "LEAD",
        hasLead: (id) => upNextRef.current.some((item) => item.lead.id === id),
        leadName: (id) => upNextRef.current.find((item) => item.lead.id === id)?.lead.name ?? null,
        getListState: () => ({ tab: "LEADS", statusFilter: "", sortBy: "NEWEST" }),
        indexOf: () => -1
      }),
    [employeeId]
  );

  const attentionTotal = attention ? ATTENTION_ROWS.reduce((sum, key) => sum + attention[key], 0) : 0;

  const toggleSocial = () => {
    setSocialOpen((open) => {
      writeSocialOpen(!open);
      return !open;
    });
  };

  return (
    <div data-testid="employee-home-p1" className="mx-auto w-full max-w-xl space-y-4 px-4 pb-28 pt-4">
      {!isDataOnly && (
      <section aria-labelledby="home-attention" data-testid="needs-attention" className="rounded-2xl border border-amber-200 bg-white/90 p-4 shadow-sm">
        <h2 id="home-attention" className="mb-2 text-base font-semibold text-slate-900">Needs attention</h2>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
          </div>
        ) : attention ? (
          attentionTotal === 0 ? (
            <p data-testid="all-caught-up" className="flex min-h-11 items-center text-sm text-slate-600">
              All caught up. Nothing needs attention right now.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {ATTENTION_ROWS.filter((key) => attention[key] > 0).map((key) => (
                <li key={key}>
                  <Link
                    href={
                      // One call without a result: straight to that lead's sheet (result form), as call-return does.
                      key === "pending-result" && pendingIds.length === 1
                        ? `/leads?openLead=${encodeURIComponent(pendingIds[0])}`
                        : HOME_ATTENTION_LINKS[key]
                    }
                    data-testid={`attention-${key}`}
                    aria-label={`${attention[key]} ${HOME_FILTER_LABELS[key]}, open`}
                    className="flex min-h-12 items-center justify-between gap-3 px-1 text-sm text-slate-800"
                  >
                    <span>
                      <b className="mr-1.5 tabular-nums text-amber-800">{attention[key]}</b>
                      {HOME_FILTER_LABELS[key]}
                    </span>
                    <span aria-hidden className="text-slate-400">›</span>
                  </Link>
                </li>
              ))}
            </ul>
          )
        ) : (
          leadsError && <RetryBox onRetry={reload} />
        )}
        {!loading && remindersError && (
          <p className="mt-1 text-xs text-slate-500">Reminders couldn&apos;t load; they are not counted here.</p>
        )}
      </section>
      )}

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
            {data ? (
              <>
                <Tile testId="tile-data-untouched" href="/data" value={data.untouched} label="Untouched data" tone="blue" />
                <Tile testId="tile-data-calls-left" href="/data" value={data.callsLeft} label={`Calls left (${4} attempts)`} tone="amber" />
              </>
            ) : counts ? (
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

      {!isDataOnly && (
      <section aria-labelledby="home-up-next" data-testid="up-next" className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
        <h2 id="home-up-next" className="mb-1 text-base font-semibold text-slate-900">Up next</h2>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : upNext.length > 0 ? (
          <ul className="divide-y divide-slate-100">
            {upNext.map((item) => (
              <UpNextRow key={item.lead.id} item={item} />
            ))}
          </ul>
        ) : leadsError ? (
          <RetryBox onRetry={reload} />
        ) : (
          <p className="flex min-h-11 items-center text-sm text-slate-600">No leads waiting. Check back later.</p>
        )}
      </section>
      )}

      {isDataOnly && data && (
        <section aria-labelledby="home-my-data" data-testid="my-data" className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="home-my-data" className="text-base font-semibold text-slate-900">My data</h2>
            <Link href="/data" className="flex min-h-11 items-center px-2 text-sm font-medium text-blue-700">
              All {data.total} ›
            </Link>
          </div>
          <p className="text-sm text-slate-600">
            <b data-testid="data-last-attempt" className="tabular-nums text-amber-800">{data.lastAttempt}</b> on their last attempt
          </p>
        </section>
      )}

      {!isDataOnly && (
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
      )}

      {isTeamLeader && (
        <section aria-labelledby="home-team" data-testid="team-today" className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="home-team" className="text-base font-semibold text-slate-900">My team today</h2>
            <Link href="/team" className="flex min-h-11 items-center px-2 text-sm font-medium text-blue-700">
              Team ›
            </Link>
          </div>
          {teamToday.team ? (
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: "team-on-shift", value: `${teamToday.team.onShift}/${teamToday.team.members}`, label: "On shift" },
                { id: "team-waiting", value: String(teamToday.team.waiting), label: "To assign" },
                { id: "team-at-risk", value: String(teamToday.team.atRisk), label: "At risk" }
              ].map((t) => (
                <Link key={t.id} href="/team" data-testid={t.id} className="flex min-h-14 flex-col items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-1 text-center">
                  <span className="text-lg font-bold tabular-nums text-slate-900">{t.value}</span>
                  <span className="text-xs font-medium text-slate-600">{t.label}</span>
                </Link>
              ))}
            </div>
          ) : teamToday.error ? (
            <RetryBox onRetry={teamToday.reload} />
          ) : (
            <Skeleton className="h-14" />
          )}
        </section>
      )}

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

      {/* Start with next lead (thumb zone): the queue runs on /leads with its own modal, Call and result-save. */}
      {!loading && (
        <div className="fixed inset-x-0 bottom-0 z-20 px-4" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}>
          <div className="mx-auto max-w-xl">
            {isDataOnly ? (
              dataQueueLength > 0 ? (
                <Link href="/data?queue=1" data-testid="start-next" className="flex min-h-14 flex-col items-center justify-center rounded-2xl bg-blue-600 px-4 py-2 text-white shadow-lg active:bg-blue-700">
                  <span className="text-base font-semibold">Start with next lead</span>
                  <span data-testid="start-next-count" className="text-xs font-medium text-blue-100">{dataQueueLength} in the queue</span>
                </Link>
              ) : null
            ) : queueLength > 0 ? (
              <Link href="/leads?queue=1" data-testid="start-next" className="flex min-h-14 flex-col items-center justify-center rounded-2xl bg-blue-600 px-4 py-2 text-white shadow-lg active:bg-blue-700">
                <span className="text-base font-semibold">Start with next lead</span>
                <span data-testid="start-next-count" className="text-xs font-medium text-blue-100">
                  {queueUrgent} due now · {queueLength} total
                </span>
              </Link>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
