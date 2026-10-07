"use client";

// Employee header banner (2026-10-07, Step 8): shown only while lead
// timers are paused — the weekly off, or an Admin non-working range
// (holiday / "pause all timers until X") — and the working-days switch is
// ON. Nothing renders otherwise.

import { useTimersPaused } from "@/lib/useWorkingCalendar";

export default function TimersPausedBanner() {
  const paused = useTimersPaused();
  if (!paused) return null;

  return (
    <div className="w-full bg-sky-50 border-b border-sky-100 px-3 lg:px-5 py-1.5 text-center text-xs font-semibold text-sky-800">
      {paused.kind === "WEEKLY_OFF"
        ? "⏸ Weekly off — timers paused"
        : `⏸ Timers paused till ${paused.untilLabel}${paused.reason ? ` — ${paused.reason}` : ""}`}
    </div>
  );
}
