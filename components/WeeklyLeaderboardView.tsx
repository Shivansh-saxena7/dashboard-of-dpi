"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Trophy, ChevronLeft, ChevronRight, Search, FileSpreadsheet, FileText } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";
import {
  getISTParts,
  formatShortDate,
  getMostRecentCompletedWeek,
  shiftWeek,
  weekEndKey,
  todayKey,
  CompletedWeek
} from "@/lib/leaderboardWeek";
import { exportTableToExcel, exportTableToPDF, ExportColumn } from "@/lib/exportTable";

interface LeaderboardRow {
  employeeId: string;
  employeeName: string;
  count: number;
  rank: number;
}

interface WeeklyLeaderboardViewProps {
  myEmployeeId: string | null;
  // Export is a data-extraction power, not a viewing power — deciding
  // who gets it belongs to each caller (they already know their own
  // role/context: the employee-facing /leaderboard route always
  // passes false, Admin's and Sales Coordinator's own pages pass
  // true), not to this shared component re-deriving role checks
  // itself. Defaults to false so any future caller that forgets to
  // pass it fails closed, not open.
  canExport?: boolean;
}

type Mode = "WEEK" | "CUSTOM";

const MEDALS = ["🥇", "🥈", "🥉"];

const EXPORT_COLUMNS: readonly ExportColumn[] = [
  { key: "rank", header: "Rank", align: "center", width: 8 },
  { key: "name", header: "Employee", align: "left", width: 28 },
  { key: "visits", header: "Visits", align: "center", width: 10 }
];

// "YYYY-MM-DD" (native <input type="date"> value) -> "Aug 1" style —
// splits into plain ints and reuses formatShortDate rather than
// `new Date(key)`, which parses as UTC-midnight and can render as the
// previous day depending on the device's timezone (the same class of
// bug the rest of this IST-explicit date handling exists to avoid).
function formatDateKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return formatShortDate(y, m - 1, d);
}

