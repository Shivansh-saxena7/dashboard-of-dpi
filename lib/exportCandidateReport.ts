import { exportTableToExcel, exportTableToPDF, ExportReportMeta, ExportRow } from "@/lib/exportTable";

// Thin wrapper over the same generic exportTable.ts engine every other
// report in this app already uses (exportLeadsReport.ts is the
// reference pattern) — no new PDF/Excel generation logic here, just
// the candidate/interview-specific column shape. One flattened row
// per candidate, with their most recent interview's details folded
// in (designation/date/interviewer) — Admin wants "the full record,"
// and a candidate with multiple interview rounds still needs to
// appear once per row for a report to stay readable; the full
// interview history remains queryable in the app itself.

const STATUS_LABEL: Record<string, string> = {
  APPLIED: "Applied",
  INTERVIEWING: "Interviewing",
  OFFER_SENT: "Offer Sent",
  APPOINTMENT_PENDING: "Appointment Pending",
  CONVERTED: "Converted",
  REJECTED: "Rejected"
};

export interface CandidateExportRow {
  name: string;
  mobile: string;
  email: string | null;
  positionAppliedFor: string;
  status: string;
  latestInterviewDesignation: string | null;
  latestInterviewDate: string | null;
  latestInterviewerName: string | null;
  createdAt: string;
}

export const CANDIDATE_COLUMNS = [
  { key: "name", header: "Candidate", align: "left", width: 20 },
  { key: "mobile", header: "Mobile", align: "left", width: 14 },
  { key: "email", header: "Email", align: "left", width: 20 },
  { key: "position", header: "Position Applied For", align: "left", width: 18 },
  { key: "status", header: "Status", align: "center", width: 16 },
  { key: "interviewDesignation", header: "Latest Interview For", align: "left", width: 18 },
  { key: "interviewDate", header: "Latest Interview Date", align: "left", width: 16 },
  { key: "interviewer", header: "Interviewer", align: "left", width: 18 },
  { key: "createdAt", header: "Added On", align: "left", width: 14 }
] as const;

export function buildCandidateRows(rows: CandidateExportRow[]): ExportRow[] {
  return rows.map((r) => ({
    name: r.name,
    mobile: r.mobile,
    email: r.email || "—",
    position: r.positionAppliedFor,
    status: STATUS_LABEL[r.status] || r.status,
    interviewDesignation: r.latestInterviewDesignation || "—",
    interviewDate: r.latestInterviewDate
      ? new Date(r.latestInterviewDate).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" })
      : "—",
    interviewer: r.latestInterviewerName || "—",
    createdAt: new Date(r.createdAt).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" })
  }));
}

export async function exportCandidatesToExcel(rows: CandidateExportRow[], meta: ExportReportMeta) {
  await exportTableToExcel({
    reportTitle: "DPI Candidate Report",
    sheetName: "Candidates",
    filenamePrefix: "hr-candidates",
    columns: CANDIDATE_COLUMNS,
    rows: buildCandidateRows(rows),
    meta
  });
}

export async function exportCandidatesToPDF(rows: CandidateExportRow[], meta: ExportReportMeta) {
  await exportTableToPDF({
    reportTitle: "DPI Candidate Report",
    sheetName: "Candidates",
    filenamePrefix: "hr-candidates",
    columns: CANDIDATE_COLUMNS,
    rows: buildCandidateRows(rows),
    meta
  });
}
