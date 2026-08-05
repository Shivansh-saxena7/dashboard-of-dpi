"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import DataCard from "./DataCard";
import DataDetailModal from "./DataDetailModal";
import { LeadStatus } from "@/lib/getValidNextLeadStatuses";

interface DataListProps {
  employeeId: string;
}

// Employee-facing Data view — deliberately NOT LeadList: no board-
// stage tabs (Data has no Follow-up/Visit/Booking workflow), no
// filters/search bar, no SLA anything. A flat, newest-first list is
// enough at Data's expected volume; add filtering later if that stops
// being true.
//
// `.eq("lead_type", "DATA")` here is the other half of the fix that
// also went into LeadList.tsx (`.eq("lead_type", "LEAD")` there) —
// together the two queries partition an employee's current_owner_id
// leads cleanly, with no overlap and no gap between the two tabs.
export default function DataList({ employeeId }: DataListProps) {

  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  useEffect(() => {
    loadLeads();
  }, [employeeId]);

  async function loadLeads() {
    setLoading(true);

    const { data, error } = await supabase
      .from("leads")
      .select(
        `
        id,
        name,
        mobile,
        status,
        created_at,
        lead_history!inner (
          id,
          call_count
        )
      `
      )
      .eq("current_owner_id", employeeId)
      .eq("lead_type", "DATA")
      .eq("lead_history.employee_id", employeeId)
      .eq("lead_history.is_active", true)
      .order("created_at", { ascending: false });

    if (!error && data) {
      setLeads(data);
    }

    setLoading(false);
  }

  // Optimistic local patch after a successful log_lead_update_atomic
  // call — same idea as LeadList's handleLeadUpdated, no full refetch
  // needed since the RPC already tells us exactly what changed.
  function handleLeadUpdated(leadId: string, updates: { status?: LeadStatus; callCount: number }) {
    setLeads((prev) =>
      prev.map((lead) => {
        if (lead.id !== leadId) return lead;

        const currentHistory = lead.lead_history[0] ?? {};

        return {
          ...lead,
          status: updates.status ?? lead.status,
          lead_history: [{ ...currentHistory, call_count: updates.callCount }]
        };
      })
    );
  }

  if (loading) {
    return (
      <div className="mx-4 mt-6 text-center text-sm text-slate-400">
        Loading your Data...
      </div>
    );
  }

  const selectedLead = leads.find((lead) => lead.id === selectedLeadId);

  return (
    <>
      {leads.length === 0 ? (
        <div className="flex flex-col items-center justify-center mt-16 text-center px-4">
          <div className="text-5xl mb-3">🗂️</div>
          <h2 className="text-lg font-semibold text-gray-700">No Data assigned to you yet</h2>
          <p className="text-sm text-gray-500 mt-1">
            Data an Admin sends you directly will show up here.
          </p>
        </div>
      ) : (
        <div className="mx-4 mt-4 space-y-3 pb-6">
          {leads.map((lead: any, index: number) => (
            <DataCard
              key={lead.id}
              index={index}
              onOpen={() => setSelectedLeadId(lead.id)}
              lead={{
                id: lead.id,
                leadHistoryId: lead.lead_history[0]?.id,
                name: lead.name,
                mobile: lead.mobile,
                status: lead.status,
                call_count: lead.lead_history[0]?.call_count ?? 0
              }}
            />
          ))}
        </div>
      )}

      {selectedLead && (
        <DataDetailModal
          lead={{
            id: selectedLead.id,
            leadHistoryId: selectedLead.lead_history[0]?.id,
            name: selectedLead.name,
            mobile: selectedLead.mobile,
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
