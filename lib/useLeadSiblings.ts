"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export interface LeadSibling {
  lead_id: string;
  project: string | null;
  status: string;
  owner_name: string | null;
  is_mine: boolean;
}

// get_lead_siblings caps each call at 1000 ids.
const CHUNK_SIZE = 1000;

// "Existing client" data for a set of visible leads: for each lead id,
// the OTHER leads sharing its normalized mobile (any project), from
// get_lead_siblings — which owns the matching and the visibility rule
// (a caller only gets siblings for leads they can already see). Shared
// by the employee and admin lead lists so neither reimplements it.
//
// Keyed on the joined id list, so re-renders that don't change which
// leads are shown don't refetch. Failures are non-fatal: the badge just
// doesn't render.
export function useLeadSiblings(leadIds: string[]): Record<string, LeadSibling[]> {
  const [siblingsByLeadId, setSiblingsByLeadId] = useState<Record<string, LeadSibling[]>>({});
  const idsKey = leadIds.join(",");

  useEffect(() => {
    let cancelled = false;
    const ids = idsKey ? idsKey.split(",") : [];

    async function load() {
      if (ids.length === 0) {
        setSiblingsByLeadId({});
        return;
      }

      const merged: Record<string, LeadSibling[]> = {};

      for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
        const { data, error } = await supabase.rpc("get_lead_siblings", {
          p_lead_ids: ids.slice(i, i + CHUNK_SIZE)
        });

        if (error) {
          console.error("get_lead_siblings failed:", error.message);
          return;
        }

        Object.assign(merged, data || {});
      }

      if (!cancelled) setSiblingsByLeadId(merged);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [idsKey]);

  return siblingsByLeadId;
}
