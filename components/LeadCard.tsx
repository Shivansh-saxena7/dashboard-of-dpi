"use client";

import { motion } from "framer-motion";
import { Phone, Timer } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { calculateSLAStatus } from "@/lib/calculateSLAStatus";
import { LEAD_STATUS_DISPLAY } from "@/lib/leadStatusDisplay";
import { LEAD_PRIORITY_DISPLAY, LeadPriority } from "@/lib/leadPriorityDisplay";
import { LeadStatus } from "@/lib/getValidNextLeadStatuses";

interface LeadCardLead {
  id: string;
  leadHistoryId: string;
  name: string;
  mobile: string;
  project: string | null;
  source: string | null;
  status: LeadStatus;
  priority: LeadPriority;
  sla_deadline: string | null;
  recycle_count: number;
  call_count: number;
  outcome_at: string | null;
  assigned_at: string | null;
}

interface LeadCardProps {
  lead: LeadCardLead;
  now: Date;
  onOpen: () => void;
  index?: number;
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
export default function LeadCard({ lead, now, onOpen, index = 0 }: LeadCardProps) {

  const slaStatus = calculateSLAStatus(
    {
      status: lead.status,
      sla_deadline: lead.sla_deadline,
      recycle_count: lead.recycle_count
    },
    lead.outcome_at,
    // NOT_INTERESTED repeat-count isn't tracked at list-view
    // granularity yet — it only affects the JUNK_ELIGIBLE case, which
    // Phase 4's recycling engine is the real consumer of.
    0
  );

  const statusDisplay = LEAD_STATUS_DISPLAY[lead.status];
  const priorityDisplay = LEAD_PRIORITY_DISPLAY[lead.priority];

  let slaBadge: { label: string; className: string; pulse?: boolean } | null = null;

  if (slaStatus === "WITHIN_SLA" && lead.sla_deadline) {
    const msRemaining = new Date(lead.sla_deadline).getTime() - now.getTime();
    slaBadge = {
      label: formatCountdown(msRemaining),
      className: "bg-cyan-50 text-cyan-700"
    };
  } else if (slaStatus === "SLA_BREACHED") {
    slaBadge = { label: "Overdue", className: "bg-red-100 text-red-700", pulse: true };
  } else if (slaStatus === "COOLDOWN") {
    slaBadge = { label: "Cooling down", className: "bg-slate-100 text-slate-500" };
  } else if (slaStatus === "RECYCLE_READY" || slaStatus === "JUNK_ELIGIBLE") {
    slaBadge = { label: "Awaiting follow-up", className: "bg-amber-50 text-amber-600" };
  }

  const initial = lead.name?.charAt(0)?.toUpperCase() || "?";

  // Fire-and-forget: logs the first-ever call-click timestamp via
  // log_call_click_atomic (no-ops after the first click, see the
  // RPC's own coalesce). Deliberately not awaited — the tel: link
  // must open immediately, this is a background signal for Admin
  // response-time reporting, not something that should ever block or
  // interrupt the actual call.
  function handleCallClick(e: React.MouseEvent) {
    e.stopPropagation();
    supabase
      .rpc("log_call_click_atomic", { p_lead_history_id: lead.leadHistoryId })
      .then(({ error }) => {
        if (error) console.error("log_call_click_atomic failed:", error.message);
      });
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: Math.min(index, 8) * 0.05 }}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.99 }}
      onClick={onOpen}
      className="rounded-[22px] bg-white border border-slate-100 shadow-[0_4px_20px_rgba(15,23,42,0.06)] hover:shadow-[0_10px_30px_rgba(15,23,42,0.1)] transition-shadow p-4 sm:p-5 cursor-pointer"
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 h-11 w-11 rounded-2xl bg-gradient-to-br from-yellow-400 to-amber-500 shadow-[0_4px_12px_rgba(217,119,6,0.35)] flex items-center justify-center text-slate-900 font-bold text-sm">
          {initial}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[15px] font-bold text-slate-800 truncate">{lead.name}</p>
              {lead.project && (
                <p className="text-xs text-slate-500 mt-0.5 truncate">{lead.project}</p>
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

        {slaBadge && (
          <span
            className={`flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full ${slaBadge.className} ${
              slaBadge.pulse ? "animate-pulse" : ""
            }`}
          >
            <Timer size={11} />
            {slaBadge.label}
          </span>
        )}

        {lead.call_count > 0 && (
          <span className="text-[11px] font-medium text-slate-400 px-1">
            Called {lead.call_count}x
          </span>
        )}
      </div>

      {lead.assigned_at && (
        <p className="text-[11px] text-slate-400 mt-2.5">
          Assigned{" "}
          {new Date(lead.assigned_at).toLocaleString([], {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit"
          })}
        </p>
      )}

      <motion.a
        href={`tel:${lead.mobile}`}
        onClick={handleCallClick}
        whileTap={{ scale: 0.98 }}
        className="mt-4 flex items-center justify-center gap-2 h-11 rounded-xl bg-gradient-to-r from-yellow-400 to-amber-500 text-slate-900 text-sm font-bold shadow-[0_6px_16px_rgba(217,119,6,0.3)] active:shadow-[0_2px_8px_rgba(217,119,6,0.3)]"
      >
        <Phone size={15} />
        Call {lead.mobile}
      </motion.a>
    </motion.div>
  );
}
