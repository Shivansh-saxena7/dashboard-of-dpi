"use client";

import { memo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, History, ChevronDown, Timer } from "lucide-react";
import { LEAD_STATUS_DISPLAY } from "@/lib/leadStatusDisplay";
import { LEAD_PRIORITY_DISPLAY, LeadPriority } from "@/lib/leadPriorityDisplay";
import { LeadStatus } from "@/lib/getValidNextLeadStatuses";
import { BOARD_STAGES, BoardStage } from "@/lib/leadBoardStageDisplay";
import { FOLLOWUP_INACTIVITY_WARNING_DAYS, FOLLOWUP_INACTIVITY_RECYCLE_DAYS, getRecycleCutoff, RecycleCutoffReason } from "@/lib/calculateSLAStatus";
import { isLeadTerminal } from "@/lib/isLeadTerminal";
import { useWorkingCalendar } from "@/lib/useWorkingCalendar";
import { DAY_MS, timerCalendar, workingElapsedMs } from "@/lib/workingCalendar";
import AdminLeadHistoryModal from "./AdminLeadHistoryModal";
import LeadCardMore, { ExpandSection } from "./LeadCardMore";
import LastLogPanel from "./LastLogPanel";
import toast from "react-hot-toast";
import { leadCardFont } from "@/lib/leadCardFont";
import { FACT_LABEL, FACT_VALUE, FACTS_BOX, NUMBER_INK, CHAMPAGNE, dotStyle, BUTTON_BG, CALL_BUTTON, cardSurface, DOCK, FACTS, callStyle, GLASS_BOX, NAME_COLOR, clockParts, DOT, formatAgo, formatAssignedExact, formatExactTime, HAIRLINE, headerChip, HEADER_GLASS, ICON_BUTTON, INK, MUTED, NEUTRAL_TAG, PASS, PassTone, SIZE, statusPillStyle, TAG, TEXT2, TINT_TAG } from "@/lib/leadCardLook";
import FactIcon from "@/components/FactIcon";
import SourceChip from "@/components/SourceChip";
import ExistingClientBadge from "./ExistingClientBadge";
import RecycledBadge from "./RecycledBadge";
import TimerPausedBadge from "./TimerPausedBadge";
import type { LeadSibling } from "@/lib/useLeadSiblings";

const RECYCLE_REASON_LABEL: Record<RecycleCutoffReason, string> = {
  FOLLOWUP_INACTIVITY: "Follow-up inactivity",
  NOT_CONNECTED_COOLDOWN: "Not Connected cooldown",
  SWITCHED_OFF_COOLDOWN: "Switched Off cooldown",
  NOT_INTERESTED_COOLDOWN: "Not Interested cooldown"
};

function formatDaysHoursLeft(msRemaining: number): string {
  const totalHours = Math.max(0, Math.floor(msRemaining / (1000 * 60 * 60)));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return days > 0 ? `${days}d ${hours}h left` : `${hours}h left`;
}

interface AdminLeadCardLead {
  id: string;
  name: string;
  mobile: string;
  project: string | null;
  source: string | null;
  status: LeadStatus;
  priority: LeadPriority;
  boardStage: BoardStage;
  recycleCount: number;
  ownerName: string | null;
  currentOwnerId?: string | null;
  catcherName?: string | null;
  assignedAt: string | null;
  pendingTeamId: string | null;
  pendingTeamName: string | null;
  leadType: string;
  callCount: number;
  pausedUntil: string | null;
  pauseReason: string | null;
  lastActivityAt: string | null;
  // Stale/Recycle-Warning filter (2026-09-16) — optional so every
  // pre-existing caller not yet updated (Coordinator page) still works
  // unchanged; undefined just means the cooldown-based reason (Leads-
  // stage NOT_CONNECTED/SWITCHED_OFF/NOT_INTERESTED) can't be shown.
  outcomeAt?: string | null;
  // Personal (self-sourced) lead (2026-09-23) — optional, undefined
  // behaves exactly like false (every pre-existing caller unaffected).
  isPersonalLead?: boolean;
  // Other leads for the same client (same mobile) — optional, so the
  // Coordinator page's cards simply don't show the badge.
  siblings?: LeadSibling[];
  // Why the active assignment exists (lead_history.recycle_reason), 2026-10-05.
  recycleReason?: string | null;
  recycledFromStatus?: string | null;
  recycledFromStage?: string | null;
}

