"use client";

import { useState } from "react";
import { Calculator } from "lucide-react";
import CostSheetModal from "./CostSheetModal";

interface CostSheetSectionProps {
  leadId: string;
  leadName: string;
  leadMobile: string;
  leadProject?: string | null;
}

// Thin trigger + modal-mount wrapper — mirrors LeadProjectAssetsSection's
// self-containment (Part 1), but the actual form is big enough to
// warrant its own dedicated modal (CostSheetModal) rather than an
// inline card, matching ManualLeadEntryModal's established centered-
// dialog chrome instead of a new pattern.
export default function CostSheetSection({ leadId, leadName, leadMobile, leadProject }: CostSheetSectionProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="rounded-2xl bg-white border border-slate-100 shadow-md p-5">
        <p className="text-sm font-bold text-slate-800 mb-1">Cost Sheet</p>
        <p className="text-xs text-slate-400 mb-4">Generate a cost sheet PDF for this client.</p>
        <button
          onClick={() => setOpen(true)}
          className="w-full min-w-0 flex items-center justify-center gap-2 h-11 rounded-xl font-semibold text-white bg-gradient-to-r from-blue-500 to-blue-600 shadow-[0_8px_20px_rgba(59,130,246,0.3)]"
        >
          <Calculator size={15} className="shrink-0" />
          Generate Cost Sheet
        </button>
      </div>

      {open && (
        <CostSheetModal
          leadId={leadId}
          leadName={leadName}
          leadMobile={leadMobile}
          leadProject={leadProject}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
