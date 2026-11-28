"use client";
// Employee Home v3 (2026-11-29, full): the employee's day as a guided story, "Today's plan", for every Sales role.
//   Hero band: greeting (IST) + message of the day + shift status (StartShiftCard hero: start time, Start / End Shift
//   with the same handlers) + leave strip + progress ring + 4 tappable numbers (desktop; on a phone they sit lower).
//   Left: Today's plan stepper, one primary button, "Next best lead".
//   Right (sticky on desktop): Today's follow-ups (Late / Due today, late-day chips), Recycle alert, Given to you,
//   Visits today, My team today (team leaders).
//   Below: My leads by stage, Call Quality (on tap only), Social posts (collapsed, as before).
//   DATA-only employees: the plan from their DATA counts, /data queue; lead-only parts are hidden.
// Data: one source, useEmployeeHome (its full queue + reminder times + counts) through homeModel(); existing hooks for
// the team card (useTeamToday) and social posts (useSocialSummary / PostsTrackingView); a light, non-blocking leave
// read; call quality only on tap. Calling keeps the existing flow (rememberCalledCard + logCallClick + tel:,
// call-return via registerActiveCallContext). Colours: only the existing palette (Header / lead card / lead detail
// modal, see lib/leadCardLook.ts). English, light only, 44px taps, reduced motion respected.
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Phone, CheckCircle2, AlarmClock, UserPlus, MapPin, RefreshCw, ArrowRight, Quote, PhoneCall, Sparkles, CalendarClock, Check, Users, Gift, Gauge, Layers, Database } from "lucide-react";
import StartShiftCard from "@/components/StartShiftCard";
import PostsTrackingView from "@/components/PostsTrackingView";
import { useEmployeeHome } from "@/lib/useEmployeeHome";
import { useWorkingCalendar } from "@/lib/useWorkingCalendar";
import { useLastLog } from "@/lib/useLastLog";
import { useTeamToday } from "@/lib/useTeamToday";
import { socialSummaryText, useSocialSummary } from "@/lib/useSocialSummary";
import { useHomeLeave, useCallQualityOnDemand } from "@/lib/useHomeV3Extras";
import { logCallClick } from "@/lib/logCallClick";
import { rememberCalledCard } from "@/lib/lastCalledLead";
import { registerActiveCallContext } from "@/lib/activeCall";
import { istDateYmd } from "@/lib/ownerLeave";
import { bandClasses } from "@/lib/callQuality";
import { HOME_ATTENTION_LINKS, HOME_LINKS, callQualityCardModel, fromHome, leaveStatus, leaveStatusText, shortYmd, type HomeStage } from "@/lib/employeeHome";
import { CALL_BUTTON, GOLD, HAIRLINE, INK, MUTED, TEXT2, callStyle, type PassTone } from "@/lib/leadCardLook";
import { DATA_STEP_LABELS, STAGE_WORD, STEP_LABELS, dataPlanModel, firstName, followUpWhen, greeting, homeModel, istClock, messageOfTheDay, progressModel, type FollowUp, type StepKey } from "@/lib/homeV3";

// Existing palette only (see the report's colour table): Header / lead detail modal champagne band and gold border,
// the gold primary button (Start Shift / modal primary), lead-card ink + hairline, card status tones.
const BAND = "bg-gradient-to-br from-[#FFFDF8] to-[#F3ECDA] border border-[#D4AF37]/40";
const PRIMARY = "bg-gradient-to-r from-yellow-400 to-amber-500 text-slate-900 shadow-[0_8px_20px_rgba(217,119,6,0.35)]";
const CARD = "rounded-[22px] border bg-white shadow-[0_4px_20px_rgba(15,23,42,0.06)]";
const EYEBROW = "text-[11px] font-semibold uppercase tracking-[0.2em] text-[#9c7a1f]";
const LATE = { bg: "#fff8f5", ring: "#fbd5d5", text: "#b42318" };
const DUE = { bg: "#fff3dc", ring: "#fbe3b6", text: "#92400e" };
const DONE = "bg-gradient-to-br from-green-400 to-emerald-600";
const CHIP_ICON = "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FBF9F4]";
const STEP_LINK: Record<StepKey, string> = {
  results: HOME_ATTENTION_LINKS["pending-result"],
  callbacks: fromHome("/leads?queue=1"),
  new: fromHome("/leads?queue=1"),
  late: fromHome("/leads?queue=1")
};
const STEP_BUTTON: Record<StepKey, string> = { results: "Save results", callbacks: "Start calling", new: "Start calling", late: "Start calling" };
const SHOWN = 5;
const STAGES: HomeStage[] = ["LEADS", "FOLLOW_UP", "VISIT", "BOOKING"];

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
  return <div className={`animate-pulse rounded-[22px] bg-[#F3ECDA]/60 motion-reduce:animate-none ${className}`} aria-hidden />;
}
const IconChip = ({ children }: { children: ReactNode }) => (
  <span className={CHIP_ICON} style={{ color: GOLD, boxShadow: "inset 0 0 0 1px #e6d9bb" }}>{children}</span>
);

