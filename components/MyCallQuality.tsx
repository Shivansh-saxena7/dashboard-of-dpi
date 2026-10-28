"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { CallQualitySummary, isCallQualityHidden, isCallQualityMissing, istDayKey } from "@/lib/callQuality";
import { CallQualityDetails, FlagChipRow, HowCalculated, ScoreBadge, StatusNotes, TrendBars } from "@/components/CallQualityParts";

// Employee's own Call Quality panel on /report (2026-10-28). Only ever the
// signed-in employee's own data — get_call_quality_summary/_details refuse
// anyone else's id, and refuse entirely while Admin has switched
// call_quality_visible_to_employees off (the panel then simply hides).
export default function MyCallQuality({ employeeId }: { employeeId: string }) {
  const [range, setRange] = useState<"today" | "7">("today");
  const [summary, setSummary] = useState<CallQualitySummary | null>(null);
  const [hidden, setHidden] = useState(false);
  const [showCalls, setShowCalls] = useState(false);

  const from = istDayKey(range === "today" ? 0 : 6);
  const to = istDayKey(0);

  useEffect(() => {
    supabase.rpc("get_call_quality_summary", { p_employee_id: employeeId, p_from: from, p_to: to }).then(({ data, error }) => {
      if (error) {
        if (!isCallQualityMissing(error) && !isCallQualityHidden(error)) console.error("get_call_quality_summary failed:", error.message);
        setHidden(true);
        return;
      }
      setHidden(false);
      setSummary(data as CallQualitySummary);
    });
  }, [employeeId, from, to]);

  if (hidden || !summary) return null;
  const me = summary.employees[0];
  const t = me?.totals;

  return (
    <div className="rounded-2xl bg-white border border-slate-100 shadow-md p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-slate-800">📞 Call Quality</p>
        <div className="flex rounded-lg bg-slate-100 p-0.5">
          {(["today", "7"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`px-2 py-1 text-[11px] font-semibold rounded-md ${range === r ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"}`}
            >
              {r === "today" ? "Today" : "Last 7 days"}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-slate-500">
        The CRM keeps a record of every Call tap and every outcome you log, with the server&apos;s time. This score shows how many of your calls have a believable record.
      </p>
      <StatusNotes estimated={summary.estimated} enforced={summary.enforced} />

      {!t ? (
        <p className="text-sm text-slate-400">No calls yet in this range.</p>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-2">
            <Stat label="Score" value={<ScoreBadge score={t.genuine_score} />} />
            <Stat label="Dial clicks" value={t.dial_clicks} />
            <Stat label="Logged calls" value={t.logged_calls} />
            <Stat label="Connected" value={t.connected} />
          </div>
          {t.genuine_score === null && (
            <p className="text-[11px] text-slate-400">Score appears after {summary.settings.min_sample} judged calls.</p>
          )}
          <FlagChipRow totals={t} />
          {range === "7" && <TrendBars days={me.days} />}

          <button type="button" onClick={() => setShowCalls((v) => !v)} className="text-xs font-semibold text-amber-700">
            {showCalls ? "Hide flagged calls" : "Show my flagged calls with exact times"}
          </button>
          {showCalls && <CallQualityDetails employeeId={employeeId} from={from} to={to} onlyFlagged />}
        </>
      )}

      <div className="rounded-xl bg-slate-50 p-3">
        <p className="text-xs font-bold text-slate-700 mb-1">How to keep your score high</p>
        <ul className="text-xs text-slate-600 space-y-1 list-disc pl-4">
          <li>Always dial from the Call button in the CRM, not from your phone&apos;s dialer.</li>
          <li>Log the outcome right after every call. When you come back to the CRM, the lead opens for you.</li>
          <li>If the call drops, just tap Call again — a redial never counts against you.</li>
          <li>Followed up on WhatsApp instead? Tap the WhatsApp button first, then log the status.</li>
          <li>Called the client on another number from your phone? That shows as Outcome without click. A few are fine: the score is a ratio, not a count.</li>
        </ul>
      </div>
      <HowCalculated settings={summary.settings} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-100 p-2 text-center">
      <p className="text-[10px] font-semibold text-slate-500">{label}</p>
      <div className="text-lg font-bold text-slate-800 tabular-nums">{value}</div>
    </div>
  );
}
