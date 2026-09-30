"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";
import DateInput from "@/components/DateInput";

type AttendanceRuleType = "LATE_COMING_THRESHOLD" | "SANDWICH_LEAVE";

interface AttendanceRuleOption {
  id: string;
  name: string;
  rule_type: AttendanceRuleType;
}

interface AttendanceRuleAssignmentRow {
  id: string;
  rule_id: string | null;
  effective_from: string;
  rule: { name: string; rule_type: AttendanceRuleType } | null;
  assigned_by: { name: string } | null;
}

const ATTENDANCE_RULE_TYPE_LABELS: Record<AttendanceRuleType, string> = {
  LATE_COMING_THRESHOLD: "Late Coming",
  SANDWICH_LEAVE: "Sandwich Leave"
};

// MULTIPLE concurrent assignments per employee are allowed (opt into
// Late Coming without Sandwich Leave, or both), so "current" is resolved
// per rule_type, not as one single latest row. A bare unassign row
// (rule_id = null) carries no type of its own -- currentForType() below
// deliberately resolves that conservatively (fails toward "None" rather
// than a stale "Assigned") by unioning null rows into every type's
// candidate set. Shared by HR and Payroll (equal write access).
// onAssigned lets a page with its own separate cached "current
// attendance rules" (e.g. the Payroll page's "Current Setup" card)
// refresh after an assign/unassign here.
export default function AttendanceRuleAssignmentForm({ employeeId, onAssigned }: { employeeId: string; onAssigned?: () => void }) {
  const todayStr = new Date().toISOString().slice(0, 10);

  const [attendanceRules, setAttendanceRules] = useState<AttendanceRuleOption[]>([]);
  const [attRuleAssignments, setAttRuleAssignments] = useState<AttendanceRuleAssignmentRow[]>([]);
  const [assignLateRuleId, setAssignLateRuleId] = useState("");
  const [assignSandwichRuleId, setAssignSandwichRuleId] = useState("");
  const [attAssignEffectiveFrom, setAttAssignEffectiveFrom] = useState(todayStr);
  const [assigningAttRule, setAssigningAttRule] = useState(false);

  async function loadAttendanceRules() {
    const { data } = await supabase.from("attendance_deduction_rules").select("id, name, rule_type").order("created_at", { ascending: false });
    setAttendanceRules((data || []) as AttendanceRuleOption[]);
  }

  async function loadAttRuleAssignments() {
    const { data } = await supabase
      .from("employee_attendance_deduction_rule_assignments")
      .select(
        "id, rule_id, effective_from, rule:attendance_deduction_rules(name, rule_type), assigned_by:employees!employee_attendance_deduction_rule_assigned_by_employee_id_fkey(name)"
      )
      .eq("employee_id", employeeId)
      .order("effective_from", { ascending: false });
    setAttRuleAssignments((data || []) as unknown as AttendanceRuleAssignmentRow[]);
  }

  useEffect(() => {
    loadAttendanceRules();
    loadAttRuleAssignments();
    setAssignLateRuleId("");
    setAssignSandwichRuleId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  function currentForType(type: AttendanceRuleType): AttendanceRuleAssignmentRow | null {
    const relevant = attRuleAssignments.filter((a) => a.effective_from <= todayStr && (a.rule_id === null || a.rule?.rule_type === type));
    return relevant[0] || null;
  }

  async function handleAssignAttendanceRule(ruleId: string) {
    if (!attAssignEffectiveFrom) {
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

    setAssigningAttRule(true);
    const { error } = await supabase.from("employee_attendance_deduction_rule_assignments").insert({
      employee_id: employeeId,
      rule_id: ruleId || null,
      effective_from: attAssignEffectiveFrom,
      assigned_by_employee_id: me.id
    });
    setAssigningAttRule(false);

    if (error) {
      toast.error(error.message || "Could not save assignment.");
      return;
    }

    toast.success(ruleId ? "Attendance deduction rule assigned." : "Attendance deduction rule unassigned.");
    loadAttRuleAssignments();
    onAssigned?.();
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3">
      <p className="text-sm font-bold text-slate-800">Attendance Deduction Rule Assignment</p>
      <p className="text-xs text-slate-500 -mt-2">Opt-in — leave both unassigned for a flat-salary employee with no attendance deductions.</p>

      <div>
        <label className="text-xs font-semibold text-slate-500">Effective From (applies to whichever you assign below)</label>
        <DateInput value={attAssignEffectiveFrom} onChange={setAttAssignEffectiveFrom} />
      </div>

      {(
        [
          ["LATE_COMING_THRESHOLD", currentForType("LATE_COMING_THRESHOLD"), assignLateRuleId, setAssignLateRuleId] as const,
          ["SANDWICH_LEAVE", currentForType("SANDWICH_LEAVE"), assignSandwichRuleId, setAssignSandwichRuleId] as const
        ]
      ).map(([type, current, selected, setSelected]) => (
        <div key={type} className="flex flex-wrap items-end gap-3 pt-2 border-t border-slate-100">
          <div className="w-32">
            <p className="text-xs font-bold text-slate-600">{ATTENDANCE_RULE_TYPE_LABELS[type]}</p>
            <p className="text-xs font-bold text-cyan-600">{current?.rule?.name || "None"}</p>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Rule</label>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="mt-1 h-9 w-56 rounded-lg bg-slate-50 border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-cyan-100 focus:border-cyan-300"
            >
              <option value="">— Unassign —</option>
              {attendanceRules
                .filter((r) => r.rule_type === type)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </select>
          </div>
          <button
            onClick={() => handleAssignAttendanceRule(selected)}
            disabled={assigningAttRule}
            className="h-9 px-4 rounded-xl bg-cyan-600 text-white text-xs font-bold disabled:opacity-40 hover:bg-cyan-700 transition"
          >
            {assigningAttRule ? "Saving..." : "Assign"}
          </button>
        </div>
      ))}

      {attRuleAssignments.length > 0 && (
        <div className="pt-2 border-t border-slate-100 space-y-1.5">
          {attRuleAssignments.map((a) => (
            <div key={a.id} className="flex items-center justify-between text-xs">
              <span className="text-slate-600">
                From {a.effective_from} — {a.rule ? `${a.rule.name} (${ATTENDANCE_RULE_TYPE_LABELS[a.rule.rule_type]})` : "Unassigned"}
              </span>
              <span className="text-slate-400">by {a.assigned_by?.name || "—"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
