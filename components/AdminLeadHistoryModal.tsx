"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { X, User } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { ENDED_REASON_TEXT } from "@/lib/endedReasonDisplay";

interface AdminLeadHistoryModalProps {
  leadId: string;
  leadName: string;
  onClose: () => void;
}

interface HistoryEntry {
  id: string;
  employee_id: string;
  assigned_at: string;
  is_active: boolean;
  ended_reason: string | null;
  outcome: string | null;
  employees: { name: string } | null;
}

// Admin-only, full audit trail — queries lead_history DIRECTLY (never
// employee_sla_breach_history, which is deliberately scoped/masked
// for the employee-facing SLA Breach tab and wrong for this use
// case). Admin already has full RLS access via lead_history_admin_all
// and leads_admin_all, so this feature needed zero new backend/
// security work — purely additive UI.
//
// Blue-cyan themed (not gold) — matches AdminLeadCard and the rest
// of the Admin app shell, per Section 2.7's Admin/Employee visual
// split. Reuses the same slide-in drawer motion pattern as
// LeadDetailModal/TeamMemberDetailModal, just restyled.
//
// Portaled to document.body: AdminLeadCard (the caller) is itself an
// animated motion.div, and Framer Motion implements its y-animation
// via a CSS transform. A transformed ancestor becomes the containing
// block for any `position: fixed` descendant, so without the portal
// this modal's "fixed" backdrop/drawer would resolve against that
// one card's box instead of the viewport — different size/position
// depending on which card in the grid triggered it. Portaling out to
// document.body sidesteps that entirely while keeping open/close
// state self-contained in AdminLeadCard (see its own comment).
// AnimatePresence for the exit animation lives in AdminLeadCard, at
// the point where the {historyOpen && ...} conditional actually is —
// portals change DOM output, not React parent/unmount timing, so
// AnimatePresence still needs to sit there to see the removal coming.
export default function AdminLeadHistoryModal({ leadId, leadName, onClose }: AdminLeadHistoryModalProps) {

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadHistory();
  }, [leadId]);

  async function loadHistory() {
    setLoading(true);

    const { data, error } = await supabase
      .from("lead_history")
      .select("id, employee_id, assigned_at, is_active, ended_reason, outcome, employees(name)")
      .eq("lead_id", leadId)
      .order("assigned_at", { ascending: true });

    if (!error && data) {
      setHistory(data as any);
    }

    setLoading(false);
  }

  return createPortal(
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.45 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black z-40"
      />

      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 120, damping: 18 }}
        className="fixed top-0 right-0 h-full w-full sm:w-[420px] z-50 bg-white shadow-2xl overflow-y-auto"
      >
        <div className="relative pt-6 pb-6 px-6 bg-gradient-to-br from-[#0f172a] via-[#1d4ed8] to-[#06b6d4] text-white overflow-hidden">
          <div className="absolute top-[-40px] right-[-40px] w-[120px] h-[120px] rounded-full bg-white/10 blur-3xl pointer-events-none" />

          <button
            onClick={onClose}
            className="absolute top-5 right-5 h-8 w-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition"
          >
            <X size={16} />
          </button>

          <p className="relative text-[10px] font-semibold tracking-[0.2em] text-cyan-200 uppercase mb-2">
            Lead History
          </p>
          <h2 className="relative text-xl font-bold pr-10">{leadName}</h2>
          <p className="relative text-sm text-white/70 mt-1">
            {history.length} assignment{history.length === 1 ? "" : "s"}
          </p>
        </div>

        <div className="px-6 py-6">

          {loading ? (
            <p className="text-sm text-slate-400">Loading...</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-slate-400">No history found.</p>
          ) : (
            <div>
              {history.map((entry, index) => (
                <div key={entry.id} className="relative pl-8 pb-6 last:pb-0">

                  {index < history.length - 1 && (
                    <div className="absolute left-[9px] top-6 bottom-0 w-px bg-slate-200" />
                  )}

                  <div
                    className={`absolute left-0 top-0.5 h-5 w-5 rounded-full flex items-center justify-center ${
                      entry.is_active
                        ? "bg-gradient-to-br from-cyan-500 to-blue-600"
                        : "bg-slate-300"
                    }`}
                  >
                    <User size={11} className="text-white" />
                  </div>

                  <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-bold text-slate-800">
                        {entry.employees?.name || "Unknown employee"}
                      </p>
                      {entry.is_active && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 shrink-0">
                          Current
                        </span>
                      )}
                    </div>

                    <p className="text-[11px] text-slate-400 mt-1">
                      Assigned{" "}
                      {new Date(entry.assigned_at).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit"
                      })}
                    </p>

                    {entry.outcome && (
                      <p className="text-xs text-slate-600 mt-2">
                        Outcome logged: <span className="font-semibold">{entry.outcome}</span>
                      </p>
                    )}

                    {!entry.is_active && entry.ended_reason && (
                      <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                        {ENDED_REASON_TEXT[entry.ended_reason] || entry.ended_reason}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

        </div>
      </motion.div>
    </>,
    document.body
  );
}
