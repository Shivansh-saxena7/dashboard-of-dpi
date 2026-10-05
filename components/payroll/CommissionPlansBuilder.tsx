"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Percent } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface CommissionPlanTier {
  id: string;
  plan_id: string;
  min_bookings: number;
  rate_type: "PERCENT_OF_SALE_VALUE" | "FLAT_PER_BOOKING";
  rate_value: number;
  sort_order: number;
}

interface CommissionPlan {
  id: string;
  name: string;
  created_at: string;
  created_by: { name: string } | null;
  tiers: CommissionPlanTier[];
}

// Company-wide, immutable once created (a rate change is a new plan,
// never an edit to an existing one, same reasoning as Basic Pay never
// being mutated in place). Shared by HR and Payroll (equal write access
// on commission_plans/commission_plan_tiers). onCreated lets a page that
// separately caches the plan list for a per-employee assignment dropdown
// (see app/hr/salary/page.tsx) refresh its own copy after a create here.
export default function CommissionPlansBuilder({ onCreated }: { onCreated?: () => void }) {
  const [commissionPlans, setCommissionPlans] = useState<CommissionPlan[]>([]);
  const [newPlanName, setNewPlanName] = useState("");
  const [newPlanTiers, setNewPlanTiers] = useState([{ min_bookings: "0", rate_type: "PERCENT_OF_SALE_VALUE", rate_value: "" }]);
  const [savingPlan, setSavingPlan] = useState(false);

  async function loadCommissionPlans() {
    const [{ data: plans }, { data: tiers }] = await Promise.all([
      supabase
        .from("commission_plans")
        .select("id, name, created_at, created_by:employees!commission_plans_created_by_employee_id_fkey(name)")
        .order("created_at", { ascending: false }),
      supabase.from("commission_plan_tiers").select("id, plan_id, min_bookings, rate_type, rate_value, sort_order").order("sort_order")
    ]);
    const tiersByPlan: Record<string, CommissionPlanTier[]> = {};
    for (const t of (tiers || []) as CommissionPlanTier[]) {
      (tiersByPlan[t.plan_id] ||= []).push(t);
    }
    setCommissionPlans((plans || []).map((p) => ({ ...p, tiers: tiersByPlan[p.id] || [] })) as unknown as CommissionPlan[]);
  }

  useEffect(() => {
    loadCommissionPlans();
  }, []);

  function addPlanTierRow() {
    setNewPlanTiers((prev) => [...prev, { min_bookings: "", rate_type: "PERCENT_OF_SALE_VALUE", rate_value: "" }]);
  }

  function removePlanTierRow(idx: number) {
    setNewPlanTiers((prev) => prev.filter((_, i) => i !== idx));
  }

  function updatePlanTierRow(idx: number, patch: Partial<{ min_bookings: string; rate_type: string; rate_value: string }>) {
    setNewPlanTiers((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  async function handleCreateCommissionPlan() {
    if (!newPlanName.trim()) {
      toast.error("Enter a plan name.");
      return;
    }
    const tiers = newPlanTiers
      .map((t, i) => ({ min_bookings: Number(t.min_bookings), rate_type: t.rate_type, rate_value: Number(t.rate_value), sort_order: i }))
      .filter((t) => Number.isFinite(t.min_bookings) && t.min_bookings >= 0 && t.rate_value > 0);
    if (tiers.length === 0) {
      toast.error("Add at least one valid tier.");
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

    setSavingPlan(true);
    const { data: plan, error } = await supabase
      .from("commission_plans")
      .insert({ name: newPlanName.trim(), created_by_employee_id: me.id })
      .select("id")
      .single();

    if (error || !plan) {
      setSavingPlan(false);
      toast.error(error?.message || "Could not create plan.");
      return;
    }

    const { error: tiersError } = await supabase.from("commission_plan_tiers").insert(tiers.map((t) => ({ ...t, plan_id: plan.id })));
    setSavingPlan(false);

    if (tiersError) {
      toast.error(tiersError.message || "Could not save tiers.");
      return;
    }

    toast.success("Commission plan created.");
    setNewPlanName("");
    setNewPlanTiers([{ min_bookings: "0", rate_type: "PERCENT_OF_SALE_VALUE", rate_value: "" }]);
    loadCommissionPlans();
    onCreated?.();
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3">
      <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
        <Percent size={15} className="text-violet-600" /> Commission Plans
      </p>
      <p className="text-xs text-slate-500 -mt-2">
        Plans are immutable once created — to change rates, create a new plan and reassign affected employees to it.
      </p>

      <div className="space-y-2 pb-3 border-b border-slate-100">
        <div>
          <label className="text-xs font-semibold text-slate-500">Plan Name</label>
          <input
            type="text"
            value={newPlanName}
            onChange={(e) => setNewPlanName(e.target.value)}
            placeholder="e.g. Sales Executive — Standard"
            className="mt-1 h-9 w-64 rounded-lg bg-slate-50 border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-violet-100 focus:border-violet-300"
          />
        </div>

        <div className="space-y-1.5">
          {newPlanTiers.map((tier, idx) => (
            <div key={idx} className="flex flex-wrap items-end gap-2">
              <div>
                <label className="block text-xs font-semibold text-slate-500">Min Bookings</label>
                <input
                  type="number"
                  min={0}
                  value={tier.min_bookings}
                  onChange={(e) => updatePlanTierRow(idx, { min_bookings: e.target.value })}
                  className="mt-1 h-8 w-20 rounded-lg bg-slate-50 border border-slate-200 px-2 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-violet-100 focus:border-violet-300"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500">Rate Type</label>
                <select
                  value={tier.rate_type}
                  onChange={(e) => updatePlanTierRow(idx, { rate_type: e.target.value })}
                  className="mt-1 h-8 w-40 sm:w-44 rounded-lg bg-slate-50 border border-slate-200 px-2 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-violet-100 focus:border-violet-300"
                >
                  <option value="PERCENT_OF_SALE_VALUE">% of Sale Value</option>
                  <option value="FLAT_PER_BOOKING">Flat Rs. per Booking</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500">{tier.rate_type === "FLAT_PER_BOOKING" ? "Rs. / booking" : "Rate %"}</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={tier.rate_value}
                  onChange={(e) => updatePlanTierRow(idx, { rate_value: e.target.value })}
                  className="mt-1 h-8 w-24 rounded-lg bg-slate-50 border border-slate-200 px-2 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-violet-100 focus:border-violet-300"
                />
              </div>
              {newPlanTiers.length > 1 && (
                <button onClick={() => removePlanTierRow(idx)} className="h-8 text-xs font-bold text-red-500 hover:underline">
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <button onClick={addPlanTierRow} className="text-xs font-bold text-violet-600 hover:underline">
            + Add Tier
          </button>
          <button
            onClick={handleCreateCommissionPlan}
            disabled={savingPlan}
            className="h-9 px-4 rounded-xl bg-violet-600 text-white text-xs font-bold disabled:opacity-40 hover:bg-violet-700 transition"
          >
            {savingPlan ? "Creating..." : "Create Plan"}
          </button>
        </div>
      </div>

      {commissionPlans.length === 0 ? (
        <p className="text-xs text-slate-400">No commission plans yet.</p>
      ) : (
        <div className="space-y-1.5 max-h-56 overflow-y-auto">
          {commissionPlans.map((p) => (
            <div key={p.id} className="text-xs">
              <span className="font-bold text-slate-700">{p.name}</span>
              <span className="text-slate-500">
                {" — "}
                {p.tiers
                  .slice()
                  .sort((a, b) => a.sort_order - b.sort_order)
                  .map((t) =>
                    t.rate_type === "FLAT_PER_BOOKING"
                      ? `${t.min_bookings}+ bookings: Rs. ${t.rate_value}/booking`
                      : `${t.min_bookings}+ bookings: ${t.rate_value}% of sale value`
                  )
                  .join("; ")}
              </span>
              {p.created_by && (
                <div className="text-slate-400">
                  Created by {p.created_by.name} on {new Date(p.created_at).toLocaleDateString()}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
