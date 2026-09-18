"use client";

import { memo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, History } from "lucide-react";
import { LEAD_STATUS_DISPLAY } from "@/lib/leadStatusDisplay";
import { LEAD_PRIORITY_DISPLAY, LeadPriority } from "@/lib/leadPriorityDisplay";
import { LeadStatus } from "@/lib/getValidNextLeadStatuses";
import { BOARD_STAGES, BoardStage } from "@/lib/leadBoardStageDisplay";
import { FOLLOWUP_INACTIVITY_WARNING_DAYS, FOLLOWUP_INACTIVITY_RECYCLE_DAYS, getRecycleCutoff, RecycleCutoffReason } from "@/lib/calculateSLAStatus";
import { isLeadTerminal } from "@/lib/isLeadTerminal";
import AdminLeadHistoryModal from "./AdminLeadHistoryModal";

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

  const [historyOpen, setHistoryOpen] = useState(false);
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
  const daysSinceActivity = lead.lastActivityAt
    ? (Date.now() - new Date(lead.lastActivityAt).getTime()) / (1000 * 60 * 60 * 24)
    : null;
  const isBeyondLeadsStage = lead.leadType !== "DATA" && lead.boardStage !== "LEADS";
  // Employee Leave/Holiday gap (2026-08-23, Point A) — mirrors
  // calculateSLAStatus.ts's own isOwnerOnLeave precedence exactly: on
  // leave overrides the inactivity evaluation entirely, not just caps
  // the badge. Without the !isOwnerOnLeave guard here too, this card
  // would keep showing "Needs follow-up"/"Going stale" even though
  // the backend has already stopped counting toward recycling for
  // it — actively misleading, not just a missing badge.
  const isStale = !isTerminal && !isPaused && !isOwnerOnLeave && isBeyondLeadsStage && daysSinceActivity !== null && daysSinceActivity >= FOLLOWUP_INACTIVITY_WARNING_DAYS;
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
    !isTerminal && !isPaused && !isOwnerOnLeave
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
          lead.outcomeAt ?? null
        )
      : null;
  const recycleCutoffMsRemaining = recycleCutoff ? recycleCutoff.cutoffAt.getTime() - Date.now() : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index, 10) * 0.04 }}
      whileHover={{ y: -3 }}
      className="relative overflow-hidden rounded-[20px] bg-white border border-slate-100 shadow-[0_4px_20px_rgba(15,23,42,0.06)] hover:shadow-[0_10px_28px_rgba(29,78,216,0.12)] transition-shadow p-5"
    >
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-blue-600 via-cyan-400 to-blue-600" />

      <div className="flex items-start gap-3">
        {selectable && !isTerminal && !readOnly && (
          // Custom button, not a native <input type="checkbox"> — the
          // native element's checkmark glyph is drawn by the browser's
          // own widget rendering (combined with accent-color), which
          // turned out inconsistent enough to be invisible in real
          // testing despite the element being fully functional. This
          // renders the check mark ourselves (a lucide icon), so its
          // visibility is never dependent on browser/OS checkbox theming.
          <button
            type="button"
            role="checkbox"
            aria-checked={selected}
            aria-label={selected ? "Deselect lead" : "Select lead"}
            onClick={() => onToggleSelect?.(lead.id)}
            // No transition-colors here (2026-09-18) — Tailwind's
            // transition utilities default to a 150ms eased fade, which
            // is exactly the kind of small-but-visible gap between
            // click and checkmark the "instant" requirement rules out.
            // The color/icon flip below is a plain synchronous class
            // swap, so it paints in the very next frame.
            className={`mt-1 h-5 w-5 shrink-0 rounded border-2 flex items-center justify-center ${
              selected ? "bg-blue-600 border-blue-600" : "bg-white border-slate-400"
            }`}
          >
            {selected && <Check size={13} strokeWidth={3} className="text-white" />}
          </button>
        )}

        <div className="shrink-0 h-11 w-11 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 shadow-[0_4px_12px_rgba(37,99,235,0.35)] flex items-center justify-center text-white font-bold text-sm">
          {initial}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[15px] font-bold text-slate-800 truncate">{lead.name}</p>
              <p className="text-xs text-slate-500 mt-0.5">{lead.mobile}</p>
              {lead.project && (
                <p className="text-xs text-slate-500 truncate">{lead.project}</p>
              )}
            </div>

            <div className="shrink-0 flex flex-col items-end gap-1">
              <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${priorityDisplay.badgeClassName}`}>
                {priorityDisplay.label}
              </span>
              {lead.source && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600">
                  {lead.source}
                </span>
              )}
              {lead.catcherName && (
                <span
                  className="max-w-[140px] truncate text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700"
                  title={`Catcher: ${lead.catcherName}`}
                >
                  🎣 Catcher: {lead.catcherName}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center flex-wrap gap-1.5 mt-3.5">
        {lead.leadType === "DATA" && (
          <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-violet-50 text-violet-700">
            Data
          </span>
        )}

        <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${statusDisplay.badgeClassName}`}>
          {statusDisplay.label}
        </span>

        {/* Data has no board_stage/Visit/Booking funnel at all (Phase
            4 — board_stage stays 'LEADS' forever on a Data row, purely
            an unused artifact of the column's default) — showing this
            badge next to "Data" implied a workflow that doesn't exist
            for it, hence Lead-only. */}
        {lead.leadType !== "DATA" && boardStageDisplay && (
          <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-blue-50 text-blue-700">
            {boardStageDisplay.emoji} {boardStageDisplay.label}
          </span>
        )}

        {lead.callCount > 0 && (
          <span className="text-[11px] font-medium text-slate-400 px-1">
            Called {lead.callCount}x
          </span>
        )}

        {isPaused && (
          <span
            className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${
              lead.pauseReason === "VISIT_LOCK"
                ? "bg-emerald-50 text-emerald-700"
                : lead.pauseReason === "VISIT_PENDING_VERIFICATION"
                ? "bg-amber-50 text-amber-700"
                : "bg-indigo-50 text-indigo-700"
            }`}
          >
            {lead.pauseReason === "VISIT_LOCK"
              ? "🔒 Locked"
              : lead.pauseReason === "VISIT_PENDING_VERIFICATION"
              ? "⏳ Pending verification"
              : "😴 Snoozed"}
            {lead.pauseReason !== "VISIT_PENDING_VERIFICATION" && (
              <> until {new Date(lead.pausedUntil!).toLocaleDateString([], { month: "short", day: "numeric" })}</>
            )}
          </span>
        )}

        {isStale && (
          <span
            title={recycleCutoff ? `Exact time: ${recycleCutoff.cutoffAt.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : undefined}
            className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${
              isGoingStale ? "bg-red-100 text-red-700 animate-pulse" : "bg-amber-50 text-amber-600"
            }`}
          >
            {isGoingStale
              ? `⚠️ Recycling now — ${recycleCutoff ? RECYCLE_REASON_LABEL[recycleCutoff.reason] : "Going stale"}`
              : recycleCutoff
              ? `⏳ ${formatDaysHoursLeft(recycleCutoffMsRemaining)} — ${RECYCLE_REASON_LABEL[recycleCutoff.reason]}`
              : "⏳ Needs follow-up"}
          </span>
        )}

        {/* Stale/Recycle-Warning filter (2026-09-16) — the Leads-stage
            NOT_CONNECTED/SWITCHED_OFF/NOT_INTERESTED cooldown case
            isStale above never covers (it's gated on isBeyondLeadsStage
            only). Independent condition, own badge slot. */}
        {!isStale && recycleCutoff && (
          <span
            title={`Exact time: ${recycleCutoff.cutoffAt.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`}
            className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${
              recycleCutoffMsRemaining <= 0 ? "bg-red-100 text-red-700 animate-pulse" : "bg-slate-100 text-slate-500"
            }`}
          >
            {recycleCutoffMsRemaining <= 0
              ? `⚠️ Recycling now — ${RECYCLE_REASON_LABEL[recycleCutoff.reason]}`
              : `⏳ ${formatDaysHoursLeft(recycleCutoffMsRemaining)} — ${RECYCLE_REASON_LABEL[recycleCutoff.reason]}`}
          </span>
        )}

        {/* Employee Leave/Holiday gap (2026-08-23, Point A) — shown
            instead of (never alongside) isStale/isGoingStale above,
            since showOnLeaveBadge and isStale can't both be true
            (isStale is gated on !isOwnerOnLeave). Compatible with
            isPaused though — a Snooze/Visit-lock pause and an owner
            being on leave are independent, genuinely-different reasons
            a lead isn't moving, so both can legitimately show together. */}
        {showOnLeaveBadge && (
          <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-teal-50 text-teal-700">
            🌴 Timer Paused — Owner on Leave
          </span>
        )}

        {lead.recycleCount > 0 && (
          <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-orange-50 text-orange-600">
            Recycled {lead.recycleCount}x
          </span>
        )}
      </div>

      <div className="flex items-center justify-between mt-3.5 pt-3.5 border-t border-slate-100">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-slate-400 font-bold">Owner</p>
          {lead.ownerName ? (
            <p className="text-sm font-semibold text-slate-700">{lead.ownerName}</p>
          ) : (
            <div className="mt-0.5 space-y-1">
              {lead.pendingTeamName ? (
                <span className="inline-block text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
                  Reserved for {lead.pendingTeamName}
                </span>
              ) : (
                <span className="inline-block text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600">
                  Unassigned
                </span>
              )}

              {!readOnly && (
                <select
                  value={lead.pendingTeamId || ""}
                  onChange={(e) => onReserveTeam(lead.id, e.target.value || null)}
                  className="block h-7 rounded-md bg-slate-50 border border-slate-200 px-1.5 text-[10px] font-semibold text-slate-600 outline-none"
                >
                  <option value="">No team reserved</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>

        {lead.assignedAt && (
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wide text-slate-400 font-bold">Assigned</p>
            <p className="text-xs text-slate-500">
              {new Date(lead.assignedAt).toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit"
              })}
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-4 mt-3">
        <button
          onClick={() => setHistoryOpen(true)}
          className="flex items-center gap-1.5 text-[11px] font-bold text-blue-700 hover:text-blue-900 transition"
        >
          <History size={12} />
          View History
        </button>

        {lead.status === "JUNK" && !readOnly && onUnjunkReassign && !reassignOpen && (
          <button
            onClick={() => setReassignOpen(true)}
            className="text-[11px] font-bold text-emerald-700 hover:text-emerald-900 transition"
          >
            🔁 Reassign
          </button>
        )}
      </div>

      {reassignOpen && (
        <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
          <p className="text-[11px] text-slate-500">Recover this JUNK lead and hand it to:</p>
          <div className="flex items-center gap-2">
            <select
              value={reassignEmployeeId}
              onChange={(e) => setReassignEmployeeId(e.target.value)}
              className="flex-1 h-10 rounded-lg bg-slate-50 border border-slate-200 px-2 text-xs outline-none"
            >
              <option value="">Select employee...</option>
              {employees
                .filter((e) => e.is_active && e.id !== lead.currentOwnerId)
                .map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
            </select>
          </div>
          <textarea
            value={reassignReason}
            onChange={(e) => setReassignReason(e.target.value)}
            placeholder="Reason (mandatory)"
            rows={2}
            className="w-full rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-emerald-200"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={submitReassign}
              disabled={reassignSubmitting || !reassignEmployeeId || !reassignReason.trim()}
              className="h-10 px-3 rounded-lg bg-emerald-600 text-white text-[11px] font-bold disabled:opacity-50"
            >
              {reassignSubmitting ? "..." : "Reassign"}
            </button>
            <button
              onClick={() => {
                setReassignOpen(false);
                setReassignEmployeeId("");
                setReassignReason("");
              }}
              className="h-10 px-3 text-[11px] text-slate-400"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

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
