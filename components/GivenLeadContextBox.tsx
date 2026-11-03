"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { givenBoxText, givenBoxVisible, type GivenLeadContext } from "@/lib/givenLeadContext";

// Shown in the lead's detail view while its protection lasts, also after the lead has left the
// "Given by admin" filter. Collapsed it is one line, so it stays small on a phone.
export default function GivenLeadContextBox({ context }: { context: GivenLeadContext | null }) {
  const [open, setOpen] = useState(false);
  if (!context || !givenBoxVisible(context)) return null;
  const text = givenBoxText(context);

  return (
    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 text-left">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="text-xs font-bold text-amber-900">Why you got this lead</span>
        <ChevronDown size={16} className={`shrink-0 text-amber-700 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-1.5 px-3 pb-3 text-xs leading-relaxed text-amber-900 break-words">
          <p className="font-semibold">{text.lastPositive}</p>
          {text.note && <p>{text.note}</p>}
          {text.after && <p>{text.after}</p>}
          <p>{text.protectedUntil}</p>
          {text.yourNotes.length > 0 && (
            <div className="border-t border-amber-200 pt-1.5">
              <p className="font-semibold">Your earlier notes</p>
              <ul className="mt-1 space-y-1">
                {text.yourNotes.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
