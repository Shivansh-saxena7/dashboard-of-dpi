"use client";

import { motion } from "framer-motion";
import { Phone, MessageCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { LEAD_STATUS_DISPLAY } from "@/lib/leadStatusDisplay";
import { LeadStatus } from "@/lib/getValidNextLeadStatuses";
import { MAX_DATA_ATTEMPTS } from "@/lib/calculateSLAStatus";
import { buildWhatsAppLink } from "@/lib/buildWhatsAppLink";

interface DataCardLead {
  id: string;
  leadHistoryId: string;
  name: string;
  mobile: string;
  status: LeadStatus;
  call_count: number;
}

interface DataCardProps {
  lead: DataCardLead;
  onOpen: () => void;
  index?: number;
}

// Deliberately NOT a reuse of LeadCard — no SLA countdown (Data has
// none), no priority badge (Data is always Cold — showing a badge
// that's never anything else is just noise), no board-stage anything.
// Attempt-count is what actually matters here, the Data equivalent of
// LeadCard's SLA countdown — auto-recycle triggers at
// MAX_DATA_ATTEMPTS while status is still NEW/NOT_CONNECTED/
// SWITCHED_OFF (see lib/calculateSLAStatus.ts), so that's what gets
// the prominent warning treatment once it's close.
export default function DataCard({ lead, onOpen, index = 0 }: DataCardProps) {

  const statusDisplay = LEAD_STATUS_DISPLAY[lead.status];
  const initial = lead.name?.charAt(0)?.toUpperCase() || "?";

  const stillAtRisk = lead.status === "NEW" || lead.status === "NOT_CONNECTED" || lead.status === "SWITCHED_OFF";
  const attemptsLeft = Math.max(MAX_DATA_ATTEMPTS - lead.call_count, 0);
  const showAttemptWarning = stillAtRisk && attemptsLeft <= 1;

  // Same fire-and-forget pattern LeadCard uses — logs first-call/
  // first-whatsapp timestamps via the shared RPCs, never blocks the
  // tel:/wa.me link itself from opening.
  function handleCallClick(e: React.MouseEvent) {
    e.stopPropagation();
    supabase
      .rpc("log_call_click_atomic", { p_lead_history_id: lead.leadHistoryId })
      .then(({ error }) => {
        if (error) console.error("log_call_click_atomic failed:", error.message);
      });
  }

  function handleWhatsAppClick(e: React.MouseEvent) {
    e.stopPropagation();
    supabase
      .rpc("log_whatsapp_click_atomic", { p_lead_history_id: lead.leadHistoryId })
      .then(({ error }) => {
        if (error) console.error("log_whatsapp_click_atomic failed:", error.message);
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
      <div className="flex items-center gap-3">
        <div className="shrink-0 h-11 w-11 rounded-2xl bg-gradient-to-br from-yellow-400 to-amber-500 shadow-[0_4px_12px_rgba(217,119,6,0.35)] flex items-center justify-center text-slate-900 font-bold text-sm">
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold text-slate-800 truncate">{lead.name}</p>
          <p className="text-xs text-slate-500 mt-0.5">{lead.mobile}</p>
        </div>
      </div>

      <div className="flex items-center flex-wrap gap-1.5 mt-3.5">
        <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${statusDisplay.badgeClassName}`}>
          {statusDisplay.label}
        </span>

        {lead.call_count > 0 && (
          stillAtRisk ? (
            <span
              className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${
                showAttemptWarning ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-500"
              }`}
            >
              Called {lead.call_count}x · {attemptsLeft} attempt{attemptsLeft === 1 ? "" : "s"} left
            </span>
          ) : (
            <span className="text-[11px] font-medium text-slate-400 px-1">
              Called {lead.call_count}x
            </span>
          )
        )}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <motion.a
          href={`tel:${lead.mobile}`}
          onClick={handleCallClick}
          whileTap={{ scale: 0.98 }}
          className="flex-1 flex items-center justify-center gap-2 h-11 rounded-xl bg-gradient-to-r from-yellow-400 to-amber-500 text-slate-900 text-sm font-bold shadow-[0_6px_16px_rgba(217,119,6,0.3)] active:shadow-[0_2px_8px_rgba(217,119,6,0.3)]"
        >
          <Phone size={15} />
          Call
        </motion.a>

        <motion.a
          href={buildWhatsAppLink(lead.mobile)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleWhatsAppClick}
          whileTap={{ scale: 0.98 }}
          className="flex-1 flex items-center justify-center gap-2 h-11 rounded-xl bg-emerald-500 text-white text-sm font-bold shadow-[0_6px_16px_rgba(16,185,129,0.3)] active:shadow-[0_2px_8px_rgba(16,185,129,0.3)]"
        >
          <MessageCircle size={15} />
          WhatsApp
        </motion.a>
      </div>
    </motion.div>
  );
}
