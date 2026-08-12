import {
  exportMultiSectionToExcel,
  exportMultiSectionToPDF,
  ExportColumn,
  ExportReportMeta,
  ExportRow,
  formatDateTime,
  formatDuration
} from "@/lib/exportTable";

export interface SummaryExportRow {
  name: string;
  team: string;
  totalLeads: number;
  followUp: number;
  inVisitStage: number;
  bookings: number;
  visits: number;
  verifiedVisits: number;
  noContactClickUpdates: number;
  avgResponseMs: number | null;
}

// The lead-wise backing detail for "Updates w/o Contact-Click" — the
// exact same rows the app's own drill-down shows, one row per
// flagged lead rather than just its count. employeeName is always the
// real person (even when the Summary export is grouped "By Team" —
// a lead belongs to someone specific, not abstractly "the team").
export interface NoContactDetailExportRow {
  employeeName: string;
  leadName: string;
  mobile: string;
  action: string;
  evidenceAt: string | null;
}

// Same row shape serves both "By Employee" and "By Team" views (see
// app/coordinator/page.tsx) — only the first column's label changes
// ("Employee" vs "Team"), since a team-grouped row's `name` field
// already holds the team's name, not an employee's.
function buildSummaryColumns(groupBy: "EMPLOYEE" | "TEAM"): ExportColumn[] {
  return [
    { key: "name", header: groupBy === "TEAM" ? "Team" : "Employee", align: "left", width: 22 },
    { key: "team", header: "Team", align: "left", width: 18 },
    { key: "totalLeads", header: "Total Leads", align: "center", width: 14 },
    { key: "followUp", header: "Follow-up", align: "center", width: 12 },
    { key: "inVisitStage", header: "In Visit Stage", align: "center", width: 14 },
    { key: "bookings", header: "Bookings", align: "center", width: 12 },
    { key: "visits", header: "Site Visits Logged", align: "center", width: 16 },
    { key: "verifiedVisits", header: "Site Visits Verified", align: "center", width: 16 },
    { key: "avgResponseTime", header: "Avg. Response Time", align: "center", width: 18 },
    { key: "noContactClickUpdates", header: "Updates w/o Contact-Click", align: "center", width: 20 }
  ];
}

function buildSummaryRows(rows: SummaryExportRow[]): ExportRow[] {
  return rows.map((r) => ({
    name: r.name,
    team: r.team,
    totalLeads: r.totalLeads,
    followUp: r.followUp,
    inVisitStage: r.inVisitStage,
    bookings: r.bookings,
    visits: r.visits,
    verifiedVisits: r.verifiedVisits,
    avgResponseTime: formatDurationOrDash(r.avgResponseMs),
    noContactClickUpdates: r.noContactClickUpdates
  }));
}

function formatDurationOrDash(ms: number | null): string {
  return ms === null ? "—" : formatDuration(ms);
}

const DETAIL_COLUMNS: ExportColumn[] = [
  { key: "employeeName", header: "Employee", align: "left", width: 20 },
  { key: "leadName", header: "Lead Name", align: "left", width: 22 },
  { key: "mobile", header: "Mobile", align: "left", width: 16 },
  { key: "action", header: "Action", align: "left", width: 32 },
  { key: "when", header: "When", align: "left", width: 18 }
];

function buildDetailRows(rows: NoContactDetailExportRow[]): ExportRow[] {
  return rows.map((r) => ({
    employeeName: r.employeeName,
    leadName: r.leadName,
    mobile: r.mobile,
    action: r.action,
    when: r.evidenceAt ? formatDateTime(r.evidenceAt) : "—"
  }));
}

export async function exportEmployeeSummaryToExcel(
  rows: SummaryExportRow[],
  detailRows: NoContactDetailExportRow[],
  meta: ExportReportMeta,
  groupBy: "EMPLOYEE" | "TEAM"
) {
  // Team-mode rows have no separate team-name (the "name" column IS
  // the team) — the Team column would just duplicate it, so it's
  // dropped from the column set entirely for that mode.
  const summaryColumns = buildSummaryColumns(groupBy).filter((c) => !(groupBy === "TEAM" && c.key === "team"));
  const title = `DPI Employee Summary Report — ${groupBy === "TEAM" ? "By Team" : "By Employee"}`;

  await exportMultiSectionToExcel({
    reportTitle: title,
    filenamePrefix: "employee-summary-export",
    meta,
    sections: [
      { sectionTitle: title, sheetName: "Summary", columns: summaryColumns, rows: buildSummaryRows(rows) },
      {
        sectionTitle: "No-Contact-Click Detail",
        sheetName: "No-Contact-Click Detail",
        columns: DETAIL_COLUMNS,
        rows: buildDetailRows(detailRows)
      }
    ]
  });
}

export async function exportEmployeeSummaryToPDF(
  rows: SummaryExportRow[],
  detailRows: NoContactDetailExportRow[],
  meta: ExportReportMeta,
  groupBy: "EMPLOYEE" | "TEAM"
) {
  const summaryColumns = buildSummaryColumns(groupBy).filter((c) => !(groupBy === "TEAM" && c.key === "team"));
  const title = `DPI Employee Summary Report — ${groupBy === "TEAM" ? "By Team" : "By Employee"}`;

  await exportMultiSectionToPDF({
    reportTitle: title,
    filenamePrefix: "employee-summary-export",
    meta,
    sections: [
      { sectionTitle: title, sheetName: "Summary", columns: summaryColumns, rows: buildSummaryRows(rows) },
      {
        sectionTitle: "No-Contact-Click Detail",
        sheetName: "Detail",
        columns: DETAIL_COLUMNS,
        rows: buildDetailRows(detailRows)
      }
    ]
  });
}
