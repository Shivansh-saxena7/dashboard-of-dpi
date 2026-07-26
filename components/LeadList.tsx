"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import LeadCard from "./LeadCard";
import LeadDetailModal from "./LeadDetailModal";
import { LeadStatus } from "@/lib/getValidNextLeadStatuses";

interface LeadListProps {
  employeeId: string;
}

const SLA_RECHECK_INTERVAL_MS = 30000;

// Employee-facing lead list — "Always shows New" is enforced simply
// by what this query does NOT touch: it never selects from
// lead_history beyond the caller's own single active row (via
// !inner + is_active=true), never exposes recycle_count to any
// visual element, and never joins lead_notes from a prior owner
// (impossible anyway — lead_notes RLS only returns each employee's
// own authored rows). There is no "recycled" badge to accidentally
// render because the query simply has no path to that data.
export default function LeadList({ employeeId }: LeadListProps) {

  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(new Date());
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  useEffect(() => {
    loadLeads();
  }, [employeeId]);

  // Single shared clock for all cards' SLA countdowns, rather than
  // each LeadCard running its own interval.
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), SLA_RECHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  async function loadLeads() {
    setLoading(true);

    const { data, error } = await supabase
      .from("leads")
      .select(
        `
        id,
        name,
        mobile,
        project,
        status,
        priority,
        sla_deadline,
        recycle_count,
        created_at,
        lead_history!inner (
          id,
          call_count,
          outcome_at
        )
      `
      )
      .eq("current_owner_id", employeeId)
      .eq("lead_history.employee_id", employeeId)
      .eq("lead_history.is_active", true)
      .order("created_at", { ascending: false });

    if (!error && data) {
      setLeads(data);
    }

    setLoading(false);
  }

  // Optimistic local patch after a successful log_lead_update_atomic
  // call — no full refetch needed, since the RPC already tells us
  // exactly what changed. outcome_at is bumped to "now" locally too,
  // so SLA/cooldown badges reflect the change immediately rather than
  // waiting for a reload.
  function handleLeadUpdated(leadId: string, updates: { status?: LeadStatus; callCount: number }) {
    setLeads((prev) =>
      prev.map((lead) => {
        if (lead.id !== leadId) return lead;

        const currentHistory = lead.lead_history[0] ?? {};

        return {
          ...lead,
          status: updates.status ?? lead.status,
          lead_history: [
            {
              ...currentHistory,
              call_count: updates.callCount,
              outcome_at: updates.status ? new Date().toISOString() : currentHistory.outcome_at
            }
          ]
        };
      })
    );
  }

  if (loading) {
    return (
      <div className="mx-4 mt-6 text-center text-sm text-slate-400">
        Loading your leads...
      </div>
    );
  }

  if (leads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center mt-16 text-center px-4">
        <div className="text-5xl mb-3">📋</div>
        <h2 className="text-lg font-semibold text-gray-700">No leads yet</h2>
        <p className="text-sm text-gray-500 mt-1">
          New leads assigned to you will show up here.
        </p>
      </div>
    );
  }

  const selectedLead = leads.find((lead) => lead.id === selectedLeadId);

  return (
    <>
      <div className="mx-4 mt-4 space-y-3 pb-6">
        {leads.map((lead: any) => (
          <LeadCard
            key={lead.id}
            now={now}
            onOpen={() => setSelectedLeadId(lead.id)}
            lead={{
              id: lead.id,
              name: lead.name,
              mobile: lead.mobile,
              project: lead.project,
              status: lead.status,
              priority: lead.priority,
              sla_deadline: lead.sla_deadline,
              recycle_count: lead.recycle_count,
              call_count: lead.lead_history[0]?.call_count ?? 0,
              outcome_at: lead.lead_history[0]?.outcome_at ?? null
            }}
          />
        ))}
      </div>

      {selectedLead && (
        <LeadDetailModal
          lead={{
            id: selectedLead.id,
            leadHistoryId: selectedLead.lead_history[0]?.id,
            name: selectedLead.name,
            mobile: selectedLead.mobile,
            project: selectedLead.project,
            status: selectedLead.status,
            callCount: selectedLead.lead_history[0]?.call_count ?? 0
          }}
          onClose={() => setSelectedLeadId(null)}
          onUpdated={(updates) => handleLeadUpdated(selectedLead.id, updates)}
        />
      )}
    </>
  );
}