interface AdminLeadCardProps {
  lead: AdminLeadCardLead;
  teams: { id: string; name: string }[];
  onReserveTeam: (leadId: string, teamId: string | null) => void;
  index?: number;
  // Full active-employee roster — only actually used by the JUNK-
  // recovery Reassign picker below (optional so every other existing
  // caller of this card is unaffected).
  employees?: { id: string; name: string; is_active: boolean }[];
  // JUNK-recovery — Admin manually decides a specific JUNK lead is
  // worth another shot and hands it to someone. The one deliberate,
  // narrow exception to this card's "purely a visibility layer"
  // design (see the file-level comment below) — optional, and only
  // ever rendered when lead.status === "JUNK" && !readOnly.
  onUnjunkReassign?: (leadId: string, employeeId: string, reason: string) => void | Promise<void>;
  // Sales Coordinator reuses this exact card for full-visibility
  // reporting (Golden Rule — one card, not a forked copy), but per
  // the approved scope ("Aankhen aur Reports," never "Haath"),
  // Coordinator must never see anything that LOOKS actionable, not
  // just be functionally blocked from it — the team-reserve <select>
  // below is a real decision-making control, so this replaces it with
  // plain read-only text instead of merely no-op'ing onReserveTeam.
  // Also hides the JUNK-recovery Reassign control (Admin-only power).
  readOnly?: boolean;
  // Employee Leave/Holiday gap (2026-08-23, Point A) — resolved by the
  // PARENT page from employee_leave_periods (one query per page load,
  // not per card) and passed in as a plain boolean, same shape as
  // every other derived flag this card receives rather than fetching.
  // Optional/defaults false so every other existing caller of this
  // card is unaffected.
  isOwnerOnLeave?: boolean;
  // Bulk Reassign checkbox — selection state itself lives in the
  // parent (app/admin/leads/page.tsx), same split as onReserveTeam
  // above; this card only ever renders the box and reports taps.
  // Deliberately never offered on a terminal lead (JUNK/BOOKING) —
  // force_reassign_lead_atomic's terminal branch only moves ownership,
  // it doesn't unjunk, so bulk-selecting a JUNK lead here would look
  // like it worked but silently leave it junked under the new owner.
  // JUNK recovery stays on the existing per-card onUnjunkReassign flow.
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (leadId: string) => void;
}