export function MessageOfTheDay({ text }: { text: string }) {
  return (
    <p className="mt-2 flex items-start gap-2 text-[14px] leading-snug" style={{ color: TEXT2 }} data-testid="home3-motd">
      <Quote size={15} className="mt-0.5 shrink-0" style={{ color: GOLD }} aria-hidden />
      <span>{text}</span>
    </p>
  );
}

function Ring({ pct, finished }: { pct: number; finished: boolean }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  const reduce = useReducedMotion();
  return (
    <div className="relative h-[76px] w-[76px] shrink-0" aria-hidden>
      <svg viewBox="0 0 72 72" className="h-full w-full -rotate-90">
        <circle cx="36" cy="36" r={r} fill="none" stroke={HAIRLINE} strokeWidth="7" />
        <motion.circle cx="36" cy="36" r={r} fill="none" stroke={finished ? "#16a34a" : GOLD} strokeWidth="7" strokeLinecap="round" strokeDasharray={c}
          initial={{ strokeDashoffset: reduce ? c * (1 - pct / 100) : c }} animate={{ strokeDashoffset: c * (1 - pct / 100) }} transition={{ duration: reduce ? 0 : 0.8, ease: "easeOut" }} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[16px] font-bold" style={{ color: INK }}>{pct}%</span>
    </div>
  );
}

function CallLink({ f, size = "md" }: { f: FollowUp; size?: "md" | "lg" }) {
  const lead = f.item.lead;
  const historyId = lead.lead_history?.[0]?.id ?? null;
  if (!lead.mobile || !historyId) return null;
  const tone: PassTone = f.kind === "late" ? "OVERDUE" : lead.board_stage === "FOLLOW_UP" ? "FOLLOW_UP" : "NEW";
  const onCall = () => {
    rememberCalledCard(lead.id);
    if (historyId) logCallClick(historyId, lead.id);
  };
  return (
    <a href={`tel:${lead.mobile}`} onClick={onCall} aria-label={`Call ${lead.name || "lead"}`} data-testid={`home3-call-${lead.id}`}
      className={`${CALL_BUTTON} ${size === "lg" ? "!h-12 !flex-none w-full px-5 text-[16px]" : "!flex-none min-w-[84px] px-3 text-[14px]"}`} style={callStyle(tone)}>
      <Phone size={size === "lg" ? 18 : 15} aria-hidden /> Call
    </a>
  );
}

function FollowUpRow({ f, testId }: { f: FollowUp; testId: string }) {
  const lead = f.item.lead;
  const h = lead.lead_history?.[0];
  const last = useLastLog(h?.id ?? null, h?.last_activity_at ?? null);
  const tone = f.kind === "late" ? LATE : DUE;
  return (
    <li className="rounded-2xl p-3" style={{ background: "#fff", boxShadow: `inset 0 0 0 1px ${HAIRLINE}` }} data-testid={testId} data-kind={f.kind}>
      <div className="flex items-center gap-3">
        <Link href={fromHome(`/leads?openLead=${encodeURIComponent(lead.id)}`)} className="min-h-11 min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold" style={{ color: INK }}>{lead.name || "Lead"}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12.5px]">
            <span className="rounded-full bg-[#eef2f7] px-2 py-0.5 font-semibold" style={{ color: TEXT2 }}>{STAGE_WORD[lead.board_stage || "LEADS"] ?? lead.board_stage}</span>
            <span className="rounded-full px-2 py-0.5 font-semibold" style={{ background: tone.bg, color: tone.text, boxShadow: `inset 0 0 0 1px ${tone.ring}` }}>{followUpWhen(f)}</span>
          </p>
          {last && last !== "off" && <p className="mt-1 line-clamp-1 text-[12.5px]" style={{ color: MUTED }}>“{last.note}”</p>}
        </Link>
        <CallLink f={f} />
      </div>
    </li>
  );
}

