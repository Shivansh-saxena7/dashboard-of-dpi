"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Printer } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  CallQualityDetails,
  clock,
  contactMethodLabel,
  duration,
  flagMetaFor,
  flagReason,
  isCallQualityMissing,
  istDayKey,
  longDate,
  outcomeLabel
} from "@/lib/callQuality";

// Dispute view (Call Quality, 2026-10-29): one employee, one day, every dial and every saved
// result with exact server times, the "How did you talk?" answer, each flag and the rule that
// applied — one clean page to print or screenshot when an employee questions their numbers.
// Gated by admin/layout.tsx like every /admin page; the RPC itself checks the role again.
export default function DisputePage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-400">Loading...</p>}>
      <Dispute />
    </Suspense>
  );
}

function Dispute() {
  const params = useSearchParams();
  const employeeId = params.get("employee") ?? "";
  const [date, setDate] = useState(params.get("date") ?? istDayKey(0));
  const [result, setResult] = useState<{ key: string; data: CallQualityDetails | null; error: string | null } | null>(null);
  const key = `${employeeId}|${date}`;

  useEffect(() => {
    if (!employeeId) return;
    let cancelled = false;
    supabase.rpc("get_call_quality_details", { p_employee_id: employeeId, p_from: date, p_to: date }).then(({ data, error }) => {
      if (cancelled) return;
      setResult({ key, data: error ? null : (data as CallQualityDetails), error: error ? (isCallQualityMissing(error) ? "Call Quality is not switched on yet." : error.message) : null });
    });
    return () => {
      cancelled = true;
    };
  }, [key, employeeId, date]);

  if (!employeeId) return <p className="text-sm text-slate-500">Open this page from Work Reports → Call Quality → an employee → Open dispute view.</p>;
  if (!result || result.key !== key) return <p className="text-sm text-slate-400">Loading...</p>;
  if (result.error || !result.data) return <p className="text-sm text-red-600">{result.error}</p>;

  const d = result.data;
  const s = d.settings;
  const clicks = d.rows.filter((r) => r.kind === "CLICK");
  const saved = clicks.filter((r) => r.result_at).length;
  const lowering = d.rows.filter((r) => r.score_flags.length > 0).length;

  return (
    <div className="max-w-4xl bg-white rounded-2xl border border-slate-100 shadow-md p-5 print:shadow-none print:border-0 print:p-0">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Call Quality — dispute view</p>
          <h1 className="text-2xl font-bold text-slate-900">{d.employee_name ?? "Employee"}</h1>
          <p className="text-sm text-slate-600">{longDate(date)} · all times are server times (IST)</p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <input type="date" value={date} max={istDayKey(0)} onChange={(e) => setDate(e.target.value)} className="h-10 rounded-xl bg-slate-50 border border-slate-200 px-3 text-sm" />
          <button onClick={() => window.print()} className="flex items-center gap-1 h-10 px-3 rounded-xl bg-slate-800 text-white text-sm font-semibold">
            <Printer size={15} /> Print
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <Box label="Dials" value={clicks.length} />
        <Box label="Results saved" value={saved} />
        <Box label="Results without a dial" value={d.rows.filter((r) => r.kind === "NO_DIAL").length} />
        <Box label="Lines that lower the score" value={lowering} />
      </div>
      {!s.enforced && <p className="text-sm text-sky-700 mb-3">Learning week: no action is taken on this score.</p>}

      {d.rows.length === 0 ? (
        <p className="text-sm text-slate-400">No dials or results on this day.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                <th className="py-2 pr-2">Dial time</th>
                <th className="py-2 pr-2">Lead</th>
                <th className="py-2 pr-2">How did you talk?</th>
                <th className="py-2 pr-2">Result</th>
                <th className="py-2 pr-2">Result time</th>
                <th className="py-2 pr-2">After</th>
                <th className="py-2">Flags and the rule that applied</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r, i) => (
                <tr key={r.click_id ?? `n-${i}`} className="border-b border-slate-100 align-top">
                  <td className="py-2 pr-2 tabular-nums whitespace-nowrap">{r.kind === "CLICK" ? clock(r.clicked_at) : "No dial"}</td>
                  <td className="py-2 pr-2">
                    <p className="font-medium text-slate-800">{r.lead_name ?? "—"}</p>
                    <p className="text-xs text-slate-400">{r.card_type === "DATA" ? "Data card" : "Lead card"}{r.estimated ? " · Estimated" : ""}</p>
                  </td>
                  <td className="py-2 pr-2">{r.outcome ? contactMethodLabel(r.contact_method) : "—"}</td>
                  <td className="py-2 pr-2">{r.outcome ? outcomeLabel(r.outcome) : r.result_kind === "NOTE" ? "Note" : r.result_kind === "WHATSAPP" ? "WhatsApp" : r.result_kind === "FOLLOW_UP" ? "Follow-up" : "—"}</td>
                  <td className="py-2 pr-2 tabular-nums whitespace-nowrap">{clock(r.result_at ?? r.outcome_at)}</td>
                  <td className="py-2 pr-2 tabular-nums whitespace-nowrap">{r.kind === "CLICK" && r.gap_seconds !== null ? duration(r.gap_seconds) : "—"}</td>
                  <td className="py-2">
                    {r.flags.length === 0 ? (
                      <span className="text-emerald-700">OK</span>
                    ) : (
                      r.flags.map((f) => (
                        <p key={f} className={r.score_flags.includes(f) ? "text-red-700" : "text-slate-500"}>
                          <span className="font-semibold">{flagMetaFor(f, s).label}</span> ({r.score_flags.includes(f) ? "lowers score" : "context only"}): {flagReason(f, r, s)}
                        </p>
                      ))
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-400 mt-4">Generated {new Date().toLocaleString("en-GB", { timeZone: "Asia/Kolkata" })} IST from the CRM&apos;s own records.</p>
    </div>
  );
}

function Box({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="text-2xl font-bold text-slate-800 tabular-nums">{value}</p>
    </div>
  );
}
