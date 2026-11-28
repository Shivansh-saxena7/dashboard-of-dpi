"use client";
// Employee Home v3 (2026-11-29): a richer, practical Home in five sections, top to bottom: greeting + message of the
// day, "Do this now" (one main action), today's progress, today's follow-ups, quick numbers. Phone: one column.
// Desktop: two columns (greeting, Do this now, progress and numbers on the left; follow-ups on the right).
// Numbers: one source only, useEmployeeHome (the same hook as the old Home). Extra reads are existing ones only:
// today's reminders (useTodayReminders, the /leads reminder read) for "Due 4:30 PM" and the last note per shown card
// (useLastLog -> get_last_notes). Calling keeps the existing flow (rememberCalledCard + logCallClick + tel:, call-return
// via registerActiveCallContext). Read-only. English, blue / cyan accents, light only, 44px taps, reduced motion respected.
// Data-only employees keep the old Home (it has their DATA numbers).
import Link from "next/link";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Phone, Sparkles, CheckCircle2, AlarmClock, UserPlus, MapPin, RefreshCw, PhoneCall, ArrowRight, Quote } from "lucide-react";
import EmployeeHomeP1 from "@/components/EmployeeHomeP1";
import { useEmployeeHome } from "@/lib/useEmployeeHome";
import { useTodayReminders } from "@/lib/todayReminders";
import { useLastLog } from "@/lib/useLastLog";
import { logCallClick } from "@/lib/logCallClick";
import { rememberCalledCard } from "@/lib/lastCalledLead";
import { registerActiveCallContext } from "@/lib/activeCall";
import { HOME_ATTENTION_LINKS, HOME_LINKS, fromHome, type UpNextItem } from "@/lib/employeeHome";
import { STAGE_WORD, firstName, followUpCount, followUpItems, greeting, heroModel, messageOfTheDay, progressModel, whenText, type FollowUpWhen } from "@/lib/homeV3";

const CARD = "rounded-3xl border border-slate-200/80 bg-white p-5 shadow-[0_8px_30px_-12px_rgba(15,23,42,0.18)]";
const FOLLOW_UP_SHOWN = 5;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function Appear({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div className={className} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay }}>
      {children}
    </motion.div>
  );
}

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-3xl bg-slate-200/70 motion-reduce:animate-none ${className}`} aria-hidden />;
}

export function MessageOfTheDay({ text }: { text: string }) {
  return (
    <div className="mt-3 flex items-start gap-2 rounded-2xl border border-sky-100 bg-white/70 px-4 py-3 text-[14px] text-slate-700 backdrop-blur" data-testid="home3-motd">
      <Quote size={16} className="mt-0.5 shrink-0 text-sky-500" aria-hidden />
      <p>{text}</p>
    </div>
  );
}

function ProgressRing({ pct, finished }: { pct: number; finished: boolean }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const reduce = useReducedMotion();
  return (
    <div className="relative h-[88px] w-[88px] shrink-0" aria-hidden>
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="#e2e8f0" strokeWidth="8" />
        <motion.circle cx="40" cy="40" r={r} fill="none" stroke={finished ? "#10b981" : "#2563eb"} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={c} initial={{ strokeDashoffset: reduce ? c * (1 - pct / 100) : c }} animate={{ strokeDashoffset: c * (1 - pct / 100) }}
          transition={{ duration: reduce ? 0 : 0.8, ease: "easeOut" }} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[18px] font-bold text-slate-900">{pct}%</span>
    </div>
  );
}

function FollowUpCard({ item }: { item: UpNextItem & { when: FollowUpWhen } }) {
  const { lead, when, reason } = item;
  const historyId = lead.lead_history?.[0]?.id ?? null;
  const last = useLastLog(historyId, lead.lead_history?.[0]?.last_activity_at ?? null);
  const onCall = () => {
    rememberCalledCard(lead.id);
    if (historyId) logCallClick(historyId, lead.id);
  };
  const late = when.kind === "late";
  return (
    <li className={`rounded-2xl border p-3 ${late ? "border-rose-200 bg-rose-50/60" : "border-slate-200 bg-white"}`} data-testid={`home3-fu-${lead.id}`}>
      <div className="flex items-start gap-3">
        <Link href={fromHome(`/leads?openLead=${encodeURIComponent(lead.id)}`)} className="min-h-11 min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-slate-900">{lead.name || "Lead"}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px]">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700">{STAGE_WORD[lead.board_stage || "LEADS"] ?? lead.board_stage}</span>
            <span className={late ? "font-semibold text-rose-700" : "font-medium text-blue-700"}>{whenText(when, reason)}</span>
          </p>
          {last && last !== "off" && <p className="mt-1 line-clamp-1 text-[13px] text-slate-600">“{last.note}”</p>}
        </Link>
        {lead.mobile && historyId && (
          <a href={`tel:${lead.mobile}`} onClick={onCall} data-testid={`home3-fu-call-${lead.id}`} aria-label={`Call ${lead.name || "lead"}`}
            className="flex min-h-11 min-w-[76px] shrink-0 items-center justify-center gap-1 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 px-3 text-sm font-semibold text-white shadow-md shadow-blue-600/20 active:scale-[0.98] motion-reduce:transform-none">
            <Phone size={15} aria-hidden /> Call
          </a>
        )}
      </div>
    </li>
  );
}

function Tile({ href, value, label, icon, tone, testId }: { href: string; value: number; label: string; icon: ReactNode; tone: string; testId: string }) {
  return (
    <Link href={href} data-testid={testId} aria-label={`${value} ${label}, open`}
      className="group flex min-h-[92px] flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md motion-reduce:transform-none">
      <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${tone}`}>{icon}</span>
      <span className="mt-2">
        <span className="block text-[24px] font-bold leading-none text-slate-900">{value}</span>
        <span className="mt-1 block text-[13px] font-medium text-slate-600">{label}</span>
      </span>
    </Link>
  );
}

