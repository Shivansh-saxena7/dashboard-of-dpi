"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { AlarmClock } from "lucide-react";
import { supabase } from "@/lib/supabase";

type AttendanceRuleType = "LATE_COMING_THRESHOLD" | "SANDWICH_LEAVE";

interface AttendanceRule {
  id: string;
  name: string;
  rule_type: AttendanceRuleType;
  created_at: string;
  created_by: { name: string } | null;
}

const ATTENDANCE_RULE_TYPE_LABELS: Record<AttendanceRuleType, string> = {
  LATE_COMING_THRESHOLD: "Late Coming",
  SANDWICH_LEAVE: "Sandwich Leave"
};

// Simpler than Commission Plans/Condition Rules: no tiers, just a name +
// fixed rule_type. Shared by HR and Payroll (equal write access on
// attendance_deduction_rules). onCreated lets a page that separately
// caches the rule list for a per-employee assignment dropdown (see
// app/hr/salary/page.tsx) refresh its own copy after a create here.
export default function AttendanceDeductionRulesBuilder({ onCreated }: { onCreated?: () => void }) {
  const [attendanceRules, setAttendanceRules] = useState<AttendanceRule[]>([]);
  const [newAttRuleName, setNewAttRuleName] = useState("");
  const [newAttRuleType, setNewAttRuleType] = useState<AttendanceRuleType>("LATE_COMING_THRESHOLD");
  const [savingAttRule, setSavingAttRule] = useState(false);

  async function loadAttendanceRules() {
    const { data } = await supabase
      .from("attendance_deduction_rules")
      .select("id, name, rule_type, created_at, created_by:employees!attendance_deduction_rules_created_by_employee_id_fkey(name)")
      .order("created_at", { ascending: false });
    setAttendanceRules((data || []) as unknown as AttendanceRule[]);
  }

  useEffect(() => {
    loadAttendanceRules();
  }, []);

  async function handleCreateAttendanceRule() {
    if (!newAttRuleName.trim()) {
      toast.error("Enter a rule name.");
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

    setSavingAttRule(true);
    const { error } = await supabase.from("attendance_deduction_rules").insert({
      name: newAttRuleName.trim(),
      rule_type: newAttRuleType,
      created_by_employee_id: me.id
    });
    setSavingAttRule(false);

    if (error) {
      toast.error(error.message || "Could not create rule.");
      return;
    }

    toast.success("Attendance deduction rule created.");
    setNewAttRuleName("");
    loadAttendanceRules();
    onCreated?.();
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3">
      <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
        <AlarmClock size={15} className="text-cyan-600" /> Attendance Deduction Rules
      </p>
      <p className="text-xs text-slate-500 -mt-2">
        Opt-in per employee — not every employee needs these. Late Coming reuses the existing 2-free-per-month policy; Sandwich Leave
        treats a weekly-off between two absences as a paid deduction too. No numeric setup here; each is just a named rule of one of
        the two types.
      </p>

      <div className="flex flex-wrap items-end gap-3 pb-3 border-b border-slate-100">
        <div>
          <label className="text-xs font-semibold text-slate-500">Rule Name</label>
          <input
            type="text"
            value={newAttRuleName}
            onChange={(e) => setNewAttRuleName(e.target.value)}
            placeholder="e.g. Late Coming Deduction"
            className="mt-1 h-9 w-64 rounded-lg bg-slate-50 border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-cyan-100 focus:border-cyan-300"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500">Type</label>
          <select
            value={newAttRuleType}
            onChange={(e) => setNewAttRuleType(e.target.value as AttendanceRuleType)}
            className="mt-1 h-9 w-48 rounded-lg bg-slate-50 border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-cyan-100 focus:border-cyan-300"
          >
            <option value="LATE_COMING_THRESHOLD">Late Coming</option>
            <option value="SANDWICH_LEAVE">Sandwich Leave</option>
          </select>
        </div>
        <button
          onClick={handleCreateAttendanceRule}
          disabled={savingAttRule}
          className="h-9 px-4 rounded-xl bg-cyan-600 text-white text-xs font-bold disabled:opacity-40 hover:bg-cyan-700 transition"
        >
          {savingAttRule ? "Creating..." : "Create Rule"}
        </button>
      </div>

      {attendanceRules.length === 0 ? (
        <p className="text-xs text-slate-400">No attendance deduction rules yet.</p>
      ) : (
        <div className="space-y-1.5 max-h-56 overflow-y-auto">
          {attendanceRules.map((r) => (
            <div key={r.id} className="text-xs">
              <span className="font-bold text-slate-700">{r.name}</span>
              <span className="text-slate-500"> — {ATTENDANCE_RULE_TYPE_LABELS[r.rule_type]}</span>
              {r.created_by && (
                <div className="text-slate-400">
                  Created by {r.created_by.name} on {new Date(r.created_at).toLocaleDateString()}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
