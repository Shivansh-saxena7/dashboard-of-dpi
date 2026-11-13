"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, AlertOctagon, RefreshCw, CheckCircle2, Check, Activity, ChevronLeft, ChevronRight } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { type AnomalyGroup, type AnomalyRow, chunkIds, groupAnomalies, STALE_DAYS, staleGroups } from "@/lib/anomalyGroups";

import PageHeader from "@/components/PageHeader";
import GuardHeldLeadsCard from "@/components/GuardHeldLeadsCard";

// System Health (built 2026-09-21, regrouped 2026-11-13). Fed by system_anomaly_log: failed Supabase calls
// (lib/reportingFetch.ts), browser errors (lib/reportClientError.ts) and the app's own checks (logAnomaly / log_anomaly).
//
// Unreviewed rows only, all of them (fetchAllRows, count-checked), grouped: one source + message = one card
// (lib/anomalyGroups.ts). Errors first, then failed writes, then other warnings. Guard / shadow records and info rows
// (network blips, call-return records) sit in "Activity" as counts. A group is marked reviewed in one go; groups not
// seen for STALE_DAYS days can be cleared together. Reviewed rows are read a page at a time.

const REVIEWED_PAGE_SIZE = 50;

interface ReviewedRow {
  id: string;
  source: string;
  severity: string;
  message: string;
  last_seen_at: string;
  reviewed_at: string | null;
  reviewed_by_employee: { name: string } | null;
}

