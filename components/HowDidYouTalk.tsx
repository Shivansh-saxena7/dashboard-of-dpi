"use client";

import { CONTACT_METHODS, ContactMethod } from "@/lib/callQuality";

// "How did you talk?" one-tap chips on the outcome sheet (Call Quality, 2026-10-29). Default
// "Called from CRM"; the other three let an honest employee say the call happened another way,
// so it is never counted as "Result without a dial".
export default function HowDidYouTalk({ value, onChange }: { value: ContactMethod; onChange: (v: ContactMethod) => void }) {
  return (
    <div className="mb-4">
      <p className="text-xs font-semibold text-slate-500 mb-1.5">How did you talk?</p>
      <div className="flex flex-wrap gap-2">
        {CONTACT_METHODS.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => onChange(m.value)}
            className={`text-[13px] font-semibold px-3 py-2 rounded-full border transition ${
              value === m.value ? "bg-amber-500 text-slate-900 border-amber-500" : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}
