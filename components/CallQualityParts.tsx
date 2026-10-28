"use client";

import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  CallQualityDetailRow,
  CallQualitySettings,
  CallQualityTotals,
  FLAG_CHIPS,
  flagMeta,
  formatClock,
  formatScore,
  scoreExplanation,
  scoreTone
} from "@/lib/callQuality";

// Small shared pieces of the Call Quality UI (2026-10-28), used by the Admin
// overview (CallQualityOverview) and the employee's own panel (MyCallQuality).

export function FlagChip({ flag, count, active, onClick }: { flag: string; count?: number; active?: boolean; onClick?: () => void }) {
  const meta = flagMeta(flag);
  const cls = `inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${meta.chipClass} ${
    active ? "ring-2 ring-offset-1 ring-amber-400" : ""
  }`;
  const body = (
    <>
      {meta.label}
      {count !== undefined && <span className="tabular-nums">{count}</span>}
    </>
  );
  return onClick ? (
    <button type="button" title={meta.hint} onClick={onClick} className={cls}>
      {body}
    </button>
  ) : (
    <span title={meta.hint} className={cls}>
      {body}
    </span>
  );
}

export function FlagChipRow({ totals, active, onPick }: { totals: CallQualityTotals; active?: string | null; onPick?: (flag: string | null) => void }) {
  const shown = FLAG_CHIPS.filter((c) => (totals.flags[c.key] ?? 0) > 0);
  if (shown.length === 0) return <span className="text-xs text-emerald-600 font-semibold">No flags</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((c) => (
        <FlagChip
          key={c.key}
          flag={c.flag}
          count={totals.flags[c.key]}
          active={active === c.flag}
          onClick={onPick ? () => onPick(active === c.flag ? null : c.flag) : undefined}
        />
      ))}
    </div>
  );
}

export function ScoreBadge({ score, size = "md" }: { score: number | null; size?: "md" | "lg" }) {
  return (
    <span className={`font-extrabold tabular-nums ${scoreTone(score)} ${size === "lg" ? "text-3xl" : "text-lg"}`} title={score === null ? "Not enough judged calls yet" : undefined}>
      {formatScore(score)}
    </span>
  );
}

export function StatusNotes({ estimated, enforced }: { estimated: boolean; enforced: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {!enforced && (
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200">
          Learning week — the score is not used for evaluation yet
        </span>
      )}
      {estimated && (
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
          Estimated — includes days before Call Quality went live
        </span>
      )}
    </div>
  );
}

export function HowCalculated({ settings }: { settings: CallQualitySettings }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700">
        <Info size={13} /> How is this calculated?
      </button>
      {open && (
        <ul className="mt-2 space-y-1.5 text-xs text-slate-600 list-disc pl-4">
          {scoreExplanation(settings).map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Per-day score bars (oldest left). Days without enough judged calls show as a grey stub.
export function TrendBars({ days }: { days: (CallQualityTotals & { date: string })[] }) {
  if (days.length === 0) return <span className="text-xs text-slate-400">No calls in this range.</span>;
  return (
    <div className="flex items-end gap-0.5 h-10" aria-label="Daily genuine score">
      {days.map((d) => {
        const s = d.genuine_score;
        const h = s === null ? 8 : Math.max(8, Math.round((s / 100) * 40));
        const color = s === null ? "bg-slate-200" : s >= 80 ? "bg-emerald-400" : s >= 60 ? "bg-amber-400" : "bg-red-400";
        return <div key={d.date} title={`${d.date}: ${formatScore(s)} · ${d.dial_clicks} dial clicks`} className={`w-2 rounded-sm ${color}`} style={{ height: h }} />;
      })}
    </div>
  );
}

// Drill-down: every call click (and every outcome without a click) for one employee.
export function CallQualityDetails({ employeeId, from, to, onlyFlagged = false }: { employeeId: string; from: string; to: string; onlyFlagged?: boolean }) {
  // Result is kept with the request it answers, so a changed range shows "Loading" instead of stale rows.
  const requestKey = `${employeeId}|${from}|${to}`;
  const [result, setResult] = useState<{ key: string; rows: CallQualityDetailRow[] | null; error: string | null } | null>(null);
  const [flagFilter, setFlagFilter] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.rpc("get_call_quality_details", { p_employee_id: employeeId, p_from: from, p_to: to }).then(({ data, error }) => {
      if (cancelled) return;
      setResult({ key: requestKey, rows: error ? null : ((data as CallQualityDetailRow[]) ?? []), error: error ? error.message : null });
    });
    return () => {
      cancelled = true;
    };
  }, [requestKey, employeeId, from, to]);

  if (!result || result.key !== requestKey) return <p className="text-sm text-slate-400">Loading calls...</p>;
  if (result.error || !result.rows) return <p className="text-sm text-red-600">Could not load the call list: {result.error}</p>;
  const rows = result.rows;

  const scoreFlags = (r: CallQualityDetailRow) => r.flags.filter((f) => flagMeta(f).affectsScore);
  let shown = onlyFlagged ? rows.filter((r) => scoreFlags(r).length > 0) : rows;
  if (flagFilter) shown = shown.filter((r) => r.flags.includes(flagFilter as never));
  const present = Array.from(new Set(rows.flatMap((r) => r.flags)));

  return (
    <div className="space-y-2">
      {present.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {present.map((f) => (
            <FlagChip key={f} flag={f} active={flagFilter === f} onClick={() => setFlagFilter(flagFilter === f ? null : f)} />
          ))}
        </div>
      )}
      {shown.length === 0 ? (
        <p className="text-sm text-slate-400">{onlyFlagged ? "No flagged calls in this range." : "No calls in this range."}</p>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-400">
                <th className="px-1 py-1 font-semibold">Lead</th>
                <th className="px-1 py-1 font-semibold">Click time</th>
                <th className="px-1 py-1 font-semibold">Outcome</th>
                <th className="px-1 py-1 font-semibold">Outcome time</th>
                <th className="px-1 py-1 font-semibold text-right">Gap (s)</th>
                <th className="px-1 py-1 font-semibold">Flags</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={r.click_id ?? `o-${i}`} className="border-t border-slate-50 align-top">
                  <td className="px-1 py-1.5 max-w-[140px]">
                    <p className="font-medium text-slate-700 truncate">{r.lead_name ?? "—"}</p>
                    <p className="text-[10px] text-slate-400">
                      {r.card_type ?? "LEAD"}
                      {r.estimated ? " · Estimated" : ""}
                      {r.pending ? " · Waiting for outcome" : ""}
                    </p>
                  </td>
                  <td className="px-1 py-1.5 whitespace-nowrap text-slate-600">{r.kind === "CLICK" ? formatClock(r.clicked_at) : "No click"}</td>
                  <td className="px-1 py-1.5 text-slate-700">{r.outcome ? r.outcome.replace(/_/g, " ") : "—"}</td>
                  <td className="px-1 py-1.5 whitespace-nowrap text-slate-600">{formatClock(r.outcome_at)}</td>
                  <td className="px-1 py-1.5 text-right tabular-nums text-slate-700">{r.gap_seconds ?? "—"}</td>
                  <td className="px-1 py-1.5">
                    <div className="flex flex-wrap gap-1">
                      {r.flags.map((f) => (
                        <FlagChip key={f} flag={f} />
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
