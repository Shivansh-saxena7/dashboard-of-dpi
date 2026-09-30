"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface PayrollConditionRuleTier {
  id: string;
  rule_id: string;
  min_metric_value: number;
  salary_percent: number;
  sort_order: number;
}

interface PayrollConditionRule {
  id: string;
  name: string;
  metric: string;
  refund_on_recovery: boolean;
  created_at: string;
  created_by: { name: string } | null;
  tiers: PayrollConditionRuleTier[];
}

// Same immutable-once-created shape as Commission Plans. metric is fixed
// to 'BOOKINGS_COUNT' (the only metric the DB CHECK constraint currently
// allows); refund_on_recovery drives the cross-month refund logic at
// computation time (lib/computePayrollAdjustments.ts). Shared by HR and
// Payroll (equal write access). onCreated lets a page that separately
// caches the rule list for a per-employee assignment dropdown (see
// app/hr/salary/page.tsx) refresh its own copy after a create here.
export default function PayrollConditionRulesBuilder({ onCreated }: { onCreated?: () => void }) {
  const [conditionRules, setConditionRules] = useState<PayrollConditionRule[]>([]);
  const [newRuleName, setNewRuleName] = useState("");
  const [newRuleRefund, setNewRuleRefund] = useState(false);
  const [newRuleTiers, setNewRuleTiers] = useState([{ min_metric_value: "0", salary_percent: "" }]);
  const [savingRule, setSavingRule] = useState(false);

  async function loadConditionRules() {
    const [{ data: rules }, { data: tiers }] = await Promise.all([
      supabase
        .from("payroll_condition_rules")
        .select("id, name, metric, refund_on_recovery, created_at, created_by:employees!payroll_condition_rules_created_by_employee_id_fkey(name)")
        .order("created_at", { ascending: false }),
      supabase.from("payroll_condition_rule_tiers").select("id, rule_id, min_metric_value, salary_percent, sort_order").order("sort_order")
    ]);
    const tiersByRule: Record<string, PayrollConditionRuleTier[]> = {};
    for (const t of (tiers || []) as PayrollConditionRuleTier[]) {
      (tiersByRule[t.rule_id] ||= []).push(t);
    }
    setConditionRules((rules || []).map((r) => ({ ...r, tiers: tiersByRule[r.id] || [] })) as unknown as PayrollConditionRule[]);
  }

  useEffect(() => {
    loadConditionRules();
  }, []);

  function addRuleTierRow() {
    setNewRuleTiers((prev) => [...prev, { min_metric_value: "", salary_percent: "" }]);
  }

  function removeRuleTierRow(idx: number) {
    setNewRuleTiers((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateRuleTierRow(idx: number, patch: Partial<{ min_metric_value: string; salary_percent: string }>) {
    setNewRuleTiers((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  async function handleCreateConditionRule() {
    if (!newRuleName.trim()) {
      toast.error("Enter a rule name.");
      return;
    }
    const filled = newRuleTiers.filter((t) => t.min_metric_value !== "" && t.salary_percent !== "");
    if (filled.length === 0) {
      toast.error("Add at least one valid tier.");
      return;
    }
    const tiers = filled.map((t, i) => ({
      min_metric_value: Number(t.min_metric_value),
      salary_percent: Number(t.salary_percent),
      sort_order: i
    }));
    if (
      tiers.some((t) => !Number.isFinite(t.min_metric_value) || t.min_metric_value < 0 || !Number.isFinite(t.salary_percent) || t.salary_percent < 0 || t.salary_percent > 100)
    ) {
      toast.error("Tier values out of range (Min Bookings >= 0, Salary % 0-100).");
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

    setSavingRule(true);
    const { data: rule, error } = await supabase
      .from("payroll_condition_rules")
      .insert({ name: newRuleName.trim(), metric: "BOOKINGS_COUNT", refund_on_recovery: newRuleRefund, created_by_employee_id: me.id })
      .select("id")
      .single();

    if (error || !rule) {
      setSavingRule(false);
      toast.error(error?.message || "Could not create rule.");
      return;
    }

    const { error: tiersError } = await supabase.from("payroll_condition_rule_tiers").insert(tiers.map((t) => ({ ...t, rule_id: rule.id })));
    setSavingRule(false);

    if (tiersError) {
      toast.error(tiersError.message || "Could not save tiers.");
      return;
    }

    toast.success("Payroll condition rule created.");
    setNewRuleName("");
    setNewRuleRefund(false);
    setNewRuleTiers([{ min_metric_value: "0", salary_percent: "" }]);
    loadConditionRules();
    onCreated?.();
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3">
      <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
        <ShieldCheck size={15} className="text-rose-600" /> Payroll Condition Rules
      </p>
      <p className="text-xs text-slate-500 -mt-2">
        Performance-gate rules (e.g. &quot;4+ bookings/month for full pay, else 50%&quot;). Immutable once created — metric is monthly
        booking count. &quot;Refund on recovery&quot; means: if a cut month is immediately followed by a month that clears the top
        tier, the cut is refunded in that next slip.
      </p>

      <div className="space-y-2 pb-3 border-b border-slate-100">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs font-semibold text-slate-500">Rule Name</label>
            <input
              type="text"
              value={newRuleName}
              onChange={(e) => setNewRuleName(e.target.value)}
              placeholder="e.g. Team Lead — 4 Booking Minimum"
              className="mt-1 h-9 w-64 rounded-lg bg-slate-50 border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-rose-100 focus:border-rose-300"
            />
          </div>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 cursor-pointer h-9">
            <input
              type="checkbox"
              checked={newRuleRefund}
              onChange={(e) => setNewRuleRefund(e.target.checked)}
              style={{ appearance: "auto" }}
              className="h-4 w-4 shrink-0 accent-rose-600 cursor-pointer"
            />
            Refund on recovery (consecutive month only)
          </label>
        </div>

        <div className="space-y-1.5">
          {newRuleTiers.map((tier, idx) => (
            <div key={idx} className="flex items-end gap-2">
              <div>
                <label className="text-xs font-semibold text-slate-500">Min Bookings/Month</label>
                <input
                  type="number"
                  min={0}
                  value={tier.min_metric_value}
                  onChange={(e) => updateRuleTierRow(idx, { min_metric_value: e.target.value })}
                  className="mt-1 h-8 w-32 rounded-lg bg-slate-50 border border-slate-200 px-2 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-rose-100 focus:border-rose-300"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500">Salary % Paid</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={tier.salary_percent}
                  onChange={(e) => updateRuleTierRow(idx, { salary_percent: e.target.value })}
                  className="mt-1 h-8 w-24 rounded-lg bg-slate-50 border border-slate-200 px-2 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-rose-100 focus:border-rose-300"
                />
              </div>
              {newRuleTiers.length > 1 && (
                <button onClick={() => removeRuleTierRow(idx)} className="h-8 text-xs font-bold text-red-500 hover:underline">
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <button onClick={addRuleTierRow} className="text-xs font-bold text-rose-600 hover:underline">
            + Add Tier
          </button>
          <button
            onClick={handleCreateConditionRule}
            disabled={savingRule}
            className="h-9 px-4 rounded-xl bg-rose-600 text-white text-xs font-bold disabled:opacity-40 hover:bg-rose-700 transition"
          >
            {savingRule ? "Creating..." : "Create Rule"}
          </button>
        </div>
      </div>

      {conditionRules.length === 0 ? (
        <p className="text-xs text-slate-400">No payroll condition rules yet.</p>
      ) : (
        <div className="space-y-1.5 max-h-56 overflow-y-auto">
          {conditionRules.map((r) => (
            <div key={r.id} className="text-xs">
              <span className="font-bold text-slate-700">{r.name}</span>
              {r.refund_on_recovery && <span className="ml-1.5 text-rose-600 font-semibold">(refund-eligible)</span>}
              <span className="text-slate-500">
                {" — "}
                {r.tiers
                  .slice()
                  .sort((a, b) => a.sort_order - b.sort_order)
                  .map((t) => `${t.min_metric_value}+ bookings: ${t.salary_percent}% pay`)
                  .join("; ")}
              </span>
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
