"use client";
// Lead name + mobile for the admin cross-check (2026-11-29): only the Positive-history junk page and the Performance
// Report Lead Journey tab use this. get_admin_lead_contacts (admin only, is_admin() inside) takes the ids in the POST
// body, at most 200 per call, so no id list ever goes into a URL. Customer names / numbers are never logged: a failure
// reports the error code only.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { reportClientError } from "@/lib/reportClientError";

export const CONTACT_CHUNK = 200;

export interface LeadContact {
  name: string | null;
  mobile: string | null;
}

export function chunkIds(ids: string[], size = CONTACT_CHUNK): string[][] {
  const unique = [...new Set(ids.filter(Boolean))];
  const out: string[][] = [];
  for (let i = 0; i < unique.length; i += size) out.push(unique.slice(i, i + size));
  return out;
}

export function useLeadContacts(ids: string[], where: string): { contacts: Map<string, LeadContact>; failed: boolean } {
  const key = useMemo(() => [...new Set(ids.filter(Boolean))].sort().join(","), [ids]);
  const [contacts, setContacts] = useState<Map<string, LeadContact>>(() => new Map());
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!key) return;
    let alive = true;
    (async () => {
      const next = new Map<string, LeadContact>();
      for (const chunk of chunkIds(key.split(","))) {
        const { data, error } = await supabase.rpc("get_admin_lead_contacts", { p_lead_ids: chunk });
        if (!alive) return;
        if (error) {
          reportClientError(`${where}:lead-contacts`, `lookup failed (${error.code ?? "unknown"})`, "warning");
          setFailed(true);
          return;
        }
        for (const r of (data ?? []) as { lead_id: string; name: string | null; mobile: string | null }[]) next.set(r.lead_id, { name: r.name, mobile: r.mobile });
      }
      if (alive) {
        setContacts(next);
        setFailed(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [key, where]);
  return { contacts, failed };
}
