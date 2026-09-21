"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, AlertOctagon, RefreshCw, CheckCircle2, Check } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/fetchAllRows";

interface Anomaly {
  id: string;
  detected_at: string;
  source: string;
  severity: "warning" | "error";
  message: string;
  context: Record<string, unknown> | null;
  reviewed: boolean;
  reviewed_at: string | null;
  reviewed_by_employee: { name: string } | null;
}

// Built 2026-09-21, directly from the 1000-row-cap bug hiding real
// duplicate leads for over a month with zero visible symptom — same
// motivating incident as backup-status's own "never again a silent
// failure" origin. Where backup-status is one specific job's own
// dedicated log, this is the general-purpose destination: any
// defensive check anywhere in the app that notices something looks
// wrong (today: fetchAllRows's own count-mismatch check; more can
// call lib/logAnomaly.ts's logAnomaly() over time) lands here instead
// of a console.log nobody will ever read.
//
// Deliberately not a general error-tracking/APM replacement — it's
// only fed by checks the app's own code explicitly runs, not a
// catch-all for every JS exception. That's a narrower, cheaper tool,
// matching this team's actual scale rather than standing up a much
// bigger initiative for it.
export default function SystemHealthPage() {

  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(true);
  const [showReviewed, setShowReviewed] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  useEffect(() => {
    loadAnomalies();
  }, []);

  // fetchAllRows here too, deliberately — this page exists to be the
  // one place that's never silently short, so it would be a genuinely
  // bad look for its own query to be the unbounded one. count-check
  // included (own dogfooding), source-tagged distinctly from a
  // mismatch on the data THIS page is reporting on.
  async function loadAnomalies() {
    setLoading(true);

    const { data, error } = await fetchAllRows(
      () =>
        supabase
          .from("system_anomaly_log")
          .select(
            "id, detected_at, source, severity, message, context, reviewed, reviewed_at, reviewed_by_employee:employees!system_anomaly_log_reviewed_by_fkey(name)",
            { count: "exact" }
          )
          .order("detected_at", { ascending: false })
          .order("id"),
      { anomalyContext: { supabase, source: "admin/system-health:loadAnomalies" } }
    );

    if (!error && data) setAnomalies(data as unknown as Anomaly[]);

    setLoading(false);
  }

  async function handleMarkReviewed(id: string) {
    setReviewingId(id);
    try {
      const {
        data: { session }
      } = await supabase.auth.getSession();

      if (!session) {
        toast.error("Not logged in.");
        return;
      }

      const { data: employee } = await supabase
        .from("employees")
        .select("id")
        .eq("auth_user_id", session.user.id)
        .single();

      const { error } = await supabase
        .from("system_anomaly_log")
        .update({ reviewed: true, reviewed_at: new Date().toISOString(), reviewed_by: employee?.id ?? null })
        .eq("id", id);

      if (error) {
        toast.error("Failed to mark reviewed.");
        return;
      }

      await loadAnomalies();
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong.");
    } finally {
      setReviewingId(null);
    }
  }

  const unreviewed = anomalies.filter((a) => !a.reviewed);
  const visible = showReviewed ? anomalies : unreviewed;
  const errorCount = unreviewed.filter((a) => a.severity === "error").length;

  return (
    <div className="space-y-6 pb-10">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-[24px] bg-gradient-to-br from-[#0f172a] via-[#7c2d12] to-[#c2410c] text-white p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.2em] text-orange-200 uppercase mb-2">
              Silent-Bug Detection
            </p>
            <h1 className="text-xl font-bold">System Health</h1>
            <p className="text-sm text-white/70 mt-1">
              Anomalies the app's own defensive checks flagged automatically — nothing here required a human to
              notice something looked off first.
            </p>
          </div>

          <button
            onClick={loadAnomalies}
            className="flex items-center gap-1.5 h-9 px-3.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-xs font-semibold transition shrink-0"
          >
            <RefreshCw size={13} />
            Refresh
          </button>
        </div>

        <div className="mt-4 flex items-center gap-2 flex-wrap">
          {unreviewed.length === 0 ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full bg-green-50 text-green-700 border border-green-200">
              <CheckCircle2 size={13} />
              No unreviewed anomalies
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full bg-red-50 text-red-700 border border-red-200">
              <AlertOctagon size={13} />
              {unreviewed.length} unreviewed{errorCount > 0 ? ` (${errorCount} error)` : ""}
            </span>
          )}

          <button
            onClick={() => setShowReviewed((v) => !v)}
            className="text-xs font-semibold text-white/60 hover:text-white transition underline underline-offset-2"
          >
            {showReviewed ? "Hide reviewed" : "Show reviewed too"}
          </button>
        </div>
      </motion.div>

      {loading ? (
        <p className="text-sm text-slate-400 px-1">Loading...</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-slate-400 px-1">
          {showReviewed ? "No anomalies logged yet." : "Nothing unreviewed — all clear."}
        </p>
      ) : (
        <div className="space-y-3">
          {visible.map((a) => {
            const isError = a.severity === "error";
            return (
              <div
                key={a.id}
                className={`rounded-2xl bg-white border shadow-[0_2px_10px_rgba(15,23,42,0.05)] p-4 ${
                  a.reviewed ? "border-slate-100 opacity-60" : isError ? "border-red-200" : "border-amber-200"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full ${
                        isError
                          ? "bg-red-50 text-red-700 border border-red-200"
                          : "bg-amber-50 text-amber-700 border border-amber-200"
                      }`}
                    >
                      {isError ? <AlertOctagon size={12} /> : <AlertTriangle size={12} />}
                      {isError ? "Error" : "Warning"}
                    </span>
                    <span className="text-xs font-semibold text-slate-500">{a.source}</span>
                    <span className="text-xs text-slate-400">
                      {new Date(a.detected_at).toLocaleString([], {
                        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
                      })}
                    </span>
                  </div>

                  {a.reviewed ? (
                    <span className="text-xs text-slate-400 shrink-0">
                      Reviewed{a.reviewed_by_employee?.name ? ` by ${a.reviewed_by_employee.name}` : ""}
                    </span>
                  ) : (
                    <button
                      onClick={() => handleMarkReviewed(a.id)}
                      disabled={reviewingId === a.id}
                      className="flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg px-2.5 py-1 transition disabled:opacity-50 shrink-0"
                    >
                      <Check size={12} />
                      {reviewingId === a.id ? "..." : "Mark reviewed"}
                    </button>
                  )}
                </div>

                <p className="text-sm text-slate-700 mt-2 leading-relaxed">{a.message}</p>

                {a.context && (
                  <pre className="text-xs text-slate-400 mt-2 bg-slate-50 rounded-lg p-2 overflow-x-auto">
                    {JSON.stringify(a.context, null, 2)}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
