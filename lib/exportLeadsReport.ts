import { LEAD_STATUS_DISPLAY } from "@/lib/leadStatusDisplay";
import { LEAD_PRIORITY_DISPLAY } from "@/lib/leadPriorityDisplay";
import { BOARD_STAGES, BoardStage } from "@/lib/leadBoardStageDisplay";
import { assignedByLabel, AssignedBySource } from "@/lib/assignedByDisplay";

export interface AdminExportLead {
  name: string;
  mobile: string;
  project: string | null;
  source: string | null;
  status: string;
  priority: string;
  board_stage: string | null;
  recycle_count: number;
  employees: { name: string } | null;
  lead_history: (AssignedBySource & { assigned_at: string | null; first_call_at: string | null; first_whatsapp_at: string | null })[] | null;
}

// Everything the report header needs to explain "what criteria was
// this pulled with" — Employee gets its own line (per spec), the
// other filters are bundled into one "Filters: ..." line. scopeLabel
// is optional and only used by scoped callers (e.g. a Team Leader's
// Team Reports, "Team: Team Yogesh") — Admin's export omits it.
export interface ExportReportMeta {
  employeeLabel: string | null;
  otherFilters: { label: string; value: string }[];
  scopeLabel?: string;
}

const COMPANY_NAME = "Divya Padma Infosystem LLP";
const BRAND_BLUE: [number, number, number] = [29, 78, 216];
const SLATE_500: [number, number, number] = [100, 116, 139];

// Single source of truth for export columns — Excel and PDF both
// read from this. `align` and `width` are metadata each format
// interprets its own way (Excel column width vs. PDF cell halign).
export const EXPORT_COLUMNS = [
  { key: "leadName", header: "Lead Name", align: "left", width: 24 },
  { key: "mobile", header: "Mobile", align: "left", width: 16 },
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

export type ExportRow = Record<(typeof EXPORT_COLUMNS)[number]["key"], string | number>;

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

function buildExportFilename(ext: string): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `leads-export-${y}-${m}-${d}.${ext}`;
}

function buildFiltersLine(otherFilters: { label: string; value: string }[]): string {
  if (otherFilters.length === 0) {
    return "Filters: All Leads (no filters applied)";
  }
  return "Filters: " + otherFilters.map((f) => `${f.label}=${f.value}`).join(", ");
}

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

    return {
      leadName: lead.name || "",
      mobile: lead.mobile || "",
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

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function exportLeadsToExcel(leads: AdminExportLead[], meta: ExportReportMeta) {
  const rows = buildExportRows(leads);
  const columns = EXPORT_COLUMNS;
  const colCount = columns.length;

  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = COMPANY_NAME;
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Leads");

  function mergedTextRow(rowIndex: number, text: string, font: Partial<import("exceljs").Font>) {
    sheet.mergeCells(rowIndex, 1, rowIndex, colCount);
    const cell = sheet.getCell(rowIndex, 1);
    cell.value = text;
    cell.font = font;
    cell.alignment = { horizontal: "left", vertical: "middle" };
  }

  // True background-image watermarking needs a rasterized (canvas ->
  // PNG) image embed, which is fragile across Excel renderers for
  // marginal benefit — pre-agreed fallback: an oversized, unmissable
  // company-name banner as the first thing anyone sees on open,
  // aiming for the same "unmistakably official" effect.
  mergedTextRow(1, `${COMPANY_NAME.toUpperCase()} — CONFIDENTIAL`, {
    size: 20,
    bold: true,
    color: { argb: "FF1D4ED8" }
  });
  sheet.getRow(1).height = 30;

  mergedTextRow(2, "DPI Lead Report", { size: 13, bold: true, color: { argb: "FF0F172A" } });

  let row = 3;

  if (meta.scopeLabel) {
    mergedTextRow(row, `Team: ${meta.scopeLabel}`, { size: 10, bold: true, color: { argb: "FF0F172A" } });
    row++;
  }

  mergedTextRow(row, `Generated: ${formatDateTime(new Date().toISOString())}`, {
    size: 9,
    color: { argb: "FF64748B" }
  });
  row++;

  if (meta.employeeLabel) {
    mergedTextRow(row, `Employee: ${meta.employeeLabel}`, {
      size: 9,
      bold: true,
      color: { argb: "FF1D4ED8" }
    });
    row++;
  }

  mergedTextRow(row, buildFiltersLine(meta.otherFilters), {
    size: 9,
    italic: true,
    color: { argb: "FF64748B" }
  });
  row++;

  row++; // blank spacer before the table

  const headerRowIndex = row;
  columns.forEach((col, i) => {
    const cell = sheet.getCell(headerRowIndex, i + 1);
    cell.value = col.header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D4ED8" } };
    cell.alignment = { horizontal: col.align, vertical: "middle" };
  });
  sheet.getRow(headerRowIndex).height = 20;

  rows.forEach((r, idx) => {
    const excelRow = headerRowIndex + 1 + idx;
    columns.forEach((col, i) => {
      const cell = sheet.getCell(excelRow, i + 1);
      cell.value = r[col.key];
      cell.alignment = { horizontal: col.align, vertical: "middle" };
      if (idx % 2 === 1) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
      }
    });
  });

  columns.forEach((col, i) => {
    sheet.getColumn(i + 1).width = col.width;
  });

  sheet.views = [{ state: "frozen", ySplit: headerRowIndex }];

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  downloadBlob(blob, buildExportFilename("xlsx"));
}

