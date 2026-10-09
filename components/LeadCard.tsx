"use client";

import { memo, useState } from "react";
import { motion } from "framer-motion";
import { Phone, Timer, Repeat, Zap, PencilLine, ChevronDown } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { calculateSLAStatus, getRecycleCutoff, RecycleCutoffReason } from "@/lib/calculateSLAStatus";
import { useWorkingCalendar } from "@/lib/useWorkingCalendar";
import { LEAD_STATUS_DISPLAY } from "@/lib/leadStatusDisplay";
import { LEAD_PRIORITY_DISPLAY, LeadPriority } from "@/lib/leadPriorityDisplay";
import { LeadStatus } from "@/lib/getValidNextLeadStatuses";
import { AssignedBySource } from "@/lib/assignedByDisplay";
import { buildWhatsAppLink } from "@/lib/buildWhatsAppLink";
import { rememberCalledCard } from "@/lib/lastCalledLead";
import type { LeadSibling } from "@/lib/useLeadSiblings";
import { recycledFromText } from "@/lib/recycleReasonDisplay";
import { leadCardFont } from "@/lib/leadCardFont";
import { BUTTON_BG, CALL_BUTTON, cardSurface, CALL, GLASS_BOX, NAME_COLOR, DOT, formatAssignedExact, formatExactTime, clockParts, GOLD, HAIRLINE, HEADER_GLASS, ICON_BUTTON, INK, MUTED, NEUTRAL_TAG, PASS, PassTone, SIZE, sourceDot, statusPillStyle, TAG, TEXT2, TINT_TAG } from "@/lib/leadCardLook";
import LeadCardMore, { ExpandSection } from "./LeadCardMore";
import WhatsAppIcon from "./WhatsAppIcon";
import LastLogPanel from "./LastLogPanel";
import toast from "react-hot-toast";
import TimerPausedBadge from "./TimerPausedBadge";

interface LeadCardLead {
  id: string;
  leadHistoryId: string;
  name: string;
  mobile: string;
  project: string | null;
  source: string | null;
  catcher_name?: string | null;
  status: LeadStatus;
  priority: LeadPriority;
  board_stage?: string | null;
  sla_deadline: string | null;
  recycle_count: number;
  call_count: number;
  outcome_at: string | null;
  assigned_at: string | null;
  assigned_by_type: AssignedBySource["assigned_by_type"] | null;
  assigned_by: { name: string } | null;
  reassign_note: string | null;
  last_activity_at?: string | null;
  paused_until?: string | null;
  pause_reason?: string | null;
  is_personal_lead?: boolean;
  siblings?: LeadSibling[];
  recycle_reason?: string | null;
  recycled_from_status?: string | null;
  recycled_from_stage?: string | null;
}

interface LeadCardProps {
  lead: LeadCardLead;
  now: Date;
  // Takes the lead id (2026-08-27 perf pass) rather than a bare
  // () => void — lets the parent (LeadList.tsx) pass ONE stable
  // useCallback-wrapped handler to every card instead of a fresh
  // inline arrow per card per render, which is what actually makes
  // the React.memo wrap below effective. A per-card inline arrow
  // (`onOpen={() => setSelectedLeadId(lead.id)}`) would give memo a
  // new prop reference every render regardless of whether this card's
  // own data changed, silently defeating it.
  onOpen: (id: string) => void;
  // Quick Dial (2026-09-23) — genuinely unrelated to this card's own
  // lead (dials an arbitrary NEW number, no lead exists for it yet),
  // so unlike onOpen this takes no id — same stable no-arg callback
  // for every card, see LeadList.tsx's own handleQuickDial comment.
  onQuickDial: () => void;
  index?: number;
}

// Stale/Recycle-Warning filter (2026-09-16) — days+hours, distinct
// from formatCountdown below (hours+minutes, sized for the 2h SLA
// timer only — a multi-day cooldown/inactivity window needs its own
// granularity).
function formatDaysHoursLeft(msRemaining: number): string {
  const totalHours = Math.max(0, Math.floor(msRemaining / (1000 * 60 * 60)));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return days > 0 ? `${days}d ${hours}h left` : `${hours}h left`;
}

