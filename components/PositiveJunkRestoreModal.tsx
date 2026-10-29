"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";
import { PositiveJunkRow, RestoreResult, label, restoreTarget, suggestedEmployee } from "@/lib/positiveJunk";

// "Restore and assign" (positive-history junk, 2026-10-29). Step 1: pick an employee per lead
// (default = who first had the positive conversation) and write a reason. Step 2: the server's
// own preview (dry run) is shown as the confirm list; leads whose number is positive with
// another employee are HELD and need a separate admin override tick. Step 3: real restore.
export default function PositiveJunkRestoreModal({
  rows,
  employees,
  protectionDays,
  onClose,
  onDone
}: {
  rows: PositiveJunkRow[];
  employees: { id: string; name: string }[];
  protectionDays: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const active = new Set(employees.map((e) => e.id));
  const [assign, setAssign] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [r.lead_id, suggestedEmployee(r, active)])));
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<RestoreResult[] | null>(null);
  const [override, setOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<RestoreResult[] | null>(null);

  const items = rows.map((r) => ({ lead_id: r.lead_id, employee_id: assign[r.lead_id] }));
  const missing = items.some((i) => !i.employee_id);
  const held = (preview ?? []).filter((p) => p.result === "HELD");

  async function call(dryRun: boolean) {
    setBusy(true);
    const { data, error } = await supabase.rpc("restore_positive_junk_leads", {
      p_items: items,
      p_reason: reason.trim(),
      p_bypass_sibling: override,
      p_dry_run: dryRun
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return null;
    }
    return data as RestoreResult[];
  }

  async function runPreview() {
    if (missing) return toast.error("Pick an employee for every lead.");
    if (reason.trim().length < 5) return toast.error("Write a reason (at least 5 characters).");
    setOverride(false);
    const r = await call(true);
    if (r) setPreview(r);
  }

  async function runRestore() {
    const r = await call(false);
    if (!r) return;
    setDone(r);
    const n = r.filter((x) => x.result === "RESTORED").length;
    toast.success(`${n} lead(s) restored.`);
  }

  const nameOf = (id: string) => employees.find((e) => e.id === id)?.name ?? "—";

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center sm:p-4">
      <div onClick={busy ? undefined : onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto bg-white rounded-t-3xl sm:rounded-3xl shadow-xl p-5">
        <p className="text-lg font-bold text-slate-900">Restore and assign</p>
        <p className="text-sm text-slate-500 mb-4">
          Each lead comes back at its highest positive point, with a fresh activity timer and {protectionDays} days of protection from auto-junk.
        </p>

        {done ? (
          <>
            <ResultList results={done} />
            <button onClick={onDone} className="mt-4 w-full h-12 rounded-2xl bg-slate-900 text-white font-semibold">Done</button>
          </>
        ) : !preview ? (
          <>
            <div className="space-y-2">
              {rows.map((r) => (
                <div key={r.lead_id} className="rounded-xl border border-slate-200 p-3 flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono font-semibold text-slate-800">{r.lead_id8}</p>
                    <p className="text-xs text-slate-500">
                      Comes back as {restoreTarget(r.restore_status, r.restore_stage)} · first {label(r.first_positive)} by {r.first_positive_by_name ?? "—"}
                    </p>
                  </div>
                  <select
                    value={assign[r.lead_id]}
                    onChange={(e) => setAssign((a) => ({ ...a, [r.lead_id]: e.target.value }))}
                    className="h-11 sm:w-56 rounded-xl bg-slate-50 border border-slate-200 px-3 text-sm"
                  >
                    <option value="">Pick an employee</option>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                        {e.id === r.first_positive_by ? " (first positive)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <label className="block mt-4">
              <span className="text-xs font-semibold text-slate-500">Reason (required)</span>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Why are these leads being given back?" className="w-full mt-1 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-sm" />
            </label>
            <div className="flex gap-2 mt-4">
              <button onClick={onClose} className="flex-1 h-12 rounded-2xl bg-slate-100 font-semibold text-slate-600">Cancel</button>
              <button onClick={runPreview} disabled={busy} className="flex-1 h-12 rounded-2xl bg-slate-900 text-white font-semibold disabled:opacity-60">
                {busy ? "Checking..." : "Review"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold text-slate-800 mb-2">Please confirm</p>
            <ul className="space-y-2">
              {preview.map((p) => (
                <li key={p.lead_id} className={`rounded-xl border p-3 text-sm ${p.result === "HELD" ? "border-amber-300 bg-amber-50" : p.result === "WOULD_RESTORE" ? "border-slate-200" : "border-red-200 bg-red-50"}`}>
                  <p className="text-slate-800">
                    <span className="font-mono font-semibold">{p.lead_id8}</span> → <b>{p.employee_name ?? nameOf(p.employee_id)}</b>
                    {p.to_status && <> · back as {restoreTarget(p.to_status, p.to_stage ?? "LEADS")}</>}
                  </p>
                  {p.result === "HELD" && p.sibling && (
                    <p className="text-amber-800 mt-0.5">
                      On hold: this number is {label(p.sibling.stage)} with {p.sibling.owner_name} (lead {p.sibling.holder_id8}).
                    </p>
                  )}
                  {(p.result === "REFUSED" || p.result === "ERROR") && <p className="text-red-700 mt-0.5">Will be skipped: {p.why}</p>}
                </li>
              ))}
            </ul>
            {held.length > 0 && (
              <label className="flex items-start gap-2 mt-3 text-sm text-amber-900">
                <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="mt-1" />
                <span>
                  Restore the {held.length} lead(s) on hold anyway. The same number will then be with two employees. Only tick this if you have checked it.
                </span>
              </label>
            )}
            <p className="text-sm text-slate-600 mt-3">Reason: {reason.trim()}</p>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setPreview(null)} disabled={busy} className="flex-1 h-12 rounded-2xl bg-slate-100 font-semibold text-slate-600">Back</button>
              <button
                onClick={runRestore}
                disabled={busy || preview.every((p) => p.result !== "WOULD_RESTORE" && !(p.result === "HELD" && override))}
                className="flex-1 h-12 rounded-2xl bg-emerald-600 text-white font-semibold disabled:opacity-50"
              >
                {busy ? "Restoring..." : "Confirm restore"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

function ResultList({ results }: { results: RestoreResult[] }) {
  const tone: Record<string, string> = { RESTORED: "text-emerald-700", HELD: "text-amber-700", REFUSED: "text-red-700", ERROR: "text-red-700" };
  return (
    <ul className="space-y-1.5 text-sm">
      {results.map((r) => (
        <li key={r.lead_id}>
          <span className="font-mono font-semibold">{r.lead_id8}</span> → {r.employee_name ?? "—"}:{" "}
          <span className={`font-semibold ${tone[r.result] ?? ""}`}>{label(r.result)}</span>
          {r.why ? ` (${r.why})` : ""}
        </li>
      ))}
    </ul>
  );
}
