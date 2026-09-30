"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";
import DateInput from "@/components/DateInput";

interface CommissionPlanOption {
  id: string;
  name: string;
}

interface CommissionAssignmentRow {
  id: string;
  plan_id: string | null;
  effective_from: string;
  plan: { name: string } | null;
  assigned_by: { name: string } | null;
}

// Effective-dated history table, same "drawer" nullable-FK pattern as
// everywhere else in this phase: a row with plan_id = null means
// unassigned from that date. Shared by HR and Payroll (equal write
// access). onAssigned lets a page with its own separate cached "current
// commission plan" (e.g. the Payroll page's "Current Setup" card)
// refresh after an assign/unassign here.
export default function CommissionAssignmentForm({ employeeId, onAssigned }: { employeeId: string; onAssigned?: () => void }) {
  const todayStr = new Date().toISOString().slice(0, 10);

  const [commissionPlans, setCommissionPlans] = useState<CommissionPlanOption[]>([]);
  const [commissionAssignments, setCommissionAssignments] = useState<CommissionAssignmentRow[]>([]);
  const [assignPlanId, setAssignPlanId] = useState("");
  const [assignPlanEffectiveFrom, setAssignPlanEffectiveFrom] = useState(todayStr);
  const [assigningPlan, setAssigningPlan] = useState(false);

  async function loadCommissionPlans() {
    const { data } = await supabase.from("commission_plans").select("id, name").order("created_at", { ascending: false });
    setCommissionPlans(data || []);
  }

  async function loadCommissionAssignments() {
    const { data } = await supabase
      .from("employee_commission_plan_assignments")
      .select(
        "id, plan_id, effective_from, plan:commission_plans(name), assigned_by:employees!employee_commission_plan_assignmen_assigned_by_employee_id_fkey(name)"
      )
      .eq("employee_id", employeeId)
      .order("effective_from", { ascending: false });
    setCommissionAssignments((data || []) as unknown as CommissionAssignmentRow[]);
  }

  useEffect(() => {
    loadCommissionPlans();
    loadCommissionAssignments();
    setAssignPlanId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  const currentCommissionAssignment = commissionAssignments.find((a) => a.effective_from <= todayStr) || null;

  async function handleAssignCommissionPlan() {
    if (!assignPlanEffectiveFrom) {
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

    setAssigningPlan(true);
    const { error } = await supabase.from("employee_commission_plan_assignments").insert({
      employee_id: employeeId,
      plan_id: assignPlanId || null,
      effective_from: assignPlanEffectiveFrom,
      assigned_by_employee_id: me.id
    });
    setAssigningPlan(false);

    if (error) {
      toast.error(error.message || "Could not save assignment.");
      return;
    }

    toast.success(assignPlanId ? "Commission plan assigned." : "Commission plan unassigned.");
    loadCommissionAssignments();
    onAssigned?.();
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-slate-800">Commission Plan Assignment</p>
        <p className="text-sm font-bold text-violet-600">Current: {currentCommissionAssignment?.plan?.name || "None"}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs font-semibold text-slate-500">Plan</label>
          <select
            value={assignPlanId}
            onChange={(e) => setAssignPlanId(e.target.value)}
            className="mt-1 h-9 w-56 rounded-lg bg-slate-50 border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-violet-100 focus:border-violet-300"
          >
            <option value="">— Unassign —</option>
            {commissionPlans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500">Effective From</label>
          <DateInput value={assignPlanEffectiveFrom} onChange={setAssignPlanEffectiveFrom} />
        </div>
        <button
          onClick={handleAssignCommissionPlan}
          disabled={assigningPlan}
          className="h-9 px-4 rounded-xl bg-violet-600 text-white text-xs font-bold disabled:opacity-40 hover:bg-violet-700 transition"
        >
          {assigningPlan ? "Saving..." : "Assign"}
        </button>
      </div>

      {commissionAssignments.length > 0 && (
        <div className="pt-2 border-t border-slate-100 space-y-1.5">
          {commissionAssignments.map((a) => (
            <div key={a.id} className="flex items-center justify-between text-xs">
              <span className="text-slate-600">
                From {a.effective_from} — {a.plan?.name || "Unassigned"}
              </span>
              <span className="text-slate-400">by {a.assigned_by?.name || "—"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
