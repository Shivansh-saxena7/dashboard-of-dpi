"use client";

import { useState } from "react";
import type { LeadSibling } from "@/lib/useLeadSiblings";

// "Existing client" pill — this client (same mobile) also has other leads.
// Informational only; each lead is still worked and owned independently.
//
// Who sees what (2026-10-05):
//   Admin / Super Admin / Coordinator (fullDetail): "👥 2 other leads";
//     hover, or tap on a phone, lists each one's project and owner.
//   Employee / Team Leader: just "👥 Existing client" — no projects, no
//     names. get_lead_siblings also strips those fields server-side for
//     these roles, so they never reach the browser.
export default function ExistingClientBadge({ siblings, fullDetail = false }: { siblings?: LeadSibling[]; fullDetail?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!siblings || siblings.length === 0) return null;

  const pill = "shrink-0 inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100 whitespace-nowrap";

  if (!fullDetail) {
    return <span className={pill}>👥 Existing client</span>;
  }

  const lines = siblings.map((s) => `${s.project || "No project"} — ${s.is_mine ? "you" : s.owner_name || "Unassigned"}`);

  return (
    <span className="relative shrink-0">
      <button
        type="button"
        title={lines.join("\n")}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`${pill} relative after:absolute after:inset-x-0 after:-inset-y-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400`}
      >
        👥 {siblings.length} other lead{siblings.length === 1 ? "" : "s"}
      </button>
      {open && (
        <span className="absolute right-0 top-full mt-1 z-20 w-60 max-w-[80vw] rounded-xl bg-white border border-slate-200 shadow-lg p-2 text-[11px] text-slate-700 space-y-1">
          {lines.map((line, i) => (
            <span key={i} className="block truncate">{line}</span>
          ))}
        </span>
      )}
    </span>
  );
}
