"use client";

import { motion } from "framer-motion";
import { LEAD_STATUS_DISPLAY } from "@/lib/leadStatusDisplay";
import { LEAD_PRIORITY_DISPLAY, LeadPriority } from "@/lib/leadPriorityDisplay";
import { LeadStatus } from "@/lib/getValidNextLeadStatuses";
import { BOARD_STAGES, BoardStage } from "@/lib/leadBoardStageDisplay";

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
}

interface AdminLeadCardProps {
  lead: AdminLeadCardLead;
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
// primary CTAs. This card has no CTAs at all.
export default function AdminLeadCard({ lead, index = 0 }: AdminLeadCardProps) {

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
        <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${statusDisplay.badgeClassName}`}>
          {statusDisplay.label}
        </span>

        {boardStageDisplay && (
          <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-blue-50 text-blue-700">
            {boardStageDisplay.emoji} {boardStageDisplay.label}
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
            <span className="inline-block mt-0.5 text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600">
              Unassigned
            </span>
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
    </motion.div>
  );
}
