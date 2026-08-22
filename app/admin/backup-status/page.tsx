"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, AlertTriangle, XCircle, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface Discrepancy {
  tab: string;
  expectedRows: number;
  actualRows: number;
}

interface BackupRun {
  id: string;
  run_at: string;
  status: "SUCCESS" | "PARTIAL_FAILURE" | "FAILED";
  tabs_written: number | null;
  tabs_created: number | null;
  total_leads_backed_up: number | null;
  discrepancies: Discrepancy[] | null;
  error: string | null;
}

// Built 2026-08-22 after a genuinely silent partial failure: one
// employee's Google Sheets tab went blank overnight with `success:
// true` returned and zero admin notification, because
// values:batchUpdate's outer HTTP 200 doesn't mean every tab's write
// actually landed (see backup-to-google-sheets/index.ts's own comment
// at the point this now gets caught). This page is the permanent,
// always-queryable record of every run's real per-tab outcome —
// backup_run_log exists specifically so this never again requires a
// multi-hour forensic dig through purged pg_net response data and a
// non-existent audit log to answer "did last night's backup actually
// work."
const STATUS_DISPLAY: Record<BackupRun["status"], { label: string; icon: typeof CheckCircle2; className: string }> = {
  SUCCESS: { label: "Success", icon: CheckCircle2, className: "bg-green-50 text-green-700 border border-green-200" },
  PARTIAL_FAILURE: { label: "Partial Failure", icon: AlertTriangle, className: "bg-amber-50 text-amber-700 border border-amber-200" },
  FAILED: { label: "Failed", icon: XCircle, className: "bg-red-50 text-red-700 border border-red-200" }
};

export default function BackupStatusPage() {

  const [runs, setRuns] = useState<BackupRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRuns();
  }, []);

  async function loadRuns() {
    setLoading(true);

    const { data, error } = await supabase
      .from("backup_run_log")
      .select("*")
      .order("run_at", { ascending: false })
      .limit(60);

    if (!error && data) setRuns(data);

    setLoading(false);
  }

  const latest = runs[0];

  return (
    <div className="space-y-6 pb-10">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-[24px] bg-gradient-to-br from-[#0f172a] via-[#1d4ed8] to-[#06b6d4] text-white p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.2em] text-cyan-200 uppercase mb-2">
              Disaster Recovery
            </p>
            <h1 className="text-xl font-bold">Google Sheets Backup Status</h1>
            <p className="text-sm text-white/70 mt-1">
              One row per run, every night at 2:00 AM IST — including per-tab discrepancies that a plain HTTP 200
              from Google can silently hide.
            </p>
          </div>

          <button
            onClick={loadRuns}
            className="shrink-0 flex items-center gap-1.5 h-9 px-3.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-xs font-semibold transition"
          >
            <RefreshCw size={13} />
            Refresh
          </button>
        </div>

        {latest && (
          <div className="mt-4 flex items-center gap-2">
            {(() => {
              const s = STATUS_DISPLAY[latest.status];
              const Icon = s.icon;
              return (
                <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full ${s.className}`}>
                  <Icon size={13} />
                  Last run: {s.label}
                </span>
              );
            })()}
            <span className="text-xs text-white/60">
              {new Date(latest.run_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        )}
      </motion.div>

      {loading ? (
        <p className="text-sm text-slate-400 px-1">Loading...</p>
      ) : runs.length === 0 ? (
        <p className="text-sm text-slate-400 px-1">No backup runs logged yet.</p>
      ) : (
        <div className="space-y-3">
          {runs.map((run) => {
            const s = STATUS_DISPLAY[run.status];
            const Icon = s.icon;

            return (
              <div key={run.id} className="rounded-2xl bg-white border border-slate-100 shadow-[0_2px_10px_rgba(15,23,42,0.05)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full ${s.className}`}>
                      <Icon size={12} />
                      {s.label}
                    </span>
                    <span className="text-xs text-slate-400">
                      {new Date(run.run_at).toLocaleString([], {
                        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
                      })}
                    </span>
                  </div>

                  {run.total_leads_backed_up !== null && (
                    <span className="text-xs text-slate-500 shrink-0">
                      {run.tabs_written} tabs · {run.total_leads_backed_up} leads
                      {run.tabs_created ? ` · ${run.tabs_created} new tab${run.tabs_created === 1 ? "" : "s"}` : ""}
                    </span>
                  )}
                </div>

                {run.error && (
                  <p className="text-xs text-red-600 mt-2 leading-relaxed">{run.error}</p>
                )}

                {run.discrepancies && run.discrepancies.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {run.discrepancies.map((d, i) => (
                      <p key={i} className="text-xs text-amber-700 leading-relaxed">
                        <span className="font-semibold">{d.tab}</span> — expected {d.expectedRows} rows, got {d.actualRows}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
