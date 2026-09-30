"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";
import DateInput from "@/components/DateInput";

interface ConditionRuleOption {
  id: string;
  name: string;
}

interface PayrollRuleAssignmentRow {
  id: string;
  rule_id: string | null;
  effective_from: string;
  rule: { name: string } | null;
  assigned_by: { name: string } | null;
}

// Same effective-dated "drawer" pattern as Commission Plan Assignment.
// Shared by HR and Payroll (equal write access). onAssigned lets a page
// with its own separate cached "current condition rule" (e.g. the
// Payroll page's "Current Setup" card) refresh after an assign/unassign
// here.
export default function ConditionRuleAssignmentForm({ employeeId, onAssigned }: { employeeId: string; onAssigned?: () => void }) {
  const todayStr = new Date().toISOString().slice(0, 10);

  const [conditionRules, setConditionRules] = useState<ConditionRuleOption[]>([]);
  const [ruleAssignments, setRuleAssignments] = useState<PayrollRuleAssignmentRow[]>([]);
  const [assignRuleId, setAssignRuleId] = useState("");
  const [assignRuleEffectiveFrom, setAssignRuleEffectiveFrom] = useState(todayStr);
  const [assigningRule, setAssigningRule] = useState(false);

  async function loadConditionRules() {
    const { data } = await supabase.from("payroll_condition_rules").select("id, name").order("created_at", { ascending: false });
    setConditionRules(data || []);
  }

  async function loadRuleAssignments() {
    const { data } = await supabase
      .from("employee_payroll_rule_assignments")
      .select(
        "id, rule_id, effective_from, rule:payroll_condition_rules(name), assigned_by:employees!employee_payroll_rule_assignments_assigned_by_employee_id_fkey(name)"
      )
      .eq("employee_id", employeeId)
      .order("effective_from", { ascending: false });
    setRuleAssignments((data || []) as unknown as PayrollRuleAssignmentRow[]);
  }

  useEffect(() => {
    loadConditionRules();
    loadRuleAssignments();
    setAssignRuleId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  const currentRuleAssignment = ruleAssignments.find((a) => a.effective_from <= todayStr) || null;

  async function handleAssignConditionRule() {
    if (!assignRuleEffectiveFrom) {
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

    setAssigningRule(true);
    const { error } = await supabase.from("employee_payroll_rule_assignments").insert({
      employee_id: employeeId,
      rule_id: assignRuleId || null,
      effective_from: assignRuleEffectiveFrom,
      assigned_by_employee_id: me.id
    });
    setAssigningRule(false);

    if (error) {
      toast.error(error.message || "Could not save assignment.");
      return;
    }

    toast.success(assignRuleId ? "Payroll condition rule assigned." : "Payroll condition rule unassigned.");
    loadRuleAssignments();
    onAssigned?.();
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-slate-800">Payroll Condition Rule Assignment</p>
        <p className="text-sm font-bold text-rose-600">Current: {currentRuleAssignment?.rule?.name || "None"}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs font-semibold text-slate-500">Rule</label>
          <select
            value={assignRuleId}
            onChange={(e) => setAssignRuleId(e.target.value)}
            className="mt-1 h-9 w-56 rounded-lg bg-slate-50 border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-rose-100 focus:border-rose-300"
          >
            <option value="">— Unassign —</option>
            {conditionRules.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500">Effective From</label>
          <DateInput value={assignRuleEffectiveFrom} onChange={setAssignRuleEffectiveFrom} />
        </div>
        <button
          onClick={handleAssignConditionRule}
          disabled={assigningRule}
          className="h-9 px-4 rounded-xl bg-rose-600 text-white text-xs font-bold disabled:opacity-40 hover:bg-rose-700 transition"
        >
          {assigningRule ? "Saving..." : "Assign"}
        </button>
      </div>

      {ruleAssignments.length > 0 && (
        <div className="pt-2 border-t border-slate-100 space-y-1.5">
          {ruleAssignments.map((a) => (
            <div key={a.id} className="flex items-center justify-between text-xs">
              <span className="text-slate-600">
                From {a.effective_from} — {a.rule?.name || "Unassigned"}
              </span>
              <span className="text-slate-400">by {a.assigned_by?.name || "—"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
