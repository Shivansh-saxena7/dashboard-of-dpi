"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import DateInput from "@/components/DateInput";
import { formatINR } from "@/lib/exportTable";

interface EmployeeRow {
  id: string;
  name: string;
}

// Company-wide "who's missing Basic Pay" + bulk-set, same pattern as the
// per-employee Basic Pay history the calling page keeps for itself.
// Fetches its own employees/compensation snapshot rather than relying on
// the parent page's copy (both pages already fetch employees separately
// for their own employee-selector dropdown). If the currently selected
// employee (employeeId) is among the rows just bulk-set, onSavedForEmployee
// fires so the parent can refresh whatever per-employee Basic Pay display
// it's showing (mirrors the original inline handler's behavior).
export default function BasicPayOverview({ employeeId, onSavedForEmployee }: { employeeId?: string; onSavedForEmployee?: () => void }) {
  const todayStr = new Date().toISOString().slice(0, 10);

  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [compensationMap, setCompensationMap] = useState<Record<string, number>>({});
  const [showOnlyMissing, setShowOnlyMissing] = useState(true);
  const [bulkPayAmounts, setBulkPayAmounts] = useState<Record<string, string>>({});
  const [bulkPayEffectiveFrom, setBulkPayEffectiveFrom] = useState(todayStr);
  const [bulkPaySaving, setBulkPaySaving] = useState(false);

  async function loadEmployees() {
    const { data } = await supabase.from("employees").select("id, name").eq("is_active", true).order("name");
    setEmployees(data || []);
  }

  async function loadAllCompensation() {
    const { data } = await supabase
      .from("employee_compensation")
      .select("employee_id, basic_pay, effective_from")
      .order("effective_from", { ascending: false });

    // Reduce to the latest row per employee -- rows already arrive
    // newest-first, so the first row seen for a given employee_id is
    // their current Basic Pay, later ones for the same id are ignored.
    const map: Record<string, number> = {};
    for (const row of data || []) {
      if (!(row.employee_id in map)) map[row.employee_id] = row.basic_pay;
    }
    setCompensationMap(map);
  }

  useEffect(() => {
    loadEmployees();
    loadAllCompensation();
  }, []);

  async function handleBulkSetBasicPay() {
    const rows = Object.entries(bulkPayAmounts)
      .map(([empId, amountStr]) => ({ empId, amount: Number(amountStr) }))
      .filter((r) => r.amount > 0);

    if (rows.length === 0) {
      toast.error("Enter at least one amount.");
      return;
    }
    if (!bulkPayEffectiveFrom) {
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

    setBulkPaySaving(true);
    const { error } = await supabase.from("employee_compensation").insert(
      rows.map((r) => ({
        employee_id: r.empId,
        basic_pay: r.amount,
        effective_from: bulkPayEffectiveFrom,
        set_by_employee_id: me.id
      }))
    );
    setBulkPaySaving(false);

    if (error) {
      toast.error(error.message || "Could not save Basic Pay.");
      return;
    }

    toast.success(`Basic Pay set for ${rows.length} employee(s).`);
    setBulkPayAmounts({});
    loadAllCompensation();
    if (employeeId && rows.some((r) => r.empId === employeeId)) onSavedForEmployee?.();
  }

  const rows = employees.filter((e) => !showOnlyMissing || !(e.id in compensationMap));

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
          <AlertTriangle size={15} className="text-amber-500" /> Basic Pay Overview
        </p>
        <div className="flex gap-1.5">
          <button
            onClick={() => setShowOnlyMissing(true)}
            className={`h-8 px-3 rounded-lg text-xs font-bold transition ${showOnlyMissing ? "bg-amber-100 text-amber-700" : "bg-slate-50 text-slate-500"}`}
          >
            Missing Basic Pay ({employees.filter((e) => !(e.id in compensationMap)).length})
          </button>
          <button
            onClick={() => setShowOnlyMissing(false)}
            className={`h-8 px-3 rounded-lg text-xs font-bold transition ${!showOnlyMissing ? "bg-slate-800 text-white" : "bg-slate-50 text-slate-500"}`}
          >
            All Employees
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-slate-400">Everyone has Basic Pay set.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3 pb-2 border-b border-slate-100">
            <div>
              <label className="text-xs font-semibold text-slate-500">Effective From (applies to all rows filled below)</label>
              <DateInput value={bulkPayEffectiveFrom} onChange={setBulkPayEffectiveFrom} />
            </div>
            <button
              onClick={handleBulkSetBasicPay}
              disabled={bulkPaySaving}
              className="h-10 px-4 rounded-xl bg-emerald-600 text-white text-xs font-bold disabled:opacity-40 hover:bg-emerald-700 transition"
            >
              {bulkPaySaving ? "Saving..." : "Save All"}
            </button>
          </div>

          <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
            {rows.map((e) => (
              <div key={e.id} className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 sm:gap-3 sm:items-center py-2.5">
                <span className="text-sm font-semibold text-slate-700">{e.name}</span>
                <span
                  className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[11px] font-bold w-fit sm:w-24 ${
                    e.id in compensationMap ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {e.id in compensationMap ? `Rs. ${formatINR(compensationMap[e.id])}` : "Missing"}
                </span>
                <input
                  type="number"
                  min={0}
                  value={bulkPayAmounts[e.id] || ""}
                  onChange={(ev) => setBulkPayAmounts((prev) => ({ ...prev, [e.id]: ev.target.value }))}
                  placeholder="New amount"
                  className="w-full sm:w-28 h-8 rounded-lg bg-slate-50 border border-slate-200 px-2 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-100 focus:border-emerald-300"
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
