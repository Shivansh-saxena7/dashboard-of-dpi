"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";
import { exportExpenseBillToPDF, exportExpenseConsolidatedToPDF } from "@/lib/exportExpenseReport";
import ExpenseDetailModal from "@/components/ExpenseDetailModal";

interface EmployeeRow {
  id: string;
  name: string;
}

interface ExpenseRow {
  id: string;
  expense_source: "EMPLOYEE_SUBMITTED" | "OFFICE_DIRECT";
  employee_id: string | null;
  amount: number;
  expense_date: string;
  description: string;
  receipt_storage_path: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "PAID";
  rejection_reason: string | null;
  payment_method: string | null;
  payment_reference: string | null;
  paid_date: string | null;
  created_at: string;
  employee: { name: string } | null;
  submitted_by: { name: string } | null;
  reviewed_by: { name: string } | null;
  paid_by: { name: string } | null;
}

const PAYMENT_METHODS = ["CASH", "UPI", "BANK_TRANSFER", "OTHER"];

// Admin/Payroll's own approve/reject/pay + office-direct-log surface,
// gated by app/payroll/layout.tsx (role === 'payroll' || 'admin').
// Employees never reach this page -- their own submission + status view
// lives at the separate top-level /expenses (mirrors the /hr/documents +
// /documents split). Office-direct receipt upload is a two-step client
// flow (file straight to the private payroll-receipts bucket via
// Admin/Payroll's own bucket RLS, then log_office_expense_atomic records
// the row) -- same idiom as HR document upload. PDF export reuses the
// same exportTable.ts engine every other report in this app uses, via
// lib/exportExpenseReport.ts -- no new PDF logic.
export default function PayrollExpensesPage() {
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("PENDING");
  const [sourceFilter, setSourceFilter] = useState<string>("");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);

  const [payingId, setPayingId] = useState<string | null>(null);
  const [paidDate, setPaidDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [paymentReference, setPaymentReference] = useState("");

  const [logOpen, setLogOpen] = useState(false);
  const [logAmount, setLogAmount] = useState("");
  const [logDate, setLogDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [logDescription, setLogDescription] = useState("");
  const [logFile, setLogFile] = useState<File | null>(null);
  const [logging, setLogging] = useState(false);

  async function loadExpenses() {
    setLoading(true);
    const { data } = await supabase
      .from("expenses")
      .select(
        "id, expense_source, employee_id, amount, expense_date, description, receipt_storage_path, status, rejection_reason, payment_method, payment_reference, paid_date, created_at, employee:employees!expenses_employee_id_fkey(name), submitted_by:employees!expenses_submitted_by_employee_id_fkey(name), reviewed_by:employees!expenses_reviewed_by_employee_id_fkey(name), paid_by:employees!expenses_paid_by_employee_id_fkey(name)"
      )
      .order("created_at", { ascending: false });

    setExpenses((data as any) || []);
    setLoading(false);
  }

  async function loadEmployees() {
    const { data } = await supabase.from("employees").select("id, name").eq("is_active", true).order("name");
    setEmployees(data || []);
  }

  useEffect(() => {
    loadExpenses();
    loadEmployees();
  }, []);

  const visibleExpenses = useMemo(() => {
    return expenses.filter((e) => {
      if (statusFilter && e.status !== statusFilter) return false;
      if (sourceFilter && e.expense_source !== sourceFilter) return false;
      if (employeeFilter && e.employee_id !== employeeFilter) return false;
      if (dateFrom && e.expense_date < dateFrom) return false;
      if (dateTo && e.expense_date > dateTo) return false;
      return true;
    });
  }, [expenses, statusFilter, sourceFilter, employeeFilter, dateFrom, dateTo]);

  async function handleApprove(expenseId: string) {
    const { error } = await supabase.rpc("approve_expense_atomic", { p_expense_id: expenseId });
    if (error) {
      toast.error(error.message || "Could not approve.");
      return;
    }
    toast.success("Expense approved.");
    loadExpenses();
  }

  async function handleReject(expenseId: string) {
    if (!rejectReason.trim()) {
      toast.error("Rejection reason is required.");
      return;
    }
    const { error } = await supabase.rpc("reject_expense_atomic", {
      p_expense_id: expenseId,
      p_rejection_reason: rejectReason.trim()
    });
    if (error) {
      toast.error(error.message || "Could not reject.");
      return;
    }
    toast.success("Expense rejected.");
    setRejectingId(null);
    setRejectReason("");
    loadExpenses();
  }

  async function handleMarkPaid(expenseId: string) {
    if (paymentMethod !== "CASH" && !paymentReference.trim()) {
      toast.error("Payment reference is required for this method.");
      return;
    }
    const { error } = await supabase.rpc("mark_expense_paid_atomic", {
      p_expense_id: expenseId,
      p_paid_date: paidDate,
      p_payment_method: paymentMethod,
      p_payment_reference: paymentReference.trim() || null
    });
    if (error) {
      toast.error(error.message || "Could not mark as paid.");
      return;
    }
    toast.success("Expense marked as paid.");
    setPayingId(null);
    setPaymentReference("");
    loadExpenses();
  }

  async function handleViewReceipt(path: string) {
    const { data, error } = await supabase.storage.from("payroll-receipts").createSignedUrl(path, 300);
    if (error || !data?.signedUrl) {
      toast.error("Could not open receipt.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  function toExportRow(exp: ExpenseRow) {
    return {
      source: exp.expense_source,
      employeeName: exp.employee?.name || null,
      amount: exp.amount,
      expenseDate: exp.expense_date,
      description: exp.description,
      status: exp.status,
      paymentMethod: exp.payment_method,
      paymentReference: exp.payment_reference
    };
  }

  async function handleDownloadBill(exp: ExpenseRow) {
    await exportExpenseBillToPDF(toExportRow(exp), {
      employeeLabel: exp.expense_source === "OFFICE_DIRECT" ? "Office" : exp.employee?.name || null,
      otherFilters: [{ label: "Date", value: exp.expense_date }]
    });
  }

  async function handleExportConsolidated() {
    if (visibleExpenses.length === 0) {
      toast.error("No expenses in the current filter to export.");
      return;
    }
    await exportExpenseConsolidatedToPDF(
      visibleExpenses.map(toExportRow),
      {
        employeeLabel: employeeFilter ? employees.find((e) => e.id === employeeFilter)?.name ?? null : null,
        otherFilters: [
          { label: "Status", value: statusFilter || "All" },
          { label: "Source", value: sourceFilter || "All" },
          { label: "Date Range", value: dateFrom || dateTo ? `${dateFrom || "start"} to ${dateTo || "today"}` : "All" }
        ]
      }
    );
  }

  async function handleLogOfficeExpense() {
    const amount = Number(logAmount);
    if (!amount || amount <= 0) {
      toast.error("Enter a valid amount.");
      return;
    }
    if (!logDescription.trim()) {
      toast.error("Description is required.");
      return;
    }
    if (!logFile) {
      toast.error("Receipt upload is required for office expenses.");
      return;
    }

    setLogging(true);
    try {
      const sanitizedName = logFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `office/${crypto.randomUUID()}-${sanitizedName}`;

      const { error: uploadError } = await supabase.storage.from("payroll-receipts").upload(storagePath, logFile);
      if (uploadError) {
        toast.error(uploadError.message || "Upload failed.");
        return;
      }

      const { error: rpcError } = await supabase.rpc("log_office_expense_atomic", {
        p_amount: amount,
        p_expense_date: logDate,
        p_description: logDescription.trim(),
        p_receipt_storage_path: storagePath
      });

      if (rpcError) {
        await supabase.storage.from("payroll-receipts").remove([storagePath]);
        toast.error(rpcError.message || "Could not log expense.");
        return;
      }

      toast.success("Office expense logged.");
      setLogOpen(false);
      setLogAmount("");
      setLogDescription("");
      setLogFile(null);
      loadExpenses();
    } finally {
      setLogging(false);
    }
  }

  return (
    <div className="space-y-6 pb-10">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-[24px] bg-gradient-to-br from-amber-700 via-orange-600 to-amber-500 text-white p-6"
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.2em] text-amber-100 uppercase mb-2">Payroll</p>
            <h1 className="text-xl font-bold">Expenses</h1>
            <p className="text-sm text-white/70 mt-1">Approve, pay, and log expenses.</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={handleExportConsolidated}
              className="shrink-0 flex items-center gap-1.5 h-10 px-4 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-sm font-semibold transition"
            >
              📄 Export Report
            </button>
            <button
              onClick={() => setLogOpen(true)}
              className="shrink-0 flex items-center gap-1.5 h-10 px-4 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-sm font-semibold transition"
            >
              🧾 Log Office Expense
            </button>
          </div>
        </div>
      </motion.div>

      {logOpen && (
        <div className="rounded-2xl bg-white border border-slate-100 shadow-md p-5 space-y-3">
          <p className="text-sm font-bold text-slate-800">Log Office Expense</p>
          <div className="flex flex-wrap gap-2">
            <input
              type="number"
              value={logAmount}
              onChange={(e) => setLogAmount(e.target.value)}
              placeholder="Amount"
              className="h-10 w-32 rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs outline-none"
            />
            <input
              type="date"
              value={logDate}
              onChange={(e) => setLogDate(e.target.value)}
              className="h-10 rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs outline-none"
            />
            <input
              value={logDescription}
              onChange={(e) => setLogDescription(e.target.value)}
              placeholder="Description (e.g. Office wifi bill - September)"
              className="h-10 flex-1 min-w-[200px] rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs outline-none"
            />
            <input type="file" onChange={(e) => setLogFile(e.target.files?.[0] || null)} className="text-xs" />
          </div>
          <div className="flex gap-2">
            <button
              disabled={logging}
              onClick={handleLogOfficeExpense}
              className="h-10 px-4 rounded-xl text-xs font-bold bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-60 transition"
            >
              {logging ? "Logging..." : "Log Expense"}
            </button>
            <button
              disabled={logging}
              onClick={() => setLogOpen(false)}
              className="h-10 px-4 rounded-xl text-xs font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-60 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        {["PENDING", "APPROVED", "PAID", "REJECTED", ""].map((s) => (
          <button
            key={s || "ALL"}
            onClick={() => setStatusFilter(s)}
            className={`h-9 px-3 rounded-xl text-xs font-bold transition ${
              statusFilter === s ? "bg-amber-600 text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {s || "All"}
          </button>
        ))}

        <span className="w-px h-6 bg-slate-200 mx-1" />

        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="h-9 rounded-xl bg-white border border-slate-200 px-3 text-xs font-semibold text-slate-600 outline-none"
        >
          <option value="">All Sources</option>
          <option value="EMPLOYEE_SUBMITTED">Employee-Submitted</option>
          <option value="OFFICE_DIRECT">Office Direct</option>
        </select>

        <select
          value={employeeFilter}
          onChange={(e) => setEmployeeFilter(e.target.value)}
          className="h-9 rounded-xl bg-white border border-slate-200 px-3 text-xs font-semibold text-slate-600 outline-none"
        >
          <option value="">All Employees</option>
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.name}
            </option>
          ))}
        </select>

        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="h-9 rounded-xl bg-white border border-slate-200 px-3 text-xs outline-none"
        />
        <span className="text-xs text-slate-400">to</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="h-9 rounded-xl bg-white border border-slate-200 px-3 text-xs outline-none"
        />
      </div>

      {loading ? (
        <p className="text-sm text-slate-400 px-1">Loading...</p>
      ) : visibleExpenses.length === 0 ? (
        <p className="text-sm text-slate-400 px-1">No expenses here.</p>
      ) : (
        <div className="space-y-3">
          {visibleExpenses.map((exp) => (
            <div key={exp.id} className="rounded-2xl bg-white border border-slate-100 shadow-[0_2px_10px_rgba(15,23,42,0.05)] p-4 space-y-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-bold text-slate-800">₹{exp.amount.toLocaleString()}</p>
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                      {exp.expense_source === "OFFICE_DIRECT" ? "Office" : exp.employee?.name || "Unknown"}
                    </span>
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                        exp.status === "PENDING"
                          ? "bg-amber-50 text-amber-700"
                          : exp.status === "APPROVED"
                            ? "bg-emerald-50 text-emerald-700"
                            : exp.status === "PAID"
                              ? "bg-indigo-50 text-indigo-700"
                              : "bg-red-50 text-red-700"
                      }`}
                    >
                      {exp.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-1">{exp.description}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {new Date(exp.expense_date).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })} · logged by{" "}
                    {exp.submitted_by?.name || "—"}
                    {exp.reviewed_by?.name ? ` · reviewed by ${exp.reviewed_by.name}` : ""}
                  </p>
                  {exp.status === "REJECTED" && exp.rejection_reason && (
                    <p className="text-xs text-red-600 mt-0.5">Reason: {exp.rejection_reason}</p>
                  )}
                  {exp.status === "PAID" && (
                    <p className="text-xs text-indigo-600 mt-0.5">
                      Paid via {exp.payment_method}
                      {exp.payment_reference ? ` (${exp.payment_reference})` : ""} on{" "}
                      {exp.paid_date && new Date(exp.paid_date).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}
                      {exp.paid_by?.name ? ` · by ${exp.paid_by.name}` : ""}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  <button
                    onClick={() => setDetailId(exp.id)}
                    className="text-xs font-bold px-3 py-1.5 rounded-full bg-amber-50 text-amber-700 hover:bg-amber-100"
                  >
                    Timeline
                  </button>
                  <button
                    onClick={() => handleDownloadBill(exp)}
                    className="text-xs font-bold px-3 py-1.5 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200"
                  >
                    Bill
                  </button>
                  {exp.receipt_storage_path && (
                    <button
                      onClick={() => handleViewReceipt(exp.receipt_storage_path!)}
                      className="text-xs font-bold px-3 py-1.5 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200"
                    >
                      Receipt
                    </button>
                  )}
                  {exp.status === "PENDING" && exp.expense_source === "EMPLOYEE_SUBMITTED" && (
                    <>
                      <button
                        onClick={() => handleApprove(exp.id)}
                        className="text-xs font-bold px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => setRejectingId(rejectingId === exp.id ? null : exp.id)}
                        className="text-xs font-bold px-3 py-1.5 rounded-full bg-red-50 text-red-700 hover:bg-red-100"
                      >
                        Reject
                      </button>
                    </>
                  )}
                  {exp.status === "APPROVED" && exp.expense_source === "EMPLOYEE_SUBMITTED" && (
                    <button
                      onClick={() => setPayingId(payingId === exp.id ? null : exp.id)}
                      className="text-xs font-bold px-3 py-1.5 rounded-full bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                    >
                      Mark Paid
                    </button>
                  )}
                </div>
              </div>

              {rejectingId === exp.id && (
                <div className="flex gap-2 pt-1">
                  <input
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Rejection reason..."
                    className="h-9 flex-1 rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs outline-none"
                  />
                  <button
                    onClick={() => handleReject(exp.id)}
                    className="h-9 px-3 rounded-xl text-xs font-bold bg-red-600 text-white hover:bg-red-700"
                  >
                    Confirm Reject
                  </button>
                </div>
              )}

              {payingId === exp.id && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <input
                    type="date"
                    value={paidDate}
                    onChange={(e) => setPaidDate(e.target.value)}
                    className="h-9 rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs outline-none"
                  />
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="h-9 rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs font-semibold text-slate-600 outline-none"
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <input
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                    placeholder={paymentMethod === "CASH" ? "Reference (optional)" : "Reference (required)"}
                    className="h-9 flex-1 min-w-[160px] rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs outline-none"
                  />
                  <button
                    onClick={() => handleMarkPaid(exp.id)}
                    className="h-9 px-3 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700"
                  >
                    Confirm Paid
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {detailId && <ExpenseDetailModal expenseId={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}
