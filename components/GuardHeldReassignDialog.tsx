"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";
import {
  HELD_REASSIGN_REASON,
  heldLeadIdRange,
  heldReassignOutcome,
  heldReassignTargets,
  type GuardHeldLead,
  type ReassignEmployee
} from "@/lib/guardHeldLeads";

// Admin action on one held lead. Uses reassign_keep_state_atomic, the same path as the earlier batches: status, stage and
// history stay, and the database itself checks the caller is an admin. Reads only the lead id and its owner.
export default function GuardHeldReassignDialog({
  lead,
  onClose,
  onDone
}: {
  lead: GuardHeldLead;
  onClose: () => void;
  onDone: () => void;
}) {
  const [leadId, setLeadId] = useState<string | null>(null);
  const [targets, setTargets] = useState<ReassignEmployee[]>([]);
  const [targetId, setTargetId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const range = heldLeadIdRange(lead.lead_id8);
      if (!range) {
        setError("This lead could not be found. Please refresh the list.");
        setLoading(false);
        return;
      }
      const [leadResult, employeeResult] = await Promise.all([
        supabase.from("leads").select("id, current_owner_id").gte("id", range.from).lte("id", range.to).limit(2),
        supabase.from("employees").select("id, name, role, department, is_active").eq("is_active", true).limit(200)
      ]);
      if (!active) return;
      if (leadResult.error || employeeResult.error || leadResult.data?.length !== 1) {
        setError("This lead could not be loaded. Please refresh the list.");
        setLoading(false);
        return;
      }
      const row = leadResult.data[0];
      setLeadId(row.id);
      setTargets(heldReassignTargets((employeeResult.data ?? []) as ReassignEmployee[], row.current_owner_id));
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [lead.lead_id8]);

  async function handleReassign() {
    if (!leadId || !targetId || saving) return;
    setSaving(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc("reassign_keep_state_atomic", {
      p_lead_id: leadId,
      p_new_employee_id: targetId,
      p_reason: HELD_REASSIGN_REASON
    });
    const outcome = heldReassignOutcome(data, rpcError);
    setSaving(false);
    if (!outcome.ok) {
      setError(outcome.message);
      return;
    }
    toast.success(outcome.message);
    onDone();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-labelledby="held-reassign-title">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <h3 id="held-reassign-title" className="text-base font-bold text-slate-800">Reassign lead</h3>
        <p className="text-sm text-slate-600 mt-1">
          {lead.lead_name || "Lead"} <span className="font-mono text-xs text-slate-400">{lead.lead_id8}</span>, now with {lead.owner_name || "no owner"}.
        </p>

        <label htmlFor="held-reassign-employee" className="block text-xs font-semibold text-slate-600 mt-4 mb-1">New owner</label>
        <select
          id="held-reassign-employee"
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          disabled={loading || saving || !leadId}
          className="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 disabled:opacity-60"
        >
          <option value="">{loading ? "Loading..." : "Choose an employee"}</option>
          {targets.map((employee) => (
            <option key={employee.id} value={employee.id}>{employee.name}</option>
          ))}
        </select>

        <p className="text-xs text-slate-500 mt-3">
          The lead&apos;s history and status will not change. It moves to the new owner and gets the usual protection from recycling and auto-junk.
        </p>
        {error && <p className="text-sm text-red-600 mt-3" role="alert">{error}</p>}

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} disabled={saving} className="h-10 px-4 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            Cancel
          </button>
          <button onClick={handleReassign} disabled={!targetId || !leadId || saving} className="h-10 px-4 rounded-xl bg-slate-800 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-50">
            {saving ? "Reassigning..." : "Reassign"}
          </button>
        </div>
      </div>
    </div>
  );
}