export default function EmployeeHomeV3({ employeeId, employeeName, role, teamId, message }: { employeeId: string; employeeName?: string | null; role?: string | null; teamId?: string | null; message?: string | null }) {
  const home = useEmployeeHome(employeeId);
  const { counts, attention, upNext, queueLength, queueUrgent, today, leadsError, loading, reload, data } = home;
  const reminders = useTodayReminders(employeeId, true);
  const upNextRef = useRef(upNext);
  upNextRef.current = upNext;
  const now = Date.now();

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

  const hero = heroModel(attention, counts?.newCount ?? 0, queueLength);
  const progress = progressModel(today, queueUrgent);
  const fuCount = followUpCount(attention);
  const fuItems = useMemo(() => followUpItems(upNext, reminders.byLead, reminders.missed).slice(0, FOLLOW_UP_SHOWN), [upNext, reminders.byLead, reminders.missed]);
  const viewAll = fuCount.late > 0 ? HOME_ATTENTION_LINKS[attention && attention["reminders-missed"] > 0 ? "reminders-missed" : "followup-overdue"] : HOME_ATTENTION_LINKS["reminders-today"];

  // A data-only employee (no LEAD leads, some DATA leads): the old Home already shows their DATA numbers.
  if (data) return <EmployeeHomeP1 employeeId={employeeId} employeeName={employeeName} role={role} teamId={teamId} />;

  const greet = (
    <Appear className="lg:col-start-1 lg:row-start-1">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-sky-50 via-white to-cyan-50 p-5 ring-1 ring-sky-100" data-testid="home3-greeting">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-cyan-200/40 blur-3xl" aria-hidden />
        <p className="relative text-[13px] font-semibold uppercase tracking-[0.18em] text-sky-700">{new Date(now).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" })}</p>
        <h1 className="relative mt-1 text-[28px] font-bold leading-tight text-slate-900 sm:text-[32px]">
          {greeting(now)}{firstName(employeeName) ? `, ${firstName(employeeName)}` : ""}
        </h1>
        <MessageOfTheDay text={message?.trim() || messageOfTheDay(now)} />
      </section>
    </Appear>
  );

  if (loading && !counts) {
    return (
      <div className="mx-auto w-full max-w-6xl" data-testid="home3" aria-busy="true">
        <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
          {greet}
          <Skeleton className="h-[150px] lg:col-start-1 lg:row-start-2" />
          <Skeleton className="h-[130px] lg:col-start-1 lg:row-start-3" />
          <Skeleton className="h-[360px] lg:col-start-2 lg:row-start-1 lg:row-span-4" />
          <Skeleton className="h-[200px] lg:col-start-1 lg:row-start-4" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl" data-testid="home3">
      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        {greet}

        <Appear delay={0.05} className="lg:col-start-1 lg:row-start-2">
          {leadsError ? (
            <section className={CARD} data-testid="home3-error">
              <p className="text-[16px] font-semibold text-slate-900">We couldn&apos;t load your leads just now.</p>
              <button type="button" onClick={reload} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-[15px] font-semibold text-slate-800 hover:bg-slate-50">
                <RefreshCw size={16} aria-hidden /> Try again
              </button>
            </section>
          ) : hero.state === "clear" ? (
            <section className="rounded-3xl bg-gradient-to-br from-emerald-500 to-teal-500 p-5 text-white shadow-lg shadow-emerald-600/20" data-testid="home3-hero" data-state="clear">
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20"><CheckCircle2 size={26} aria-hidden /></span>
                <div>
                  <p className="text-[20px] font-bold">All caught up</p>
                  <p className="text-[14px] text-white/90">Nothing is due right now. Nice work!</p>
                </div>
              </div>
            </section>
          ) : (
            <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-blue-700 via-blue-600 to-cyan-500 p-5 text-white shadow-xl shadow-blue-700/25" data-testid="home3-hero" data-state="work">
              <div className="pointer-events-none absolute -bottom-12 -right-8 h-40 w-40 rounded-full bg-white/10 blur-2xl" aria-hidden />
              <p className="relative text-[13px] font-semibold uppercase tracking-[0.18em] text-cyan-100">Do this now</p>
              <p className="relative mt-1 text-[22px] font-bold leading-snug" data-testid="home3-hero-title">
                {hero.title} <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-[18px]">{hero.count}</span>
              </p>
              <p className="relative mt-1 text-[14px] text-white/85">{queueUrgent} due now · {queueLength} in your list</p>
              <Link href={fromHome("/leads?queue=1")} data-testid="home3-start"
                className="relative mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white px-5 text-[16px] font-bold text-blue-700 shadow-md transition active:scale-[0.99] motion-reduce:transform-none sm:w-auto">
                <PhoneCall size={18} aria-hidden /> Start calling <ArrowRight size={18} aria-hidden />
              </Link>
            </section>
          )}
        </Appear>

        <Appear delay={0.1} className="lg:col-start-1 lg:row-start-3">
          <section className={CARD} data-testid="home3-progress">
            <div className="flex items-center gap-4">
              <ProgressRing pct={progress.pct} finished={progress.finished} />
              <div className="min-w-0">
                <p className="text-[16px] font-bold text-slate-900">{progress.finished ? "Today's list is done 🎉" : "Today's progress"}</p>
                <p className="mt-0.5 text-[14px] text-slate-600" data-testid="home3-progress-text">{progress.done} results saved · {progress.left} still due</p>
                <p className="mt-0.5 text-[13px] text-slate-500">{plural(today?.calls ?? 0, "call")} · {plural(today?.followUps ?? 0, "follow-up")} · {plural(today?.visits ?? 0, "visit")} today</p>
              </div>
            </div>
          </section>
        </Appear>

        <Appear delay={0.15} className="lg:col-start-2 lg:row-start-1 lg:row-span-4">
          <section className={CARD} aria-labelledby="home3-fu-h" data-testid="home3-followups">
            <div className="flex items-center justify-between gap-2">
              <h2 id="home3-fu-h" className="flex items-center gap-2 text-[17px] font-bold text-slate-900">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-700"><AlarmClock size={18} aria-hidden /></span>
                Today&apos;s follow-ups
              </h2>
              <span className="rounded-full bg-slate-900 px-2.5 py-0.5 text-[13px] font-bold text-white" data-testid="home3-fu-count">{fuCount.total}</span>
            </div>
            {fuCount.late > 0 && <p className="mt-2 text-[13px] font-medium text-rose-700" data-testid="home3-fu-late">{fuCount.late} late · {fuCount.today} due later today</p>}
            {fuCount.total === 0 ? (
              <p className="mt-4 flex items-center gap-2 rounded-2xl bg-slate-50 p-4 text-[15px] text-slate-600" data-testid="home3-fu-empty"><Sparkles size={18} className="text-sky-500" aria-hidden /> No follow-ups today</p>
            ) : (
              <>
                <ul className="mt-3 space-y-2">{fuItems.map((it) => <FollowUpCard key={it.lead.id} item={it} />)}</ul>
                {fuCount.total > fuItems.length && (
                  <Link href={viewAll} data-testid="home3-fu-all" className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-1 rounded-xl border border-slate-200 text-[15px] font-semibold text-blue-700 hover:bg-slate-50">
                    View all {fuCount.total} <ArrowRight size={16} aria-hidden />
                  </Link>
                )}
              </>
            )}
          </section>
        </Appear>

        <Appear delay={0.2} className="lg:col-start-1 lg:row-start-4">
          <section aria-label="Quick numbers" className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-4" data-testid="home3-tiles">
            <Tile testId="home3-tile-new" href={HOME_LINKS.newLeads} value={counts?.newCount ?? 0} label="New leads" tone="bg-blue-100 text-blue-700" icon={<UserPlus size={18} aria-hidden />} />
            <Tile testId="home3-tile-visits" href={HOME_ATTENTION_LINKS["visits-today"]} value={attention?.["visits-today"] ?? 0} label="Visits today" tone="bg-sky-100 text-sky-700" icon={<MapPin size={18} aria-hidden />} />
            <Tile testId="home3-tile-recycling" href={HOME_LINKS.recyclingTomorrow} value={counts?.recyclingTomorrow ?? 0} label="Recycle tomorrow" tone="bg-amber-100 text-amber-700" icon={<RefreshCw size={18} aria-hidden />} />
            <Tile testId="home3-tile-calls" href={HOME_LINKS.report} value={today?.calls ?? 0} label="Calls today" tone="bg-emerald-100 text-emerald-700" icon={<Phone size={18} aria-hidden />} />
          </section>
        </Appear>
      </div>
    </div>
  );
}
