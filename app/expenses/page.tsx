"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import EmployeeTabBar from "@/components/EmployeeTabBar";
import ExpenseDetailModal from "@/components/ExpenseDetailModal";

interface ExpenseRow {
  id: string;
  amount: number;
  expense_date: string;
  description: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "PAID";
  rejection_reason: string | null;
  payment_method: string | null;
  payment_reference: string | null;
  paid_date: string | null;
  created_at: string;
}

const STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-700",
  APPROVED: "bg-emerald-50 text-emerald-700",
  PAID: "bg-indigo-50 text-indigo-700",
  REJECTED: "bg-red-50 text-red-700"
};

// Own top-level route, mirrors app/documents/page.tsx exactly (same
// inline auth-check block, no shared employee layout exists yet). This
// is the submission side of the Payroll Expense module -- Admin/Payroll's
// approve/reject/office-log surface lives at /payroll/expenses, which
// this route's own role can never reach (gated by app/payroll/layout.tsx).
export default function ExpensesPage() {
  const router = useRouter();

  const [employee, setEmployee] = useState<any>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  async function loadExpenses() {
    const { data } = await supabase
      .from("expenses")
      .select("id, amount, expense_date, description, status, rejection_reason, payment_method, payment_reference, paid_date, created_at")
      .order("created_at", { ascending: false });

    setExpenses(data || []);
  }

  useEffect(() => {
    async function getLoggedInEmployee() {
      const {
        data: { user }
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/login");
        return;
      }

      const { data, error } = await supabase.from("employees").select("*").eq("auth_user_id", user.id).single();

      if (error || !data) {
        console.error("Employee not found");
        return;
      }

      if (!data.is_active) {
        await supabase.auth.signOut();
        router.replace("/login");
        return;
      }

      if (data.role === "admin") {
        router.replace("/admin");
        return;
      }

      setEmployee(data);
      setAuthChecked(true);

      await loadExpenses();
      setLoading(false);
    }

    getLoggedInEmployee();
  }, []);

  async function handleSubmit() {
    const numAmount = Number(amount);
    if (!numAmount || numAmount <= 0) {
      toast.error("Enter a valid amount.");
      return;
    }
    if (!description.trim()) {
      toast.error("Description is required.");
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.rpc("submit_expense_atomic", {
      p_amount: numAmount,
      p_expense_date: expenseDate,
      p_description: description.trim()
    });
    setSubmitting(false);

    if (error) {
      toast.error(error.message || "Could not submit expense.");
      return;
    }

    toast.success("Expense submitted for approval.");
    setAmount("");
    setDescription("");
    loadExpenses();
  }

  if (!authChecked) {
    return <div className="min-h-screen bg-white" />;
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-white via-blue-50 to-blue-100">
      <Header />
      <EmployeeTabBar role={employee?.role} department={employee?.department} />

      <div className="px-4 mt-4 space-y-3 pb-6">
        <div className="rounded-2xl bg-white border border-slate-100 shadow-md p-4 space-y-3">
          <div>
            <p className="text-sm font-bold text-slate-800">Submit an Expense</p>
            <p className="text-xs text-slate-500 mt-0.5">Sent to Admin/Payroll for approval.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount"
              className="h-10 w-28 rounded-md border px-3 text-sm outline-none"
            />
            <input
              type="date"
              value={expenseDate}
              onChange={(e) => setExpenseDate(e.target.value)}
              className="h-10 rounded-md border px-3 text-sm outline-none"
            />
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What was this for?"
              className="h-10 flex-1 min-w-[180px] rounded-md border px-3 text-sm outline-none"
            />
          </div>
          <button
            disabled={submitting}
            onClick={handleSubmit}
            className="h-10 px-4 rounded-md text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition"
          >
            {submitting ? "Submitting..." : "Submit Expense"}
          </button>
        </div>

        <p className="text-sm font-bold text-slate-800 px-1">My Expenses</p>

        {loading ? (
          <p className="text-sm text-slate-400 px-1">Loading...</p>
        ) : expenses.length === 0 ? (
          <p className="text-sm text-slate-400 px-1">No expenses submitted yet.</p>
        ) : (
          expenses.map((exp) => (
            <div
              key={exp.id}
              className="rounded-2xl bg-white border border-slate-100 shadow-[0_2px_10px_rgba(15,23,42,0.05)] p-4"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-bold text-slate-800">₹{exp.amount.toLocaleString()}</p>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_STYLES[exp.status]}`}>{exp.status}</span>
                </div>
                <button
                  onClick={() => setDetailId(exp.id)}
                  className="text-xs font-bold px-3 py-1 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200"
                >
                  Timeline
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">{exp.description}</p>
              <p className="text-xs text-slate-400 mt-0.5">
                {new Date(exp.expense_date).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}
              </p>
              {exp.status === "REJECTED" && exp.rejection_reason && (
                <p className="text-xs text-red-600 mt-0.5">Reason: {exp.rejection_reason}</p>
              )}
              {exp.status === "PAID" && (
                <p className="text-xs text-indigo-600 mt-0.5">
                  Paid via {exp.payment_method}
                  {exp.payment_reference ? ` (${exp.payment_reference})` : ""}
                  {exp.paid_date && ` on ${new Date(exp.paid_date).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`}
                </p>
              )}
            </div>
          ))
        )}
      </div>

      <Footer />

      {detailId && <ExpenseDetailModal expenseId={detailId} onClose={() => setDetailId(null)} />}
    </main>
  );
}
