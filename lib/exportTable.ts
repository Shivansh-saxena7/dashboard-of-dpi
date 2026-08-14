// Generic "any tabular data -> styled Excel/PDF" engine — extracted
// out of exportLeadsReport.ts (Coordinator-Dashboard export-everywhere
// requirement) so the branding/watermark/header styling that page
// already built is a single owner, reused by every report type
// (Leads, Employee Summary, Visit list, Snooze log), rather than
// copy-pasted four times. exportLeadsReport.ts's own public API
// (exportLeadsToExcel/exportLeadsToPDF/AdminExportLead/EXPORT_COLUMNS)
// is untouched — it's now a thin leads-specific wrapper around this.

export interface ExportColumn {
  key: string;
  header: string;
  align: "left" | "center" | "right";
  width: number;
}

// Employee gets its own labeled line (per spec), the other filters
// bundle into one "Filters: ..." line. scopeLabel is optional —
// Admin's Leads export omits it, a Team-scoped or role-scoped report
// (Coordinator's exports, a future Team Leader report) sets it.
export interface ExportReportMeta {
  employeeLabel: string | null;
  otherFilters: { label: string; value: string }[];
  scopeLabel?: string;
}

export type ExportRow = Record<string, string | number>;

const COMPANY_NAME = "Divya Padma Infosystem LLP";
const BRAND_BLUE: [number, number, number] = [29, 78, 216];
const SLATE_500: [number, number, number] = [100, 116, 139];
const SLATE_200: [number, number, number] = [226, 232, 240];

// Shared by exportTableToPDF and exportMultiSectionToPDF's autoTable
// calls — light grid-lines (theme:"grid" without this looks the same
// as jspdf-autotable's default striped theme but with heavy black
// 1pt borders, not the subtle look the rest of the app uses).
// lineWidth 0.5pt + slate-200 matches the on-screen tables' own
// divide-slate-100/200 borders as closely as jsPDF's units allow.
const PDF_TABLE_STYLES = {
  fontSize: 7,
  cellPadding: 4,
  overflow: "linebreak" as const,
  valign: "middle" as const,
  lineColor: SLATE_200,
  lineWidth: 0.5
};

const PDF_HEAD_STYLES = {
  fillColor: BRAND_BLUE,
  textColor: 255,
  fontStyle: "bold" as const,
  halign: "left" as const,
  lineColor: SLATE_200,
  lineWidth: 0.5
};

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

