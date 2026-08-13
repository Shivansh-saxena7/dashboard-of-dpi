"use client";

import WeeklyLeaderboardView from "@/components/WeeklyLeaderboardView";

// Admin's own Weekly Visits Leaderboard view — no separate admin-
// flavored component (Golden Rule): reuses the exact same
// WeeklyLeaderboardView the employee-facing /leaderboard route uses,
// just with canExport=true (Admin is one of the two roles allowed to
// download) and myEmployeeId=null (Admin isn't a ranked participant,
// so no row highlights as "You"). No auth-check needed here — the
// admin/layout.tsx wrapper around every /admin/* route already gates
// on role === "admin" before children ever render.
export default function AdminLeaderboardPage() {
  return <WeeklyLeaderboardView myEmployeeId={null} canExport={true} />;
}
