import { exportTableToExcel, exportTableToPDF, formatDateTime, ExportReportMeta, ExportRow } from "@/lib/exportTable";
import { DailyHrmsStatus, MonthlyHrmsStatus } from "@/lib/calculateHrmsAttendanceStatus";

// Two thin wrappers around the same generic exportTable.ts engine the
// Leads report already uses (exportLeadsReport.ts is the reference
// pattern) — no new PDF/Excel generation logic here at all, just
// attendance-specific column/row shapes. Two shapes, not one, because
// /hr/attendance genuinely has two different kinds of table on screen
// (a per-day detail list vs. a per-employee monthly aggregate) — same
// engine, same watermark, different columns for each.

const STATUS_LABEL: Record<string, string> = {
  ON_TIME: "On Time",
  LATE_COMING: "Late Coming",
  HALF_DAY: "Half Day",
  ABSENT: "Absent"
};

// ---- Daily / date-range detail export ----

export interface AttendanceDetailExportRow {
  employeeName: string;
  date: string;
  status: DailyHrmsStatus;
  shiftStartAt: string | null;
  half: "FIRST" | "SECOND" | null;
  manuallyMarkedBy: string | null;
}

export const ATTENDANCE_DETAIL_COLUMNS = [
  { key: "employeeName", header: "Employee", align: "left", width: 22 },
  { key: "date", header: "Date", align: "left", width: 14 },
  { key: "status", header: "Status", align: "center", width: 14 },
  { key: "shiftStartTime", header: "Shift Start Time", align: "left", width: 18 },
  { key: "half", header: "Half", align: "center", width: 12 },
  { key: "manuallyMarked", header: "Manually Marked", align: "left", width: 22 }
] as const;

export function buildAttendanceDetailRows(rows: AttendanceDetailExportRow[]): ExportRow[] {
  return rows.map((r) => ({
    employeeName: r.employeeName,
    date: new Date(r.date).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" }),
    status: STATUS_LABEL[r.status] || r.status,
    shiftStartTime: r.shiftStartAt ? formatDateTime(r.shiftStartAt) : "—",
    half: r.half === "FIRST" ? "First Half" : r.half === "SECOND" ? "Second Half" : "—",
    manuallyMarked: r.manuallyMarkedBy ? `Yes (${r.manuallyMarkedBy})` : "No"
  }));
}

export async function exportAttendanceDetailToExcel(rows: AttendanceDetailExportRow[], meta: ExportReportMeta) {
  await exportTableToExcel({
    reportTitle: "DPI Attendance Report",
    sheetName: "Attendance",
    filenamePrefix: "hr-attendance-detail",
    columns: ATTENDANCE_DETAIL_COLUMNS,
    rows: buildAttendanceDetailRows(rows),
    meta
  });
}

export async function exportAttendanceDetailToPDF(rows: AttendanceDetailExportRow[], meta: ExportReportMeta) {
  await exportTableToPDF({
    reportTitle: "DPI Attendance Report",
    sheetName: "Attendance",
    filenamePrefix: "hr-attendance-detail",
    columns: ATTENDANCE_DETAIL_COLUMNS,
    rows: buildAttendanceDetailRows(rows),
    meta
  });
}

// ---- Monthly summary export ----

export interface AttendanceSummaryExportRow {
  employeeName: string;
  counts: Record<MonthlyHrmsStatus, number>;
}

export const ATTENDANCE_SUMMARY_COLUMNS = [
  { key: "employeeName", header: "Employee", align: "left", width: 24 },
  { key: "onTime", header: "On Time", align: "center", width: 12 },
  { key: "lateComing", header: "Late Coming", align: "center", width: 14 },
  { key: "halfDay", header: "Half Day", align: "center", width: 12 },
  { key: "absent", header: "Absent", align: "center", width: 12 }
] as const;

export function buildAttendanceSummaryRows(rows: AttendanceSummaryExportRow[]): ExportRow[] {
  return rows.map((r) => ({
    employeeName: r.employeeName,
    onTime: r.counts.ON_TIME,
    lateComing: r.counts.LATE_COMING,
    halfDay: r.counts.HALF_DAY,
    absent: r.counts.ABSENT
  }));
}

export async function exportAttendanceSummaryToExcel(rows: AttendanceSummaryExportRow[], meta: ExportReportMeta) {
  await exportTableToExcel({
    reportTitle: "DPI Attendance Report",
    sheetName: "Monthly Summary",
    filenamePrefix: "hr-attendance-summary",
    columns: ATTENDANCE_SUMMARY_COLUMNS,
    rows: buildAttendanceSummaryRows(rows),
    meta
  });
}

export async function exportAttendanceSummaryToPDF(rows: AttendanceSummaryExportRow[], meta: ExportReportMeta) {
  await exportTableToPDF({
    reportTitle: "DPI Attendance Report",
    sheetName: "Monthly Summary",
    filenamePrefix: "hr-attendance-summary",
    columns: ATTENDANCE_SUMMARY_COLUMNS,
    rows: buildAttendanceSummaryRows(rows),
    meta
  });
}
