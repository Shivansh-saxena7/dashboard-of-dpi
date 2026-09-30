"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";

interface CompanySettings {
  company_cin: string | null;
  company_gstin: string | null;
  updated_at: string | null;
  updated_by: { name: string } | null;
}

// Company-wide (not per-employee) registration numbers -- single row in
// hrms_settings, shared by HR and Payroll (both roles have equal write
// access on hrms_settings). onSaved lets a page that separately caches
// these values for its own purposes (e.g. the Payroll Salary page uses
// them when building a slip PDF) refresh its own copy after a save here.
export default function CompanyRegistrationDetails({ onSaved }: { onSaved?: () => void }) {
  const [companySettings, setCompanySettings] = useState<CompanySettings>({
    company_cin: "",
    company_gstin: "",
    updated_at: null,
    updated_by: null
  });
  const [savingCompanySettings, setSavingCompanySettings] = useState(false);

  async function loadCompanySettings() {
    const { data } = await supabase
      .from("hrms_settings")
      .select("company_cin, company_gstin, updated_at, updated_by:employees!hrms_settings_updated_by_employee_id_fkey(name)")
      .eq("id", 1)
      .maybeSingle();
    if (data) setCompanySettings(data as unknown as CompanySettings);
  }

  useEffect(() => {
    loadCompanySettings();
  }, []);

  async function handleSaveCompanySettings() {
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data: me } = await supabase.from("employees").select("id").eq("auth_user_id", user.id).single();
    if (!me) {
      toast.error("Could not identify your employee record.");
      return;
    }

    setSavingCompanySettings(true);
    const { error } = await supabase
      .from("hrms_settings")
      .update({
        company_cin: companySettings.company_cin || null,
        company_gstin: companySettings.company_gstin || null,
        updated_by_employee_id: me.id,
        updated_at: new Date().toISOString()
      })
      .eq("id", 1);
    setSavingCompanySettings(false);

    if (error) {
      toast.error(error.message || "Could not save company details.");
      return;
    }
    toast.success("Company registration details saved.");
    loadCompanySettings();
    onSaved?.();
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3">
      <p className="text-sm font-bold text-slate-800">Company Registration Details</p>
      <p className="text-xs text-slate-500 -mt-2">Shown in the slip header, blank until set. Company-wide, not per-employee.</p>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs font-semibold text-slate-500">CIN</label>
          <input
            type="text"
            value={companySettings.company_cin || ""}
            onChange={(e) => setCompanySettings((prev) => ({ ...prev, company_cin: e.target.value }))}
            className="mt-1 h-9 w-48 rounded-lg bg-slate-50 border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-100 focus:border-emerald-300"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500">GSTIN</label>
          <input
            type="text"
            value={companySettings.company_gstin || ""}
            onChange={(e) => setCompanySettings((prev) => ({ ...prev, company_gstin: e.target.value }))}
            className="mt-1 h-9 w-48 rounded-lg bg-slate-50 border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-100 focus:border-emerald-300"
          />
        </div>
        <button
          onClick={handleSaveCompanySettings}
          disabled={savingCompanySettings}
          className="h-9 px-4 rounded-xl bg-slate-800 text-white text-xs font-bold disabled:opacity-40 hover:bg-slate-900 transition"
        >
          {savingCompanySettings ? "Saving..." : "Save"}
        </button>
      </div>
      {companySettings.updated_by && (
        <p className="text-xs text-slate-400">
          Last updated by {companySettings.updated_by.name} on {new Date(companySettings.updated_at!).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}
