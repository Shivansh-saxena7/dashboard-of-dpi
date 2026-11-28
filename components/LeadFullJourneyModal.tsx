"use client";
// Full lead history for admins (2026-11-29): every owner and every event of one lead, start to end, junk or not, from
// get_admin_lead_full_journey (admin only, one lead per call). Name + number only through LeadContactLine. Light,
// blue accents, 44px taps, phone sheet / desktop side panel. If the function is not on the server yet, onMissing()
// lets the caller show the old timeline instead.
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";
import { reportClientError } from "@/lib/reportClientError";
import LeadContactLine from "@/components/LeadContactLine";
import { useLeadContacts } from "@/lib/leadContacts";
import { adminReason, endedText, eventGroup, eventTitle, istTime, stintCounts, word, type EventGroup, type FullJourney } from "@/lib/leadFullJourney";

const BTN = "min-h-11 rounded-xl border border-slate-200 bg-white px-4 text-[15px] font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600";
const GROUPS: [EventGroup | "all", string][] = [["all", "All"], ["status", "Status & stage"], ["calls", "Calls"], ["notes", "Notes"], ["visits", "Visits"], ["other", "Other"]];

export default function LeadFullJourneyModal({ leadId, onClose, onMissing }: { leadId: string; onClose: () => void; onMissing?: () => void }) {
  const [j, setJ] = useState<FullJourney | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [group, setGroup] = useState<EventGroup | "all">("all");
  const { contacts } = useLeadContacts([leadId], "lead-history");

  async function load() {
    setState("loading");
    const { data, error } = await supabase.rpc("get_admin_lead_full_journey", { p_lead_id: leadId });
    if (error) {
      if ((error.code === "PGRST202" || error.code === "42883") && onMissing) return onMissing();
      reportClientError("lead-history:full-journey", `load failed (${error.code ?? "unknown"})`, "warning");
      setState("error");
      return;
    }
    setJ(data as FullJourney);
    setState("ok");
  }

  useEffect(() => {
    void load();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  const events = useMemo(() => (j?.events ?? []).filter((e) => group === "all" || eventGroup(e) === group), [j, group]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: j?.events.length ?? 0 };
    for (const e of j?.events ?? []) c[eventGroup(e)] = (c[eventGroup(e)] ?? 0) + 1;
    return c;
  }, [j]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Lead history" data-testid="lfj">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} aria-hidden />
      <div className="absolute inset-x-0 bottom-0 top-10 flex flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:top-0 sm:w-[560px] sm:rounded-none">
        <header className="shrink-0 border-b border-slate-200 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-[18px] font-bold text-slate-900">Lead history</h2>
              <p className="font-mono text-[13px] text-slate-600">{leadId.slice(0, 8)}</p>
              <LeadContactLine contact={contacts.get(leadId)} testId="lfj-contact" />
            </div>
            <button type="button" onClick={onClose} className={BTN} data-testid="lfj-close">Close</button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {state === "loading" && <p className="text-[15px] text-slate-600" aria-busy="true">Loading the full history…</p>}
          {state === "error" && (
            <button type="button" className={`${BTN} w-full text-left`} onClick={() => void load()} data-testid="lfj-retry">Couldn&apos;t load the history. Tap to try again.</button>
          )}
          {state === "ok" && j && !j.found && <p className="text-[15px] text-slate-700">This lead was not found.</p>}
          {state === "ok" && j?.found && j.lead && (
            <div className="space-y-5">
              <section className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[14px] text-slate-800" data-testid="lfj-now">
                <p className="font-semibold">
                  Now: {word(j.lead.status)} · {word(j.lead.board_stage ?? "LEADS")} · {j.lead.lead_type === "DATA" ? "Data" : "Lead"}
                </p>
                <p className="mt-1 text-slate-700">
                  {j.lead.current_owner_name ? `With ${j.lead.current_owner_name}` : j.lead.pending_team_name ? `Reserved for ${j.lead.pending_team_name}` : "No owner"}
                  {" · "}{j.stints.length} owner{j.stints.length === 1 ? "" : "s"} · {j.lead.recycle_count} recycle{j.lead.recycle_count === 1 ? "" : "s"}
                </p>
                <p className="mt-1 text-slate-600">
                  Added {istTime(j.lead.created_at)}{j.lead.source ? ` · ${j.lead.source}` : ""}{j.lead.project ? ` · ${j.lead.project}` : ""}
                  {j.lead.csv_batch8 ? ` · import ${j.lead.csv_batch8}` : ""}{j.lead.is_personal_lead ? " · Personal lead" : ""}
                </p>
                {j.lead.merged_into8 && <p className="mt-1 text-slate-700">Merged into lead {j.lead.merged_into8}</p>}
                {j.lead.last_unjunked_at && <p className="mt-1 text-slate-700">Taken out of junk {istTime(j.lead.last_unjunked_at)}</p>}
              </section>

              <section aria-labelledby="lfj-owners-h">
                <h3 id="lfj-owners-h" className="text-[16px] font-bold text-slate-900">Owners, in order</h3>
                <ol className="mt-2 space-y-2" data-testid="lfj-owners">
                  {j.stints.map((s, i) => {
                    const c = stintCounts(j, s.stint_id);
                    const reason = adminReason(s);
                    return (
                      <li key={s.stint_id} className={`rounded-xl border p-3 text-[14px] ${s.active ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white"}`} data-testid={`lfj-owner-${i + 1}`}>
                        <p className="font-semibold text-slate-900">{i + 1}. {s.employee_name ?? "Unknown employee"} <span className="font-normal text-slate-600">· {word(s.origin)}</span></p>
                        <p className="text-slate-700">{istTime(s.assigned_at)} → {s.active ? "now" : istTime(s.ended_at)}</p>
                        <p className="text-slate-700">{c.calls} call{c.calls === 1 ? "" : "s"} · {c.notes} note{c.notes === 1 ? "" : "s"} · {c.moves} update{c.moves === 1 ? "" : "s"}{s.result ? ` · last result ${word(s.result)}` : ""}</p>
                        <p className="text-slate-600">{endedText(s)}</p>
                        <p className="text-[13px] text-slate-600">Employee saw: {s.employee_sees}</p>
                        {reason && <p className="text-[13px] text-slate-800" data-testid="lfj-admin-reason">Admin reason (admins only): {reason}</p>}
                        {s.restore?.protected_until && <p className="text-[13px] text-slate-600">Protected until {istTime(s.restore.protected_until)}{s.restore.undone_at ? ` · undone ${istTime(s.restore.undone_at)}` : ""}</p>}
                        {s.pause_reason && <p className="text-[13px] text-slate-600">Paused ({word(s.pause_reason)}) until {istTime(s.paused_until)}</p>}
                      </li>
                    );
                  })}
                  {!j.stints.length && <li className="text-[14px] text-slate-600">Never assigned to anyone.</li>}
                </ol>
              </section>

              <section aria-labelledby="lfj-events-h">
                <h3 id="lfj-events-h" className="text-[16px] font-bold text-slate-900">Everything that happened</h3>
                <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Show">
                  {GROUPS.map(([g, label]) => (
                    <button key={g} type="button" onClick={() => setGroup(g)} aria-pressed={group === g} data-testid={`lfj-chip-${g}`}
                      className={`min-h-11 rounded-full border px-3 text-[14px] font-semibold ${group === g ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-700"}`}>
                      {label} ({counts[g] ?? 0})
                    </button>
                  ))}
                </div>
                <ol className="mt-3 space-y-2" data-testid="lfj-events">
                  {events.map((e, i) => (
                    <li key={`${e.at}-${e.kind}-${i}`} className="rounded-xl border border-slate-200 p-3 text-[14px]" data-testid={`lfj-ev-${e.kind}`}>
                      <p className="font-semibold text-slate-900">{eventTitle(e)}</p>
                      <p className="text-slate-600">{e.employee_name ?? (e.kind === "GUARD" ? "System" : "—")} · {istTime(e.at)}</p>
                      {e.text && <p className="mt-1 whitespace-pre-wrap break-words text-slate-800">{e.text}</p>}
                      {e.kind === "LEAVE" && e.extra && <p className="text-slate-600">{String(e.extra.start_date)} to {e.extra.end_date ? String(e.extra.end_date) : "open"}</p>}
                      {(e.kind === "VISIT" || e.kind === "BOOKING") && e.extra?.deny_reason ? <p className="text-slate-600">Reason: {String(e.extra.deny_reason)}</p> : null}
                      {e.kind === "RESTORE" && e.extra?.to_name ? <p className="text-slate-600">To {String(e.extra.to_name)}</p> : null}
                    </li>
                  ))}
                  {!events.length && <li className="text-[14px] text-slate-600">Nothing here.</li>}
                </ol>
                {j.truncated && <p className="mt-2 text-[13px] text-slate-600">Very long history: the first 2,000 items of each kind are shown.</p>}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
