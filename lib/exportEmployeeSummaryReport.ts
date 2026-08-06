import { exportTableToExcel, exportTableToPDF, ExportColumn, ExportReportMeta, ExportRow, formatDuration } from "@/lib/exportTable";

export interface SummaryExportRow {
  name: string;
  team: string;
  totalLeads: number;
  followUp: number;
  bookings: number;
  visits: number;
  verifiedVisits: number;
  avgResponseMs: number | null;
}

// Same row shape serves both "By Employee" and "By Team" views (see
// app/coordinator/page.tsx) — only the first column's label changes
// ("Employee" vs "Team"), since a team-grouped row's `name` field
// already holds the team's name, not an employee's.
function buildColumns(groupBy: "EMPLOYEE" | "TEAM"): ExportColumn[] {
  return [
    { key: "name", header: groupBy === "TEAM" ? "Team" : "Employee", align: "left", width: 22 },
    { key: "team", header: "Team", align: "left", width: 18 },
    { key: "totalLeads", header: "Total Leads", align: "center", width: 14 },
    { key: "followUp", header: "Follow-up / Visit", align: "center", width: 16 },
    { key: "bookings", header: "Bookings", align: "center", width: 12 },
    { key: "visits", header: "Visits", align: "center", width: 10 },
    { key: "verifiedVisits", header: "Verified Visits", align: "center", width: 14 },
    { key: "avgResponseTime", header: "Avg. Response Time", align: "center", width: 18 }
  ];
}

function buildRows(rows: SummaryExportRow[]): ExportRow[] {
  return rows.map((r) => ({
    name: r.name,
    team: r.team,
    totalLeads: r.totalLeads,
    followUp: r.followUp,
    bookings: r.bookings,
    visits: r.visits,
    verifiedVisits: r.verifiedVisits,
    avgResponseTime: formatDurationOrDash(r.avgResponseMs)
  }));
}

function formatDurationOrDash(ms: number | null): string {
  return ms === null ? "—" : formatDuration(ms);
}

export async function exportEmployeeSummaryToExcel(
  rows: SummaryExportRow[],
  meta: ExportReportMeta,
  groupBy: "EMPLOYEE" | "TEAM"
) {
  // Team-mode rows have no separate team-name (the "name" column IS
  // the team) — the Team column would just duplicate it, so it's
  // dropped from the column set entirely for that mode.
  const columns = buildColumns(groupBy).filter((c) => !(groupBy === "TEAM" && c.key === "team"));

  await exportTableToExcel({
    reportTitle: `DPI Employee Summary Report — ${groupBy === "TEAM" ? "By Team" : "By Employee"}`,
    sheetName: "Summary",
    filenamePrefix: "employee-summary-export",
    columns,
    rows: buildRows(rows),
    meta
  });
}

export async function exportEmployeeSummaryToPDF(
  rows: SummaryExportRow[],
  meta: ExportReportMeta,
  groupBy: "EMPLOYEE" | "TEAM"
) {
  const columns = buildColumns(groupBy).filter((c) => !(groupBy === "TEAM" && c.key === "team"));

  await exportTableToPDF({
    reportTitle: `DPI Employee Summary Report — ${groupBy === "TEAM" ? "By Team" : "By Employee"}`,
    sheetName: "Summary",
    filenamePrefix: "employee-summary-export",
    columns,
    rows: buildRows(rows),
    meta
  });
}
