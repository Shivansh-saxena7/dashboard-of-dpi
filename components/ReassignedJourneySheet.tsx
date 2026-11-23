"use client";
// Journey sheet (2026-11-23) for a lead an admin gave from the Performance Report: who had it, when, what happened, and
// who has it now. Asks get_reassigned_lead_context once when opened; the database answers only the lead's current
// owner and never sends the admin's reason, label or batch. Bottom sheet on a phone, side panel on desktop.
import { useEffect, useState } from "react";
import { dayText, originText, outcomeText, type ReassignedContext } from "@/lib/reassignedJourney";
import { loadReassignedContext } from "@/lib/useReassignedJourney";

export default function ReassignedJourneySheet({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const [state, setState] = useState<{ id: string; data: ReassignedContext | null; error: boolean } | null>(null);
  useEffect(() => {
    let alive = true;
    void loadReassignedContext(leadId).then((r) => {
      if (alive) setState({ id: leadId, data: "data" in r ? r.data ?? null : null, error: "error" in r });
    });
    return () => {
      alive = false;
    };
  }, [leadId]);
  const s = state && state.id === leadId ? state : null;
  const c = s?.data ?? null;
  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/35" onClick={onClose} aria-hidden />
      <aside role="dialog" aria-modal="true" aria-label="Lead journey" data-testid="journey-sheet"
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
        className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl lg:inset-y-0 lg:left-auto lg:right-0 lg:max-h-none lg:w-[420px] lg:rounded-none">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">Lead journey</h2>
            {c && <p className="text-[13px] text-slate-600">Given to you by admin on {dayText(c.given_at)}</p>}
          </div>
          <button type="button" autoFocus onClick={onClose} data-testid="journey-close"
            className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 text-[15px] font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">
            Close
          </button>
        </div>
        <div className="mt-3">
          {!s ? (
            <div aria-hidden className="h-32 animate-pulse rounded-xl bg-slate-200/70 motion-reduce:animate-none" />
          ) : s.error ? (
            <p className="text-[15px] text-slate-700" data-testid="journey-error">Couldn&apos;t load the journey. Please try again.</p>
          ) : !c ? (
            <p className="text-[15px] text-slate-700" data-testid="journey-none">No journey to show for this lead.</p>
          ) : (
            <ol className="relative ml-2 border-l-2 border-slate-200 pl-4" data-testid="journey-list">
              {c.journey.map((j, i) => (
                <li key={`${j.assigned_at}-${i}`} className="relative pb-3" data-testid="journey-row">
                  <span aria-hidden className={`absolute -left-[23px] top-1.5 h-3 w-3 rounded-full border-2 bg-white ${j.given_by_admin ? "border-amber-600" : "border-blue-700"}`} />
                  {j.given_by_admin && <p className="mb-1 inline-block rounded-full bg-amber-50 px-2 py-0.5 text-[13px] font-semibold text-amber-800">Given by admin</p>}
                  <p className="text-[15px] text-slate-900">
                    <b>{j.employee ?? "Someone"}</b>
                    <span className="text-slate-600"> · {originText(j.origin)}</span>
                  </p>
                  <p className="text-[13px] text-slate-600">{dayText(j.assigned_at)} – {j.current ? "now" : dayText(j.ended_at)}</p>
                  <p className={`mt-0.5 text-[13px] font-semibold ${j.current ? "text-blue-700" : "text-slate-700"}`}>{j.current ? "With you now" : outcomeText(j)}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </aside>
    </>
  );
}
