"use client";
// Employee Home (2026-11-18/19, Phases 1-3, E4, E5), behind lead_engine_settings.employee_home_mode (lib/employeeHome.ts).
// Order: Needs attention, Today tiles, Up next, My leads (or My data), My team today (team leaders), then the social
// posts card collapsed (it loads, and polls, only when opened); the sticky "Start with next lead" button at the bottom.
// Numbers and links only, plus the Up next Call button, which is LeadCard's own Call: tel: link + rememberCalledCard +
// logCallClick. The Home registers itself as the list on screen (lib/activeCall.ts), so a call from here comes back
// through the existing call-return flow (ResumeCallStrip / cold-start resume to /leads?openLead=), which opens the lead
// with its result form. The header, tab bar and call-return strip stay as before (app/page.tsx).
// E5 polish: one type scale (section title 16, number 28, label 13, card padding 16), neutral zero tiles, soft Call
// buttons (only Start is solid), 150 ms fade-in (none with reduced motion), per-card error text + reportClientError,
// scroll position kept when coming back, labels without opacity (contrast), room for the sticky button + safe area.
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import PostsTrackingView from "@/components/PostsTrackingView";
import { useEmployeeHome } from "@/lib/useEmployeeHome";
import { useTeamToday } from "@/lib/useTeamToday";
import { logCallClick } from "@/lib/logCallClick";
import { rememberCalledCard } from "@/lib/lastCalledLead";
import { registerActiveCallContext } from "@/lib/activeCall";
import {
  DATA_MAX_ATTEMPTS,
  HOME_ATTENTION_LINKS,
  HOME_FILTER_LABELS,
  HOME_LINKS,
  UP_NEXT_LABELS,
  fromHome,
  type HomeFilter,
  type HomeStage,
  type UpNextItem
} from "@/lib/employeeHome";

// E4: "Called, no result" first (the result form is one tap away), then yesterday's missed reminders.
const ATTENTION_ROWS: HomeFilter[] = ["pending-result", "reminders-missed", "reminders-today", "followup-overdue", "visits-today"];

const CARD = "rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm";
const TITLE = "text-base font-semibold text-slate-900";
const NUMBER = "text-[28px] font-bold tabular-nums leading-none";
const LABEL = "text-[13px] font-medium";
const LINK = "flex min-h-11 items-center px-2 text-[13px] font-semibold text-blue-700";

// Skeleton -> content: 150 ms fade, nothing with prefers-reduced-motion.
function FadeIn({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div initial={{ opacity: reduce ? 1 : 0 }} animate={{ opacity: 1 }} transition={{ duration: reduce ? 0 : 0.15 }}>
      {children}
    </motion.div>
  );
}

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
        href={fromHome(`/leads?openLead=${encodeURIComponent(lead.id)}`)}
        className="flex min-h-12 min-w-0 flex-1 flex-col justify-center rounded-xl px-2 active:bg-slate-50"
      >
        <span className="truncate text-[15px] font-semibold text-slate-900">{lead.name || "Lead"}</span>
        <span className={`truncate ${LABEL} text-slate-600`}>
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
          className="flex min-h-12 min-w-[72px] items-center justify-center rounded-xl border border-blue-600 bg-white px-4 text-sm font-semibold text-blue-700 active:bg-blue-50"
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
const scrollKey = (employeeId: string) => `employee-home-scroll:${employeeId}`;

function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // a private window simply does not remember it
  }
}

function Skeleton({ className }: { className: string }) {
  return <div aria-hidden className={`animate-pulse rounded-xl bg-slate-200/70 motion-reduce:animate-none ${className}`} />;
}

