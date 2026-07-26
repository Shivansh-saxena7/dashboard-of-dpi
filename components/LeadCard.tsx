"use client";

import { motion } from "framer-motion";
import { Phone, Timer } from "lucide-react";
import { calculateSLAStatus } from "@/lib/calculateSLAStatus";
import { LEAD_STATUS_DISPLAY } from "@/lib/leadStatusDisplay";
import { LEAD_PRIORITY_DISPLAY, LeadPriority } from "@/lib/leadPriorityDisplay";
import { LeadStatus } from "@/lib/getValidNextLeadStatuses";

interface LeadCardLead {
  id: string;
  name: string;
  mobile: string;
  project: string | null;
  status: LeadStatus;
  priority: LeadPriority;
  sla_deadline: string | null;
  recycle_count: number;
  call_count: number;
  outcome_at: string | null;
}

interface LeadCardProps {
  lead: LeadCardLead;
  now: Date;
  onOpen: () => void;
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
export default function LeadCard({ lead, now, onOpen }: LeadCardProps) {

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

  let slaBadge: { label: string; className: string } | null = null;

  if (slaStatus === "WITHIN_SLA" && lead.sla_deadline) {
    const msRemaining = new Date(lead.sla_deadline).getTime() - now.getTime();
    slaBadge = {
      label: formatCountdown(msRemaining),
      className: "bg-cyan-50 text-cyan-700"
    };
  } else if (slaStatus === "SLA_BREACHED") {
    slaBadge = { label: "Overdue", className: "bg-red-50 text-red-600" };
  } else if (slaStatus === "COOLDOWN") {
    slaBadge = { label: "Cooling down", className: "bg-slate-100 text-slate-500" };
  } else if (slaStatus === "RECYCLE_READY" || slaStatus === "JUNK_ELIGIBLE") {
    slaBadge = { label: "Awaiting follow-up", className: "bg-amber-50 text-amber-600" };
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      onClick={onOpen}
      className="rounded-[20px] bg-white border border-slate-100 shadow-md p-5 cursor-pointer"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-bold text-slate-800 truncate">{lead.name}</p>
          {lead.project && (
            <p className="text-xs text-slate-500 mt-0.5 truncate">{lead.project}</p>
          )}
        </div>

        <span className={`shrink-0 text-[10px] font-semibold px-2 py-1 rounded-full ${priorityDisplay.badgeClassName}`}>
          {priorityDisplay.label}
        </span>
      </div>

      <div className="flex items-center flex-wrap gap-2 mt-3">
        <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${statusDisplay.badgeClassName}`}>
          {statusDisplay.label}
        </span>

        {slaBadge && (
          <span className={`flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full ${slaBadge.className}`}>
            <Timer size={11} />
            {slaBadge.label}
          </span>
        )}

        {lead.call_count > 0 && (
          <span className="text-[11px] text-slate-400">
            Called {lead.call_count}x
          </span>
        )}
      </div>

      <a
        href={`tel:${lead.mobile}`}
        onClick={(e) => e.stopPropagation()}
        className="mt-4 flex items-center justify-center gap-2 h-10 rounded-xl bg-gradient-to-r from-yellow-400 to-amber-500 text-slate-900 text-sm font-semibold shadow-[0_6px_16px_rgba(217,119,6,0.3)]"
      >
        <Phone size={15} />
        Call {lead.mobile}
      </a>
    </motion.div>
  );
}
