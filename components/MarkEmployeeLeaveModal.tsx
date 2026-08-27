"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";
import { X } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface MarkEmployeeLeaveModalProps {
  employees: { id: string; name: string; is_active: boolean }[];
  onClose: () => void;
  onMarked: () => void;
}

// Admin-only (mark_employee_leave_atomic gates on role server-side —
// an employee can never self-declare leave to protect their own
// leads). Same small-modal shape as ManualBookingEntryModal — portal,
// backdrop, one Save action.
//
// End Date is deliberately optional (Point C, 2026-08-23) — leaving it
// blank marks an OPEN-ENDED leave (end_date NULL), treated as
// currently-on-leave until Admin comes back and sets a real date or
// uses "Mark Returned Today" (Piece 5). The RPC's own overlap-guard
// blocks a second active/open leave period for someone who already
// has one — surfaced here as a plain error toast, not pre-validated
// client-side, since only the RPC actually knows what's currently
// active.
export default function MarkEmployeeLeaveModal({ employees, onClose, onMarked }: MarkEmployeeLeaveModalProps) {

  const [employeeId, setEmployeeId] = useState("");
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!employeeId || !startDate || submitting) {
      toast.error("Employee and Start Date are required.");
      return;
    }

    if (endDate && endDate < startDate) {
      toast.error("End Date cannot be before Start Date.");
      return;
    }

    setSubmitting(true);

    try {
      const { error } = await supabase.rpc("mark_employee_leave_atomic", {
        p_employee_id: employeeId,
        p_start_date: startDate,
        p_end_date: endDate || null,
        p_reason: reason.trim() || null
      });

      if (error) {
        toast.error(error.message || "Could not mark this leave period.");
        return;
      }

      toast.success("Leave marked.");
      onMarked();
      onClose();
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  const modal = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div onClick={onClose} className="absolute inset-0 bg-black/40" />

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="relative w-full max-w-md bg-white rounded-[24px] shadow-2xl p-6 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-800">🌴 Mark Employee On Leave</h2>
          <button onClick={onClose} className="h-8 w-8 rounded-lg bg-slate-50 flex items-center justify-center text-slate-400 hover:text-slate-600 transition">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3">
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="w-full h-11 rounded-xl bg-slate-50 border border-slate-200 px-3.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
          >
            <option value="">Employee... *</option>
            {employees.filter((e) => e.is_active).map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>

          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Start Date *</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full h-11 rounded-xl bg-slate-50 border border-slate-200 px-3.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">End Date (optional)</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full h-11 rounded-xl bg-slate-50 border border-slate-200 px-3.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Leave blank if the return date isn't known yet — this marks an open-ended leave, which stays active
              until you set a date or mark them returned.
            </p>
          </div>

          <input
            type="text"
            placeholder="Reason (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full h-11 rounded-xl bg-slate-50 border border-slate-200 px-3.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
          />

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full h-11 rounded-xl font-semibold text-white bg-gradient-to-r from-teal-600 to-emerald-500 disabled:opacity-60"
          >
            {submitting ? "Marking..." : "Mark On Leave"}
          </button>
        </div>
      </motion.div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : null;
}
