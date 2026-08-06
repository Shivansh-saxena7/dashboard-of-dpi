import { LEAD_STATUS_DISPLAY } from "@/lib/leadStatusDisplay";
import { LEAD_PRIORITY_DISPLAY } from "@/lib/leadPriorityDisplay";
import { BOARD_STAGES, BoardStage } from "@/lib/leadBoardStageDisplay";
import { assignedByLabel, AssignedBySource } from "@/lib/assignedByDisplay";
import {
  exportTableToExcel,
  exportTableToPDF,
  formatDateTime,
  formatDuration,
  ExportReportMeta,
  ExportRow
} from "@/lib/exportTable";

// Re-exported for every pre-existing importer (admin/leads/page.tsx,
// app/team/page.tsx's Team Reports, ExportPreviewTable.tsx,
// app/coordinator/page.tsx) — this file's public API is unchanged by
// the generic-engine extraction below; only its internals moved.
export type { ExportReportMeta };

export interface AdminExportLead {
  name: string;
  mobile: string;
  project: string | null;
  source: string | null;
  status: string;
  priority: string;
  board_stage: string | null;
  recycle_count: number;
  // Optional + defaults to "LEAD" in buildExportRows below — older
  // callers/rows that predate the Leads-vs-Data distinction still
  // export correctly without needing to be touched.
  lead_type?: string | null;
  employees: { name: string } | null;
  lead_history: (AssignedBySource & { assigned_at: string | null; first_call_at: string | null; first_whatsapp_at: string | null })[] | null;
}

// Single source of truth for export columns — Excel and PDF both
// read from this. `align` and `width` are metadata each format
// interprets its own way (Excel column width vs. PDF cell halign).
export const EXPORT_COLUMNS = [
  { key: "leadName", header: "Lead Name", align: "left", width: 24 },
  { key: "mobile", header: "Mobile", align: "left", width: 16 },
  { key: "type", header: "Type", align: "center", width: 10 },
  { key: "project", header: "Project", align: "left", width: 22 },
  { key: "source", header: "Source", align: "left", width: 16 },
  { key: "priority", header: "Priority", align: "center", width: 12 },
  { key: "status", header: "Status", align: "center", width: 16 },
  { key: "boardStage", header: "Board Stage", align: "center", width: 14 },
  { key: "assignedEmployee", header: "Assigned Employee", align: "left", width: 20 },
  { key: "assignedBy", header: "Assigned By", align: "left", width: 20 },
  { key: "assignedDate", header: "Assigned Date", align: "left", width: 20 },
  { key: "firstCallTime", header: "First Call Time", align: "left", width: 20 },
  { key: "responseTime", header: "Response Time", align: "center", width: 16 },
  { key: "firstWhatsAppTime", header: "First WhatsApp Time", align: "left", width: 20 },
  { key: "recycleCount", header: "Recycle Count", align: "center", width: 14 }
] as const;

// Landscape + small font comfortably fits these columns for typical
// data. If a future column ever makes the PDF feel cramped, drop it
// here (e.g. ["recycleCount"]) — Excel is unaffected either way.
const PDF_EXCLUDED_KEYS: string[] = [];

export function buildExportRows(leads: AdminExportLead[]): ExportRow[] {
  return leads.map((lead) => {
    const history = lead.lead_history?.[0];
    const assignedAt = history?.assigned_at ?? null;
    const firstCallAt = history?.first_call_at ?? null;
    const firstWhatsAppAt = history?.first_whatsapp_at ?? null;

    let responseTime = "Not yet contacted";
    if (assignedAt && firstCallAt) {
      const diffMs = new Date(firstCallAt).getTime() - new Date(assignedAt).getTime();
      responseTime = formatDuration(diffMs);
    }

    const boardStageLabel =
      BOARD_STAGES.find((b) => b.stage === ((lead.board_stage as BoardStage) || "LEADS"))?.label ||
      lead.board_stage ||
      "—";

    const priorityLabel =
      LEAD_PRIORITY_DISPLAY[lead.priority as keyof typeof LEAD_PRIORITY_DISPLAY]?.label || lead.priority;

    const statusLabel =
      LEAD_STATUS_DISPLAY[lead.status as keyof typeof LEAD_STATUS_DISPLAY]?.label || lead.status;

    const typeLabel = lead.lead_type === "DATA" ? "Data" : "Leads";

    return {
      leadName: lead.name || "",
      mobile: lead.mobile || "",
      type: typeLabel,
      project: lead.project || "",
      source: lead.source || "",
      priority: priorityLabel,
      status: statusLabel,
      boardStage: boardStageLabel,
      assignedEmployee: lead.employees?.name || "Unassigned",
      assignedBy: history ? assignedByLabel(history) : "—",
      assignedDate: formatDateTime(assignedAt),
      firstCallTime: firstCallAt ? formatDateTime(firstCallAt) : "Not yet contacted",
      responseTime,
      firstWhatsAppTime: firstWhatsAppAt ? formatDateTime(firstWhatsAppAt) : "Not yet contacted",
      recycleCount: lead.recycle_count ?? 0
    };
  });
}

export async function exportLeadsToExcel(leads: AdminExportLead[], meta: ExportReportMeta) {
  await exportTableToExcel({
    reportTitle: "DPI Lead Report",
    sheetName: "Leads",
    filenamePrefix: "leads-export",
    columns: EXPORT_COLUMNS,
    rows: buildExportRows(leads),
    meta
  });
}

export async function exportLeadsToPDF(leads: AdminExportLead[], meta: ExportReportMeta) {
  await exportTableToPDF({
    reportTitle: "DPI Lead Report",
    sheetName: "Leads",
    filenamePrefix: "leads-export",
    columns: EXPORT_COLUMNS,
    rows: buildExportRows(leads),
    meta,
    pdfExcludedKeys: PDF_EXCLUDED_KEYS
  });
}
