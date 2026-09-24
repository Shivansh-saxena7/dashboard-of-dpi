"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { X, Send, CheckCircle2, XCircle, Wallet } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface ExpenseDetailModalProps {
  expenseId: string;
  onClose: () => void;
}

interface ExpenseDetail {
  id: string;
  expense_source: "EMPLOYEE_SUBMITTED" | "OFFICE_DIRECT";
  amount: number;
  expense_date: string;
  description: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "PAID";
  rejection_reason: string | null;
  employee_name: string | null;
  submitted_by_name: string | null;
  submitted_at: string;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  paid_by_name: string | null;
  paid_date: string | null;
  payment_method: string | null;
  payment_reference: string | null;
}

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  CASH: "Cash",
  UPI: "UPI",
  BANK_TRANSFER: "Bank Transfer",
  OTHER: "Other"
};

// Shared timeline view used on BOTH /payroll/expenses (Admin/Payroll)
// and /expenses (employee, own expenses only) -- one component so the
// two surfaces never drift. Backed by get_expense_detail_atomic (not a
// client-side table embed) specifically because a plain employee's own
// RLS on `employees` only lets them see their OWN row -- an embed for
// "who approved/paid this" would silently come back null for them. The
// RPC resolves all three names server-side and gates on admin/payroll
// OR "this is the caller's own expense", so it works identically for
// both callers without depending on employees-table RLS at all.
// Portaled to document.body + slide-in drawer, mirrors
// AdminLeadHistoryModal's exact convention (that one is Admin-only/
// blue-themed for leads; this reuses the same shape, amber-themed to
// match the rest of the Payroll module).
export default function ExpenseDetailModal({ expenseId, onClose }: ExpenseDetailModalProps) {
  const [detail, setDetail] = useState<ExpenseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase.rpc("get_expense_detail_atomic", { p_expense_id: expenseId }).single();
      if (error || !data) {
        setError(error?.message || "Could not load this expense.");
        setLoading(false);
        return;
      }
      setDetail(data as ExpenseDetail);
      setLoading(false);
    }
    load();
  }, [expenseId]);

  function fmt(iso: string | null, withTime = true) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString([], withTime ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" } : { month: "short", day: "numeric", year: "numeric" });
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
        className="fixed top-0 right-0 h-full w-full sm:w-[420px] z-50 bg-white shadow-2xl flex flex-col overflow-hidden"
      >
        <div className="relative pt-6 pb-6 px-6 bg-gradient-to-br from-amber-700 via-orange-600 to-amber-500 text-white overflow-hidden shrink-0">
          <div className="absolute top-[-40px] right-[-40px] w-[120px] h-[120px] rounded-full bg-white/10 blur-3xl pointer-events-none" />

          <button
            onClick={onClose}
            className="absolute top-5 right-5 h-8 w-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition"
          >
            <X size={16} />
          </button>

          <p className="relative text-[10px] font-semibold tracking-[0.2em] text-amber-100 uppercase mb-2">Expense Timeline</p>
          <h2 className="relative text-xl font-bold pr-10">₹{detail ? detail.amount.toLocaleString() : "..."}</h2>
          {detail && <p className="relative text-sm text-white/70 mt-1">{detail.description}</p>}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          {loading ? (
            <p className="text-sm text-slate-400">Loading...</p>
          ) : error || !detail ? (
            <p className="text-sm text-red-500">{error || "Could not load this expense."}</p>
          ) : (
            <div>
              {/* Submitted / Logged */}
              <div className="relative pl-8 pb-6">
                <div className="absolute left-[9px] top-6 bottom-0 w-px bg-slate-200" />
                <div className="absolute left-0 top-0.5 h-5 w-5 rounded-full flex items-center justify-center bg-gradient-to-br from-slate-500 to-slate-600">
                  <Send size={11} className="text-white" />
                </div>
                <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                  <p className="text-sm font-bold text-slate-800">
                    {detail.expense_source === "OFFICE_DIRECT" ? "Logged" : "Submitted"} by {detail.submitted_by_name || "Unknown"}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1">{fmt(detail.submitted_at)}</p>
                  <p className="text-xs text-slate-600 mt-2">
                    Amount: <span className="font-semibold">₹{detail.amount.toLocaleString()}</span>
                  </p>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Reason: <span className="font-semibold">{detail.description}</span>
                  </p>
                </div>
              </div>

              {/* Reviewed (Approved/Rejected) */}
              {(detail.status === "APPROVED" || detail.status === "PAID" || detail.status === "REJECTED") && (
                <div className="relative pl-8 pb-6">
                  {detail.status === "PAID" && <div className="absolute left-[9px] top-6 bottom-0 w-px bg-slate-200" />}
                  <div
                    className={`absolute left-0 top-0.5 h-5 w-5 rounded-full flex items-center justify-center ${
                      detail.status === "REJECTED" ? "bg-gradient-to-br from-red-500 to-red-600" : "bg-gradient-to-br from-emerald-500 to-emerald-600"
                    }`}
                  >
                    {detail.status === "REJECTED" ? <XCircle size={11} className="text-white" /> : <CheckCircle2 size={11} className="text-white" />}
                  </div>
                  <div className={`rounded-xl border p-3 ${detail.status === "REJECTED" ? "bg-red-50 border-red-100" : "bg-emerald-50 border-emerald-100"}`}>
                    <p className={`text-sm font-bold ${detail.status === "REJECTED" ? "text-red-800" : "text-emerald-800"}`}>
                      {detail.status === "REJECTED" ? "Rejected" : "Approved"} by {detail.reviewed_by_name || "Unknown"}
                    </p>
                    <p className={`text-[11px] mt-1 ${detail.status === "REJECTED" ? "text-red-700/80" : "text-emerald-700/80"}`}>{fmt(detail.reviewed_at)}</p>
                    {detail.status === "REJECTED" && detail.rejection_reason && (
                      <p className="text-xs text-red-700 mt-2">
                        Reason: <span className="font-semibold">{detail.rejection_reason}</span>
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Paid */}
              {detail.status === "PAID" && (
                <div className="relative pl-8">
                  <div className="absolute left-0 top-0.5 h-5 w-5 rounded-full flex items-center justify-center bg-gradient-to-br from-indigo-500 to-indigo-600">
                    <Wallet size={11} className="text-white" />
                  </div>
                  <div className="rounded-xl bg-indigo-50 border border-indigo-100 p-3">
                    <p className="text-sm font-bold text-indigo-800">Paid by {detail.paid_by_name || "Unknown"}</p>
                    <p className="text-[11px] text-indigo-700/80 mt-1">{fmt(detail.paid_date, false)}</p>
                    <p className="text-xs text-indigo-700 mt-2">
                      Via <span className="font-semibold">{PAYMENT_METHOD_LABEL[detail.payment_method || ""] || detail.payment_method}</span>
                      {detail.payment_reference && (
                        <>
                          {" "}
                          — Reference: <span className="font-semibold">{detail.payment_reference}</span>
                        </>
                      )}
                    </p>
                  </div>
                </div>
              )}

              {detail.status === "PENDING" && <p className="text-sm text-slate-400 pl-8">Awaiting approval.</p>}
            </div>
          )}
        </div>
      </motion.div>
    </>,
    document.body
  );
}
