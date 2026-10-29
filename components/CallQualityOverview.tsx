"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { CallQualityDetails, CallQualityEmployee, CallQualitySummary, isCallQualityMissing, istDayKey, longDate } from "@/lib/callQuality";
import { FlagChipRow, HowCalculated, SmallScore, StatusNotes, Timeline, TrendBars } from "@/components/CallQualityParts";

// Admin Work Reports — Call Quality (2026-10-28, plain names 2026-10-29). Team table for the last
// 7 or 30 days: Leads and Data scored separately, Dials / Results saved / Connected, flag chips,
// daily trend. A row opens that employee's call-by-call day (same wording the employee sees) and
// a link to the printable Dispute view. Everything comes from the DB RPCs.
export default function CallQualityOverview() {
  const [days, setDays] = useState<7 | 30>(7);
  const [summary, setSummary] = useState<CallQualitySummary | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing" | "error">("loading");
  const [error, setError] = useState("");
  const [openEmployee, setOpenEmployee] = useState<string | null>(null);

  const from = istDayKey(days - 1);
  const to = istDayKey(0);

  useEffect(() => {
    load();
  }, [days]);

  async function load() {
    setState("loading");
    const { data, error } = await supabase.rpc("get_call_quality_summary", { p_employee_id: null, p_from: from, p_to: to });
    if (error) {
      setState(isCallQualityMissing(error) ? "missing" : "error");
      setError(error.message);
      return;
    }
    setSummary(data as CallQualitySummary);
    setState("ok");
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-md p-4 mb-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <p className="text-sm font-bold text-slate-800">📞 Call Quality — Team</p>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-slate-100 p-0.5">
            {([7, 30] as const).map((d) => (
              <button key={d} type="button" onClick={() => setDays(d)} className={`px-2 py-1 text-xs font-semibold rounded-md ${days === d ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"}`}>
                {d} days
              </button>
            ))}
          </div>
          <button onClick={load} disabled={state === "loading"} className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700 disabled:opacity-50">
            <RefreshCw size={12} className={state === "loading" ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {state === "loading" && <p className="text-sm text-slate-400">Loading...</p>}
      {state === "missing" && <p className="text-sm text-slate-400">Call Quality is not switched on yet.</p>}
      {state === "error" && <p className="text-sm text-red-600">Could not load Call Quality: {error}</p>}

      {state === "ok" && summary && (
        <div className="space-y-3">
          <StatusNotes estimated={summary.estimated} enforced={summary.enforced} />
          <HowCalculated settings={summary.settings} />
          {summary.employees.length === 0 ? (
            <p className="text-sm text-slate-400">No dials in this range.</p>
          ) : (
            <div className="w-0 min-w-full overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-400">
                    <th className="px-1 py-1 font-semibold">Employee</th>
                    <th className="px-1 py-1 font-semibold text-right">Leads score</th>
                    <th className="px-1 py-1 font-semibold text-right">Data score</th>
                    <th className="px-1 py-1 font-semibold text-right">Dials</th>
                    <th className="px-1 py-1 font-semibold text-right">Results saved</th>
                    <th className="px-1 py-1 font-semibold text-right">Connected</th>
                    <th className="px-1 py-1 font-semibold">Flags</th>
                    <th className="px-1 py-1 font-semibold">Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {[...summary.employees]
                    .sort((a, b) => b.totals.dial_clicks - a.totals.dial_clicks)
                    .map((e) => {
                      const isOpen = openEmployee === e.employee_id;
                      return (
                        <Fragment key={e.employee_id}>
                          <tr onClick={() => setOpenEmployee(isOpen ? null : e.employee_id)} className={`border-t border-slate-50 cursor-pointer align-middle ${isOpen ? "bg-amber-50/60" : "hover:bg-slate-50"}`}>
                            <td className="px-1 py-2 font-semibold text-slate-700 whitespace-nowrap">{e.employee_name}</td>
                            <td className="px-1 py-2 text-right"><SmallScore score={e.by_card_type.LEAD.genuine_score} /></td>
                            <td className="px-1 py-2 text-right"><SmallScore score={e.by_card_type.DATA.genuine_score} /></td>
                            <td className="px-1 py-2 text-right tabular-nums">{e.totals.dial_clicks}</td>
                            <td className="px-1 py-2 text-right tabular-nums">{e.totals.results_saved}</td>
                            <td className="px-1 py-2 text-right tabular-nums">{e.totals.connected}</td>
                            <td className="px-1 py-2">
                              <FlagChipRow totals={e.totals} settings={summary.settings} />
                              <InfoBadges employee={e} summary={summary} />
                            </td>
                            <td className="px-1 py-2"><TrendBars days={e.days} /></td>
                          </tr>
                          {isOpen && (
                            <tr>
                              <td colSpan={8} className="px-1 pb-3 pt-1 bg-amber-50/30">
                                <EmployeeDay employee={e} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InfoBadges({ employee, summary }: { employee: CallQualityEmployee; summary: CallQualitySummary }) {
  const t = employee.totals;
  const pct = t.logged_calls > 0 ? Math.round((t.declared_other * 100) / t.logged_calls) : 0;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {employee.declared_other_high && (
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200">
          Often says &quot;Customer called me&quot; / &quot;another phone&quot; ({pct}% of results, info only)
        </span>
      )}
      {employee.no_dial_pattern_days > 0 && (
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
          Result without a dial on {summary.settings.no_dial_share_pct}%+ of results: {employee.no_dial_pattern_days} day(s)
        </span>
      )}
    </div>
  );
}

// One employee, one day, call by call (same lines and reasons the employee sees).
function EmployeeDay({ employee }: { employee: CallQualityEmployee }) {
  const activeDays = employee.days.filter((d) => d.dial_clicks > 0 || d.logged_calls > 0).map((d) => d.date);
  const [day, setDay] = useState(activeDays[activeDays.length - 1] ?? istDayKey(0));
  const [details, setDetails] = useState<{ key: string; data: CallQualityDetails | null; error: string | null } | null>(null);
  const key = `${employee.employee_id}|${day}`;

  useEffect(() => {
    let cancelled = false;
    supabase.rpc("get_call_quality_details", { p_employee_id: employee.employee_id, p_from: day, p_to: day }).then(({ data, error }) => {
      if (!cancelled) setDetails({ key, data: error ? null : (data as CallQualityDetails), error: error ? error.message : null });
    });
    return () => {
      cancelled = true;
    };
  }, [key, employee.employee_id, day]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <select value={day} onChange={(e) => setDay(e.target.value)} className="h-9 rounded-lg bg-white border border-slate-200 px-2 text-sm">
          {[...activeDays].reverse().map((d) => (
            <option key={d} value={d}>{longDate(d)}</option>
          ))}
        </select>
        <Link href={`/admin/work-reports/dispute?employee=${employee.employee_id}&date=${day}`} target="_blank" className="text-sm font-semibold text-amber-700 underline">
          Open dispute view
        </Link>
      </div>
      {!details || details.key !== key ? (
        <p className="text-sm text-slate-400">Loading dials...</p>
      ) : details.error || !details.data ? (
        <p className="text-sm text-red-600">Could not load the dials: {details.error}</p>
      ) : (
        <Timeline rows={details.data.rows} settings={details.data.settings} showLowersScore />
      )}
    </div>
  );
}
