"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { History } from "lucide-react";
import { supabase } from "@/lib/supabase";
import DateInput from "@/components/DateInput";
import { formatINR } from "@/lib/exportTable";

interface CompensationRow {
  id: string;
  basic_pay: number;
  effective_from: string;
  created_at: string;
  set_by: { name: string } | null;
}

// Effective-dated, insert-only -- a raise is a new row, never an edit to
// an existing one, same reasoning as Commission Plans being immutable.
// Shared by HR and Payroll (equal write access on employee_compensation).
// onSaved lets a page with its own separate cached "current Basic Pay"
// (e.g. the Payroll page's "Current Setup" card, or Generate Slip's
// as-of-month lookup) refresh after a set here. This form's own history
// can also go stale from the OTHER write path into this same table --
// Basic Pay Overview's bulk-set -- so both pages remount this component
// (via a key bump on Basic Pay Overview's onSavedForEmployee) rather than
// try to thread that page's separate cache into here.
export default function BasicPaySetForm({ employeeId, onSaved }: { employeeId: string; onSaved?: () => void }) {
  const todayStr = new Date().toISOString().slice(0, 10);

  const [history, setHistory] = useState<CompensationRow[]>([]);
  const [newBasicPay, setNewBasicPay] = useState("");
  const [newEffectiveFrom, setNewEffectiveFrom] = useState(todayStr);
  const [savingPay, setSavingPay] = useState(false);

  async function loadHistory() {
    const { data } = await supabase
      .from("employee_compensation")
      .select("id, basic_pay, effective_from, created_at, set_by:employees!employee_compensation_set_by_employee_id_fkey(name)")
      .eq("employee_id", employeeId)
      .order("effective_from", { ascending: false });
    setHistory((data || []) as unknown as CompensationRow[]);
  }

  useEffect(() => {
    loadHistory();
    setNewBasicPay("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  const currentBasicPay = history.find((h) => h.effective_from <= todayStr)?.basic_pay ?? null;

  async function handleSetBasicPay() {
    const amount = Number(newBasicPay);
    if (!amount || amount <= 0) {
      toast.error("Enter a valid Basic Pay amount.");
      return;
    }
    if (!newEffectiveFrom) {
      toast.error("Pick an effective-from date.");
      return;
    }

    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data: me } = await supabase.from("employees").select("id").eq("auth_user_id", user.id).single();
    if (!me) {
      toast.error("Could not identify your employee record.");
      return;
    }

    setSavingPay(true);
    const { error } = await supabase.from("employee_compensation").insert({
      employee_id: employeeId,
      basic_pay: amount,
      effective_from: newEffectiveFrom,
      set_by_employee_id: me.id
    });
    setSavingPay(false);

    if (error) {
      toast.error(error.message || "Could not save Basic Pay.");
      return;
    }

    toast.success("Basic Pay updated.");
    setNewBasicPay("");
    loadHistory();
    onSaved?.();
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-slate-800">Basic Pay</p>
        <p className="text-sm font-bold text-emerald-600">
          Current: {currentBasicPay !== null ? `Rs. ${formatINR(currentBasicPay)}` : "Not set"}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs font-semibold text-slate-500">New Basic Pay (Rs.)</label>
          <input
            type="number"
            min={0}
            value={newBasicPay}
            onChange={(e) => setNewBasicPay(e.target.value)}
            placeholder="e.g. 30000"
            className="mt-1 h-10 w-40 rounded-xl bg-slate-50 border border-slate-200 px-3 text-sm font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-100 focus:border-emerald-300"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500">Effective From</label>
          <DateInput value={newEffectiveFrom} onChange={setNewEffectiveFrom} />
        </div>
        <button
          onClick={handleSetBasicPay}
          disabled={savingPay}
          className="h-10 px-4 rounded-xl bg-emerald-600 text-white text-xs font-bold disabled:opacity-40 hover:bg-emerald-700 transition"
        >
          {savingPay ? "Saving..." : "Set Basic Pay"}
        </button>
      </div>

      {history.length > 0 && (
        <div className="pt-2 border-t border-slate-100">
          <p className="text-xs font-bold text-slate-500 flex items-center gap-1.5 mb-2">
            <History size={12} /> History
          </p>
          <div className="space-y-1.5">
            {history.map((h) => (
              <div key={h.id} className="flex items-center justify-between text-xs">
                <span className="text-slate-600">
                  From {h.effective_from} — Rs. {formatINR(h.basic_pay)}
                </span>
                <span className="text-slate-400">by {h.set_by?.name || "—"}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
