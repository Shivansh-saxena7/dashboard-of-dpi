"use client";
// Full lead history for admins (2026-11-29, v2 look): ONE vertical timeline, oldest at the top, dot by dot, in the same
// look as the old History modal (gradient header, small coloured dots on a thin line, tinted cards). Owner changes are
// events in that same list. Data: get_admin_lead_full_journey (admin only, one lead per call). Name + number only
// through LeadContactLine. 44px taps, English, no purple, light only. If the function is not on the server yet,
// onMissing() lets the caller show the old timeline instead.
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  X, User, UserMinus, ArrowRightCircle, TrendingUp, Phone, MessageCircle, StickyNote, MapPin, Moon, RotateCcw, ShieldAlert, Repeat, Bookmark, CalendarX
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { reportClientError } from "@/lib/reportClientError";
import LeadContactLine from "@/components/LeadContactLine";
import LeadExtraDataSection from "@/components/LeadExtraDataSection";
import { useLeadContacts } from "@/lib/leadContacts";
import { buildTimeline, istTime, nowLine, type FullJourney, type TimelineIcon, type TimelineTone } from "@/lib/leadFullJourney";

// The old modal's dot / card colours, per kind (visits and snoozes were purple / indigo there: now sky / cyan).
const TONE: Record<TimelineTone, { dot: string; card: string; title: string; meta: string }> = {
  owner: { dot: "from-cyan-500 to-blue-600", card: "bg-slate-50 border-slate-200", title: "text-slate-800", meta: "text-slate-500" },
  ownerOut: { dot: "from-slate-300 to-slate-400", card: "bg-white border-slate-200", title: "text-slate-700", meta: "text-slate-500" },
  status: { dot: "from-blue-500 to-blue-600", card: "bg-blue-50 border-blue-100", title: "text-blue-800", meta: "text-blue-700/80" },
  stage: { dot: "from-rose-500 to-rose-600", card: "bg-rose-50 border-rose-100", title: "text-rose-800", meta: "text-rose-700/80" },
  call: { dot: "from-teal-500 to-teal-600", card: "bg-teal-50 border-teal-100", title: "text-teal-800", meta: "text-teal-700/80" },
  note: { dot: "from-slate-400 to-slate-500", card: "bg-slate-50 border-slate-200", title: "text-slate-800", meta: "text-slate-500" },
  visit: { dot: "from-sky-500 to-sky-600", card: "bg-sky-50 border-sky-100", title: "text-sky-800", meta: "text-sky-700/80" },
  snooze: { dot: "from-cyan-500 to-cyan-600", card: "bg-cyan-50 border-cyan-100", title: "text-cyan-800", meta: "text-cyan-700/80" },
  admin: { dot: "from-emerald-500 to-emerald-600", card: "bg-emerald-50 border-emerald-100", title: "text-emerald-800", meta: "text-emerald-700/80" },
  guard: { dot: "from-amber-400 to-orange-500", card: "bg-amber-50 border-amber-100", title: "text-amber-800", meta: "text-amber-700/80" },
  transfer: { dot: "from-amber-400 to-orange-500", card: "bg-orange-50 border-orange-100", title: "text-orange-800", meta: "text-orange-700/80" },
  leave: { dot: "from-slate-400 to-slate-500", card: "bg-white border-slate-200", title: "text-slate-700", meta: "text-slate-500" }
};
const ICON: Record<TimelineIcon, typeof User> = {
  user: User, userMinus: UserMinus, status: ArrowRightCircle, stage: TrendingUp, phone: Phone, whatsapp: MessageCircle, note: StickyNote,
  visit: MapPin, snooze: Moon, restore: RotateCcw, guard: ShieldAlert, transfer: Repeat, reserve: Bookmark, leave: CalendarX
};

export default function LeadFullJourneyModal({ leadId, onClose, onMissing }: { leadId: string; onClose: () => void; onMissing?: () => void }) {
  const [j, setJ] = useState<FullJourney | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
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

  const items = useMemo(() => (j?.found ? buildTimeline(j) : []), [j]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Lead history" data-testid="lfj">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} aria-hidden />
      <div className="absolute inset-y-0 right-0 flex w-full flex-col overflow-hidden bg-white shadow-2xl sm:w-[460px]">
        <div className="relative shrink-0 overflow-hidden bg-gradient-to-br from-[#0f172a] via-[#1d4ed8] to-[#06b6d4] px-6 pb-5 pt-6 text-white">
          <div className="pointer-events-none absolute right-[-40px] top-[-40px] h-[120px] w-[120px] rounded-full bg-white/10 blur-3xl" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            data-testid="lfj-close"
            className="absolute right-4 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
          >
            <X size={18} />
          </button>
          <p className="relative mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-200">{j?.lead?.lead_type === "DATA" ? "Data History" : "Lead History"}</p>
          <h2 className="relative pr-12 font-mono text-xl font-bold">{leadId.slice(0, 8)}</h2>
          {j?.lead && <p className="relative mt-1 text-sm text-white/85" data-testid="lfj-now">{nowLine(j)}</p>}
          {j?.lead?.catcher_name && <p className="relative mt-1 text-sm font-semibold text-amber-200">🎣 Caught by: {j.lead.catcher_name}</p>}
        </div>
        <div className="shrink-0 border-b border-slate-100 px-6 py-1">
          <LeadContactLine contact={contacts.get(leadId)} testId="lfj-contact" />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <LeadExtraDataSection leadId={leadId} className="mb-6" />
          {state === "loading" && <p className="text-sm text-slate-500" aria-busy="true">Loading...</p>}
          {state === "error" && (
            <button type="button" onClick={() => void load()} data-testid="lfj-retry"
              className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100">
              Couldn&apos;t load the history. Tap to try again.
            </button>
          )}
          {state === "ok" && j && !j.found && <p className="text-sm text-slate-500">This lead was not found.</p>}
          {state === "ok" && j?.found && items.length === 0 && <p className="text-sm text-slate-500">No history found.</p>}
          {state === "ok" && items.length > 0 && (
            <ol data-testid="lfj-timeline">
              {items.map((t, index) => {
                const tone = TONE[t.tone];
                const Icon = ICON[t.icon];
                return (
                  <li key={t.key} className="relative pb-6 pl-8 last:pb-0" data-testid={`lfj-item-${t.tone}`}>
                    {index < items.length - 1 && <div className="absolute bottom-0 left-[9px] top-6 w-px bg-slate-200" aria-hidden />}
                    <div className={`absolute left-0 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br ${tone.dot}`} aria-hidden>
                      <Icon size={11} className="text-white" />
                    </div>
                    <div className={`rounded-xl border p-3 ${tone.card}`}>
                      <p className={`text-sm font-bold ${tone.title}`}>{t.title}</p>
                      <p className={`mt-1 text-[12px] ${tone.meta}`} data-testid="lfj-when">{t.who} · {istTime(t.at)}</p>
                      {t.lines.map((l, i) => (
                        <p key={i} className="mt-0.5 text-[12px] text-slate-600">{l}</p>
                      ))}
                      {t.text && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-800">{t.text}</p>}
                      {t.adminLine && <p className="mt-1 text-[12px] font-medium text-slate-800" data-testid="lfj-admin-reason">Admin reason (admins only): {t.adminLine}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          {state === "ok" && j?.truncated && <p className="mt-4 text-[12px] text-slate-500">Very long history: the first 2,000 items of each kind are shown.</p>}
        </div>
      </div>
    </div>,
    document.body
  );
}
