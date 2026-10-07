"use client";

// "⏸ Timer paused · till <date>" (2026-10-07, Step 8) — on any lead card
// whose recycle/SLA clock would otherwise be running, while timers are
// paused (weekly off or an Admin non-working range, switch ON). The parent
// decides "clock running" (already-paused / Visit-locked / on-leave /
// personal leads pass false, so they never get it). Disappears by itself
// when the pause ends (shared minute tick in useTimersPaused).

import { useTimersPaused } from "@/lib/useWorkingCalendar";

export default function TimerPausedBadge({ clockRunning, size = "md" }: { clockRunning: boolean; size?: "sm" | "md" }) {
  const paused = useTimersPaused();
  if (!clockRunning || !paused) return null;

  const why = paused.kind === "WEEKLY_OFF" ? "Weekly off" : paused.reason || "Timers paused";
  return (
    <span
      title={`${why} — recycle/SLA timers resume ${paused.untilLabel}`}
      className={`font-bold rounded-full bg-sky-50 text-sky-700 ${size === "sm" ? "text-[10px] px-2 py-0.5" : "text-[11px] px-2.5 py-1"}`}
    >
      ⏸ Timer paused · till {paused.untilLabel}
    </span>
  );
}
