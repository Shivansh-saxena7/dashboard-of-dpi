"use client";

// Non-working days (2026-10-07, working-calendar Step 8). Admin adds a
// holiday or a "pause all timers until X" range; lead timers don't count
// that time. Every save goes through save_non_working_period: preview
// first (how many Visit-lock/Snooze end dates and NEW-lead SLA deadlines
// move), then confirm. The weekly off itself is the existing
// lead_engine_settings.sla_weekly_off_day — not managed here. Only works
// while the working-days switch is ON (the RPC refuses otherwise).

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import PageHeader from "@/components/PageHeader";
import ShiftOverridesSection from "@/components/ShiftOverridesSection";
import { useWorkingCalendar } from "@/lib/useWorkingCalendar";
import { formatPauseUntil } from "@/lib/workingCalendar";

type Kind = "HOLIDAY" | "TIMER_PAUSE";

interface Period {
  id: string;
  starts_at: string;
  ends_at: string;
  reason: string;
  kind: Kind;
  created_at: string;
  cancelled_at: string | null;
}

interface AuditRow {
  id: string;
  action: string;
  acted_at: string;
  working_days: number | null;
  affected_paused_leads: number | null;
  affected_sla_leads: number | null;
  note: string | null;
  revert_summary: RevertSummary | null;
  after: { starts_at?: string; ends_at?: string; reason?: string } | null;
  actor: { name: string | null } | null;
}

// What a cancel puts back (Option A, 2026-10-08) — from the shift log.
interface RevertSummary {
  range_started: boolean;
  sla_revert: number;
  pause_revert: number;
  skip_touched: number;
  skip_original_passed: number;
  skip_value_changed: number;
  skip_range_started: number;
}

interface Preview {
  working_days: number;
  paused_leads: number;
  sla_leads: number;
  switch_on: boolean;
}

const istDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

// Form values are IST wall-clock; the RPC gets real instants.
const fromIstDate = (date: string, addDays = 0) => {
  const d = new Date(`${date}T00:00:00+05:30`);
  d.setTime(d.getTime() + addDays * 86400000);
  return d.toISOString();
};
const fromIstDateTime = (value: string) => new Date(`${value}:00+05:30`).toISOString();

function periodState(p: Period): { label: string; className: string } {
  if (p.cancelled_at) return { label: "Cancelled", className: "bg-slate-100 text-slate-500" };
  const now = Date.now();
  if (Date.parse(p.ends_at) <= now) return { label: "Ended", className: "bg-slate-100 text-slate-600" };
  if (Date.parse(p.starts_at) <= now) return { label: "Active now", className: "bg-sky-100 text-sky-700" };
  return { label: "Upcoming", className: "bg-amber-50 text-amber-700" };
}