const RECYCLE_REASON_LABEL: Record<RecycleCutoffReason, string> = {
  FOLLOWUP_INACTIVITY: "Follow-up inactivity",
  NOT_CONNECTED_COOLDOWN: "Not Connected cooldown",
  SWITCHED_OFF_COOLDOWN: "Switched Off cooldown",
  NOT_INTERESTED_COOLDOWN: "Not Interested cooldown"
};

// "Last activity 3h ago" on the card's meta line.
function formatAgo(msAgo: number): string {
  const minutes = Math.max(0, Math.floor(msAgo / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatCountdown(msRemaining: number): string {
  const totalMinutes = Math.max(0, Math.floor(msRemaining / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m left`;
  }

  return `${minutes}m left`;
}

// Tapping the card (anywhere except the Call link) opens
// LeadDetailModal for status/note/call-log updates via
// log_lead_update_atomic. `now` is passed down from LeadList's
// single shared ticking clock rather than each card running its own
// interval, so a long list doesn't end up with dozens of timers.
//
// Styled per Section 2 (Design System): gold as the primary accent
// (matches StartShiftCard), staggered entrance for list items
// (Section 2.4). Deliberately NO per-card ambient glow blob —
// StartShiftCard is a single hero element, but this renders inside a
// list of many cards, so a repeating background glow would read as
// clutter rather than premium. Touch targets sized for the ~95%
// mobile usage this screen gets.
// Wrapped in memo (2026-08-27 perf pass) — LeadList.tsx's shared
// 30-second countdown tick (setNow) intentionally re-renders every
// visible card (the countdown text genuinely needs to refresh), but
// any OTHER LeadList state change (search, filter, sort, tab switch)
// used to re-render every card too, even ones whose own `lead` data
// hadn't changed. memo skips those. Requires the parent to pass
// reference-stable props — see onOpen's own comment above; `lead`
// itself is already a stable object reference between renders unless
// its actual data changed, straight from the Supabase response.
function LeadCard({ lead, now, onOpen, onQuickDial, index = 0 }: LeadCardProps) {
  const [expanded, setExpanded] = useState(false);
  // Working calendar (Step 4) — same one the recycle sweep counts with,
  // so the badge/countdown matches when the lead actually recycles.
  const workingCalendar = useWorkingCalendar();

  const slaStatus = calculateSLAStatus(
    {
      status: lead.status,
      sla_deadline: lead.sla_deadline,
      recycle_count: lead.recycle_count,
      board_stage: lead.board_stage,
      paused_until: lead.paused_until,
      last_activity_at: lead.last_activity_at,
      pause_reason: lead.pause_reason,
      assigned_at: lead.assigned_at
    },
    lead.outcome_at,
    // NOT_INTERESTED repeat-count isn't tracked at list-view
    // granularity yet — it only affects the JUNK_ELIGIBLE case, which
    // Phase 4's recycling engine is the real consumer of.
    0,
    false,
    lead.is_personal_lead,
    workingCalendar
  );

  // Stale/Recycle-Warning filter (2026-09-16) — same inputs already
  // built above for calculateSLAStatus, reused as-is.
  const recycleCutoff = getRecycleCutoff(
    {
      status: lead.status,
      sla_deadline: lead.sla_deadline,
      recycle_count: lead.recycle_count,
      board_stage: lead.board_stage,
      paused_until: lead.paused_until,
      last_activity_at: lead.last_activity_at,
      pause_reason: lead.pause_reason,
      assigned_at: lead.assigned_at
    },
    lead.outcome_at,
    lead.is_personal_lead,
    workingCalendar
  );


  let slaBadge: { label: string; className: string; pulse?: boolean } | null = null;

  if (slaStatus === "WITHIN_SLA" && lead.sla_deadline) {
    const msRemaining = new Date(lead.sla_deadline).getTime() - now.getTime();
    slaBadge = {
      label: formatCountdown(msRemaining),
      className: "bg-cyan-50 text-cyan-700"
    };
  } else if (slaStatus === "SLA_BREACHED") {
    slaBadge = { label: "Overdue", className: "bg-red-100 text-red-700", pulse: true };
  } else if (slaStatus === "COOLDOWN" && recycleCutoff) {
    slaBadge = {
      label: `${formatDaysHoursLeft(recycleCutoff.cutoffAt.getTime() - now.getTime())} — ${RECYCLE_REASON_LABEL[recycleCutoff.reason]}`,
      className: "bg-slate-100 text-slate-700"
    };
  } else if (slaStatus === "COOLDOWN") {
    slaBadge = { label: "Cooling down", className: "bg-slate-100 text-slate-700" };
  } else if ((slaStatus === "RECYCLE_READY" || slaStatus === "JUNK_ELIGIBLE") && recycleCutoff) {
    slaBadge = { label: `Recycling now — ${RECYCLE_REASON_LABEL[recycleCutoff.reason]}`, className: "bg-amber-50 text-amber-800" };
  } else if (slaStatus === "RECYCLE_READY" || slaStatus === "JUNK_ELIGIBLE") {
    slaBadge = { label: "Awaiting follow-up", className: "bg-amber-50 text-amber-800" };
  } else if (slaStatus === "PAUSED" && lead.paused_until) {
    const untilLabel = new Date(lead.paused_until).toLocaleDateString([], { month: "short", day: "numeric" });
    slaBadge =
      lead.pause_reason === "VISIT_LOCK"
        ? { label: `🔒 Locked until ${untilLabel}`, className: "bg-emerald-50 text-emerald-700" }
        : lead.pause_reason === "VISIT_PENDING_VERIFICATION"
        ? { label: "⏳ Pending verification", className: "bg-amber-50 text-amber-700" }
        : { label: `😴 Snoozed until ${untilLabel}`, className: "bg-indigo-50 text-indigo-700" };
  } else if (slaStatus === "FOLLOWUP_INACTIVITY_WARNING" && recycleCutoff) {
    slaBadge = {
      label: `${formatDaysHoursLeft(recycleCutoff.cutoffAt.getTime() - now.getTime())} — ${RECYCLE_REASON_LABEL[recycleCutoff.reason]}`,
      className: "bg-amber-50 text-amber-800"
    };
  } else if (slaStatus === "FOLLOWUP_INACTIVITY_WARNING") {
    slaBadge = { label: "Needs follow-up", className: "bg-amber-50 text-amber-800" };
  } else if (slaStatus === "FOLLOWUP_INACTIVITY_RECYCLE_READY" && recycleCutoff) {
    slaBadge = { label: `Recycling now — ${RECYCLE_REASON_LABEL[recycleCutoff.reason]}`, className: "bg-red-100 text-red-700", pulse: true };
  } else if (slaStatus === "FOLLOWUP_INACTIVITY_RECYCLE_READY") {
    slaBadge = { label: "Going stale", className: "bg-red-100 text-red-700", pulse: true };
  }

  // Fire-and-forget: logs the first-ever call-click timestamp via
  // log_call_click_atomic (no-ops after the first click, see the
  // RPC's own coalesce). Deliberately not awaited — the tel: link
  // must open immediately, this is a background signal for Admin
  // response-time reporting, not something that should ever block or
  // interrupt the actual call.
  function handleCallClick(e: React.MouseEvent) {
    e.stopPropagation();
    rememberCalledCard(lead.id);
    supabase
      .rpc("log_call_click_atomic", { p_lead_history_id: lead.leadHistoryId })
      .then(({ error }) => {
        if (error) console.error("log_call_click_atomic failed:", error.message);
      });
  }

  // Same fire-and-forget pattern as handleCallClick, own column
  // (first_whatsapp_at) and own RPC — kept fully independent of the
  // call-tracking so Admin can tell which channel an employee
  // actually used, not just that they did something.
  function handleWhatsAppClick(e: React.MouseEvent) {
    e.stopPropagation();
    supabase
      .rpc("log_whatsapp_click_atomic", { p_lead_history_id: lead.leadHistoryId })
      .then(({ error }) => {
        if (error) console.error("log_whatsapp_click_atomic failed:", error.message);
      });
  }

  // ---- Design C "Pass" presentation (2026-10-09). Everything below only
  // reads values computed above (slaStatus, recycleCutoff, slaBadge) and the
  // lead's own fields — no new SLA / recycle rule, no new query.
  const overdue = Boolean(slaBadge?.pulse); // SLA breached / going stale / recycling now
  const stage = lead.board_stage || "LEADS";
  const quiet = slaStatus === "PAUSED" || slaStatus === "COOLDOWN" || Boolean(lead.is_personal_lead);
  const tone: PassTone = overdue ? "OVERDUE" : quiet ? "QUIET" : stage !== "LEADS" || slaStatus !== "WITHIN_SLA" ? "FOLLOW_UP" : "NEW";
  const look = PASS[tone];
  const source = lead.is_personal_lead ? null : lead.source;
  const statusLabel = (LEAD_STATUS_DISPLAY[lead.status]?.label || lead.status).toUpperCase();

  // Display-only cue: status still NEW but the lead has been worked (calls,
  // or activity after assignment) — the system already treats it as
  // contacted (follow-up clock), so say so on the card.
  const contacted =
    lead.status === "NEW" &&
    (lead.call_count > 0 ||
      Boolean(lead.last_activity_at && lead.assigned_at && new Date(lead.last_activity_at).getTime() > new Date(lead.assigned_at).getTime()));

  // Header clock: the existing badge text, split into label + value.
  let clock: { label: string; value: string; sub?: string } | null = null;
  if (slaBadge) {
    const [main, reason] = slaBadge.label.split(" — ");
    if (slaStatus === "WITHIN_SLA") clock = { label: "FIRST CALL", value: main.replace(/ left$/, ""), sub: "left" };
    else if (slaStatus === "SLA_BREACHED")
      clock = {
        label: "OVERDUE",
        value: lead.sla_deadline ? formatCountdown(now.getTime() - new Date(lead.sla_deadline).getTime()).replace(/ left$/, "") : "Now",
        sub: "past SLA"
      };
    else if (overdue) clock = { label: "OVERDUE", value: main.replace(/^Recycling now$/, "Now"), sub: reason || "recycling now" };
    else if (slaStatus === "PAUSED") {
      // "🔒 Locked until Oct 16" / "😴 Snoozed until Oct 16" / "⏳ Pending verification"
      const words = main.split(" ");
      clock =
        lead.pause_reason === "VISIT_PENDING_VERIFICATION"
          ? { label: "VISIT", value: "Pending", sub: "verification" }
          : { label: `${(words[1] || "Paused").toUpperCase()} UNTIL`, value: main.replace(/^\S+\s\S+\suntil\s/, "") };
    } else if (recycleCutoff) {
      // countdown to the recycle — same value the old badge showed
      clock = { label: slaStatus === "COOLDOWN" ? "COOLDOWN" : "FOLLOW-UP", value: main.replace(/ left$/, ""), sub: "until recycle" };
    } else clock = { label: slaStatus === "COOLDOWN" ? "COOLDOWN" : "FOLLOW-UP", value: main };
  }
  const recycleReason = recycleCutoff ? RECYCLE_REASON_LABEL[recycleCutoff.reason] : null;
  const recycleTitle = recycleCutoff ? `Recycles at ${formatExactTime(recycleCutoff.cutoffAt.toISOString())}${recycleReason ? ` — ${recycleReason}` : ""}` : undefined;
  const recycleMsLeft = recycleCutoff ? recycleCutoff.cutoffAt.getTime() - now.getTime() : null;
  // No other clock running (e.g. follow-up within its window): the recycle
  // countdown becomes the header clock, as in the Pass design.
  const recycleInClock = !clock && recycleMsLeft !== null && recycleMsLeft > 0;
  if (recycleInClock && recycleMsLeft !== null) {
    clock = { label: stage !== "LEADS" ? "FOLLOW-UP" : "RECYCLES IN", value: formatDaysHoursLeft(recycleMsLeft).replace(/ left$/, ""), sub: "until recycle" };
  }

  // Facts row values.
  const assignedValue = lead.assigned_at
    ? `${formatAssignedExact(lead.assigned_at)} · ${formatAgo(now.getTime() - new Date(lead.assigned_at).getTime())}`
    : "—";
  const callsValue = lead.call_count > 0 ? `${lead.call_count} ${lead.call_count === 1 ? "call" : "calls"}` : "None yet";
  const lastActivityValue = lead.last_activity_at ? formatAgo(now.getTime() - new Date(lead.last_activity_at).getTime()) : "—";

  // Same text as RecycledBadge (which this replaces on this card only).
  const recycledFrom = lead.recycle_reason ? recycledFromText(lead.recycled_from_stage, lead.recycled_from_status, false) : null;
  const recycledText =
    lead.recycle_reason || lead.recycle_count > 0
      ? `Recycled${lead.recycle_count > 0 ? ` ${lead.recycle_count}×` : ""}${recycledFrom ? ` · from ${recycledFrom}` : ""}`
      : null;
  const showRecycleChip = Boolean(recycleCutoff) && recycleMsLeft !== null && recycleMsLeft > 0 && !overdue && !recycleInClock;
  const timersRunning = Boolean(recycleCutoff) || (slaStatus === "WITHIN_SLA" && Boolean(lead.sla_deadline));
  const clockTitle = [clock ? `${clock.label} ${clock.value}` : null, clock?.sub, recycleTitle].filter(Boolean).join(" · ") || undefined;
  // Header chip text; words drop on a narrow card (full label in the tooltip).
  const chip = clockParts(clock);
  const dot = (color: string) => <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />;

  return (
    <motion.div
      id={`lead-card-${lead.id}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index, 8) * 0.04 }}
      onClick={() => onOpen(lead.id)}
      style={cardSurface(tone)}
      className={`${leadCardFont.className} @container relative w-full min-w-0 scroll-mt-28 overflow-hidden rounded-[18px] border cursor-pointer shadow-[var(--card-shadow)] transition-[transform,box-shadow] duration-200 hover:-translate-y-px hover:shadow-[var(--card-shadow-hover)] focus-within:ring-2 focus-within:ring-slate-300 motion-reduce:transition-none motion-reduce:hover:translate-y-0`}
    >
      {/* 3px accent line + slim header: position, source, temperature, status | clock chip */}
      <div className="h-[3px]" style={{ background: look.line }} aria-hidden="true" />
      <div className={`flex items-center justify-between gap-2 px-3.5 py-1.5 ${HEADER_GLASS}`} style={{ background: look.header }}>
        <div data-header-tags className="flex min-w-0 flex-wrap @[340px]:flex-nowrap items-center gap-1 @[360px]:gap-1.5 overflow-hidden [&>span:not(:first-child)]:shrink-0 @max-[420px]:[&>span]:px-1.5">
          {/* Position in the current list — a visual count, not a lead ID. */}
          <span className="text-[11px] font-bold tabular-nums" style={{ color: MUTED }}>#{index + 1}</span>
          {source && (
            <span className={`${TAG} min-w-0 max-w-[120px] shrink!`} style={NEUTRAL_TAG} title={source}>
              {dot(sourceDot(source))}
              <span className="hidden truncate @[420px]:inline">{source}</span>
            </span>
          )}
          {/* Lead temperature (priority) — always shown, as on the old card. HOT/WARM tinted, COLD neutral. */}
          {lead.priority === "hot" ? (
            <span className={TAG} style={TINT_TAG.hot}>HOT</span>
          ) : lead.priority === "warm" ? (
            <span className={TAG} style={TINT_TAG.warm}>WARM</span>
          ) : (
            <span className={TAG} style={NEUTRAL_TAG}>
              <span className="hidden @[360px]:inline-flex">{dot(DOT.blueGrey)}</span>
              {(LEAD_PRIORITY_DISPLAY[lead.priority]?.label || lead.priority).toUpperCase()}
            </span>
          )}
          <span className={`${TAG} tracking-[.04em]`} style={statusPillStyle(lead.status)}>{statusLabel}</span>
        </div>
        {clock && (
          <span
            title={clockTitle}
            className={`inline-flex h-[24px] shrink-0 items-center gap-1 rounded-full bg-white px-2 @[360px]:gap-1.5 @[360px]:px-2.5 tabular-nums ${overdue ? "motion-safe:animate-pulse" : ""}`}
            style={{ color: look.accent, boxShadow: `inset 0 0 0 1px ${HAIRLINE}, 0 1px 2px rgba(15,23,42,.05)` }}
          >
            <Timer size={12} strokeWidth={2} aria-hidden="true" />
            <span className="text-[12px] font-extrabold whitespace-nowrap">
              {chip?.lead && <span className="hidden @[420px]:inline">{chip.lead}</span>}
              {chip?.main}
              {chip?.tail && <span className="hidden @[360px]:inline">{chip.tail}</span>}
            </span>
          </span>
        )}
      </div>

      {/* Body — one left edge (px-3.5), 8px rhythm */}
      <div className="flex flex-col gap-2 px-3.5 pt-2.5 pb-3">
        {/* Identity + last log: side by side on a wide card, stacked (log as a slim strip) on a narrow one. */}
        <div className="flex flex-col gap-2 @[380px]:flex-row @[380px]:items-start @[380px]:gap-3">
          <div className="min-w-0 flex-1">
            <p title={lead.name} className={`${SIZE.name} font-extrabold tracking-[-0.015em] break-words line-clamp-2`} style={{ color: NAME_COLOR }}>{lead.name}</p>
            {/* Tap the number to copy it (Call button unchanged). */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard?.writeText(lead.mobile).then(() => toast.success("Number copied"), () => {});
              }}
              title="Tap to copy"
              className={`mt-0.5 block ${SIZE.number} font-bold tabular-nums cursor-copy rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300`}
              style={{ color: "#1e293b" }}
            >
              {lead.mobile}
            </button>
            {lead.project && <p className={`mt-0.5 ${SIZE.project} font-bold truncate`} style={{ color: look.project }}>{lead.project}</p>}
          </div>
          <LastLogPanel
            lookupKey="lead_history_id"
            id={lead.leadHistoryId}
            version={lead.last_activity_at}
            called={lead.call_count > 0}
            resultLabel={lead.status !== "NEW" ? LEAD_STATUS_DISPLAY[lead.status]?.label : null}
            className="@[380px]:w-[46%] @[380px]:max-w-[230px] @[380px]:shrink-0"
          />
        </div>

        {/* Facts row: label small muted, value bold. Assigned = exact time · how long ago. */}
        <dl className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 rounded-[12px] px-3 py-2" style={GLASS_BOX}>
          <div className="min-w-0">
            <dt className={`${SIZE.factLabel} font-bold`} style={{ color: MUTED }}>Assigned</dt>
            <dd className={`${SIZE.factValue} font-bold tabular-nums`} style={{ color: INK }} title={assignedValue}>
              {lead.assigned_at ? (
                <>
                  <span className="whitespace-nowrap">{formatAssignedExact(lead.assigned_at)}</span>{" "}
                  <span className="whitespace-nowrap font-semibold" style={{ color: TEXT2 }}>· {formatAgo(now.getTime() - new Date(lead.assigned_at).getTime())}</span>
                </>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className={`${SIZE.factLabel} font-bold`} style={{ color: MUTED }}>Calls</dt>
            <dd className={`${SIZE.factValue} font-bold tabular-nums truncate`} style={{ color: INK }}>{callsValue}</dd>
          </div>
          <div className="min-w-0">
            <dt className={`${SIZE.factLabel} font-bold truncate`} style={{ color: MUTED }}>Last activity</dt>
            <dd className={`${SIZE.factValue} font-bold tabular-nums truncate`} style={{ color: INK }}>{lastActivityValue}</dd>
          </div>
        </dl>

        {/* Tags: neutral pill + dot; only Call first / recycle-soon tinted. Empty row collapses. */}
        <div className="flex flex-wrap items-center gap-1.5 min-w-0 [&:not(:has(>:not(:empty)))]:hidden">
          {overdue && <span className={TAG} style={TINT_TAG.callFirst}>Call first</span>}
          {contacted && (
            <span className={TAG} style={NEUTRAL_TAG} title="Called or worked since assignment — on the follow-up clock now">
              {dot(DOT.teal)}
              Contacted
            </span>
          )}
          {showRecycleChip && recycleMsLeft !== null && (
            <span title={recycleTitle} className={`${TAG} tabular-nums`} style={recycleMsLeft < 12 * 3600000 ? TINT_TAG.recycleSoon : NEUTRAL_TAG}>
              <Timer size={11} strokeWidth={2} aria-hidden="true" />
              Recycles in {formatDaysHoursLeft(recycleMsLeft).replace(/ left$/, "")}
            </span>
          )}
          {lead.is_personal_lead && (
            <span className={TAG} style={NEUTRAL_TAG}>
              {dot(DOT.slate)}
              Personal
            </span>
          )}
          {lead.source === "Legacy" && (
            <span className={TAG} style={NEUTRAL_TAG}>
              {dot(DOT.gold)}
              Legacy
            </span>
          )}
          {recycledText && (
            <span title={recycledText} className={`${TAG} max-w-full`} style={NEUTRAL_TAG}>
              {dot(DOT.slate)}
              <span className="truncate">{recycledText}</span>
            </span>
          )}
          {lead.siblings && lead.siblings.length > 0 && (
            <span className={TAG} style={NEUTRAL_TAG}>
              {dot(DOT.gold)}
              Existing client
            </span>
          )}
          {lead.catcher_name && (
            <span title={`Catcher: ${lead.catcher_name}`} className={`${TAG} max-w-[170px]`} style={NEUTRAL_TAG}>
              {dot(DOT.slate)}
              <span className="truncate">Catcher: {lead.catcher_name}</span>
            </span>
          )}
          {/* Step 8: weekly off / Admin pause — only on leads whose recycle or SLA clock is running.
              Shared badge, restyled here to the neutral pill (its sky ⏸ icon stays). */}
          <span className="inline-flex empty:hidden [&>span]:inline-flex [&>span]:h-[22px] [&>span]:items-center [&>span]:text-[11px] [&>span]:bg-[#f3f6fa]! [&>span]:text-[#475569]! [&>span]:shadow-[inset_0_0_0_1px_#e8edf3]">
            <TimerPausedBadge size="sm" clockRunning={timersRunning} />
          </span>
        </div>

        {lead.assigned_by_type === "TEAM_LEADER" && (
          <div className="flex items-start gap-1.5 rounded-[12px] px-3 py-2" style={GLASS_BOX}>
            <Repeat size={12} strokeWidth={2} className="shrink-0 mt-0.5" style={{ color: GOLD }} />
            <p className="text-[12px] leading-snug font-semibold" style={{ color: TEXT2 }}>
              {lead.assigned_by?.name || "Your Team Leader"} reassigned this lead to you
              {lead.reassign_note && (
                <>
                  {" "}— <span className="font-extrabold" style={{ color: INK }}>{lead.reassign_note}</span>
                </>
              )}
            </p>
          </div>
        )}

        {/* Perforated tear line, then the action stub */}
        <div className="border-t border-dashed" style={{ borderColor: HAIRLINE }} aria-hidden="true" />
        <div className="flex items-center gap-2">
          <motion.a
            href={`tel:${lead.mobile}`}
            onClick={handleCallClick}
            whileTap={{ scale: 0.98 }}
            style={CALL}
            className={`${CALL_BUTTON} ${SIZE.button}`}
          >
            <Phone size={16} strokeWidth={2} />
            Call now
          </motion.a>
          <a
            href={buildWhatsAppLink(lead.mobile)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleWhatsAppClick}
            aria-label="WhatsApp"
            title="WhatsApp"
            className={ICON_BUTTON}
            style={BUTTON_BG.whatsapp}
          >
            <WhatsAppIcon size={20} />
          </a>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(lead.id);
            }}
            aria-label="Update status"
            title="Update status"
            className={ICON_BUTTON}
            style={look.update}
          >
            <PencilLine size={17} strokeWidth={2} />
          </button>
          {/* Quick Dial (2026-09-23) — dials a NEW number, unrelated to this lead;
              after the call it offers "Add as personal lead" (LeadList.tsx). */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onQuickDial();
            }}
            aria-label="Quick dial a new number"
            title="Quick dial a new number (you can add it as a personal lead)"
            className={ICON_BUTTON}
            style={BUTTON_BG.quickDial}
          >
            <Zap size={17} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            aria-label={expanded ? "Hide details" : "Show details"}
            aria-expanded={expanded}
            title={expanded ? "Hide details" : "Show details"}
            className={ICON_BUTTON}
            style={expanded ? BUTTON_BG.chevronOpen : BUTTON_BG.chevronClosed}
          >
            <ChevronDown size={18} strokeWidth={2} className={`transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      <div className="px-3.5 empty:hidden">
        <ExpandSection open={expanded}>
          <div className="mb-3.5 rounded-[14px] px-3 pb-3" style={{ background: "rgba(255,255,255,.8)", boxShadow: `inset 0 0 0 1px ${HAIRLINE}` }}>
            <LeadCardMore
              leadId={lead.id}
              leadHistoryId={lead.leadHistoryId}
              status={lead.status}
              boardStage={lead.board_stage}
              contacted={contacted}
              accent={look.accent}
              times={[
                ...(lead.assigned_at ? [{ label: "Assigned", value: formatExactTime(lead.assigned_at) }] : []),
                ...(lead.last_activity_at ? [{ label: "Last activity", value: formatExactTime(lead.last_activity_at) }] : []),
                ...(recycleCutoff ? [{ label: "Recycles at", value: formatExactTime(recycleCutoff.cutoffAt.toISOString()) }] : [])
              ]}
            />
          </div>
        </ExpandSection>
      </div>
    </motion.div>
  );
}

export default memo(LeadCard);