// Read-only — Admin never logs updates or moves a lead through the
// board (that's the owning employee's job, one-owner principle).
// Purely a visibility layer, reusing the same status/priority/board-
// stage display config the employee-side components use, so colors
// and labels never drift between the two views. Shows two fields
// employees deliberately never see (recycle count, board stage as an
// explicit badge) — both are legitimate Admin-only audit visibility,
// consistent with the Phase 1 RLS design.
//
// Styled in blue-cyan (the established Admin accent, Section 2.7) —
// deliberately NOT gold, which is reserved for employee-facing
// primary CTAs. This card has no CTAs at all except "View History,"
// which is read-only (opens AdminLeadHistoryModal). Always shown, not
// gated on recycleCount > 0 like it used to be — every assigned lead
// has at least one lead_history row (the initial SYSTEM assignment),
// and now that Admin-reservation events are tracked too (see
// AdminLeadHistoryModal), there's meaningful history to show even for
// leads that were never recycled.
//
// The history modal's open/close state lives HERE (self-contained),
// not lifted to the parent page — unlike the employee-side
// LeadList/LeadCard split, where the parent needs to own selection
// state because LeadDetailModal writes data that must optimistically
// patch the list. AdminLeadHistoryModal never writes anything, so
// there's no cross-card state to coordinate.
//
// AnimatePresence wraps the modal here (not inside the modal itself)
// because this is exactly where the mount/unmount decision happens —
// {historyOpen && ...} is this component's own conditional. That's
// what makes AnimatePresence actually functional here, unlike the
// earlier LeadDetailModal bug where it sat one level too deep and
// never saw its own removal coming. The modal itself is portaled to
// document.body (see its own comment) so its fixed-position backdrop/
// drawer resolve against the viewport, not this card's transformed
// (animated) box — that was the cause of the drawer sometimes
// rendering as if it were a small centered card.
// Wrapped in memo (2026-08-27 perf pass) — skips re-rendering a card
// whose own props are unchanged when an unrelated parent state change
// (search/filter/sort) triggers a re-render. Effective as long as the
// parent passes reference-stable handlers — app/admin/leads/page.tsx
// already does (named functions, not per-card inline arrows);
// app/coordinator/page.tsx's onReserveTeam no-op was switched to a
// stable reference for the same reason.
function AdminLeadCard({
  lead,
  teams,
  onReserveTeam,
  index = 0,
  employees = [],
  onUnjunkReassign,
  readOnly = false,
  isOwnerOnLeave = false,
  selectable = false,
  selected = false,
  onToggleSelect
}: AdminLeadCardProps) {
  const workingCalendar = useWorkingCalendar();

  const [historyOpen, setHistoryOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassignEmployeeId, setReassignEmployeeId] = useState("");
  const [reassignReason, setReassignReason] = useState("");
  const [reassignSubmitting, setReassignSubmitting] = useState(false);

  async function submitReassign() {
    if (!onUnjunkReassign || !reassignEmployeeId || !reassignReason.trim() || reassignSubmitting) return;

    setReassignSubmitting(true);
    try {
      await onUnjunkReassign(lead.id, reassignEmployeeId, reassignReason.trim());
      setReassignOpen(false);
      setReassignEmployeeId("");
      setReassignReason("");
    } finally {
      setReassignSubmitting(false);
    }
  }

  const statusDisplay = LEAD_STATUS_DISPLAY[lead.status];
  const priorityDisplay = LEAD_PRIORITY_DISPLAY[lead.priority];
  const boardStageDisplay = BOARD_STAGES.find((b) => b.stage === lead.boardStage);

  const initial = lead.name?.charAt(0)?.toUpperCase() || "?";

  // Follow-up-Stale-Recycling visibility — Admin-only badge, purely
  // informational (this card never writes anything). Mirrors the
  // employee-side LeadCard badge logic but computed inline here
  // rather than via the full calculateSLAStatus (this card doesn't
  // carry sla_deadline/outcome_at, which that function also needs for
  // its pre-Follow-up branches — not relevant to what this badge is
  // for). Reuses the same threshold constants so "stale" means
  // exactly the same thing here as it does to the recycling engine.
  // Pending-verification stays "paused" even past its own
  // pausedUntil — same reasoning as calculateSLAStatus's dedicated
  // check: it only ends when Admin/Sales Coordinator verifies or
  // denies it, never just by the 3-day date passing.
  // A genuinely Booked (status=CONVERTED AND board_stage=BOOKING) or
  // JUNK lead is permanently closed — nothing else about it is still
  // "pending," regardless of what its stale pause_reason/
  // last_activity_at columns happen to still say (e.g. log_booking_
  // atomic doesn't clear an in-progress VISIT_LOCK pause, since
  // that's not its job — this card is what's responsible for not
  // presenting that leftover state as if it were still active).
  // status='CONVERTED' ALONE is deliberately not enough — status and
  // board_stage are independent (log_lead_update_atomic lets an
  // employee mark CONVERTED as a plain call-outcome, e.g. "client
  // verbally agreed, formal booking hasn't happened yet," without
  // ever touching board_stage). This card used to treat status=
  // CONVERTED alone as terminal, which incorrectly suppressed stale/
  // pause badges on leads that were still very much active — see
  // lib/isLeadTerminal.ts for the full reasoning (same helper
  // calculateSLAStatus.ts's own first gate now uses too).
  const isTerminal = isLeadTerminal(lead.status, lead.boardStage);
  const isPaused =
    !isTerminal &&
    (lead.pauseReason === "VISIT_PENDING_VERIFICATION" ||
      Boolean(lead.pausedUntil && new Date(lead.pausedUntil) > new Date()));
  // Working calendar (Step 4) — with the switch ON, "days since
  // activity" counts working time only, same as the sweep.
  const workingCal = timerCalendar(workingCalendar);
  const daysSinceActivity = lead.lastActivityAt
    ? workingCal
      ? workingElapsedMs(workingCal, lead.lastActivityAt, Date.now()) / DAY_MS
      : (Date.now() - new Date(lead.lastActivityAt).getTime()) / (1000 * 60 * 60 * 24)
    : null;
  const isBeyondLeadsStage = lead.leadType !== "DATA" && lead.boardStage !== "LEADS";
  // Employee Leave/Holiday gap (2026-08-23, Point A) — mirrors
  // calculateSLAStatus.ts's own isOwnerOnLeave precedence exactly: on
  // leave overrides the inactivity evaluation entirely, not just caps
  // the badge. Without the !isOwnerOnLeave guard here too, this card
  // would keep showing "Needs follow-up"/"Going stale" even though
  // the backend has already stopped counting toward recycling for
  // it — actively misleading, not just a missing badge.
  //
  // Personal lead (2026-09-23) — same precedence as !isOwnerOnLeave
  // above, and for the identical reason: this card computes
  // isStale/isGoingStale independently of calculateSLAStatus (doesn't
  // call it at all), so its own isPersonalLead short-circuit alone
  // doesn't reach here — this guard is what actually makes "no SLA/
  // urgency whatsoever" true on this card too, not just the employee-
  // facing one.
  const isStale = !isTerminal && !isPaused && !isOwnerOnLeave && !lead.isPersonalLead && isBeyondLeadsStage && daysSinceActivity !== null && daysSinceActivity >= FOLLOWUP_INACTIVITY_WARNING_DAYS;
  const isGoingStale = isStale && daysSinceActivity !== null && daysSinceActivity >= FOLLOWUP_INACTIVITY_RECYCLE_DAYS;
  const showOnLeaveBadge = isOwnerOnLeave && !isTerminal && isBeyondLeadsStage;

  // Stale/Recycle-Warning filter (2026-09-16) — additive alongside
  // isStale/isGoingStale above, which stay untouched (still what
  // decides whether THAT badge shows at all). Reuses getRecycleCutoff
  // (same helper the employee side uses) rather than hand-duplicating
  // the cooldown math a third time — also covers the Leads-stage
  // NOT_CONNECTED/SWITCHED_OFF/NOT_INTERESTED cooldown case isStale
  // never did (it's gated on isBeyondLeadsStage only).
  const recycleCutoff =
    !isTerminal && !isPaused && !isOwnerOnLeave && !lead.isPersonalLead
      ? getRecycleCutoff(
          {
            status: lead.status,
            sla_deadline: null,
            recycle_count: lead.recycleCount,
            board_stage: lead.boardStage,
            paused_until: lead.pausedUntil,
            last_activity_at: lead.lastActivityAt,
            pause_reason: lead.pauseReason,
            assigned_at: lead.assignedAt,
            lead_type: lead.leadType
          },
          lead.outcomeAt ?? null,
          false,
          workingCalendar
        )
      : null;
  const recycleCutoffMsRemaining = recycleCutoff ? recycleCutoff.cutoffAt.getTime() - Date.now() : 0;

  // ---- Design C "Pass", restrained palette (2026-10-09). Only reads the
  // values computed above (isTerminal, isPaused, isStale, isGoingStale,
  // recycleCutoff, showOnLeaveBadge) — every condition is the old card's.
  // Look shared with the employee card via lib/leadCardLook.ts.
  const recyclingNow = Boolean(isGoingStale || (!isStale && recycleCutoff && recycleCutoffMsRemaining <= 0));
  const tone: PassTone = recyclingNow
    ? "OVERDUE"
    : isTerminal || isPaused || lead.isPersonalLead
    ? "QUIET"
    : lead.leadType !== "DATA" && lead.boardStage !== "LEADS"
    ? "FOLLOW_UP"
    : "NEW";
  const look = PASS[tone];
  const nowMs = new Date().getTime();
  const dot = (color: string) => <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={dotStyle(color)} aria-hidden="true" />;
  const untilDate = lead.pausedUntil ? new Date(lead.pausedUntil).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "";

  // Header clock — the same states the old badges showed.
  type Clock = { label: string; value: string; sub?: string };
  const pauseClock: Clock | null = !isPaused
    ? null
    : lead.pauseReason === "VISIT_LOCK"
    ? { label: "LOCKED UNTIL", value: untilDate }
    : lead.pauseReason === "VISIT_PENDING_VERIFICATION"
    ? { label: "VISIT", value: "Pending" }
    : { label: "SNOOZED UNTIL", value: untilDate };
  const recycleLeft = recycleCutoff && recycleCutoffMsRemaining > 0 ? formatDaysHoursLeft(recycleCutoffMsRemaining).replace(/ left$/, "") : null;
  const staleClock: Clock | null = isStale
    ? isGoingStale
      ? { label: "OVERDUE", value: "Now", sub: recycleCutoff ? RECYCLE_REASON_LABEL[recycleCutoff.reason] : "Going stale" }
      : recycleLeft
      ? { label: "FOLLOW-UP", value: recycleLeft, sub: "until recycle" }
      : { label: "FOLLOW-UP", value: "Needs follow-up" }
    : recycleCutoff
    ? recycleCutoffMsRemaining <= 0
      ? { label: "OVERDUE", value: "Now", sub: RECYCLE_REASON_LABEL[recycleCutoff.reason] }
      : { label: "COOLDOWN", value: recycleLeft as string, sub: "until recycle" }
    : null;
  // Old card could show a pause badge and a stale/cooldown badge together:
  // the clock shows the stale/cooldown one, the pause becomes a tag.
  const clock = staleClock || pauseClock;
  const pauseAsTag = staleClock && pauseClock ? pauseClock : null;
  const chip = clockParts(clock);
  const recycleReason = recycleCutoff ? RECYCLE_REASON_LABEL[recycleCutoff.reason] : null;
  const recycleTitle = recycleCutoff ? `Recycles at ${formatExactTime(recycleCutoff.cutoffAt.toISOString())}${recycleReason ? ` — ${recycleReason}` : ""}` : undefined;
  const clockTitle = [clock ? `${clock.label} ${clock.value}` : null, clock?.sub, recycleTitle].filter(Boolean).join(" · ") || undefined;

  const callsValue = lead.callCount > 0 ? `${lead.callCount} ${lead.callCount === 1 ? "call" : "calls"}` : "None yet";
  const lastActivityValue = lead.lastActivityAt ? formatAgo(nowMs - new Date(lead.lastActivityAt).getTime()) : "—";
  const statusLabel = (statusDisplay?.label || lead.status).toUpperCase();
  const FIELD = "block h-11 w-full rounded-[12px] bg-white px-3 text-[13px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-slate-300";
  // Shared badges restyled to the neutral pill here (their own behaviour —
  // tooltip, "N other leads" popover — is unchanged).
  const NEUTRALIZE = "[&>span]:bg-[#f3f6fa]! [&>span]:text-[#475569]! [&>span]:border-[#e8edf3]! [&>span>button]:bg-[#f3f6fa]! [&>span>button]:text-[#475569]! [&>span>button]:border-[#e8edf3]!";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index, 10) * 0.04 }}
      style={cardSurface(tone)}
      className={`${leadCardFont.className} @container relative w-full min-w-0 scroll-mt-28 overflow-hidden rounded-[18px] border shadow-[var(--card-shadow)] transition-[transform,box-shadow] duration-200 hover:-translate-y-px hover:shadow-[var(--card-shadow-hover)] focus-within:ring-2 focus-within:ring-slate-300 motion-reduce:transition-none motion-reduce:hover:translate-y-0`}
    >
      {/* 3px accent line + slim header: source, temperature, status | clock chip */}
      <div className="h-[3px]" style={{ background: look.line }} aria-hidden="true" />
      <div className={`flex items-center justify-between gap-2 px-3.5 py-1.5 ${HEADER_GLASS}`} style={{ background: look.header }}>
        <div data-header-tags className="flex min-w-0 flex-wrap @[340px]:flex-nowrap items-center gap-1 @[360px]:gap-1.5 overflow-hidden [&>*]:shrink-0 @max-[420px]:[&>span]:px-1.5">
          {/* Same dedicated-badge-over-generic-source-pill choice as LeadCard.tsx (2026-09-23). */}
          {lead.isPersonalLead ? (
            <span className={TAG} style={NEUTRAL_TAG}>
              {dot(DOT.slate)}
              Personal
            </span>
          ) : null}
          {lead.priority === "hot" ? (
            <span className={TAG} style={TINT_TAG.hot}>HOT</span>
          ) : lead.priority === "warm" ? (
            <span className={TAG} style={TINT_TAG.warm}>WARM</span>
          ) : (
            <span className={TAG} style={NEUTRAL_TAG}>
              <span className="hidden @[360px]:inline-flex">{dot(DOT.blueGrey)}</span>
              {(priorityDisplay?.label || lead.priority).toUpperCase()}
            </span>
          )}
          <span className={`${TAG} tracking-[.04em]`} style={statusPillStyle(lead.status)}>{statusLabel}</span>
        </div>
        {chip && (
          <span
            title={clockTitle}
            className={`inline-flex h-[24px] shrink-0 items-center gap-1 rounded-full bg-white px-2 @[360px]:gap-1.5 @[360px]:px-2.5 tabular-nums ${recyclingNow ? "motion-safe:animate-pulse" : ""}`}
            style={headerChip(look.accent)}
          >
            <Timer size={12} strokeWidth={2} aria-hidden="true" />
            <span className="text-[12px] font-extrabold whitespace-nowrap">
              {chip.lead && <span className="hidden @[420px]:inline">{chip.lead}</span>}
              {chip.main}
              {chip.tail && <span className="hidden @[360px]:inline">{chip.tail}</span>}
            </span>
          </span>
        )}
      </div>

      {/* Body — one left edge (px-3.5), 8px rhythm */}
      <div className="flex flex-col gap-2 px-3.5 pt-2.5 pb-3">
        {/* Select box + avatar sit beside the name, so the header stays one line. */}
        {/* Identity + last log: side by side on a wide card, stacked on a narrow one. */}
        <div className="flex flex-col gap-2 @[400px]:flex-row @[400px]:items-start @[400px]:gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
              {selectable && !isTerminal && !readOnly && (
                // Custom button, not a native checkbox — the native checkmark was
                // invisible on some browsers. 44px tap target around a 20px box.
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={selected}
                  aria-label={selected ? "Deselect lead" : "Select lead"}
                  onClick={() => onToggleSelect?.(lead.id)}
                  className="-m-3 p-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                >
                  <span className={`h-5 w-5 rounded border-2 flex items-center justify-center ${selected ? "bg-blue-600 border-blue-600" : "bg-white border-slate-400"}`}>
                    {selected && <Check size={13} strokeWidth={3} className="text-white" />}
                  </span>
                </button>
              )}
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-extrabold" style={{ background: "#eef2f6", color: TEXT2, boxShadow: `inset 0 0 0 1px ${HAIRLINE}` }} aria-hidden="true">
                {initial}
              </span>
          <div className="min-w-0 flex-1">
          <p title={lead.name} className={`${SIZE.name} break-words line-clamp-2`} style={{ color: NAME_COLOR }}>{lead.name}</p>
          {/* Tap the number to copy it. */}
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(lead.mobile).then(() => toast.success("Number copied"), () => {})}
            title="Tap to copy"
            className={`mt-0.5 block ${SIZE.number} tabular-nums cursor-copy rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300`}
            style={{ color: NUMBER_INK }}
          >
            {lead.mobile}
          </button>
          {lead.project && <p className={`mt-0.5 ${SIZE.project} font-medium truncate`} style={{ color: look.project }}>{lead.project}</p>}
          <SourceChip source={lead.isPersonalLead ? null : lead.source} />
          </div>
        </div>
        <LastLogPanel
          lookupKey="lead_id"
          id={lead.id}
          version={lead.lastActivityAt}
          called={lead.callCount > 0}
          resultLabel={lead.status !== "NEW" ? statusDisplay?.label : null}
          className="@[400px]:w-[44%] @[400px]:max-w-[230px] @[400px]:shrink-0"
        />
        </div>

        {/* Facts row: Assigned (exact · ago) / Calls / Last activity */}
        <dl className={FACTS} style={FACTS_BOX}>
          <div className="min-w-0">
            <dt className={FACT_LABEL}><FactIcon name="assigned" />Assigned</dt>
            <dd className={`${FACT_VALUE} tabular-nums`}>
              {lead.assignedAt ? (
                <>
                  <span className="whitespace-nowrap">{formatAssignedExact(lead.assignedAt)}</span>{" "}
                  <span className="whitespace-nowrap font-semibold" style={{ color: TEXT2 }}>· {formatAgo(nowMs - new Date(lead.assignedAt).getTime())}</span>
                </>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className={FACT_LABEL}><FactIcon name="calls" />Calls</dt>
            <dd className={`${FACT_VALUE} tabular-nums`}>{callsValue}</dd>
          </div>
          <div className="min-w-0">
            <dt className={FACT_LABEL}><FactIcon name="activity" />Last activity</dt>
            <dd className={`${FACT_VALUE} tabular-nums`}>{lastActivityValue}</dd>
          </div>
        </dl>

        {/* Owner — name, or reserved team / Unassigned + the team-reserve select (Admin only, hidden when readOnly). */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[12px] px-3 py-2" style={GLASS_BOX}>
          <span className={`${SIZE.factLabel} font-bold`} style={{ color: MUTED }}>Assigned to</span>
          {lead.ownerName ? (
            <span className="text-[13.5px] font-extrabold" style={{ color: INK }}>{lead.ownerName}</span>
          ) : lead.pendingTeamName ? (
            <span className={TAG} style={NEUTRAL_TAG}>
              {dot(DOT.gold)}
              Reserved for {lead.pendingTeamName}
            </span>
          ) : (
            <span className={TAG} style={TINT_TAG.callFirst}>Unassigned</span>
          )}
          {!lead.ownerName && !readOnly && (
            <select
              value={lead.pendingTeamId || ""}
              onChange={(e) => onReserveTeam(lead.id, e.target.value || null)}
              aria-label="Reserve for a team"
              className={FIELD}
              style={{ boxShadow: `inset 0 0 0 1px ${HAIRLINE}`, color: INK }}
            >
              <option value="">No team reserved</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Tags: neutral pill + dot; only Call first / recycle-soon tinted. Empty row collapses. */}
        <div className="flex flex-wrap items-center gap-1.5 min-w-0 [&:not(:has(>:not(:empty)))]:hidden">
          {recyclingNow && <span className={TAG} style={TINT_TAG.callFirst}>Call first</span>}
          {lead.leadType === "DATA" && (
            <span className={TAG} style={NEUTRAL_TAG}>
              {dot(DOT.slate)}
              Data
            </span>
          )}
          {/* Data has no board_stage funnel (stays 'LEADS' forever), hence Lead-only. */}
          {lead.leadType !== "DATA" && boardStageDisplay && (
            <span className={TAG} style={NEUTRAL_TAG}>
              {dot(look.accent)}
              {boardStageDisplay.label}
            </span>
          )}
          {lead.source === "Legacy" && (
            <span className={TAG} style={NEUTRAL_TAG}>
              {dot(DOT.gold)}
              Legacy
            </span>
          )}
          {lead.catcherName && (
            <span title={`Catcher: ${lead.catcherName}`} className={`${TAG} max-w-[200px]`} style={NEUTRAL_TAG}>
              {dot(DOT.slate)}
              <span className="truncate">Catcher: {lead.catcherName}</span>
            </span>
          )}
          {pauseAsTag && (
            <span className={TAG} style={NEUTRAL_TAG}>
              {dot(DOT.slate)}
              {pauseAsTag.label === "VISIT" ? "Visit pending verification" : `${pauseAsTag.label.replace(" UNTIL", "").charAt(0)}${pauseAsTag.label.replace(" UNTIL", "").slice(1).toLowerCase()} until ${pauseAsTag.value}`}
            </span>
          )}
          {/* Employee Leave/Holiday gap — never alongside isStale (it's gated on !isOwnerOnLeave). */}
          {showOnLeaveBadge && (
            <span className={TAG} style={NEUTRAL_TAG}>
              {dot(DOT.teal)}
              Timer paused — owner on leave
            </span>
          )}
          {/* Recycled (full detail) + Existing client (with its "N other leads" popover) — shared badges, neutral look. */}
          {(lead.recycleCount > 0 || lead.recycleReason) && (
            <span className={`inline-flex min-w-0 max-w-full ${NEUTRALIZE} [&>span]:h-[22px]! [&>span]:inline-flex! [&>span]:items-center! [&>span]:text-[11px]!`}>
              <RecycledBadge reason={lead.recycleReason} fromStage={lead.recycledFromStage} fromStatus={lead.recycledFromStatus} count={lead.recycleCount} fullDetail />
            </span>
          )}
          {lead.siblings && lead.siblings.length > 0 && (
            <span className={`inline-flex ${NEUTRALIZE} [&>span>button]:h-[22px]! [&>span>button]:text-[11px]!`}>
              <ExistingClientBadge siblings={lead.siblings} fullDetail />
            </span>
          )}
          {/* Step 8: weekly off / Admin pause. recycleCutoff is already null for paused, on-leave, personal and terminal leads. */}
          <span className="inline-flex empty:hidden [&>span]:inline-flex [&>span]:h-[22px] [&>span]:items-center [&>span]:text-[11px] [&>span]:bg-[#f3f6fa]! [&>span]:text-[#475569]! [&>span]:shadow-[inset_0_0_0_1px_#e8edf3]">
            <TimerPausedBadge size="sm" clockRunning={Boolean(recycleCutoff)} />
          </span>
        </div>

        {/* Dashed divider, then the action stub: View history, JUNK Reassign (Admin only), expand */}
        <div className="border-t border-dashed" style={{ borderColor: CHAMPAGNE.line }} aria-hidden="true" />
        <div className={DOCK}>
          <button type="button" onClick={() => setHistoryOpen(true)} style={callStyle(tone)} className={`${CALL_BUTTON} ${SIZE.button} @max-[20rem]:basis-full`}>
            <History size={16} strokeWidth={2} />
            View history
          </button>
          {lead.status === "JUNK" && !readOnly && onUnjunkReassign && !reassignOpen && (
            <button
              type="button"
              onClick={() => setReassignOpen(true)}
              className="shrink-0 h-11 px-3.5 rounded-[13px] text-[13px] font-extrabold @max-[20rem]:flex-1 transition-[filter] hover:brightness-[.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-slate-400"
              style={{ background: "#e9f8f5", color: "#0f766e" }}
            >
              Reassign
            </button>
          )}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "Hide details" : "Show details"}
            aria-expanded={expanded}
            title={expanded ? "Hide details" : "Show details"}
            className={ICON_BUTTON}
            style={expanded ? BUTTON_BG.chevronOpen : BUTTON_BG.chevronClosed}
          >
            <ChevronDown size={18} strokeWidth={2} className={`transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} />
          </button>
        </div>

        {reassignOpen && (
          <div className="space-y-2 rounded-[12px] p-3" style={GLASS_BOX}>
            <p className="text-[12.5px] font-bold" style={{ color: INK }}>Reassign this junk lead to:</p>
            <select value={reassignEmployeeId} onChange={(e) => setReassignEmployeeId(e.target.value)} aria-label="Employee" className={FIELD} style={{ boxShadow: `inset 0 0 0 1px ${HAIRLINE}`, color: INK }}>
              <option value="">Select an employee</option>
              {employees
                .filter((e) => e.is_active && e.id !== lead.currentOwnerId)
                .map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
            </select>
            <textarea
              value={reassignReason}
              onChange={(e) => setReassignReason(e.target.value)}
              placeholder="Reason (required)"
              aria-label="Reason"
              rows={2}
              className="w-full rounded-[12px] bg-white px-3 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
              style={{ boxShadow: `inset 0 0 0 1px ${HAIRLINE}`, color: INK }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={submitReassign}
                disabled={reassignSubmitting || !reassignEmployeeId || !reassignReason.trim()}
                className="h-11 px-4 rounded-[12px] text-white text-[13px] font-extrabold disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)" }}
              >
                {reassignSubmitting ? "Reassigning..." : "Reassign"}
              </button>
              <button
                onClick={() => {
                  setReassignOpen(false);
                  setReassignEmployeeId("");
                  setReassignReason("");
                }}
                className="h-11 px-3 text-[13px] font-semibold"
                style={{ color: TEXT2 }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="px-3.5 empty:hidden">
        <ExpandSection open={expanded}>
          <div className="mb-3.5 rounded-[14px] px-3 pb-3" style={{ background: "rgba(255,255,255,.8)", boxShadow: `inset 0 0 0 1px ${HAIRLINE}` }}>
            <LeadCardMore
              leadId={lead.id}
              status={lead.status}
              boardStage={lead.boardStage}
              accent={look.accent}
              times={[
                ...(lead.assignedAt ? [{ label: "Assigned", value: formatExactTime(lead.assignedAt) }] : []),
                ...(lead.lastActivityAt ? [{ label: "Last activity", value: formatExactTime(lead.lastActivityAt) }] : []),
                ...(recycleCutoff ? [{ label: "Recycles at", value: formatExactTime(recycleCutoff.cutoffAt.toISOString()) }] : [])
              ]}
            />
          </div>
        </ExpandSection>
      </div>

      <AnimatePresence>
        {historyOpen && (
          <AdminLeadHistoryModal
            key="history-modal"
            leadId={lead.id}
            leadName={lead.name}
            leadType={lead.leadType}
            leadStatus={lead.status}
            leadBoardStage={lead.boardStage}
            catcherName={lead.catcherName ?? null}
            onClose={() => setHistoryOpen(false)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default memo(AdminLeadCard);