function Tile({ href, value, label, icon, testId }: { href: string; value: number | string; label: string; icon: ReactNode; testId: string }) {
  return (
    <Link href={href} data-testid={testId} aria-label={`${value} ${label}, open`}
      className="flex min-h-[64px] items-center gap-2.5 rounded-2xl bg-white/80 px-3 py-2 transition hover:-translate-y-0.5 motion-reduce:transform-none"
      style={{ boxShadow: `inset 0 0 0 1px ${HAIRLINE}` }}>
      <IconChip>{icon}</IconChip>
      <span className="min-w-0">
        <span className="block text-[20px] font-bold leading-none" style={{ color: INK }}>{value}</span>
        <span className="mt-0.5 block truncate text-[12.5px] font-medium" style={{ color: TEXT2 }}>{label}</span>
      </span>
    </Link>
  );
}

function SectionTitle({ icon, children, id, right }: { icon: ReactNode; children: ReactNode; id: string; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 id={id} className="flex items-center gap-2 text-[17px] font-bold" style={{ color: INK }}>
        <IconChip>{icon}</IconChip>
        {children}
      </h2>
      {right}
    </div>
  );
}

function TeamCard({ teamId }: { teamId: string }) {
  const t = useTeamToday(teamId, true);
  return (
    <section className={`${CARD} p-5`} style={{ borderColor: HAIRLINE }} aria-labelledby="home3-team-h" data-testid="home3-team">
      <SectionTitle id="home3-team-h" icon={<Users size={18} aria-hidden />} right={<Link href="/team" className="inline-flex min-h-11 items-center text-[14px] font-semibold" style={{ color: GOLD }}>Team ›</Link>}>My team today</SectionTitle>
      {t.team ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[
            { id: "team-on-shift", value: `${t.team.onShift}/${t.team.members}`, label: "On shift" },
            { id: "team-waiting", value: String(t.team.waiting), label: "Waiting to assign" },
            { id: "team-at-risk", value: String(t.team.atRisk), label: "At risk" }
          ].map((x) => (
            <Link key={x.id} href="/team" data-testid={x.id} className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl bg-[#FBF9F4] px-1 text-center" style={{ boxShadow: "inset 0 0 0 1px #e6d9bb" }}>
              <span className="text-[20px] font-bold" style={{ color: INK }}>{x.value}</span>
              <span className="text-[12.5px] font-medium" style={{ color: TEXT2 }}>{x.label}</span>
            </Link>
          ))}
        </div>
      ) : t.error ? (
        <button type="button" onClick={t.reload} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-[14px] font-semibold" style={{ color: INK, boxShadow: `inset 0 0 0 1px ${HAIRLINE}` }}>
          <RefreshCw size={15} aria-hidden /> Couldn&apos;t load your team. Try again
        </button>
      ) : (
        <Skeleton className="mt-3 h-16" />
      )}
    </section>
  );
}

