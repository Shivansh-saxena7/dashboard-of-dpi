"use client";

import { useState } from "react";
import { ChevronDown, Info } from "lucide-react";
import {
  CallQualityRow,
  CallQualitySettings,
  CallQualityTotals,
  FLAG_CHIPS,
  bandClasses,
  bandMeaning,
  bandOf,
  flagMetaFor,
  scoreExplanation,
  scoreText,
  timelineLine
} from "@/lib/callQuality";

// Shared pieces of the Call Quality UI (2026-10-28, plain-language 2026-10-29), used by the Admin
// overview, the Dispute view and the employee's own panel — one wording for everyone.

export function FlagChip({ flag, settings, count, active, onClick }: { flag: string; settings: CallQualitySettings; count?: number; active?: boolean; onClick?: () => void }) {
  const meta = flagMetaFor(flag, settings);
  const cls = `inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full border ${meta.chipClass} ${active ? "ring-2 ring-offset-1 ring-amber-400" : ""}`;
  const body = (
    <>
      {meta.label}
      {count !== undefined && <span className="tabular-nums">{count}</span>}
    </>
  );
  return onClick ? (
    <button type="button" title={meta.what} onClick={onClick} className={cls}>
      {body}
    </button>
  ) : (
    <span title={meta.what} className={cls}>
      {body}
    </span>
  );
}

export function FlagChipRow({ totals, settings }: { totals: CallQualityTotals; settings: CallQualitySettings }) {
  const shown = FLAG_CHIPS.filter((c) => (totals.flags[c.key] ?? 0) > 0);
  if (shown.length === 0) return <span className="text-xs text-emerald-600 font-semibold">Nothing flagged</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((c) => (
        <FlagChip key={c.key} flag={c.flag} settings={settings} count={totals.flags[c.key]} />
      ))}
    </div>
  );
}

// Traffic light: dot + score + band word (+ one-line meaning when `explain`).
export function ScoreLight({ score, settings, explain = false, label }: { score: number | null; settings: CallQualitySettings; explain?: boolean; label?: string }) {
  const band = bandOf(score);
  const c = bandClasses(band);
  return (
    <div>
      {label && <p className="text-xs font-semibold text-slate-500">{label}</p>}
      <div className="flex items-center gap-2">
        <span className={`inline-block w-3 h-3 rounded-full ${c.dot}`} />
        <span className={`text-2xl font-extrabold tabular-nums ${c.text}`}>{scoreText(score)}</span>
        <span className={`text-sm font-bold ${c.text}`}>{band ?? "Not enough data yet"}</span>
      </div>
      {explain && <p className="text-sm text-slate-600 mt-0.5">{bandMeaning(band, settings)}</p>}
    </div>
  );
}

export function SmallScore({ score }: { score: number | null }) {
  const band = bandOf(score);
  const c = bandClasses(band);
  return (
    <span className={`inline-flex items-center gap-1 font-bold tabular-nums ${c.text}`} title={band ?? "Not enough data yet"}>
      <span className={`inline-block w-2 h-2 rounded-full ${c.dot}`} />
      {scoreText(score)}
    </span>
  );
}

export function StatusNotes({ estimated, enforced }: { estimated: boolean; enforced: boolean }) {
  if (enforced && !estimated) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {!enforced && (
        <span className="text-xs font-semibold px-2 py-1 rounded-full bg-sky-50 text-sky-700 border border-sky-200">Learning week: no action is taken on this score</span>
      )}
      {estimated && (
        <span className="text-xs font-semibold px-2 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200">Estimated: some days are from before this started</span>
      )}
    </div>
  );
}

export function Collapsible({ title, children, defaultOpen = false, tone = "plain" }: { title: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean; tone?: "plain" | "red" | "grey" }) {
  const [open, setOpen] = useState(defaultOpen);
  const border = tone === "red" ? "border-red-200" : tone === "grey" ? "border-slate-200" : "border-slate-100";
  return (
    <div className={`rounded-2xl border ${border} bg-white`}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between gap-2 p-3 text-left">
        <span className="text-[15px] font-semibold text-slate-800">{title}</span>
        <ChevronDown size={18} className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

export function HowCalculated({ settings }: { settings: CallQualitySettings }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 text-sm font-semibold text-slate-500 hover:text-slate-700">
        <Info size={14} /> How is this calculated?
      </button>
      {open && (
        <ul className="mt-2 space-y-1.5 text-sm text-slate-600 list-disc pl-5">
          {scoreExplanation(settings).map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Per-day score bars (oldest left); grey stub = no dials or nothing counted yet.
export function TrendBars({ days }: { days: (CallQualityTotals & { date: string })[] }) {
  if (days.length === 0) return <span className="text-xs text-slate-400">No dials</span>;
  return (
    <div className="flex items-end gap-0.5 h-10" aria-label="Daily score">
      {days.map((d) => {
        const s = d.genuine_score;
        const h = s === null ? 6 : Math.max(6, Math.round((s / 100) * 40));
        const dot = bandClasses(bandOf(s)).dot;
        return <div key={d.date} title={`${d.date}: ${scoreText(s)} · ${d.dial_clicks} dials`} className={`w-2 rounded-sm ${dot}`} style={{ height: h }} />;
      })}
    </div>
  );
}

const STATUS_STYLE = {
  ok: { mark: "✓", cls: "text-emerald-600" },
  bad: { mark: "!", cls: "text-red-600" },
  info: { mark: "•", cls: "text-slate-400" },
  waiting: { mark: "…", cls: "text-slate-400" }
};

// "My day" / Dispute / admin drill-down: one line per dial, oldest first.
export function Timeline({ rows, settings, showLowersScore = false }: { rows: CallQualityRow[]; settings: CallQualitySettings; showLowersScore?: boolean }) {
  if (rows.length === 0) return <p className="text-sm text-slate-400">No dials on this day.</p>;
  return (
    <ol className="space-y-2">
      {rows.map((row, i) => {
        const line = timelineLine(row, settings);
        const st = STATUS_STYLE[line.status];
        return (
          <li key={row.click_id ?? `n-${i}`} className="flex gap-2 text-[15px] leading-snug">
            <span className="shrink-0 w-12 font-semibold tabular-nums text-slate-500">{line.time}</span>
            <div className="min-w-0 flex-1">
              <p className="text-slate-800">
                {line.text} <span className={`font-bold ${st.cls}`}>{st.mark}</span>
              </p>
              {line.notes.map((n) => (
                <p key={n.flag} className={`text-sm mt-0.5 ${n.lowersScore ? "text-red-600" : "text-slate-500"}`}>
                  {n.text}
                  {showLowersScore && <span className="font-semibold">{n.lowersScore ? " · lowers score" : " · context only"}</span>}
                </p>
              ))}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
