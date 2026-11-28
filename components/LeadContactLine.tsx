"use client";
// Name + mobile under a lead id, for the admin cross-check (Positive-history junk, Lead Journey only). The number is a
// 44px button that copies it. While the lookup runs (or if it failed) the line is simply left out; the id still shows.
import { useState } from "react";
import type { LeadContact } from "@/lib/leadContacts";

export default function LeadContactLine({ contact, testId }: { contact: LeadContact | undefined; testId?: string }) {
  const [copied, setCopied] = useState(false);
  if (!contact) return null;
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!contact.mobile) return;
    navigator.clipboard?.writeText(contact.mobile).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {}
    );
  };
  return (
    <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-[13px] text-slate-700" data-testid={testId}>
      <span className="min-w-0 break-words font-medium">{contact.name?.trim() || "No name"}</span>
      {contact.mobile ? (
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy number ${contact.mobile}`}
          className="inline-flex min-h-11 items-center rounded-lg px-2 font-mono text-slate-800 underline decoration-slate-300 underline-offset-2 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
        >
          {contact.mobile}
          <span className="ml-1 text-[12px] font-sans text-slate-500" aria-live="polite">{copied ? "Copied" : "Copy"}</span>
        </button>
      ) : (
        <span className="text-slate-500">No number</span>
      )}
    </div>
  );
}
