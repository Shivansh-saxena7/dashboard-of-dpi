"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Trophy } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { getISTParts, formatShortDate, getMostRecentCompletedWeek } from "@/lib/leaderboardWeek";

interface LeaderboardRow {
  employeeId: string;
  employeeName: string;
  count: number;
}

interface WeeklyLeaderboardViewProps {
  myEmployeeId: string | null;
}

const MEDALS = ["🥇", "🥈", "🥉"];

// Permanent, always-checkable counterpart to the Tuesday popup in
// Header.tsx — same data (weekly_visits_leaderboard RPC), same
// "most recently completed Monday-Sunday week" window (via the
// shared lib/leaderboardWeek helper, so this can never drift out of
// sync with what the popup shows), just fetched on-demand every time
// this page is opened instead of on a schedule. Since the week is
// computed live from "today" on every load, the numbers naturally
// roll over to the new week the moment Tuesday arrives — there's no
// cached/frozen snapshot to go stale.
export default function WeeklyLeaderboardView({ myEmployeeId }: WeeklyLeaderboardViewProps) {
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [weekLabel, setWeekLabel] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);

      const week = getMostRecentCompletedWeek(getISTParts());
      setWeekLabel(
        `${formatShortDate(week.startYear, week.startMonth, week.startDay)} – ${formatShortDate(week.endYear, week.endMonth, week.endDay)}`
      );

      const { data, error } = await supabase.rpc("weekly_visits_leaderboard", { p_week_start: week.periodKey });

      if (!error && data) {
        setRows(data.map((r: any) => ({ employeeId: r.employee_id, employeeName: r.employee_name, count: r.visit_count })));
      } else {
        setRows([]);
      }

      setLoading(false);
    }

    load();
  }, []);

  return (
    <div className="px-4 mt-4">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="rounded-2xl bg-white border border-slate-100 shadow-sm overflow-hidden"
      >
        <div className="relative overflow-hidden bg-gradient-to-br from-[#0f172a] via-[#1d4ed8] to-[#06b6d4] p-5 text-white">
          <div className="absolute top-[-40px] right-[-40px] w-[120px] h-[120px] rounded-full bg-white/10 blur-3xl" />
          <div className="relative flex items-center gap-3">
            <div className="shrink-0 h-11 w-11 rounded-2xl bg-white/15 flex items-center justify-center">
              <Trophy size={20} />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold">Weekly Visits Leaderboard</h2>
              <p className="text-white/70 text-xs mt-0.5">{weekLabel ? `Week of ${weekLabel}` : "Loading..."}</p>
            </div>
          </div>
        </div>

        <div className="p-4 space-y-1.5">
          {loading ? (
            <p className="text-sm text-slate-400 text-center py-6">Loading...</p>
          ) : !rows || rows.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">No visits recorded for this week yet.</p>
          ) : (
            rows.map((row, index) => {
              const isMe = row.employeeId === myEmployeeId;
              return (
                <div
                  key={row.employeeId}
                  className={`flex items-center gap-3 rounded-2xl px-3.5 py-2.5 ${
                    isMe ? "bg-blue-50 border border-blue-200" : "bg-slate-50 border border-slate-100"
                  }`}
                >
                  <div className="shrink-0 w-7 text-center text-sm font-bold text-slate-500">
                    {MEDALS[index] || index + 1}
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
    </div>
  );
}
