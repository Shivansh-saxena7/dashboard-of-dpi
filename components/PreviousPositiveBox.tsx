"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { previousPositiveText, type DataPreviousPositive } from "@/lib/dataPreviousPositive";

// Same small collapsed box as GivenLeadContextBox, for a Data lead whose number had a positive result before.
export default function PreviousPositiveBox({ row }: { row: DataPreviousPositive | null }) {
  const [open, setOpen] = useState(false);
  if (!row) return null;
  const text = previousPositiveText(row);

  return (
    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 text-left">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="text-xs font-bold text-amber-900">Previously connected</span>
        <ChevronDown size={16} className={`shrink-0 text-amber-700 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-1.5 px-3 pb-3 text-xs leading-relaxed text-amber-900 break-words">
          <p className="font-semibold">{text.lastPositive}</p>
          {text.after && <p>{text.after}</p>}
        </div>
      )}
    </div>
  );
}
