"use client";

// Browser side of lib/resilientLeadUpdate.ts (2026-11-14): the real Supabase calls, the "kept" draft, and the toast
// with a Retry button. Shared by LeadDetailModal and DataDetailModal so both stay a few lines different from before.

import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";
import { logLeadUpdate, type LeadUpdateParams } from "@/lib/logLeadUpdate";
import type { ContactMethod } from "@/lib/callQuality";
import { clearActiveCall } from "@/lib/activeCall";
import { landedFromRows, LANDED_SKEW_MS, type Landed, type SaveOutcome, saveLeadUpdateResilient } from "@/lib/resilientLeadUpdate";

async function checkLanded(params: LeadUpdateParams, sinceMs: number): Promise<Landed> {
  try {
    if (params.p_new_status) {
      const { data, error } = await supabase
        .from("lead_history")
        .select("outcome, outcome_at")
        .eq("id", params.p_lead_history_id)
        .maybeSingle();
      if (error) return "unknown";
      return landedFromRows(params, sinceMs, data as { outcome: string | null; outcome_at: string | null } | null, false);
    }
    if (params.p_note) {
      const { data, error } = await supabase
        .from("lead_notes")
        .select("id")
        .eq("lead_id", params.p_lead_id)
        .eq("note", params.p_note)
        .gte("created_at", new Date(sinceMs - LANDED_SKEW_MS).toISOString())
        .limit(1);
      if (error) return "unknown";
      return landedFromRows(params, sinceMs, null, (data || []).length > 0);
    }
    return "no";
  } catch {
    return "unknown";
  }
}

export function saveLeadUpdate(params: LeadUpdateParams, contactMethod: ContactMethod | null, checkFirstSince: number | null): Promise<SaveOutcome> {
  return saveLeadUpdateResilient(
    params,
    contactMethod,
    {
      send: logLeadUpdate,
      checkLanded,
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
      // logLeadUpdate already ends the active call on its own success; this covers "it had landed".
      onSaved: (p) => {
        if (p.p_new_status) clearActiveCall(null, p.p_lead_id);
      }
    },
    { checkFirstSince }
  );
}

export function showSaveKeptToast(onRetry: () => void) {
  toast.error(
    (t) => (
      <span className="flex items-center gap-3">
        <span>Could not save. Your update is kept, we will retry.</span>
        <button
          onClick={() => {
            toast.dismiss(t.id);
            onRetry();
          }}
          className="shrink-0 rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-bold text-white"
        >
          Retry
        </button>
      </span>
    ),
    { id: "result-save-kept", duration: 15000 }
  );
}