const fmt = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export default function SystemHealthPage() {
  const [rows, setRows] = useState<AnomalyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"issues" | "activity" | "reviewed">("issues");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [heldRefreshKey, setHeldRefreshKey] = useState(0);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const [reviewed, setReviewed] = useState<ReviewedRow[]>([]);
  const [reviewedTotal, setReviewedTotal] = useState(0);
  const [reviewedPage, setReviewedPage] = useState(0);

  useEffect(() => {
    loadUnreviewed();
  }, []);

  useEffect(() => {
    if (tab === "reviewed") loadReviewed(reviewedPage);
  }, [tab, reviewedPage]);

  async function loadUnreviewed() {
    setLoading(true);
    const { data, error } = await fetchAllRows(
      () =>
        supabase
          .from("system_anomaly_log")
          .select("id, detected_at, source, severity, message, context, layer, occurrence_count, last_seen_at", { count: "exact" })
          .eq("reviewed", false)
          .order("last_seen_at", { ascending: false })
          .order("id"),
      { anomalyContext: { supabase, source: "admin/system-health:loadUnreviewed" } }
    );
    if (!error && data) setRows(data as unknown as AnomalyRow[]);
    setLoading(false);
  }

  async function loadReviewed(page: number) {
    const from = page * REVIEWED_PAGE_SIZE;
    const { data, count, error } = await supabase
      .from("system_anomaly_log")
      .select("id, source, severity, message, last_seen_at, reviewed_at, reviewed_by_employee:employees!system_anomaly_log_reviewed_by_fkey(name)", { count: "exact" })
      .eq("reviewed", true)
      .order("reviewed_at", { ascending: false, nullsFirst: false })
      .order("id")
      .range(from, from + REVIEWED_PAGE_SIZE - 1);
    if (!error) {
      setReviewed((data || []) as unknown as ReviewedRow[]);
      setReviewedTotal(count ?? 0);
    }
  }

  async function currentEmployeeId(): Promise<string | null> {
    const {
      data: { session }
    } = await supabase.auth.getSession();
    if (!session) return null;
    const { data } = await supabase.from("employees").select("id").eq("auth_user_id", session.user.id).single();
    return data?.id ?? null;
  }

  async function markReviewed(ids: string[], busy: string, doneText: string) {
    if (ids.length === 0) return;
    setBusyKey(busy);
    try {
      const employeeId = await currentEmployeeId();
      if (!employeeId) {
        toast.error("Not logged in.");
        return;
      }
      const at = new Date().toISOString();
      for (const chunk of chunkIds(ids)) {
        const { error } = await supabase
          .from("system_anomaly_log")
          .update({ reviewed: true, reviewed_at: at, reviewed_by: employeeId })
          .in("id", chunk)
          .eq("reviewed", false);
        if (error) {
          toast.error("Failed to mark reviewed.");
          return;
        }
      }
      toast.success(doneText);
      await loadUnreviewed();
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong.");
    } finally {
      setBusyKey(null);
    }
  }

  const groups = useMemo(() => groupAnomalies(rows), [rows]);
  const issues = groups.filter((g) => g.kind === "issue");
  const activity = groups.filter((g) => g.kind === "activity");
  const errorGroups = issues.filter((g) => g.isError).length;
  const stale = useMemo(() => staleGroups(groups, Date.now()), [groups]);
  const staleIds = stale.flatMap((g) => g.ids);

  function refresh() {
    loadUnreviewed();
    setHeldRefreshKey((k) => k + 1);
    if (tab === "reviewed") loadReviewed(reviewedPage);
  }

  const tabButton = (key: typeof tab, label: string) => (
    <button
      onClick={() => setTab(key)}
      className={`h-9 px-3.5 rounded-xl text-xs font-bold transition ${tab === key ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-600"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        eyebrow="System"
        title="System Health"
        description="Problems the app's own checks flagged. One card per kind of problem; routine guard records sit under Activity."
        actions={
          <button onClick={refresh} className="flex items-center gap-1.5 h-10 px-4 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-sm font-semibold transition">
            <RefreshCw size={13} />
            Refresh
          </button>
        }
      >
        <div className="flex items-center gap-2 flex-wrap">
          {issues.length === 0 ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full bg-green-50 text-green-700 border border-green-200">
              <CheckCircle2 size={13} />
              No open issues
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full bg-red-50 text-red-700 border border-red-200">
              <AlertOctagon size={13} />
              {issues.length} open issue{issues.length === 1 ? "" : "s"}
              {errorGroups > 0 ? ` (${errorGroups} error)` : ""}
            </span>
          )}
          <span className="text-xs text-white/60">{rows.length} unreviewed rows</span>
        </div>
      </PageHeader>

      <GuardHeldLeadsCard refreshKey={heldRefreshKey} />

      <div className="flex items-center gap-2 flex-wrap">
        {tabButton("issues", `Issues (${issues.length})`)}
        {tabButton("activity", `Activity (${activity.length})`)}
        {tabButton("reviewed", "Reviewed")}
        {tab !== "reviewed" && stale.length > 0 && (
          <button
            onClick={() => {
              if (window.confirm(`Mark ${stale.length} group(s) not seen for ${STALE_DAYS}+ days as reviewed?`)) {
                void markReviewed(staleIds, "stale", `Marked ${stale.length} old group(s) reviewed.`);
              }
            }}
            disabled={busyKey !== null}
            className="ml-auto h-9 px-3.5 rounded-xl text-xs font-semibold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {busyKey === "stale" ? "..." : `Mark ${stale.length} group(s) older than ${STALE_DAYS} days reviewed`}
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-slate-400 px-1">Loading...</p>
      ) : tab === "issues" ? (
        issues.length === 0 ? (
          <p className="text-sm text-slate-400 px-1">Nothing open — all clear.</p>
        ) : (
          <div className="space-y-3">
            {issues.map((g) => (
              <IssueCard
                key={g.key}
                group={g}
                open={openKey === g.key}
                busy={busyKey === g.key}
                onToggle={() => setOpenKey(openKey === g.key ? null : g.key)}
                onReview={() => markReviewed(g.ids, g.key, `Marked ${g.rows} row(s) reviewed.`)}
              />
            ))}
          </div>
        )
      ) : tab === "activity" ? (
        activity.length === 0 ? (
          <p className="text-sm text-slate-400 px-1">No activity records.</p>
        ) : (
          <div className="rounded-2xl bg-white border border-slate-200 divide-y divide-slate-100">
            {activity.map((g) => (
              <div key={g.key} className="flex items-center gap-3 px-4 py-2.5">
                <Activity size={14} className="shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-slate-700">{g.source}</p>
                  <p className="truncate text-[11px] text-slate-400">{g.message}</p>
                </div>
                <span className="shrink-0 text-[11px] font-bold text-slate-500">x{g.occurrences}</span>
                <span className="hidden sm:inline shrink-0 text-[11px] text-slate-400">last {fmt(g.lastSeen)}</span>
                <button
                  onClick={() => markReviewed(g.ids, g.key, `Marked ${g.rows} row(s) reviewed.`)}
                  disabled={busyKey !== null}
                  className="shrink-0 text-[11px] font-semibold text-slate-500 hover:text-slate-900 disabled:opacity-50"
                >
                  {busyKey === g.key ? "..." : "Mark reviewed"}
                </button>
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="space-y-3">
          {reviewed.length === 0 ? (
            <p className="text-sm text-slate-400 px-1">Nothing reviewed yet.</p>
          ) : (
            <div className="rounded-2xl bg-white border border-slate-200 divide-y divide-slate-100">
              {reviewed.map((r) => (
                <div key={r.id} className="px-4 py-2.5">
                  <p className="text-xs font-semibold text-slate-600">
                    {r.source} · {r.severity}
                  </p>
                  <p className="truncate text-[11px] text-slate-400">{r.message}</p>
                  <p className="text-[11px] text-slate-400">
                    Last seen {fmt(r.last_seen_at)}
                    {r.reviewed_at ? ` · reviewed ${fmt(r.reviewed_at)}` : ""}
                    {r.reviewed_by_employee?.name ? ` by ${r.reviewed_by_employee.name}` : ""}
                  </p>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>
              {reviewedTotal === 0 ? 0 : reviewedPage * REVIEWED_PAGE_SIZE + 1}–{Math.min((reviewedPage + 1) * REVIEWED_PAGE_SIZE, reviewedTotal)} of {reviewedTotal}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setReviewedPage((p) => Math.max(0, p - 1))}
                disabled={reviewedPage === 0}
                className="h-8 w-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white disabled:opacity-40"
                aria-label="Previous page"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={() => setReviewedPage((p) => p + 1)}
                disabled={(reviewedPage + 1) * REVIEWED_PAGE_SIZE >= reviewedTotal}
                className="h-8 w-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white disabled:opacity-40"
                aria-label="Next page"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function IssueCard({ group: g, open, busy, onToggle, onReview }: { group: AnomalyGroup; open: boolean; busy: boolean; onToggle: () => void; onReview: () => void }) {
  const tone = g.isError ? "border-red-200" : g.isWriteFailure ? "border-orange-200" : "border-amber-200";
  return (
    <div className={`rounded-2xl bg-white border shadow-[0_2px_10px_rgba(15,23,42,0.05)] p-4 ${tone}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full ${
              g.isError ? "bg-red-50 text-red-700 border border-red-200" : "bg-amber-50 text-amber-700 border border-amber-200"
            }`}
          >
            {g.isError ? <AlertOctagon size={12} /> : <AlertTriangle size={12} />}
            {g.isError ? "Error" : g.isWriteFailure ? "Write failed" : "Warning"}
          </span>
          {g.layer && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{g.layer}</span>}
          <span className="text-xs font-semibold text-slate-500">{g.source}</span>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
            x{g.occurrences}
            {g.rows > 1 ? ` in ${g.rows} rows` : ""}
          </span>
        </div>
        <button
          onClick={onReview}
          disabled={busy}
          className="flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg px-2.5 py-1 transition disabled:opacity-50 shrink-0"
        >
          <Check size={12} />
          {busy ? "..." : "Mark group reviewed"}
        </button>
      </div>

      <p className="text-sm text-slate-700 mt-2 leading-relaxed">{g.message}</p>
      <p className="text-[11px] text-slate-400 mt-1">
        First {fmt(g.firstSeen)} · last {fmt(g.lastSeen)}
      </p>

      {g.context && (
        <>
          <button onClick={onToggle} className="mt-2 text-[11px] font-semibold text-slate-500 hover:text-slate-800">
            {open ? "Hide details" : "Show details"}
          </button>
          {open && (
            <pre className="text-xs text-slate-400 mt-2 bg-slate-50 rounded-lg p-2 overflow-x-auto">{JSON.stringify(g.context, null, 2)}</pre>
          )}
        </>
      )}
    </div>
  );
}