export default function NonWorkingDaysPage() {
  const calendar = useWorkingCalendar();
  const switchOn = calendar?.timersEnabled === true;

  const [periods, setPeriods] = useState<Period[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState<Period | null>(null);
  const [kind, setKind] = useState<Kind>("HOLIDAY");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [fromDateTime, setFromDateTime] = useState("");
  const [toDateTime, setToDateTime] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelPreview, setCancelPreview] = useState<{ period: Period; revert: RevertSummary } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: periodRows }, { data: auditRows }] = await Promise.all([
      supabase.from("non_working_periods").select("id, starts_at, ends_at, reason, kind, created_at, cancelled_at").order("starts_at", { ascending: false }).limit(100),
      supabase
        .from("non_working_periods_audit")
        .select("id, action, acted_at, working_days, affected_paused_leads, affected_sla_leads, note, revert_summary, after, actor:employees!non_working_periods_audit_actor_id_fkey(name)")
        .order("acted_at", { ascending: false })
        .limit(50)
    ]);
    setPeriods((periodRows as Period[]) || []);
    setAudit((auditRows as unknown as AuditRow[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function resetForm() {
    setEditing(null);
    setKind("HOLIDAY");
    setFromDate("");
    setToDate("");
    setFromDateTime("");
    setToDateTime("");
    setReason("");
    setNote("");
    setPreview(null);
  }

  // The RPC arguments for the current form (null + toast when incomplete).
  function rpcArgs(confirm: boolean): Record<string, unknown> | null {
    const effectiveKind = editing ? editing.kind : kind;
    let ends: string | null = null;
    let starts: string | null = null;
    if (effectiveKind === "HOLIDAY") {
      if (!editing && !fromDate) return toast.error("Pick the first holiday date."), null;
      if (!toDate) return toast.error("Pick the last holiday date."), null;
      starts = editing ? null : fromIstDate(fromDate);
      ends = fromIstDate(toDate, 1);
    } else {
      if (!editing && !fromDateTime) return toast.error("Pick when the pause starts."), null;
      if (!toDateTime) return toast.error("Pick when the pause ends."), null;
      starts = editing ? null : fromIstDateTime(fromDateTime);
      ends = fromIstDateTime(toDateTime);
    }
    if (!editing && !reason.trim()) return toast.error("Reason is required."), null;
    return {
      p_action: editing ? "EDIT" : "CREATE",
      p_period_id: editing?.id ?? null,
      p_starts_at: starts,
      p_ends_at: ends,
      p_reason: reason.trim() || null,
      p_kind: editing ? null : kind,
      p_confirm: confirm,
      p_note: note.trim() || null
    };
  }

  async function runPreview() {
    const args = rpcArgs(false);
    if (!args) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("save_non_working_period", args);
    setBusy(false);
    if (error) return toast.error(error.message.replace("save_non_working_period: ", ""));
    setPreview(data as Preview);
  }

  async function confirmSave() {
    const args = rpcArgs(true);
    if (!args) return;
    setBusy(true);
    const { error } = await supabase.rpc("save_non_working_period", args);
    setBusy(false);
    if (error) return toast.error(error.message.replace("save_non_working_period: ", ""));
    toast.success(editing ? "Range extended." : "Range saved — timers will pause for it.");
    resetForm();
    load();
  }

  // Cancel = preview first (what moves back, what is skipped and why),
  // then an explicit confirm.
  async function previewCancel(p: Period) {
    setBusy(true);
    const { data, error } = await supabase.rpc("save_non_working_period", { p_action: "CANCEL", p_period_id: p.id, p_confirm: false });
    setBusy(false);
    if (error) return toast.error(error.message.replace("save_non_working_period: ", ""));
    setCancelPreview({ period: p, revert: (data as { revert: RevertSummary }).revert });
  }

  async function confirmCancel() {
    if (!cancelPreview) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("save_non_working_period", { p_action: "CANCEL", p_period_id: cancelPreview.period.id, p_confirm: true });
    setBusy(false);
    if (error) return toast.error(error.message.replace("save_non_working_period: ", ""));
    const r = (data as { revert: RevertSummary }).revert;
    toast.success(`Range cancelled. ${r.sla_revert} SLA deadline(s) and ${r.pause_revert} Visit-lock/Snooze date(s) moved back.`);
    setCancelPreview(null);
    load();
  }

  function startEdit(p: Period) {
    resetForm();
    setEditing(p);
    setReason(p.reason);
  }

  const effectiveKind = editing ? editing.kind : kind;
  const inputClass = "w-full h-10 rounded-xl bg-slate-50 border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-cyan-200";

  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader
        eyebrow="System"
        title="Non-working Days"
        description="Holidays aur timer-pause ranges. Is time mein lead timers (recycle, follow-up, reminders) nahi chalte; khatam hone par bache hue time se resume hote hain. Weekly off Settings se aata hai."
      />

      {calendar && !switchOn && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Working-days timers switch is OFF — ranges can be previewed but not saved.
        </div>
      )}

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-2xl border border-slate-100 shadow-md p-5 space-y-4">
        <p className="text-sm font-bold text-slate-800">
          {editing ? `Extend / rename: ${editing.reason}` : "Add a non-working range"}
        </p>

        {!editing && (
          <div className="flex gap-2">
            {(["HOLIDAY", "TIMER_PAUSE"] as Kind[]).map((k) => (
              <button
                key={k}
                onClick={() => { setKind(k); setPreview(null); }}
                className={`h-9 px-4 rounded-xl text-xs font-bold ${kind === k ? "bg-cyan-500 text-white" : "bg-slate-100 text-slate-600"}`}
              >
                {k === "HOLIDAY" ? "🎉 Holiday (full days)" : "⏸ Timer pause (exact time)"}
              </button>
            ))}
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-3">
          {effectiveKind === "HOLIDAY" ? (
            <>
              {!editing && (
                <label className="text-xs font-semibold text-slate-500 space-y-1">
                  <span>First day</span>
                  <input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPreview(null); }} className={inputClass} />
                </label>
              )}
              <label className="text-xs font-semibold text-slate-500 space-y-1">
                <span>{editing ? `New last day (now: ${formatPauseUntil(editing.ends_at)})` : "Last day (included)"}</span>
                <input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setPreview(null); }} className={inputClass} />
              </label>
            </>
          ) : (
            <>
              {!editing && (
                <label className="text-xs font-semibold text-slate-500 space-y-1">
                  <span>Pause from (IST)</span>
                  <input type="datetime-local" value={fromDateTime} onChange={(e) => { setFromDateTime(e.target.value); setPreview(null); }} className={inputClass} />
                </label>
              )}
              <label className="text-xs font-semibold text-slate-500 space-y-1">
                <span>{editing ? `New end (now: ${formatPauseUntil(editing.ends_at)})` : "Pause until (IST)"}</span>
                <input type="datetime-local" value={toDateTime} onChange={(e) => { setToDateTime(e.target.value); setPreview(null); }} className={inputClass} />
              </label>
            </>
          )}
          <label className="text-xs font-semibold text-slate-500 space-y-1 sm:col-span-2">
            <span>Reason {editing ? "(optional new text)" : ""} — employees see this in the banner</span>
            <input value={reason} maxLength={200} onChange={(e) => { setReason(e.target.value); setPreview(null); }} placeholder='e.g. "Diwali" or "Office shifting"' className={inputClass} />
          </label>
          <label className="text-xs font-semibold text-slate-500 space-y-1 sm:col-span-2">
            <span>Internal note (optional, audit log only)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
          </label>
        </div>

        {preview && (
          <div className="rounded-xl bg-sky-50 border border-sky-100 p-4 text-sm text-sky-900 space-y-1">
            <p className="font-bold">Preview — nothing saved yet</p>
            <p>{preview.working_days} working day(s) of timers paused.</p>
            <p>{preview.paused_leads} Visit-lock / Snooze end date(s) will move forward.</p>
            <p>{preview.sla_leads} NEW lead SLA deadline(s) will move forward.</p>
            <p className="text-xs text-sky-700">
              Cancel karne par (range shuru hone se pehle) ye dates wapas aa jayengi — sirf wo nahi jo is beech contacted/touched hui hon ya jinka original time nikal chuka ho. Range shuru hone ke baad cancel par kuch wapas nahi hota.
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button onClick={runPreview} disabled={busy} className="h-10 px-4 rounded-xl bg-slate-800 text-white text-sm font-bold disabled:opacity-60">
            {busy && !preview ? <Loader2 size={14} className="animate-spin" /> : "Preview impact"}
          </button>
          {preview && (
            <button onClick={confirmSave} disabled={busy || !switchOn} className="h-10 px-4 rounded-xl bg-cyan-500 text-white text-sm font-bold disabled:opacity-60">
              {busy ? <Loader2 size={14} className="animate-spin" /> : "Confirm & save"}
            </button>
          )}
          {(editing || preview) && (
            <button onClick={resetForm} className="h-10 px-4 rounded-xl bg-slate-100 text-slate-600 text-sm font-bold">
              Reset
            </button>
          )}
        </div>
      </motion.div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-md p-5">
        <p className="text-sm font-bold text-slate-800 mb-3">Ranges</p>
        {cancelPreview && (
          <div className="mb-3 rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-900 space-y-1">
            <p className="font-bold">Cancel &quot;{cancelPreview.period.reason}&quot;? — preview, nothing changed yet</p>
            {cancelPreview.revert.range_started ? (
              <p>Range shuru ho chuki hai — koi date wapas nahi aayegi (wo time sach mein non-working tha). Aage ke liye timers phir se chalenge.</p>
            ) : (
              <>
                <p>Wapas aayengi: {cancelPreview.revert.sla_revert} NEW-lead SLA deadline(s) aur {cancelPreview.revert.pause_revert} Visit-lock/Snooze date(s).</p>
                <p>
                  Skip hongi: {cancelPreview.revert.skip_touched} contacted/touched lead(s), {cancelPreview.revert.skip_original_passed} jinka original time nikal chuka,{" "}
                  {cancelPreview.revert.skip_value_changed} jinki date baad mein haath se badli.
                </p>
              </>
            )}
            <div className="flex gap-2 pt-2">
              <button onClick={confirmCancel} disabled={busy} className="h-9 px-4 rounded-xl bg-red-600 text-white text-xs font-bold disabled:opacity-60">
                {busy ? <Loader2 size={14} className="animate-spin" /> : "Confirm cancel"}
              </button>
              <button onClick={() => setCancelPreview(null)} className="h-9 px-4 rounded-xl bg-white text-slate-600 text-xs font-bold border border-slate-200">
                Keep range
              </button>
            </div>
          </div>
        )}
        {loading ? (
          <Loader2 size={18} className="animate-spin text-slate-400" />
        ) : periods.length === 0 ? (
          <p className="text-xs text-slate-400">No ranges yet.</p>
        ) : (
          <div className="space-y-2">
            {periods.map((p) => {
              const state = periodState(p);
              const open = !p.cancelled_at && Date.parse(p.ends_at) > Date.now();
              return (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-700">
                      {p.kind === "HOLIDAY" ? "🎉" : "⏸"} {p.reason}
                    </p>
                    <p className="text-xs text-slate-500">
                      {istDateTime(p.starts_at)} → {formatPauseUntil(p.ends_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${state.className}`}>{state.label}</span>
                    {open && (
                      <>
                        <button onClick={() => startEdit(p)} className="h-8 px-3 rounded-lg bg-slate-100 text-slate-600 text-xs font-bold">Extend</button>
                        <button onClick={() => previewCancel(p)} disabled={busy} className="h-8 px-3 rounded-lg bg-red-50 text-red-600 text-xs font-bold disabled:opacity-60">Cancel</button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ShiftOverridesSection />

      <div className="bg-white rounded-2xl border border-slate-100 shadow-md p-5">
        <p className="text-sm font-bold text-slate-800 mb-3">Audit log</p>
        {audit.length === 0 ? (
          <p className="text-xs text-slate-400">No changes yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-400">
                  <th className="py-1.5 pr-3 font-semibold">When</th>
                  <th className="py-1.5 pr-3 font-semibold">Who</th>
                  <th className="py-1.5 pr-3 font-semibold">Action</th>
                  <th className="py-1.5 pr-3 font-semibold">Range</th>
                  <th className="py-1.5 pr-3 font-semibold">Working days</th>
                  <th className="py-1.5 pr-3 font-semibold">Leads moved / moved back (pause / SLA)</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id} className="border-t border-slate-100 text-slate-600">
                    <td className="py-1.5 pr-3 whitespace-nowrap">{istDateTime(a.acted_at)}</td>
                    <td className="py-1.5 pr-3">{a.actor?.name || "—"}</td>
                    <td className="py-1.5 pr-3 font-semibold">{a.action}</td>
                    <td className="py-1.5 pr-3">
                      {a.after?.starts_at && a.after?.ends_at ? `${istDateTime(a.after.starts_at)} → ${formatPauseUntil(a.after.ends_at)}` : "—"}
                      {a.note ? <span className="block text-slate-400">{a.note}</span> : null}
                    </td>
                    <td className="py-1.5 pr-3">{a.working_days ?? "—"}</td>
                    <td className="py-1.5 pr-3">
                      {a.affected_paused_leads ?? 0} / {a.affected_sla_leads ?? 0}
                      {a.action === "CANCEL" && a.revert_summary && (
                        <span className="block text-slate-400">
                          {a.revert_summary.range_started
                            ? "range had started — nothing moved back"
                            : `moved back; skipped ${a.revert_summary.skip_touched} touched, ${a.revert_summary.skip_original_passed} passed, ${a.revert_summary.skip_value_changed} changed`}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
