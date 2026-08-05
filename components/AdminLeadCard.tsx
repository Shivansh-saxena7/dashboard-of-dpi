"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { History } from "lucide-react";
import { LEAD_STATUS_DISPLAY } from "@/lib/leadStatusDisplay";
import { LEAD_PRIORITY_DISPLAY, LeadPriority } from "@/lib/leadPriorityDisplay";
import { LeadStatus } from "@/lib/getValidNextLeadStatuses";
import { BOARD_STAGES, BoardStage } from "@/lib/leadBoardStageDisplay";
import AdminLeadHistoryModal from "./AdminLeadHistoryModal";

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
  assignedAt: string | null;
  pendingTeamId: string | null;
  pendingTeamName: string | null;
  leadType: string;
  callCount: number;
}

interface AdminLeadCardProps {
  lead: AdminLeadCardLead;
  teams: { id: string; name: string }[];
  onReserveTeam: (leadId: string, teamId: string | null) => void;
  index?: number;
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
export default function AdminLeadCard({ lead, teams, onReserveTeam, index = 0 }: AdminLeadCardProps) {

  const [historyOpen, setHistoryOpen] = useState(false);

  const statusDisplay = LEAD_STATUS_DISPLAY[lead.status];
  const priorityDisplay = LEAD_PRIORITY_DISPLAY[lead.priority];
  const boardStageDisplay = BOARD_STAGES.find((b) => b.stage === lead.boardStage);

  const initial = lead.name?.charAt(0)?.toUpperCase() || "?";

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

      <button
        onClick={() => setHistoryOpen(true)}
        className="flex items-center gap-1.5 mt-3 text-[11px] font-bold text-blue-700 hover:text-blue-900 transition"
      >
        <History size={12} />
        View History
      </button>

      <AnimatePresence>
        {historyOpen && (
          <AdminLeadHistoryModal
            key="history-modal"
            leadId={lead.id}
            leadName={lead.name}
            leadType={lead.leadType}
            onClose={() => setHistoryOpen(false)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
