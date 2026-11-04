"use client";

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import GuardHeldReassignDialog from "./GuardHeldReassignDialog";
import { guardHeldUnavailable, positiveLabel, refusedForText, shortDateIst, type GuardHeldLead } from "@/lib/guardHeldLeads";

// Leads auto-junk wanted to junk but the positive-history guard refused. Admin only (the function checks the role).
// Hidden until the SQL is applied. refreshKey: the page's Refresh button reloads this card too.
export default function GuardHeldLeadsCard({ refreshKey = 0 }: { refreshKey?: number }) {
  const [leads, setLeads] = useState<GuardHeldLead[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "failed" | "hidden">("loading");
  const [reassigning, setReassigning] = useState<GuardHeldLead | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase.rpc("get_guard_held_leads");
      if (!active) return;
      if (error) {
        setState(guardHeldUnavailable(error) ? "hidden" : "failed");
        return;
      }
      setLeads((data ?? []) as GuardHeldLead[]);
      setState("ready");
    })();
    return () => {
      active = false;
    };
  }, [refreshKey, reloadKey]);

  if (state === "hidden") return null;

  return (
    <section className="rounded-2xl bg-white border border-slate-200 shadow-[0_2px_10px_rgba(15,23,42,0.05)] p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-amber-600" />
          <h2 className="text-sm font-bold text-slate-800">Leads held by the positive-history guard</h2>
        </div>
        {state === "ready" && (
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
            {leads.length} {leads.length === 1 ? "lead" : "leads"}
          </span>
        )}
      </div>
      <p className="text-xs text-slate-500 mt-1">
        Auto-junk tried to junk these leads, but each one had a positive conversation, so they stay with their owner. Please review them.
      </p>

      {state === "loading" && <p className="text-sm text-slate-400 mt-3">Loading...</p>}
      {state === "failed" && <p className="text-sm text-red-600 mt-3">Could not load this list. Please refresh.</p>}
      {state === "ready" && leads.length === 0 && <p className="text-sm text-slate-400 mt-3">No leads are being held right now.</p>}
      {state === "ready" && leads.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-slate-500 border-b border-slate-100">
                <th className="py-2 pr-3">Lead</th>
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Owner</th>
                <th className="py-2 pr-3">Recycles</th>
                <th className="py-2 pr-3">Positive</th>
                <th className="py-2 pr-3">Last activity</th>
                <th className="py-2 pr-3">Refused for</th>
                <th className="py-2"><span className="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.lead_id8} className="border-b border-slate-50 last:border-0 text-slate-700">
                  <td className="py-2 pr-3 font-mono text-xs text-slate-500">{lead.lead_id8}</td>
                  <td className="py-2 pr-3">{lead.lead_name || "-"}</td>
                  <td className="py-2 pr-3">{lead.owner_name || "-"}</td>
                  <td className="py-2 pr-3">{lead.recycle_count}</td>
                  <td className="py-2 pr-3">{positiveLabel(lead.positive_kind)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{shortDateIst(lead.last_activity_at)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{refusedForText(lead.days_refused)}</td>
                  <td className="py-2 text-right">
                    <button onClick={() => setReassigning(lead)} className="text-xs font-semibold text-slate-700 border border-slate-200 rounded-lg px-2.5 py-1 hover:bg-slate-50 transition">
                      Reassign
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {reassigning && (
        <GuardHeldReassignDialog
          lead={reassigning}
          onClose={() => setReassigning(null)}
          onDone={() => {
            setReassigning(null);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </section>
  );
}