// Permanent, always-checkable counterpart to the Tuesday popup in
// Header.tsx — same data (visits_leaderboard RPC), same "most
// recently completed Monday-Sunday week" window by default (via the
// shared lib/leaderboardWeek helper, so this can never drift out of
// sync with what the popup shows), plus Prev/Next navigation to step
// through past completed weeks (same RPC, different start/end date —
// no new backend), plus a Custom Range mode for an arbitrary
// start/end (also the same RPC — a week is just a special case of a
// date range, not a different kind of query). "Next" is bounded at
// the most recently completed week; Custom Range's own date inputs
// are capped at today (IST) — neither can query visits that haven't
// happened yet. Employee-name search narrows the DISPLAYED rows only;
// rank badges are computed from the full unfiltered list first so a
// filtered-down view still shows someone's true rank, not "1" just
// because they're the only row left on screen.
export default function WeeklyLeaderboardView({ myEmployeeId, canExport = false }: WeeklyLeaderboardViewProps) {
  const mostRecentWeek = useMemo(() => getMostRecentCompletedWeek(getISTParts()), []);
  const todayStr = useMemo(() => todayKey(), []);

  const [mode, setMode] = useState<Mode>("WEEK");
  const [selectedWeek, setSelectedWeek] = useState<CompletedWeek>(mostRecentWeek);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState<"excel" | "pdf" | null>(null);

  const isMostRecentWeek = selectedWeek.periodKey === mostRecentWeek.periodKey;

  const range = useMemo(() => {
    if (mode === "WEEK") {
      return { start: selectedWeek.periodKey, end: weekEndKey(selectedWeek), ready: true };
    }
    const ready = customStart !== "" && customEnd !== "" && customStart <= customEnd;
    return { start: customStart, end: customEnd, ready };
  }, [mode, selectedWeek, customStart, customEnd]);

  const periodLabel =
    mode === "WEEK"
      ? `Week of ${formatShortDate(selectedWeek.startYear, selectedWeek.startMonth, selectedWeek.startDay)} – ${formatShortDate(selectedWeek.endYear, selectedWeek.endMonth, selectedWeek.endDay)}`
      : range.ready
      ? `${formatDateKey(customStart)} – ${formatDateKey(customEnd)}`
      : "Select a date range";

  useEffect(() => {
    if (!range.ready) {
      setRows(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    async function load() {
      const { data, error } = await supabase.rpc("visits_leaderboard", {
        p_start_date: range.start,
        p_end_date: range.end
      });

      if (cancelled) return;

      if (!error && data) {
        setRows(
          data.map((r: any, index: number) => ({
            employeeId: r.employee_id,
            employeeName: r.employee_name,
            count: r.visit_count,
            rank: index + 1
          }))
        );
      } else {
        setRows([]);
      }

      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [range.ready, range.start, range.end]);

  const visibleRows = (rows || []).filter((r) =>
    r.employeeName.toLowerCase().includes(search.trim().toLowerCase())
  );

  async function handleExport(format: "excel" | "pdf") {
    if (visibleRows.length === 0) return;

    setExporting(format);
    try {
      const exportRows = visibleRows.map((r) => ({
        rank: r.rank,
        name: r.employeeName,
        visits: r.count
      }));

      const opts = {
        reportTitle: "Weekly Visits Leaderboard",
        sheetName: "Leaderboard",
        filenamePrefix: "visits-leaderboard",
        columns: EXPORT_COLUMNS,
        rows: exportRows,
        meta: {
          employeeLabel: search.trim() || null,
          otherFilters: [{ label: mode === "WEEK" ? "Week" : "Date Range", value: periodLabel }]
        }
      };

      if (format === "excel") {
        await exportTableToExcel(opts);
      } else {
        await exportTableToPDF(opts);
      }
    } catch (err) {
      console.error(err);
      toast.error("Export failed. Please try again.");
    } finally {
      setExporting(null);
    }
  }

  // No outer page-margin wrapper here on purpose — Admin's and
  // Coordinator's own layouts (app/admin/layout.tsx, app/coordinator/
  // layout.tsx) already wrap all page content in p-3/lg:p-5, and
  // Coordinator's tab-content blocks don't add their own horizontal
  // padding either (same reasoning). Baking a px-4/mt-4 margin in
  // here would double up on both of those and indent this card
  // further than its sibling tabs/pages. The employee-facing
  // /leaderboard route has no such ambient padding (mirrors app/
  // data/page.tsx's bare <main>), so it supplies its own wrapper.
  return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="rounded-2xl bg-white border border-slate-100 shadow-sm overflow-hidden"
      >
        <div className="relative overflow-hidden bg-gradient-to-br from-[#0f172a] via-[#1d4ed8] to-[#06b6d4] p-5 text-white">
          <div className="absolute top-[-40px] right-[-40px] w-[120px] h-[120px] rounded-full bg-white/10 blur-3xl" />
          <div className="relative flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="shrink-0 h-11 w-11 rounded-2xl bg-white/15 flex items-center justify-center">
                <Trophy size={20} />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-bold">Weekly Visits Leaderboard</h2>
                <p className="text-white/70 text-xs mt-0.5">{periodLabel}</p>
              </div>
            </div>

            {mode === "WEEK" && (
              <div className="shrink-0 flex items-center gap-1">
                <button
                  onClick={() => setSelectedWeek(shiftWeek(selectedWeek, -1))}
                  className="h-8 w-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition"
                  title="Previous week"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  onClick={() => !isMostRecentWeek && setSelectedWeek(shiftWeek(selectedWeek, 1))}
                  disabled={isMostRecentWeek}
                  className="h-8 w-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition"
                  title="Next week"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="p-4 pb-3 border-b border-slate-100 space-y-3">
          <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 w-fit">
            <button
              onClick={() => setMode("WEEK")}
              className={`h-8 px-3 rounded-lg text-xs font-bold transition ${
                mode === "WEEK" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
              }`}
            >
              This Week
            </button>
            <button
              onClick={() => setMode("CUSTOM")}
              className={`h-8 px-3 rounded-lg text-xs font-bold transition ${
                mode === "CUSTOM" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
              }`}
            >
              Custom Range
            </button>
          </div>

          {mode === "CUSTOM" && (
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="date"
                value={customStart}
                max={customEnd || todayStr}
                onChange={(e) => setCustomStart(e.target.value)}
                className="flex-1 h-10 px-3 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-300 transition"
              />
              <span className="hidden sm:flex items-center text-slate-400 text-xs">to</span>
              <input
                type="date"
                value={customEnd}
                min={customStart || undefined}
                max={todayStr}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="flex-1 h-10 px-3 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-300 transition"
              />
            </div>
          )}
        </div>

        <div className="p-4 pb-3 flex flex-col sm:flex-row gap-2 border-b border-slate-100">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search employee..."
              className="w-full h-10 pl-9 pr-3 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-300 transition"
            />
          </div>

          {canExport && (
          <div className="flex gap-2">
            <button
              onClick={() => handleExport("excel")}
              disabled={visibleRows.length === 0 || exporting !== null}
              className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 h-10 px-3 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-emerald-100 transition"
            >
              <FileSpreadsheet size={14} />
              Excel
            </button>
            <button
              onClick={() => handleExport("pdf")}
              disabled={visibleRows.length === 0 || exporting !== null}
              className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 h-10 px-3 rounded-lg bg-red-50 text-red-700 text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-red-100 transition"
            >
              <FileText size={14} />
              PDF
            </button>
          </div>
          )}
        </div>

        <div className="p-4 space-y-1.5">
          {!range.ready ? (
            <p className="text-sm text-slate-400 text-center py-6">Pick a start and end date to see visits.</p>
          ) : loading ? (
            <p className="text-sm text-slate-400 text-center py-6">Loading...</p>
          ) : !rows || rows.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">No visits recorded for this period.</p>
          ) : visibleRows.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">No employee matches "{search}".</p>
          ) : (
            visibleRows.map((row) => {
              const isMe = row.employeeId === myEmployeeId;
              return (
                <div
                  key={row.employeeId}
                  className={`flex items-center gap-3 rounded-2xl px-3.5 py-2.5 ${
                    isMe ? "bg-blue-50 border border-blue-200" : "bg-slate-50 border border-slate-100"
                  }`}
                >
                  <div className="shrink-0 w-7 text-center text-sm font-bold text-slate-500">
                    {MEDALS[row.rank - 1] || row.rank}
                  </div>
                  <p className={`min-w-0 flex-1 truncate text-sm ${isMe ? "font-bold text-blue-800" : "font-semibold text-slate-700"}`}>
                    {row.employeeName}{isMe && " (You)"}
                  </p>
                  <div className="shrink-0 text-sm font-bold text-slate-800">
                    {row.count} <span className="text-[11px] font-medium text-slate-400">visits</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </motion.div>
  );
}