function CallQualityCard({ employeeId }: { employeeId: string }) {
  const cq = useCallQualityOnDemand(employeeId);
  const model = cq.status === "ok" ? callQualityCardModel(cq.summary) : null;
  if (cq.status === "hidden") return null;
  return (
    <section className={`${CARD} p-5`} style={{ borderColor: HAIRLINE }} aria-labelledby="home3-cq-h" data-testid="home3-cq">
      <SectionTitle id="home3-cq-h" icon={<Gauge size={18} aria-hidden />} right={<Link href="/report" className="inline-flex min-h-11 items-center text-[14px] font-semibold" style={{ color: GOLD }}>My report ›</Link>}>Call Quality</SectionTitle>
      {model ? (
        <ul className="mt-3 space-y-1">
          {model.lines.map((line) => {
            const c = bandClasses(line.band);
            return (
              <li key={line.label ?? "only"} data-testid="home3-cq-line" className="flex items-center gap-2 text-[14.5px]">
                <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${c.dot}`} />
                {line.label && <span style={{ color: TEXT2 }}>{line.label}:</span>}
                <b className={c.text}>{line.bandText}</b>
                {line.score !== null && <span style={{ color: MUTED }}>({line.score})</span>}
              </li>
            );
          })}
        </ul>
      ) : (
        <button type="button" onClick={cq.check} disabled={cq.status === "loading"} data-testid="home3-cq-check"
          className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-[14px] font-semibold disabled:opacity-60" style={{ color: INK, boxShadow: `inset 0 0 0 1px ${HAIRLINE}` }}>
          {cq.status === "loading" ? "Checking…" : cq.status === "error" ? "Couldn't check. Try again" : "Check my score"}
        </button>
      )}
    </section>
  );
}

function SocialPosts({ employeeId, employeeName }: { employeeId: string; employeeName?: string | null }) {
  const [open, setOpen] = useState(false);
  const line = socialSummaryText(useSocialSummary(employeeId, !open));
  return (
    <section className={`${CARD}`} style={{ borderColor: HAIRLINE }} data-testid="home3-social">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid="home3-social-toggle"
        className="flex min-h-14 w-full items-center justify-between gap-2 px-5 text-left">
        <span className="flex items-center gap-2">
          <IconChip><Layers size={18} aria-hidden /></IconChip>
          <span>
            <span className="block text-[16px] font-bold" style={{ color: INK }}>Social posts</span>
            {!open && line && <span className="block text-[13px]" style={{ color: TEXT2 }} data-testid="home3-social-summary">{line}</span>}
          </span>
        </span>
        <span aria-hidden className={`text-[18px] transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`} style={{ color: TEXT2 }}>›</span>
      </button>
      {open && (
        <div style={{ borderTop: `1px solid ${HAIRLINE}` }}>
          <PostsTrackingView employeeId={employeeId} employeeName={employeeName ?? ""} />
        </div>
      )}
    </section>
  );
}

export default function EmployeeHomeV3({ employeeId, employeeName, role, teamId, message }: { employeeId: string; employeeName?: string | null; role?: string | null; teamId?: string | null; message?: string | null }) {
  const home = useEmployeeHome(employeeId);
  const { counts, today, leadsError, loading, reload, data, given, dataQueueLength } = home;
  const calendar = useWorkingCalendar();
  const queue = useMemo(() => home.queue ?? [], [home.queue]);
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const [tab, setTab] = useState<"late" | "today">("late");
  const now = Date.now();
  const m = useMemo(() => homeModel(queue, home.reminderAt, home.missedAt, calendar), [queue, home.reminderAt, home.missedAt, calendar]);
  const reduce = useReducedMotion();
  const isTeamLeader = role === "team_leader" && Boolean(teamId);
  const isDataOnly = Boolean(data);
  // Leave strip: a light read after the Home has its data (never blocks it; hidden on any failure).
  const leaveRows = useHomeLeave(employeeId, !loading);
  const leave = leaveRows ? leaveStatus(leaveRows, employeeId, istDateYmd(), calendar) : null;
  const leaveText = leaveStatusText(leave);
  const dataPlan = data ? dataPlanModel(data) : null;
  const progress = progressModel(today?.results_saved ?? 0, dataPlan ? dataQueueLength : m.left);

  useEffect(
    () =>
      registerActiveCallContext({
        employeeId,
        listType: "LEAD",
        hasLead: (id) => queueRef.current.some((item) => item.lead.id === id),
        leadName: (id) => queueRef.current.find((item) => item.lead.id === id)?.lead.name ?? null,
        getListState: () => ({ tab: "LEADS", statusFilter: "", sortBy: "NEWEST" }),
        indexOf: () => -1
      }),
    [employeeId]
  );
  useEffect(() => {
    if (m.late.length === 0 && m.today.length > 0) setTab("today");
  }, [m.late.length, m.today.length]);

  const tiles = dataPlan && data ? (
    <div className="grid grid-cols-2 gap-2.5" data-testid="home3-tiles">
      <Tile testId="home3-tile-data-untouched" href={fromHome("/data")} value={data.untouched} label="Untouched data" icon={<Database size={17} aria-hidden />} />
      <Tile testId="home3-tile-data-calls-left" href={fromHome("/data")} value={data.callsLeft} label="Calls left" icon={<PhoneCall size={17} aria-hidden />} />
      <Tile testId="home3-tile-data-last" href={fromHome("/data")} value={data.lastAttempt} label="Last attempt" icon={<RefreshCw size={17} aria-hidden />} />
      <Tile testId="home3-tile-calls" href={HOME_LINKS.report} value={today?.calls ?? 0} label="Calls today" icon={<Phone size={17} aria-hidden />} />
    </div>
  ) : (
    <div className="grid grid-cols-2 gap-2.5" data-testid="home3-tiles">
      <Tile testId="home3-tile-new" href={HOME_LINKS.newLeads} value={m.newCount} label="New leads" icon={<UserPlus size={17} aria-hidden />} />
      <Tile testId="home3-tile-visits" href={HOME_ATTENTION_LINKS["visits-today"]} value={m.visits.length} label="Visits today" icon={<MapPin size={17} aria-hidden />} />
      <Tile testId="home3-tile-recycling" href={HOME_LINKS.recyclingTomorrow} value={counts?.recyclingTomorrow ?? 0} label="Recycle tomorrow" icon={<RefreshCw size={17} aria-hidden />} />
      <Tile testId="home3-tile-calls" href={HOME_LINKS.report} value={today?.calls ?? 0} label="Calls today" icon={<Phone size={17} aria-hidden />} />
    </div>
  );

  const hero = (
    <section className={`relative overflow-hidden rounded-[24px] ${BAND} p-5 shadow-[0_4px_20px_rgba(15,23,42,0.06)] lg:p-6`} data-testid="home3-hero-band">
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-gradient-to-br from-amber-300/40 via-yellow-400/20 to-transparent blur-2xl" aria-hidden />
      <div className="relative grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_auto_minmax(0,1fr)] lg:items-center">
        <div className="min-w-0" data-testid="home3-greeting">
          <p className={EYEBROW}>{new Date(now).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" })}</p>
          <h1 className="mt-1 text-[26px] font-bold leading-tight sm:text-[30px]" style={{ color: INK }}>
            {greeting(now)}{firstName(employeeName) ? `, ${firstName(employeeName)}` : ""}
          </h1>
          <MessageOfTheDay text={message?.trim() || messageOfTheDay(now)} />
          <div className="mt-3"><StartShiftCard employeeId={employeeId} hero /></div>
          {leave && leaveText && (
            <p role="status" data-testid="home3-leave" data-kind={leave.kind} className="mt-2 inline-flex items-center gap-2 rounded-xl bg-white/80 px-3 py-2 text-[13.5px] font-semibold" style={{ color: TEXT2, boxShadow: `inset 0 0 0 1px ${HAIRLINE}` }}>
              <CalendarClock size={15} style={{ color: GOLD }} aria-hidden /> {leaveText}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3" data-testid="home3-progress">
          <Ring pct={progress.pct} finished={progress.finished} />
          <div>
            <p className="text-[15px] font-bold" style={{ color: INK }}>{progress.finished ? "Today's list is done" : "Today's progress"}</p>
            <p className="text-[13px]" style={{ color: TEXT2 }} data-testid="home3-progress-text">{progress.done} results saved · {progress.left} to go</p>
          </div>
        </div>
        <div className="hidden lg:block">{tiles}</div>
      </div>
    </section>
  );

  if (loading && !counts && !data) {
    return (
      <div className="mx-auto w-full max-w-[1400px] space-y-5" data-testid="home3" aria-busy="true">
        {hero}
        <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
          <Skeleton className="h-[360px]" />
          <Skeleton className="h-[360px]" />
        </div>
      </div>
    );
  }

  const current = m.steps.find((s) => s.state === "current");
  const fuList = (tab === "late" ? m.late : m.today).slice(0, SHOWN);
  const fuTotal = m.late.length + m.today.length;

  const planCard = dataPlan ? (
    <section className={`${CARD} p-5`} style={{ borderColor: HAIRLINE }} aria-labelledby="home3-plan-h" data-testid="home3-plan" data-variant="data">
      <div className="flex items-center justify-between gap-2">
        <h2 id="home3-plan-h" className="text-[18px] font-bold" style={{ color: INK }}>Today&apos;s plan</h2>
        {dataPlan.left > 0 && <span className="text-[13px] font-semibold" style={{ color: TEXT2 }} data-testid="home3-left">{dataPlan.left} data still to call</span>}
      </div>
      <ol className="mt-4 space-y-2">
        {dataPlan.steps.map((s, i) => (
          <li key={s.key} data-testid={`home3-step-${s.key}`} data-state={s.state}
            className={`flex min-h-[52px] items-center gap-3 rounded-2xl px-3 py-2 ${s.state === "current" ? "bg-[#FBF9F4] ring-2 ring-[#D4AF37]" : ""} ${s.state === "later" ? "opacity-70" : ""}`}>
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[14px] font-bold ${s.state === "done" ? `${DONE} text-white` : s.state === "current" ? "bg-gradient-to-r from-yellow-400 to-amber-500 text-slate-900" : "bg-[#eef2f7]"}`} style={s.state === "later" ? { color: TEXT2 } : undefined}>
              {s.state === "done" ? <Check size={16} aria-hidden /> : i + 1}
            </span>
            <span className="min-w-0 flex-1 text-[15px] font-semibold" style={{ color: INK }}>{DATA_STEP_LABELS[s.key]}</span>
            {s.state === "current" && <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[#9c7a1f] ring-1 ring-[#D4AF37]/50">You are here</span>}
            <span className="min-w-[28px] text-right text-[17px] font-bold" style={{ color: s.state === "done" ? "#16a34a" : INK }} data-testid={`home3-step-${s.key}-count`}>{s.count}</span>
          </li>
        ))}
      </ol>
      {dataPlan.current ? (
        <Link href={fromHome("/data?queue=1")} data-testid="home3-start" className={`mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-5 text-[16px] font-bold ${PRIMARY}`}>
          <PhoneCall size={18} aria-hidden /> Start calling <ArrowRight size={18} aria-hidden />
        </Link>
      ) : (
        <div className="mt-4 flex items-center gap-3 rounded-2xl bg-[#FBF9F4] p-4 ring-1 ring-[#D4AF37]/40" data-testid="home3-clear">
          <span className={`flex h-10 w-10 items-center justify-center rounded-full ${DONE} text-white`}><CheckCircle2 size={22} aria-hidden /></span>
          <p className="text-[16px] font-bold" style={{ color: INK }}>All caught up</p>
        </div>
      )}
    </section>
  ) : (
    <section className={`${CARD} p-5`} style={{ borderColor: HAIRLINE }} aria-labelledby="home3-plan-h" data-testid="home3-plan">
      <div className="flex items-center justify-between gap-2">
        <h2 id="home3-plan-h" className="text-[18px] font-bold" style={{ color: INK }}>Today&apos;s plan</h2>
        {m.left > 0 && <span className="text-[13px] font-semibold" style={{ color: TEXT2 }} data-testid="home3-left">{m.left} more to finish today&apos;s list</span>}
      </div>
      <ol className="mt-4 space-y-2">
        {m.steps.map((s, i) => (
          <li key={s.key} data-testid={`home3-step-${s.key}`} data-state={s.state}
            className={`flex min-h-[52px] items-center gap-3 rounded-2xl px-3 py-2 ${s.state === "current" ? "bg-[#FBF9F4] ring-2 ring-[#D4AF37]" : ""} ${s.state === "later" ? "opacity-70" : ""}`}>
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[14px] font-bold ${s.state === "done" ? `${DONE} text-white` : s.state === "current" ? "bg-gradient-to-r from-yellow-400 to-amber-500 text-slate-900" : "bg-[#eef2f7]"}`} style={s.state === "later" ? { color: TEXT2 } : undefined}>
              {s.state === "done" ? <Check size={16} aria-hidden /> : i + 1}
            </span>
            <span className="min-w-0 flex-1 text-[15px] font-semibold" style={{ color: INK }}>{STEP_LABELS[s.key]}</span>
            {s.state === "current" && <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[#9c7a1f] ring-1 ring-[#D4AF37]/50">You are here</span>}
            <span className="min-w-[28px] text-right text-[17px] font-bold" style={{ color: s.state === "done" ? "#16a34a" : INK }} data-testid={`home3-step-${s.key}-count`}>{s.count}</span>
          </li>
        ))}
      </ol>
      {current ? (
        <Link href={STEP_LINK[current.key]} data-testid="home3-start"
          className={`mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-5 text-[16px] font-bold transition active:scale-[0.99] motion-reduce:transform-none ${PRIMARY}`}>
          <PhoneCall size={18} aria-hidden /> {STEP_BUTTON[current.key]} <ArrowRight size={18} aria-hidden />
        </Link>
      ) : (
        <motion.div initial={reduce ? false : { scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.4 }}
          className="mt-4 flex items-center gap-3 rounded-2xl bg-[#FBF9F4] p-4 ring-1 ring-[#D4AF37]/40" data-testid="home3-clear">
          <span className={`flex h-10 w-10 items-center justify-center rounded-full ${DONE} text-white`}><CheckCircle2 size={22} aria-hidden /></span>
          <div>
            <p className="text-[16px] font-bold" style={{ color: INK }}>All caught up</p>
            <p className="text-[13px]" style={{ color: TEXT2 }}>Nothing is due right now. Nice work!</p>
          </div>
        </motion.div>
      )}
    </section>
  );

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-5" data-testid="home3" data-variant={isDataOnly ? "data" : "leads"}>
      <Appear>{hero}</Appear>

      {leadsError && !isDataOnly ? (
        <section className={`${CARD} p-5`} style={{ borderColor: HAIRLINE }} data-testid="home3-error">
          <p className="text-[16px] font-semibold" style={{ color: INK }}>We couldn&apos;t load your leads just now.</p>
          <button type="button" onClick={reload} className={`mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-[15px] font-bold ${PRIMARY}`}>
            <RefreshCw size={16} aria-hidden /> Try again
          </button>
        </section>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-stretch">
          <div className="flex min-w-0 flex-col gap-5">
            <Appear delay={0.05}>{planCard}</Appear>

            {!isDataOnly && (
              <Appear delay={0.1} className="flex-1">
                <section className={`${CARD} h-full p-5`} style={{ borderColor: HAIRLINE }} aria-labelledby="home3-spot-h" data-testid="home3-spotlight">
                  <p id="home3-spot-h" className={EYEBROW}>Next best lead</p>
                  {m.spotlight ? (
                    <SpotlightBody f={m.spotlight} />
                  ) : (
                    <p className="mt-3 flex items-center gap-2 text-[15px]" style={{ color: TEXT2 }} data-testid="home3-spot-clear"><Sparkles size={18} style={{ color: GOLD }} aria-hidden /> All caught up</p>
                  )}
                </section>
              </Appear>
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-5 lg:sticky lg:top-4 lg:self-start">
            {!isDataOnly && (
              <Appear delay={0.15}>
                <section className={`${CARD} p-5`} style={{ borderColor: HAIRLINE }} aria-labelledby="home3-fu-h" data-testid="home3-followups">
                  <SectionTitle id="home3-fu-h" icon={<AlarmClock size={18} aria-hidden />} right={<span className="rounded-full px-2.5 py-0.5 text-[13px] font-bold text-white" style={{ background: INK }} data-testid="home3-fu-count">{fuTotal}</span>}>
                    Today&apos;s follow-ups
                  </SectionTitle>
                  <div className="mt-3 grid grid-cols-2 gap-1 rounded-2xl bg-[#eef2f7] p-1" role="tablist">
                    {(["late", "today"] as const).map((t) => (
                      <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} data-testid={`home3-tab-${t}`}
                        className={`min-h-11 rounded-xl text-[14px] font-semibold ${tab === t ? "bg-white shadow-sm" : ""}`} style={{ color: tab === t ? INK : TEXT2 }}>
                        {t === "late" ? `Late (${m.late.length})` : `Due today (${m.today.length})`}
                      </button>
                    ))}
                  </div>
                  {tab === "late" && m.late.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5" data-testid="home3-late-chips">
                      {([["1 day", m.lateBuckets.d1], ["2-3 days", m.lateBuckets.d2to3], ["4+ days", m.lateBuckets.d4plus]] as const).map(([label, n]) => (
                        <span key={label} className="rounded-full px-2.5 py-1 text-[12.5px] font-semibold" style={{ background: LATE.bg, color: LATE.text, boxShadow: `inset 0 0 0 1px ${LATE.ring}` }}>{label} · {n}</span>
                      ))}
                    </div>
                  )}
                  {fuList.length === 0 ? (
                    <p className="mt-4 rounded-2xl bg-[#FBF9F4] p-4 text-[15px]" style={{ color: TEXT2 }} data-testid="home3-fu-empty">{fuTotal === 0 ? "No follow-ups today" : tab === "late" ? "Nothing late. Great!" : "No more callbacks today"}</p>
                  ) : (
                    <ul className="mt-3 space-y-2" data-testid="home3-fu-list">{fuList.map((f) => <FollowUpRow key={f.item.lead.id} f={f} testId={`home3-fu-${f.item.lead.id}`} />)}</ul>
                  )}
                  {(tab === "late" ? m.late.length : m.today.length) > SHOWN && (
                    <Link href={tab === "late" ? HOME_ATTENTION_LINKS["followup-overdue"] : HOME_ATTENTION_LINKS["reminders-today"]} data-testid="home3-fu-all"
                      className="mt-3 flex min-h-11 w-full items-center justify-center gap-1 rounded-xl text-[15px] font-semibold" style={{ color: GOLD, boxShadow: `inset 0 0 0 1px ${HAIRLINE}` }}>
                      View all {tab === "late" ? m.late.length : m.today.length} <ArrowRight size={16} aria-hidden />
                    </Link>
                  )}
                </section>
              </Appear>
            )}

            {!isDataOnly && (
              <Appear delay={0.2}>
                <Link href={HOME_LINKS.recyclingTomorrow} data-testid="home3-recycle"
                  className="flex min-h-[64px] items-center gap-3 rounded-[22px] p-4" style={{ background: DUE.bg, boxShadow: `inset 0 0 0 1px ${DUE.ring}` }}>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white" style={{ color: DUE.text }}><RefreshCw size={18} aria-hidden /></span>
                  <span className="min-w-0 flex-1 text-[14.5px] font-semibold" style={{ color: DUE.text }}>
                    {(counts?.recyclingTomorrow ?? 0) === 0 ? "No leads leave you tomorrow" : `${counts?.recyclingTomorrow} lead${counts?.recyclingTomorrow === 1 ? "" : "s"} leave you tomorrow. Call them today.`}
                  </span>
                  <ArrowRight size={18} style={{ color: DUE.text }} aria-hidden />
                </Link>
              </Appear>
            )}

            {!isDataOnly && given && given.count > 0 && (
              <Link href={fromHome("/leads?filter=given")} data-testid="home3-given" className={`${CARD} flex min-h-[64px] items-center gap-3 p-4`} style={{ borderColor: HAIRLINE }}>
                <IconChip><Gift size={18} aria-hidden /></IconChip>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-bold" style={{ color: INK }}>{given.count} lead{given.count === 1 ? "" : "s"} an admin gave you, not called yet</span>
                  {given.protectedUntil && <span className="block text-[13px]" style={{ color: TEXT2 }}>Protected until {shortYmd(given.protectedUntil.slice(0, 10))}</span>}
                </span>
                <ArrowRight size={18} style={{ color: GOLD }} aria-hidden />
              </Link>
            )}

            {!isDataOnly && (
              <Appear delay={0.25}>
                <section className={`${CARD} p-5`} style={{ borderColor: HAIRLINE }} data-testid="home3-visits">
                  <SectionTitle id="home3-visits-h" icon={<CalendarClock size={18} aria-hidden />}>Visits today</SectionTitle>
                  {m.visits.length === 0 ? (
                    <p className="mt-2 text-[14px]" style={{ color: TEXT2 }}>No visits today</p>
                  ) : (
                    <ul className="mt-2 space-y-1.5">
                      {m.visits.slice(0, 3).map((v) => (
                        <li key={v.item.lead.id}>
                          <Link href={fromHome(`/leads?openLead=${encodeURIComponent(v.item.lead.id)}`)} className="flex min-h-11 items-center justify-between gap-2 rounded-xl px-2 text-[14px] hover:bg-[#FBF9F4]">
                            <span className="truncate font-semibold" style={{ color: INK }}>{v.item.lead.name || "Lead"}</span>
                            <span className="shrink-0" style={{ color: TEXT2 }}>{v.at ? istClock(v.at) : "Today"}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </Appear>
            )}

            {isTeamLeader && teamId && <TeamCard teamId={teamId} />}

            <div className="lg:hidden">{tiles}</div>
          </div>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {!isDataOnly && counts ? (
          <section className={`${CARD} p-5`} style={{ borderColor: HAIRLINE }} aria-labelledby="home3-stages-h" data-testid="home3-stages">
            <SectionTitle id="home3-stages-h" icon={<Layers size={18} aria-hidden />} right={<span className="text-[13px] font-semibold" style={{ color: TEXT2 }}>{counts.total} total</span>}>My leads</SectionTitle>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {STAGES.map((st) => (
                <Link key={st} href={HOME_LINKS.stage(st)} data-testid={`home3-stage-${st}`} className="flex min-h-14 flex-col justify-center rounded-2xl bg-[#FBF9F4] px-3" style={{ boxShadow: "inset 0 0 0 1px #e6d9bb" }}>
                  <span className="text-[18px] font-bold" style={{ color: INK }}>{counts.stages[st]}</span>
                  <span className="text-[12.5px] font-medium" style={{ color: TEXT2 }}>{STAGE_WORD[st]}</span>
                </Link>
              ))}
            </div>
          </section>
        ) : (
          <div className="hidden lg:block" />
        )}
        <CallQualityCard employeeId={employeeId} />
      </div>

      <SocialPosts employeeId={employeeId} employeeName={employeeName} />
    </div>
  );
}

function SpotlightBody({ f }: { f: FollowUp }) {
  const lead = f.item.lead;
  const h = lead.lead_history?.[0];
  const last = useLastLog(h?.id ?? null, h?.last_activity_at ?? null);
  const tone = f.kind === "late" ? LATE : DUE;
  return (
    <div className="mt-3" data-testid={`home3-spot-${lead.id}`}>
      <Link href={fromHome(`/leads?openLead=${encodeURIComponent(lead.id)}`)} className="block min-h-11">
        <p className="text-[20px] font-bold leading-tight" style={{ color: INK }}>{lead.name || "Lead"}</p>
        <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[13px]">
          <span className="rounded-full bg-[#eef2f7] px-2 py-0.5 font-semibold" style={{ color: TEXT2 }}>{STAGE_WORD[lead.board_stage || "LEADS"] ?? lead.board_stage}</span>
          <span className="rounded-full px-2 py-0.5 font-semibold" style={{ background: tone.bg, color: tone.text, boxShadow: `inset 0 0 0 1px ${tone.ring}` }}>{followUpWhen(f)}</span>
          {lead.project && <span style={{ color: MUTED }}>{lead.project}</span>}
        </p>
        {last && last !== "off" && <p className="mt-2 line-clamp-2 text-[14px]" style={{ color: TEXT2 }}>“{last.note}”</p>}
      </Link>
      <div className="mt-4"><CallLink f={f} size="lg" /></div>
    </div>
  );
}