function buildExportFilename(prefix: string, ext: string): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${prefix}-${y}-${m}-${d}.${ext}`;
}

function buildFiltersLine(otherFilters: { label: string; value: string }[]): string {
  if (otherFilters.length === 0) {
    return "Filters: None applied";
  }
  return "Filters: " + otherFilters.map((f) => `${f.label}=${f.value}`).join(", ");
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

export interface ExportTableOptions {
  reportTitle: string;
  sheetName: string;
  filenamePrefix: string;
  columns: readonly ExportColumn[];
  rows: ExportRow[];
  meta: ExportReportMeta;
  pdfExcludedKeys?: string[];
}

// Shared by exportTableToExcel and exportMultiSectionToExcel — writes
// the confidential-banner + title + meta-info block at the top of a
// worksheet and returns the row index the actual data table should
// start at. Every sheet gets this (not just the first) so a sheet is
// self-contained/understandable even if someone jumps straight to it
// without reading the first one.
function writeExcelSheetHeader(
  sheet: import("exceljs").Worksheet,
  colCount: number,
  title: string,
  meta: ExportReportMeta
): number {
  function mergedTextRow(rowIndex: number, text: string, font: Partial<import("exceljs").Font>) {
    sheet.mergeCells(rowIndex, 1, rowIndex, colCount);
    const cell = sheet.getCell(rowIndex, 1);
    cell.value = text;
    cell.font = font;
    cell.alignment = { horizontal: "left", vertical: "middle" };
  }

  mergedTextRow(1, `${COMPANY_NAME.toUpperCase()} — CONFIDENTIAL`, {
    size: 20,
    bold: true,
    color: { argb: "FF1D4ED8" }
  });
  sheet.getRow(1).height = 30;

  mergedTextRow(2, title, { size: 13, bold: true, color: { argb: "FF0F172A" } });

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

  return row;
}

// Shared by exportTableToExcel and exportMultiSectionToExcel — draws
// the header row + data rows + column widths + frozen pane for one
// table, starting at headerRowIndex.
function writeExcelTable(
  sheet: import("exceljs").Worksheet,
  headerRowIndex: number,
  columns: readonly ExportColumn[],
  rows: ExportRow[]
) {
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
}

export async function exportTableToExcel(opts: ExportTableOptions) {
  const { reportTitle, sheetName, filenamePrefix, columns, rows, meta } = opts;
  const colCount = columns.length;

  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = COMPANY_NAME;
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(sheetName);
  const headerRowIndex = writeExcelSheetHeader(sheet, colCount, reportTitle, meta);
  writeExcelTable(sheet, headerRowIndex, columns, rows);

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  downloadBlob(blob, buildExportFilename(filenamePrefix, "xlsx"));
}

// One table per section, e.g. an Employee Summary + its supporting
// per-lead Detail — genuinely different column shapes, so they can't
// share one table (neither ExcelJS nor jsPDF-autotable support mixed-
// column nested rows within a single table well). Excel gets one
// worksheet per section (the standard, familiar way spreadsheet users
// already expect "summary + backing detail" to be organized); PDF
// gets one section per page. Both share the exact same styling/
// header/watermark machinery as the single-table functions above —
// this is purely a "more than one table in the same file" capability,
// not a second export system.
export interface ExportSection {
  sectionTitle: string;
  sheetName: string;
  columns: readonly ExportColumn[];
  rows: ExportRow[];
}

export interface ExportMultiSectionOptions {
  reportTitle: string;
  filenamePrefix: string;
  sections: ExportSection[];
  meta: ExportReportMeta;
  pdfExcludedKeys?: string[];
}

export async function exportMultiSectionToExcel(opts: ExportMultiSectionOptions) {
  const { reportTitle, filenamePrefix, sections, meta } = opts;

  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = COMPANY_NAME;
  workbook.created = new Date();

  sections.forEach((section) => {
    const sheet = workbook.addWorksheet(section.sheetName);
    const headerRowIndex = writeExcelSheetHeader(sheet, section.columns.length, section.sectionTitle || reportTitle, meta);
    writeExcelTable(sheet, headerRowIndex, section.columns, section.rows);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  downloadBlob(blob, buildExportFilename(filenamePrefix, "xlsx"));
}

// Shared by exportTableToPDF and exportMultiSectionToPDF's
// didDrawPage callback — the diagonal watermark + page-number footer
// drawn on every page.
function drawPdfWatermarkAndPageNumber(doc: import("jspdf").jsPDF, GState: any, pageNumber: number) {
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const angleDeg = 45;
  const angleRad = (angleDeg * Math.PI) / 180;
  const watermarkText = COMPANY_NAME.toUpperCase();

  doc.saveGraphicsState();
  doc.setGState(new GState({ opacity: 0.15 }));
  doc.setFont("helvetica", "bold");

  // jsPDF's align:"center" doesn't compute the anchor correctly once
  // a rotation angle is involved (verified: it shifted the text
  // hundreds of points off — the actual cause of it landing in a
  // corner). Centering is done manually instead: measure the text at
  // a 60pt reference size, then scale the font down so the full
  // diagonal run fits within 85% of the page's shorter dimension —
  // the un-scaled 60pt text was ~940pt wide, wider than the page
  // itself, so no amount of correct centering math could have kept it
  // from running off the edges.
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
  doc.text(`Page ${pageNumber}`, pw - 20, ph - 15, { align: "right" });
}

// Shared by exportTableToPDF and exportMultiSectionToPDF — draws the
// title/company banner + meta-info block at the top of the current
// page and returns the Y position the table should start at.
function drawPdfPageHeader(doc: import("jspdf").jsPDF, title: string, meta: ExportReportMeta): number {
  const generatedAt = formatDateTime(new Date().toISOString());
  const filtersLine = buildFiltersLine(meta.otherFilters);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text(title, 20, 28);

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

  return headerY;
}

export async function exportTableToPDF(opts: ExportTableOptions) {
  const { reportTitle, filenamePrefix, rows, meta, pdfExcludedKeys = [] } = opts;
  const columns = opts.columns.filter((col) => !pdfExcludedKeys.includes(col.key));

  const { jsPDF, GState } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const headerY = drawPdfPageHeader(doc, reportTitle, meta);

  autoTable(doc, {
    startY: headerY + 14,
    theme: "grid",
    head: [columns.map((c) => c.header)],
    body: rows.map((row) => columns.map((c) => String(row[c.key]))),
    styles: PDF_TABLE_STYLES,
    headStyles: PDF_HEAD_STYLES,
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: Object.fromEntries(columns.map((c, i) => [i, { halign: c.align }])),
    margin: { left: 20, right: 20, top: 40 },
    didDrawPage: (data) => drawPdfWatermarkAndPageNumber(doc, GState, data.pageNumber)
  });

  doc.save(buildExportFilename(filenamePrefix, "pdf"));
}

// --- Cost-Sheet PDF (Part 2, Lead Engine) -----------------------------
// A single structured document (client/project header + a line-item
// table + a Grand Total + a disclaimer), not a plain data table — so
// it builds its own jsPDF layout rather than going through
// exportTableToPDF's autoTable-only shape.
//
// DELIBERATELY DOES NOT reuse this file's COMPANY_NAME text or
// drawPdfWatermarkAndPageNumber (the diagonal repeated-company-name
// watermark) — every other export in this file is an internal/admin
// report, but a Cost Sheet is handed directly to the CLIENT. A
// repeated watermark and explicit company letterhead read as an
// internal audit document, not the clean, plain cost sheet a real
// estate buyer actually expects to receive. Still reuses the shared
// table styles (PDF_TABLE_STYLES/HEAD_STYLES) and formatDateTime for
// visual consistency, and a plain page-number-only footer (no
// watermark, no branding) for the rare multi-page case.
export interface CostSheetPdfLineItem {
  label: string;
  amount: number;
}

// Mirrors the real company Cost Sheet format exactly (S.No /
// Particularity / Size / Rate / Flat-Cost columns), confirmed against
// an actual La Residentia sheet — not the earlier Stamp-Duty/
// Registration/GST breakdown, which was never how this company
// actually builds one.
export interface CostSheetPdfInput {
  leadName: string;
  leadMobile: string;
  project: string;
  size: string; // free-text Size/Type label (e.g. "2BHK — 880 sqft"), for the header only
  area: number; // numeric sqft, multiplies against the 3 per-sqft rates below
  bspRate: number;
  ifmsRate: number;
  leaseRentRate: number;
  carParking: number;
  clubMembership: number;
  viewPlc: number;
  floorPlc: number;
  powerBackup: number;
  dualMeter: number;
  otherCharges: CostSheetPdfLineItem[];
  bspAmount: number;
  ifmsAmount: number;
  leaseRentAmount: number;
  totalFlatCost: number;
  govtChargePct: number;
  govtCharge: number;
  grandTotal: number;
}

function formatINR(amount: number): string {
  return amount.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

// Plain "Page N" bottom-right, muted grey — no watermark, no company
// name. Only used by the Cost-Sheet PDF, which multi-pages rarely
// (many Other Charges rows) but should still be numbered if it does.
function drawPlainPageNumber(doc: import("jspdf").jsPDF, pageNumber: number) {
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  doc.text(`Page ${pageNumber}`, pw - 20, ph - 15, { align: "right" });
}

async function buildCostSheetDoc(input: CostSheetPdfInput) {
  const { jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(15, 23, 42);
  doc.text("Cost Sheet", 40, 50);

  const dateLabel = new Date().toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...SLATE_500);
  doc.text(`Date: ${dateLabel}`, pageWidth - 40, 50, { align: "right" });

  doc.setDrawColor(...SLATE_200);
  doc.setLineWidth(1);
  doc.line(40, 64, pageWidth - 40, 64);

  let y = 90;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text(`Client: ${input.leadName} (${input.leadMobile})`, 40, y);
  y += 16;
  doc.text(`Project: ${input.project} — ${input.size}`, 40, y);
  y += 20;

  // S.No | Particularity | Size | Rate | Flat Cost — exactly the real
  // sheet's own column layout. Per-sqft rows show their Size/Rate;
  // fixed-amount rows show "NA" for both, matching how the real sheet
  // marks them.
  let sno = 1;
  const rows: [string, string, string, string, string][] = [
    [String(sno++), "BSP", formatINR(input.area), formatINR(input.bspRate), formatINR(input.bspAmount)],
    [String(sno++), "IFMS", formatINR(input.area), formatINR(input.ifmsRate), formatINR(input.ifmsAmount)],
    [String(sno++), "Lease Rent", formatINR(input.area), formatINR(input.leaseRentRate), formatINR(input.leaseRentAmount)],
    [String(sno++), "Car Parking", "NA", "NA", formatINR(input.carParking)],
    [String(sno++), "Club Membership", "NA", "NA", formatINR(input.clubMembership)],
    [String(sno++), "View PLC", "NA", "NA", formatINR(input.viewPlc)],
    [String(sno++), "Floor PLC", "NA", "NA", formatINR(input.floorPlc)],
    [String(sno++), "Power Backup", "NA", "NA", formatINR(input.powerBackup)],
    [String(sno++), "Dual Meter", "NA", "NA", formatINR(input.dualMeter)],
    ...input.otherCharges.map((o): [string, string, string, string, string] => [String(sno++), o.label, "NA", "NA", formatINR(o.amount)])
  ];

  autoTable(doc, {
    startY: y,
    theme: "grid",
    head: [["S.No", "Particularity", "Size", "Rate", "Flat Cost (Rs.)"]],
    body: rows,
    styles: PDF_TABLE_STYLES,
    headStyles: PDF_HEAD_STYLES,
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { halign: "center", cellWidth: 32 },
      1: { halign: "left" },
      2: { halign: "right" },
      3: { halign: "right" },
      4: { halign: "right" }
    },
    margin: { left: 40, right: 40 },
    didDrawPage: (data) => drawPlainPageNumber(doc, data.pageNumber)
  });

  let finalY = (doc as any).lastAutoTable.finalY + 22;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text(`Total Flat Cost: Rs. ${formatINR(input.totalFlatCost)}`, 40, finalY);
  finalY += 16;
  doc.text(`Govt Charge (${input.govtChargePct}%): Rs. ${formatINR(input.govtCharge)}`, 40, finalY);
  finalY += 22;

  doc.setDrawColor(...SLATE_200);
  doc.setLineWidth(1);
  doc.line(40, finalY - 12, pageWidth - 40, finalY - 12);

  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text(`Grand Total: Rs. ${formatINR(input.grandTotal)}`, 40, finalY);

  doc.setFont("helvetica", "italic");
  doc.setFontSize(7);
  doc.setTextColor(...SLATE_500);
  doc.text("This is an internal estimate only, not a legal or tax document.", 40, finalY + 20, { maxWidth: 500 });

  return doc;
}

export async function buildCostSheetPdfBlob(input: CostSheetPdfInput): Promise<Blob> {
  const doc = await buildCostSheetDoc(input);
  return doc.output("blob");
}

// Generic "save this already-built PDF Blob locally" — reuses the same
// downloadBlob/buildExportFilename machinery every other export in
// this file uses, exposed here since Cost-Sheet PDFs are built as a
// Blob first (for the Storage-upload-then-share path) rather than via
// doc.save() directly.
export function downloadPdfBlob(blob: Blob, filenamePrefix: string) {
  downloadBlob(blob, buildExportFilename(filenamePrefix, "pdf"));
}

export async function exportMultiSectionToPDF(opts: ExportMultiSectionOptions) {
  const { reportTitle, filenamePrefix, sections, meta, pdfExcludedKeys = [] } = opts;

  const { jsPDF, GState } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });

  sections.forEach((section, index) => {
    if (index > 0) doc.addPage();

    const headerY = drawPdfPageHeader(doc, section.sectionTitle || reportTitle, meta);
    const columns = section.columns.filter((col) => !pdfExcludedKeys.includes(col.key));

    autoTable(doc, {
      startY: headerY + 14,
      theme: "grid",
      head: [columns.map((c) => c.header)],
      body: section.rows.map((row) => columns.map((c) => String(row[c.key]))),
      styles: PDF_TABLE_STYLES,
      headStyles: PDF_HEAD_STYLES,
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: Object.fromEntries(columns.map((c, i) => [i, { halign: c.align }])),
      margin: { left: 20, right: 20, top: 40 },
      didDrawPage: (data) => drawPdfWatermarkAndPageNumber(doc, GState, data.pageNumber)
    });
  });

  doc.save(buildExportFilename(filenamePrefix, "pdf"));
}
