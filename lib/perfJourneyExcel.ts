// Lead Journey Excel (2026-11-26): Summary, Journeys (the page's filters), one sheet per employee (optional),
// Definitions. A4 landscape, fit to width, header row repeats on every page, footer "Page X of N", % columns last.
// Plain values only (no formulas). exceljs is passed in, so the same builder runs in the browser and in a node script.
import { FAIR_NOTE, EFFORT_NOTE, FLAT_HEAD, SUMMARY_HEAD, flatJourney, rowsOf, sheetName, summaryRow, type JourneyReport, type JourneyRow } from "@/lib/perfJourney";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Excel = any;
type Sheet = any;

export interface JourneyExcelInput {
  report: JourneyReport;
  rows: JourneyRow[];
  total: number;
  filterText: string;
  perEmployee: boolean;
  nameOf: (id: string) => string;
}

const BLUE = "FF1D4ED8";
const HEAD_FONT = { bold: true, color: { argb: "FFFFFFFF" } };

function setup(ws: Sheet, title: string, filterText: string, head: string[], headRow: number) {
  ws.pageSetup = {
    orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 }, printTitlesRow: `${headRow}:${headRow}`
  };
  ws.headerFooter = { oddHeader: `&L&B${title.replace(/&/g, "&&")}`, oddFooter: "&LDivya Padma · Performance report&CPage &P of &N&R&D" };
  ws.getCell("A1").value = title;
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.getCell("A2").value = filterText;
  ws.getCell("A2").font = { size: 9, color: { argb: "FF475569" } };
  const r = ws.getRow(headRow);
  r.values = head;
  r.font = HEAD_FONT;
  r.alignment = { wrapText: true, vertical: "middle" };
  r.height = 32;
  r.eachCell((c: any) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } }));
  ws.views = [{ state: "frozen", ySplit: headRow }];
}
const JOURNEY_WIDTHS = [10, 11, 8, 11, ...Array.from({ length: 4 }, () => [14, 10, 12, 7, 6, 12]).flat(), 7, 13, 14, 14, 14, 14];

export function buildJourneyWorkbook(ExcelJS: Excel, input: JourneyExcelInput) {
  const { report, rows, total, filterText, perEmployee, nameOf } = input;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Performance report";
  const range = `${report.from} to ${report.to}`;

  const s = wb.addWorksheet("Summary");
  setup(s, `Lead Journey · Employee summary · ${range}`, filterText, SUMMARY_HEAD, 4);
  s.getCell("A3").value = `${FAIR_NOTE} ${EFFORT_NOTE} % = of leads given, never over 100%.`;
  s.getCell("A3").font = { italic: true, size: 9, color: { argb: "FF475569" } };
  for (const e of report.by_employee) {
    const row = s.addRow(summaryRow(`${e.name ?? nameOf(e.employee_id)}${e.active === false ? " (inactive)" : ""}`, e, report.team));
    if (row.getCell(12).value === "Low sample") row.font = { color: { argb: "FF64748B" } };
  }
  const t = s.addRow(summaryRow("Team (each row's leads added)", report.team, report.team, true));
  t.font = { bold: true };
  s.columns.forEach((c: any, i: number) => (c.width = i === 0 ? 24 : i === 10 ? 12 : i === 11 ? 11 : 11));

  const j = wb.addWorksheet("Journeys");
  setup(j, `Lead Journey · Journeys · ${range}`, filterText, FLAT_HEAD, 4);
  j.getCell("A3").value = rows.length < total ? `First ${rows.length.toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")} leads.` : `${total.toLocaleString("en-IN")} leads. Lead = short id; no client name or number.`;
  j.getCell("A3").font = { size: 9, color: { argb: "FF475569" } };
  rows.forEach((r) => j.addRow(flatJourney(r)));
  j.columns.forEach((c: any, i: number) => (c.width = JOURNEY_WIDTHS[i] ?? 10));
  j.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: FLAT_HEAD.length } };

  if (perEmployee) {
    const used = new Set(["summary", "journeys", "definitions"]);
    for (const e of report.by_employee) {
      const name = e.name ?? nameOf(e.employee_id);
      const ws = wb.addWorksheet(sheetName(name, used));
      setup(ws, `Lead Journey · ${name} · ${range}`, filterText, FLAT_HEAD, 4);
      const sr = summaryRow(name, e, report.team);
      ws.getCell("A3").value = `${sr[1]} leads given · missed by me ${sr[5]} (${sr[12]}, team ${sr[13]}) · won from others ${sr[7]} (${sr[14]}) · assists ${sr[8]} (${sr[15]})${sr[11] ? " · Low sample" : ""}. ${FAIR_NOTE}`;
      ws.getCell("A3").font = { bold: true, size: 10 };
      rowsOf(rows, e.employee_id).forEach((r) => ws.addRow(flatJourney(r)));
      ws.columns.forEach((c: any, i: number) => (c.width = JOURNEY_WIDTHS[i] ?? 10));
    }
  }

  const d = wb.addWorksheet("Definitions");
  setup(d, `Lead Journey · Definitions v${report.def_version}`, filterText, ["Term", "Meaning"], 4);
  for (const def of report.definitions) d.addRow([def.label, def.rule]);
  d.addRow(["Approx", EFFORT_NOTE]);
  d.getColumn(1).width = 26;
  d.getColumn(2).width = 110;
  d.getColumn(2).alignment = { wrapText: true, vertical: "top" };
  return wb;
}

export async function downloadJourneyExcel(input: JourneyExcelInput, fileName: string) {
  const mod = await import("exceljs");
  const ExcelJS = (mod as { default?: unknown }).default ?? mod;
  const wb = buildJourneyWorkbook(ExcelJS, input);
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