function RetryBox({ what, onRetry, testId }: { what: string; onRetry: () => void; testId: string }) {
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

type Tone = "blue" | "amber" | "slate" | "emerald";
// Zero = nothing to act on: always the neutral tile, whatever the tone.
const TONES: Record<Tone | "zero", { box: string; label: string }> = {
  blue: { box: "border-blue-100 bg-blue-50 text-blue-900", label: "text-blue-800" },
  amber: { box: "border-amber-200 bg-amber-50 text-amber-900", label: "text-amber-800" },
  slate: { box: "border-slate-200 bg-white text-slate-900", label: "text-slate-700" },
  emerald: { box: "border-emerald-100 bg-emerald-50 text-emerald-900", label: "text-emerald-800" },
  zero: { box: "border-slate-200 bg-slate-50 text-slate-700", label: "text-slate-600" }
};

function Tile({ href, value, label, hint, tone, testId }: { href: string; value: number; label: string; hint?: string; tone: Tone; testId: string }) {
  const t = TONES[value === 0 ? "zero" : tone];
  return (
    <Link
      href={href}
      data-testid={testId}
      data-tone={value === 0 ? "zero" : tone}
      aria-label={`${value} ${label}, open`}
      className={`flex min-h-[84px] flex-col justify-between rounded-2xl border p-3 shadow-sm transition active:scale-[0.98] motion-reduce:transition-none ${t.box}`}
    >
      <span className={NUMBER}>{value}</span>
      <span className={`${LABEL} ${t.label}`}>
        {label}
        {hint && <span className="block text-[12px] font-normal text-slate-600">{hint}</span>}
      </span>
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
    setSocialOpen(readSession(SOCIAL_OPEN_KEY) === "1");
  }, []);

  // E5: coming back to the Home (Back, or a tile -> list -> Back to Home) returns to where the employee was.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (loading || restoredRef.current) return;
    restoredRef.current = true;
    const y = Number(readSession(scrollKey(employeeId)));
    if (Number.isFinite(y) && y > 0) requestAnimationFrame(() => window.scrollTo(0, y));
  }, [loading, employeeId]);
  useEffect(() => {
    let last = 0;
    let frozenUntil = 0;
    const save = () => writeSession(scrollKey(employeeId), String(Math.round(window.scrollY || 0)));
    const onScroll = () => {
      const now = Date.now();
      if (now < frozenUntil) return;
      if (now - last > 250) {
        last = now;
        save();
      }
    };
    // A navigation starts with a tap: keep the position from that moment. The router then scrolls to the top while the
    // Home is still mounted, so scroll events are ignored for a moment (a tap that does not navigate loses nothing).
    const onTap = () => {
      save();
      frozenUntil = Date.now() + 1500;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("click", onTap, true);
    window.addEventListener("pagehide", save);
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("click", onTap, true);
      window.removeEventListener("pagehide", save);
    };
  }, [employeeId]);

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
  const showStart = !loading && (isDataOnly ? dataQueueLength > 0 : queueLength > 0);

  const toggleSocial = () => {
    setSocialOpen((open) => {
      writeSession(SOCIAL_OPEN_KEY, !open ? "1" : "0");
      return !open;
    });
  };

  return (
    <div
      data-testid="employee-home-p1"
      className="mx-auto w-full max-w-xl space-y-4 px-4 pt-4"
      // Room for the sticky Start button (about 72px) and the phone's safe area, so the last card is never covered.
      style={{ paddingBottom: showStart ? "calc(env(safe-area-inset-bottom, 0px) + 112px)" : "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}
    >
      {!isDataOnly && (
        <section aria-labelledby="home-attention" data-testid="needs-attention" className={`${CARD} border-amber-200`}>
          <h2 id="home-attention" className={`mb-2 ${TITLE}`}>Needs attention</h2>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-11" />
              <Skeleton className="h-11" />
            </div>
          ) : attention ? (
            <FadeIn>
              {attentionTotal === 0 ? (
                <p data-testid="all-caught-up" className="flex min-h-11 items-center text-sm text-slate-700">
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
                            ? fromHome(`/leads?openLead=${encodeURIComponent(pendingIds[0])}`)
                            : HOME_ATTENTION_LINKS[key]
                        }
                        data-testid={`attention-${key}`}
                        aria-label={`${attention[key]} ${HOME_FILTER_LABELS[key]}, open`}
                        className="flex min-h-12 items-center justify-between gap-3 px-1 text-[15px] text-slate-800"
                      >
                        <span>
                          <b className="mr-1.5 tabular-nums text-amber-800">{attention[key]}</b>
                          {HOME_FILTER_LABELS[key]}
                        </span>
                        <span aria-hidden className="text-slate-500">›</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </FadeIn>
          ) : (
            leadsError && <RetryBox what="what needs your attention" onRetry={reload} testId="retry-attention" />
          )}
          {!loading && remindersError && (
            <p data-testid="reminders-error" className={`mt-1 ${LABEL} text-slate-600`}>
              Reminders couldn&apos;t load, so they are not counted here.
            </p>
          )}
        </section>
      )}

      <section aria-labelledby="home-today" className={CARD}>
        <div className="mb-3 flex items-center justify-between">
          <h2 id="home-today" className={TITLE}>Today</h2>
          <Link href={HOME_LINKS.report} className={LINK}>
            Report ›
          </Link>
        </div>
        {loading ? (
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-[84px]" />
            <Skeleton className="h-[84px]" />
            <Skeleton className="h-[84px]" />
            <Skeleton className="h-[84px]" />
          </div>
        ) : (
          <FadeIn>
            <div className="grid grid-cols-2 gap-3">
              {data ? (
                <>
                  <Tile testId="tile-data-untouched" href={fromHome("/data")} value={data.untouched} label="Untouched data" tone="blue" />
                  <Tile
                    testId="tile-data-calls-left"
                    href={fromHome("/data")}
                    value={data.callsLeft}
                    label="Calls left"
                    hint={`Up to ${DATA_MAX_ATTEMPTS} tries per lead`}
                    tone="amber"
                  />
                </>
              ) : counts ? (
                <>
                  <Tile testId="tile-new" href={HOME_LINKS.newLeads} value={counts.newCount} label="New leads" tone="blue" />
                  <Tile testId="tile-recycling" href={HOME_LINKS.recyclingTomorrow} value={counts.recyclingTomorrow} label="Recycle tomorrow" tone="amber" />
                </>
              ) : (
                <div className="col-span-2">{leadsError && <RetryBox what="your leads" onRetry={reload} testId="retry-leads" />}</div>
              )}
              {today ? (
                <>
                  <Tile testId="tile-calls" href={HOME_LINKS.report} value={today.calls} label="Calls today" tone="slate" />
                  <Tile testId="tile-saved" href={HOME_LINKS.report} value={today.results_saved} label="Results saved" tone="emerald" />
                </>
              ) : (
                <div className="col-span-2">{todayError && <RetryBox what="today's numbers" onRetry={reload} testId="retry-today" />}</div>
              )}
            </div>
            {today && (
              <p data-testid="today-line" className="mt-3 text-sm text-slate-700">
                Connected <b className="tabular-nums text-slate-900">{today.connected}</b> · Follow-ups{" "}
                <b className="tabular-nums text-slate-900">{today.followUps}</b> · Visits <b className="tabular-nums text-slate-900">{today.visits}</b>
              </p>
            )}
          </FadeIn>
        )}
      </section>

      {!isDataOnly && (
        <section aria-labelledby="home-up-next" data-testid="up-next" className={CARD}>
          <h2 id="home-up-next" className={`mb-1 ${TITLE}`}>Up next</h2>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : upNext.length > 0 ? (
            <FadeIn>
              <ul className="divide-y divide-slate-100">
                {upNext.map((item) => (
                  <UpNextRow key={item.lead.id} item={item} />
                ))}
              </ul>
            </FadeIn>
          ) : leadsError ? (
            <RetryBox what="your next leads" onRetry={reload} testId="retry-up-next" />
          ) : (
            <p data-testid="up-next-empty" className="flex min-h-11 items-center text-sm text-slate-700">
              No leads waiting. Check back later.
            </p>
          )}
        </section>
      )}

      {isDataOnly && data && (
        <section aria-labelledby="home-my-data" data-testid="my-data" className={CARD}>
          <div className="mb-2 flex items-center justify-between">
            <h2 id="home-my-data" className={TITLE}>My data</h2>
            <Link href={fromHome("/data")} className={LINK}>
              All {data.total} ›
            </Link>
          </div>
          <ul className="space-y-1 text-[15px] text-slate-800">
            <li>
              <b data-testid="data-untouched" className="tabular-nums text-slate-900">{data.untouched}</b> not called yet
            </li>
            <li>
              <b data-testid="data-at-risk" className="tabular-nums text-slate-900">{data.atRisk}</b> still being called
            </li>
            <li>
              <b data-testid="data-last-attempt" className="tabular-nums text-amber-800">{data.lastAttempt}</b> on their last try
            </li>
          </ul>
        </section>
      )}

      {!isDataOnly && (
        <section aria-labelledby="home-my-leads" className={CARD}>
          <div className="mb-3 flex items-center justify-between">
            <h2 id="home-my-leads" className={TITLE}>My leads</h2>
            <Link href={fromHome("/leads")} className={LINK}>
              {counts ? `All ${counts.total} ›` : "Open ›"}
            </Link>
          </div>
          {loading ? (
            <Skeleton className="h-16" />
          ) : counts ? (
            <FadeIn>
              <div className="grid grid-cols-4 gap-2">
                {STAGE_LABELS.map(({ stage, label }) => (
                  <Link
                    key={stage}
                    href={HOME_LINKS.stage(stage)}
                    data-testid={`stage-${stage}`}
                    aria-label={`${counts.stages[stage]} in ${label}, open`}
                    className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-1 text-center"
                  >
                    <span className={`${NUMBER} text-slate-900`}>{counts.stages[stage]}</span>
                    <span className={`${LABEL} text-slate-700`}>{label}</span>
                  </Link>
                ))}
              </div>
            </FadeIn>
          ) : (
            leadsError && <RetryBox what="your lead counts" onRetry={reload} testId="retry-my-leads" />
          )}
        </section>
      )}

      {isTeamLeader && (
        <section aria-labelledby="home-team" data-testid="team-today" className={CARD}>
          <div className="mb-3 flex items-center justify-between">
            <h2 id="home-team" className={TITLE}>My team today</h2>
            <Link href="/team" className={LINK}>
              Team ›
            </Link>
          </div>
          {teamToday.team ? (
            <FadeIn>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "team-on-shift", value: `${teamToday.team.onShift}/${teamToday.team.members}`, label: "On shift" },
                  { id: "team-waiting", value: String(teamToday.team.waiting), label: "Waiting to assign" },
                  { id: "team-at-risk", value: String(teamToday.team.atRisk), label: "At risk" }
                ].map((t) => (
                  <Link
                    key={t.id}
                    href="/team"
                    data-testid={t.id}
                    className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-1 text-center"
                  >
                    <span className={`${NUMBER} text-slate-900`}>{t.value}</span>
                    <span className={`${LABEL} text-slate-700`}>{t.label}</span>
                  </Link>
                ))}
              </div>
            </FadeIn>
          ) : teamToday.error ? (
            <RetryBox what="your team's numbers" onRetry={teamToday.reload} testId="retry-team" />
          ) : (
            <Skeleton className="h-16" />
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
          className={`flex min-h-12 w-full items-center justify-between px-4 text-left ${TITLE}`}
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

      {/* Start with next lead (thumb zone): the queue runs on /leads (or /data) with its own modal, Call and result-save. */}
      {showStart && (
        <div className="fixed inset-x-0 bottom-0 z-20 px-4" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}>
          <div className="mx-auto max-w-xl">
            <Link
              href={fromHome(isDataOnly ? "/data?queue=1" : "/leads?queue=1")}
              data-testid="start-next"
              className="flex min-h-14 flex-col items-center justify-center rounded-2xl bg-blue-600 px-4 py-2 text-white shadow-lg active:bg-blue-700"
            >
              <span className="text-base font-semibold">Start with next lead</span>
              <span data-testid="start-next-count" className="text-[13px] font-medium text-white">
                {isDataOnly ? `${dataQueueLength} in the queue` : `${queueUrgent} due now · ${queueLength} total`}
              </span>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
