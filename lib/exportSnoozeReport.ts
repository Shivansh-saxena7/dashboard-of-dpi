import { exportTableToExcel, exportTableToPDF, ExportColumn, ExportReportMeta, ExportRow, formatDateTime } from "@/lib/exportTable";

export interface SnoozeExportRow {
  leadName: string;
  employeeName: string;
  teamName: string;
  snoozedAt: string;
  durationMonths: number;
  snoozedUntil: string;
  reason: string;
  status: "Active" | "Expired" | "Cancelled";
  cancelledAt: string | null;
}

const SNOOZE_EXPORT_COLUMNS: ExportColumn[] = [
  { key: "leadName", header: "Lead Name", align: "left", width: 22 },
  { key: "employeeName", header: "Employee", align: "left", width: 18 },
  { key: "teamName", header: "Team", align: "left", width: 16 },
  { key: "snoozedAt", header: "Snoozed On", align: "left", width: 18 },
  { key: "duration", header: "Duration", align: "center", width: 12 },
  { key: "snoozedUntil", header: "Snoozed Until", align: "left", width: 18 },
  { key: "reason", header: "Reason", align: "left", width: 28 },
  { key: "status", header: "Status", align: "center", width: 12 },
  { key: "cancelledAt", header: "Cancelled On", align: "left", width: 18 }
];

function buildRows(rows: SnoozeExportRow[]): ExportRow[] {
  return rows.map((r) => ({
    leadName: r.leadName,
    employeeName: r.employeeName,
    teamName: r.teamName,
    snoozedAt: formatDateTime(r.snoozedAt),
    duration: `${r.durationMonths}mo`,
    snoozedUntil: formatDateTime(r.snoozedUntil),
    reason: r.reason,
    status: r.status,
    cancelledAt: r.cancelledAt ? formatDateTime(r.cancelledAt) : "—"
  }));
}

export async function exportSnoozesToExcel(rows: SnoozeExportRow[], meta: ExportReportMeta) {
  await exportTableToExcel({
    reportTitle: "DPI Snooze Activity Report",
    sheetName: "Snoozes",
    filenamePrefix: "snooze-activity-export",
    columns: SNOOZE_EXPORT_COLUMNS,
    rows: buildRows(rows),
    meta
  });
}

export async function exportSnoozesToPDF(rows: SnoozeExportRow[], meta: ExportReportMeta) {
  await exportTableToPDF({
    reportTitle: "DPI Snooze Activity Report",
    sheetName: "Snoozes",
    filenamePrefix: "snooze-activity-export",
    columns: SNOOZE_EXPORT_COLUMNS,
    rows: buildRows(rows),
    meta
  });
}
