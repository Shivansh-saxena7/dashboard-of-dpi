"use client";

// "Allow shift on…" (2026-10-08). On the weekly off or an Admin HOLIDAY,
// Start Shift is blocked (switch ON); Admin lets one employee — or
// everyone — start a shift on a given date anyway (a special working day).
// It only unlocks Start Shift; lead timers still don't count that day.
// Writes go through save_shift_day_override (GRANT / CANCEL), preview
// first, then confirm.

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useWorkingCalendar } from "@/lib/useWorkingCalendar";
import { nonWorkingStatusAt, timerCalendar } from "@/lib/workingCalendar";

interface Override {
  id: string;
  work_date: string;
  reason: string;
  employee: { name: string | null } | null;
  creator: { name: string | null } | null;
}

const ALL = "ALL";
const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" });

export default function ShiftOverridesSection() {
  const calendar = useWorkingCalendar();
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([]);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [date, setDate] = useState("");
  const [employeeId, setEmployeeId] = useState(ALL);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Override | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const [{ data: emp }, { data: rows }] = await Promise.all([
      supabase.from("employees").select("id, name").eq("is_active", true).order("name"),
      supabase
        .from("shift_day_overrides")
        .select("id, work_date, reason, employee:employees!shift_day_overrides_employee_id_fkey(name), creator:employees!shift_day_overrides_created_by_fkey(name)")
        .is("cancelled_at", null)
        .gte("work_date", today)
        .order("work_date")
        .limit(100)
    ]);
    setEmployees((emp as { id: string; name: string }[]) || []);
    setOverrides((rows as unknown as Override[]) || []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Preview: what kind of day it is, and who it unlocks. Nothing written.
  function runPreview() {
    if (!date) return toast.error("Pick a date.");
    if (!reason.trim()) return toast.error("Reason is required.");
    const cal = timerCalendar(calendar);
    const status = cal ? nonWorkingStatusAt(cal, `${date}T12:00:00+05:30`) : { isNonWorking: false as const };
    const kind = !cal
      ? "Working-days switch is OFF — Start Shift isn't blocked on any day, so this override has no effect right now."
      : !status.isNonWorking
      ? "This is a normal working day — Start Shift is already allowed; the override changes nothing."
      : status.kind === "WEEKLY_OFF"
      ? "Weekly off — Start Shift is blocked; this override unlocks it."
      : status.kind === "HOLIDAY"
      ? `Holiday (${status.reason}) — Start Shift is blocked; this override unlocks it.`
      : "Timer pause — Start Shift is not blocked on a timer pause; the override changes nothing.";
    const who = employeeId === ALL ? `all ${employees.length} active employees` : employees.find((e) => e.id === employeeId)?.name || "1 employee";
    setPreview(`${dayLabel(date)}: ${kind} Applies to ${who}. Lead timers still stay paused that day.`);
  }

  async function confirmGrant() {
    setBusy(true);
    const { error } = await supabase.rpc("save_shift_day_override", {
      p_action: "GRANT",
      p_work_date: date,
      p_employee_id: employeeId === ALL ? null : employeeId,
      p_reason: reason.trim()
    });
    setBusy(false);
    if (error) return toast.error(error.message.replace("save_shift_day_override: ", ""));
    toast.success("Shift allowed for that day.");
    setDate("");
    setEmployeeId(ALL);
    setReason("");
    setPreview(null);
    load();
  }

  async function confirmCancel() {
    if (!cancelling) return;
    setBusy(true);
    const { error } = await supabase.rpc("save_shift_day_override", { p_action: "CANCEL", p_override_id: cancelling.id });
    setBusy(false);
    if (error) return toast.error(error.message.replace("save_shift_day_override: ", ""));
    toast.success("Override cancelled — Start Shift is blocked again for that day.");
    setCancelling(null);
    load();
  }

  const inputClass = "w-full h-10 rounded-xl bg-slate-50 border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-cyan-200";

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-md p-5 space-y-4">
      <div>
        <p className="text-sm font-bold text-slate-800">Allow shift on…</p>
        <p className="text-xs text-slate-500 mt-0.5">
          Weekly off ya Holiday par Start Shift band rehta hai. Special working day ke liye yahan se ek employee ya sabko allow karein.
        </p>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <label className="text-xs font-semibold text-slate-500 space-y-1">
          <span>Date</span>
          <input type="date" value={date} onChange={(e) => { setDate(e.target.value); setPreview(null); }} className={inputClass} />
        </label>
        <label className="text-xs font-semibold text-slate-500 space-y-1">
          <span>Employee</span>
          <select value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); setPreview(null); }} className={inputClass}>
            <option value={ALL}>All employees</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-500 space-y-1">
          <span>Reason</span>
          <input value={reason} maxLength={200} onChange={(e) => { setReason(e.target.value); setPreview(null); }} placeholder='e.g. "Site visit day"' className={inputClass} />
        </label>
      </div>

      {preview && (
        <div className="rounded-xl bg-sky-50 border border-sky-100 p-3 text-sm text-sky-900">
          <p className="font-bold">Preview — nothing saved yet</p>
          <p>{preview}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button onClick={runPreview} className="h-10 px-4 rounded-xl bg-slate-800 text-white text-sm font-bold">Preview</button>
        {preview && (
          <button onClick={confirmGrant} disabled={busy} className="h-10 px-4 rounded-xl bg-cyan-500 text-white text-sm font-bold disabled:opacity-60">
            {busy ? <Loader2 size={14} className="animate-spin" /> : "Confirm & allow"}
          </button>
        )}
      </div>

      {cancelling && (
        <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-900 space-y-2">
          <p>
            Cancel override for {cancelling.employee?.name || "all employees"} on {dayLabel(cancelling.work_date)}? Start Shift will be blocked again
            that day (if it&apos;s a weekly off / holiday). Shifts already started stay as they are.
          </p>
          <div className="flex gap-2">
            <button onClick={confirmCancel} disabled={busy} className="h-9 px-4 rounded-xl bg-red-600 text-white text-xs font-bold disabled:opacity-60">Confirm cancel</button>
            <button onClick={() => setCancelling(null)} className="h-9 px-4 rounded-xl bg-white text-slate-600 text-xs font-bold border border-slate-200">Keep</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {overrides.length === 0 ? (
          <p className="text-xs text-slate-400">No active overrides.</p>
        ) : (
          overrides.map((o) => (
            <div key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-700">{dayLabel(o.work_date)} · {o.employee?.name || "All employees"}</p>
                <p className="text-xs text-slate-500">{o.reason} · by {o.creator?.name || "—"}</p>
              </div>
              <button onClick={() => setCancelling(o)} className="h-8 px-3 rounded-lg bg-red-50 text-red-600 text-xs font-bold">Cancel</button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
