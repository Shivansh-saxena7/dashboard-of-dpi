"use client";

import { Fragment, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { CallQualityEmployee, CallQualitySummary, CallQualityTotals, isCallQualityMissing, istDayKey } from "@/lib/callQuality";
import { CallQualityDetails, FlagChipRow, HowCalculated, ScoreBadge, StatusNotes, TrendBars } from "@/components/CallQualityParts";

type CardFilter = "ALL" | "LEAD" | "DATA";

// Admin Work Reports — Call Quality (2026-10-28). Team table for the last 7 or
// 30 days: Dial clicks / Logged calls / Connected as three separate numbers,
// genuine score, flag chips and a daily trend; a row opens the employee's
// call-by-call drill-down. Numbers and flags come only from
// get_call_quality_summary / get_call_quality_details (DB views).
export default function CallQualityOverview() {
  const [days, setDays] = useState<7 | 30>(7);
  const [card, setCard] = useState<CardFilter>("ALL");
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

  const pick = (e: CallQualityEmployee): CallQualityTotals => (card === "ALL" ? e.totals : e.by_card_type[card]);

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-md p-4 mb-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <p className="text-sm font-bold text-slate-800">📞 Call Quality — Team</p>
        <div className="flex items-center gap-2">
          <Toggle value={days} options={[7, 30]} label={(v) => `${v} days`} onChange={(v) => setDays(v as 7 | 30)} />
          <Toggle value={card} options={["ALL", "LEAD", "DATA"]} label={(v) => (v === "ALL" ? "All cards" : v === "LEAD" ? "Leads" : "Data")} onChange={(v) => setCard(v as CardFilter)} />
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
            <p className="text-sm text-slate-400">No calls in this range.</p>
          ) : (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-slate-400">
                    <th className="px-1 py-1 font-semibold">Employee</th>
                    <th className="px-1 py-1 font-semibold text-right">Score</th>
                    <th className="px-1 py-1 font-semibold text-right">Dial clicks</th>
                    <th className="px-1 py-1 font-semibold text-right">Logged calls</th>
                    <th className="px-1 py-1 font-semibold text-right">Connected</th>
                    <th className="px-1 py-1 font-semibold">Flags</th>
                    <th className="px-1 py-1 font-semibold">Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {[...summary.employees]
                    .sort((a, b) => (pick(b).dial_clicks ?? 0) - (pick(a).dial_clicks ?? 0))
                    .map((e) => {
                      const t = pick(e);
                      const isOpen = openEmployee === e.employee_id;
                      return (
                        <Fragment key={e.employee_id}>
                          <tr
                            onClick={() => setOpenEmployee(isOpen ? null : e.employee_id)}
                            className={`border-t border-slate-50 cursor-pointer align-middle ${isOpen ? "bg-amber-50/60" : "hover:bg-slate-50"}`}
                          >
                            <td className="px-1 py-2 font-semibold text-slate-700 whitespace-nowrap">{e.employee_name}</td>
                            <td className="px-1 py-2 text-right">
                              <ScoreBadge score={t.genuine_score} />
                            </td>
                            <td className="px-1 py-2 text-right tabular-nums">{t.dial_clicks}</td>
                            <td className="px-1 py-2 text-right tabular-nums">{t.logged_calls}</td>
                            <td className="px-1 py-2 text-right tabular-nums">{t.connected}</td>
                            <td className="px-1 py-2">
                              <FlagChipRow totals={t} />
                            </td>
                            <td className="px-1 py-2">
                              <TrendBars days={e.days} />
                            </td>
                          </tr>
                          {isOpen && (
                            <tr>
                              <td colSpan={7} className="px-1 pb-3 pt-1 bg-amber-50/30">
                                <CallQualityDetails employeeId={e.employee_id} from={from} to={to} />
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

function Toggle<T extends string | number>({ value, options, label, onChange }: { value: T; options: T[]; label: (v: T) => string; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-lg bg-slate-100 p-0.5">
      {options.map((o) => (
        <button
          key={String(o)}
          type="button"
          onClick={() => onChange(o)}
          className={`px-2 py-1 text-[11px] font-semibold rounded-md ${value === o ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"}`}
        >
          {label(o)}
        </button>
      ))}
    </div>
  );
}
