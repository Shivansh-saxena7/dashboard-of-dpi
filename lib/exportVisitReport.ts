import { exportTableToExcel, exportTableToPDF, ExportColumn, ExportReportMeta, ExportRow, formatDateTime } from "@/lib/exportTable";

export interface VisitExportRow {
  leadName: string;
  project: string | null;
  employeeName: string;
  teamName: string;
  eventType: string;
  visitDate: string;
  status: "Pending" | "Verified" | "Denied";
  actionByName: string | null;
  actionDate: string | null;
  denyReason: string | null;
}

const VISIT_EXPORT_COLUMNS: ExportColumn[] = [
  { key: "leadName", header: "Lead Name", align: "left", width: 22 },
  { key: "project", header: "Project", align: "left", width: 20 },
  { key: "employeeName", header: "Employee", align: "left", width: 18 },
  { key: "teamName", header: "Team", align: "left", width: 16 },
  { key: "eventType", header: "Visit Type", align: "center", width: 12 },
  { key: "visitDate", header: "Visit Date", align: "left", width: 18 },
  { key: "status", header: "Status", align: "center", width: 12 },
  { key: "actionBy", header: "Verified/Denied By", align: "left", width: 18 },
  { key: "actionDate", header: "Verified/Denied Date", align: "left", width: 18 },
  { key: "denyReason", header: "Deny Reason", align: "left", width: 24 }
];

function buildRows(rows: VisitExportRow[]): ExportRow[] {
  return rows.map((r) => ({
    leadName: r.leadName,
    project: r.project || "—",
    employeeName: r.employeeName,
    teamName: r.teamName,
    eventType: r.eventType === "REVISIT" ? "Revisit" : "First Visit",
    visitDate: formatDateTime(r.visitDate),
    status: r.status,
    actionBy: r.actionByName || "—",
    actionDate: r.actionDate ? formatDateTime(r.actionDate) : "—",
    denyReason: r.denyReason || "—"
  }));
}

export async function exportVisitsToExcel(rows: VisitExportRow[], meta: ExportReportMeta) {
  await exportTableToExcel({
    reportTitle: "DPI Visit Verification Report",
    sheetName: "Visits",
    filenamePrefix: "visit-report-export",
    columns: VISIT_EXPORT_COLUMNS,
    rows: buildRows(rows),
    meta
  });
}

export async function exportVisitsToPDF(rows: VisitExportRow[], meta: ExportReportMeta) {
  await exportTableToPDF({
    reportTitle: "DPI Visit Verification Report",
    sheetName: "Visits",
    filenamePrefix: "visit-report-export",
    columns: VISIT_EXPORT_COLUMNS,
    rows: buildRows(rows),
    meta
  });
}
