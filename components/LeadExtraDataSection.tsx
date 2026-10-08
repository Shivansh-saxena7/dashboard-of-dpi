"use client";

// "More details" in the lead modal (2026-10-08): the lead's extra CSV
// columns (leads.extra_data), cleaned by lib/leadExtraData.ts. Loaded here,
// for this one lead only, when the modal opens — list queries never select
// extra_data, so lists stay light. Same leads RLS as the rest of the modal:
// no new access. Values render as plain React text (never HTML).

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ExtraDataItem, parseLeadExtraData } from "@/lib/leadExtraData";

const VALUE_CAP = 140;

function ExtraValue({ value }: { value: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = value.length > VALUE_CAP;
  return (
    <span className="text-sm text-slate-700 break-words whitespace-pre-line">
      {long && !expanded ? `${value.slice(0, VALUE_CAP).trimEnd()}…` : value}
      {long && (
        <button type="button" onClick={() => setExpanded(!expanded)} className="ml-1.5 text-xs font-semibold text-amber-700 hover:underline">
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </span>
  );
}

export default function LeadExtraDataSection({ leadId }: { leadId: string }) {
  // Tagged with the lead it belongs to, so a stale result never shows
  // under a different lead.
  const [loaded, setLoaded] = useState<{ leadId: string; items: ExtraDataItem[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("leads")
      .select("extra_data")
      .eq("id", leadId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!cancelled && !error && data) setLoaded({ leadId, items: parseLeadExtraData(data.extra_data) });
      });
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  const items = loaded?.leadId === leadId ? loaded.items : [];
  if (items.length === 0) return null;

  return (
    <div>
      <p className="text-[10.5px] uppercase tracking-[0.25em] text-slate-400 font-bold mb-3">More details</p>
      <div className="rounded-xl border border-slate-100 bg-white divide-y divide-slate-100">
        {items.map((item) => (
          <div key={item.label} className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3 px-3.5 py-2.5">
            <span className="shrink-0 sm:w-40 text-xs font-semibold text-slate-500">{item.label}</span>
            <ExtraValue value={item.value} />
          </div>
        ))}
      </div>
    </div>
  );
}