export async function exportLeadsToPDF(leads: AdminExportLead[], meta: ExportReportMeta) {
  const rows = buildExportRows(leads);
  const columns = EXPORT_COLUMNS.filter((col) => !PDF_EXCLUDED_KEYS.includes(col.key));

  const { jsPDF, GState } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });

  const generatedAt = formatDateTime(new Date().toISOString());
  const filtersLine = buildFiltersLine(meta.otherFilters);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text("DPI Lead Report", 20, 28);

  doc.setFontSize(11);
  doc.setTextColor(...BRAND_BLUE);
  doc.text(COMPANY_NAME, 20, 44);

  let headerY = 58;

  if (meta.scopeLabel) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text(`Team: ${meta.scopeLabel}`, 20, headerY);
    headerY += 12;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...SLATE_500);

  doc.text(`Generated: ${generatedAt}`, 20, headerY);

  if (meta.employeeLabel) {
    headerY += 12;
    doc.text(`Employee: ${meta.employeeLabel}`, 20, headerY);
  }

  headerY += 12;
  doc.text(filtersLine, 20, headerY);

  autoTable(doc, {
    startY: headerY + 14,
    head: [columns.map((c) => c.header)],
    body: rows.map((row) => columns.map((c) => String(row[c.key]))),
    styles: { fontSize: 7, cellPadding: 4, overflow: "linebreak", valign: "middle" },
    headStyles: { fillColor: BRAND_BLUE, textColor: 255, fontStyle: "bold", halign: "left" },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: Object.fromEntries(columns.map((c, i) => [i, { halign: c.align }])),
    margin: { left: 20, right: 20, top: 40 },
    didDrawPage: (data) => {
      const pw = doc.internal.pageSize.getWidth();
      const ph = doc.internal.pageSize.getHeight();
      const angleDeg = 45;
      const angleRad = (angleDeg * Math.PI) / 180;
      const watermarkText = COMPANY_NAME.toUpperCase();

      doc.saveGraphicsState();
      doc.setGState(new GState({ opacity: 0.15 }));
      doc.setFont("helvetica", "bold");

      // jsPDF's align:"center" doesn't compute the anchor correctly
      // once a rotation angle is involved (verified: it shifted the
      // text hundreds of points off — the actual cause of it landing
      // in a corner). Centering is done manually instead: measure the
      // text at a 60pt reference size, then scale the font down so
      // the full diagonal run fits within 85% of the page's shorter
      // dimension — the un-scaled 60pt text was ~940pt wide, wider
      // than the page itself, so no amount of correct centering math
      // could have kept it from running off the edges.
      doc.setFontSize(60);
      const referenceWidth = doc.getTextWidth(watermarkText);
      const maxWidth = (Math.min(pw, ph) * 0.85) / Math.sin(angleRad);
      const fontSize = Math.min(60, 60 * (maxWidth / referenceWidth));
      doc.setFontSize(fontSize);

      const textWidth = doc.getTextWidth(watermarkText);
      const cx = pw / 2;
      const cy = ph / 2;
      const startX = cx - (textWidth / 2) * Math.cos(angleRad);
      const startY = cy + (textWidth / 2) * Math.sin(angleRad);

      doc.setTextColor(...SLATE_500);
      doc.text(watermarkText, startX, startY, { angle: angleDeg });
      doc.restoreGraphicsState();

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text(`Page ${data.pageNumber}`, pw - 20, ph - 15, { align: "right" });
    }
  });

  doc.save(buildExportFilename("pdf"));
}
