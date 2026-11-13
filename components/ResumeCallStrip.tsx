"use client";

// "Resume your call" (2026-11-13): shown on Home, Leads and Data while a Call has no saved result yet
// (lib/activeCall.ts). One tap opens that lead again; Skip forgets it. The fallback for whenever the automatic
// return (lib/useActiveCallRestore.ts) could not happen.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PhoneCall } from "lucide-react";
import {
  ACTIVE_CALL_CHANGE_EVENT,
  type ActiveCallEntry,
  type ActiveCallListType,
  clearActiveCall,
  readActiveCall,
  resumePathFor
} from "@/lib/activeCall";

interface ResumeCallStripProps {
  employeeId: string | null | undefined;
  // The list this page shows, so Resume can open the lead here instead of navigating.
  currentList?: ActiveCallListType | null;
  // The lead whose detail is open right now: no strip for it.
  openLeadId?: string | null;
  onResumeHere?: (leadId: string) => void;
}

export default function ResumeCallStrip({ employeeId, currentList = null, openLeadId = null, onResumeHere }: ResumeCallStripProps) {
  const router = useRouter();
  const [entry, setEntry] = useState<ActiveCallEntry | null>(null);

  useEffect(() => {
    const sync = () => setEntry(readActiveCall(employeeId));
    sync();
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    window.addEventListener(ACTIVE_CALL_CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(ACTIVE_CALL_CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [employeeId]);

  if (!employeeId || !entry || entry.leadId === openLeadId) return null;

  function resume() {
    if (!entry) return;
    if (currentList === entry.listType && onResumeHere) onResumeHere(entry.leadId);
    else router.push(resumePathFor(entry));
  }

  return (
    <div
      data-testid="resume-call-strip"
      className="mx-4 mt-3 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5"
    >
      <PhoneCall size={16} className="shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-800">
          Resume your call with {entry.leadName || "your last lead"}
        </p>
        <p className="text-[11px] text-slate-500">Save the result, or skip it.</p>
      </div>
      <button
        onClick={resume}
        className="h-9 shrink-0 rounded-lg bg-gradient-to-r from-yellow-400 to-amber-500 px-3 text-xs font-bold text-slate-900"
      >
        Resume
      </button>
      <button
        onClick={() => clearActiveCall(employeeId, entry.leadId)}
        className="h-9 shrink-0 rounded-lg px-2 text-xs font-semibold text-slate-500 hover:bg-amber-100"
      >
        Skip
      </button>
    </div>
  );
}
