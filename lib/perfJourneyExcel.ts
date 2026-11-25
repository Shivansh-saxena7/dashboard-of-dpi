// Lead Journey Excel (2026-11-26; lists 2026-11-27): Summary, "Missed by me", "Won from others", "Assists", "All journeys",
// one sheet per employee (their Missed / Won / Assist leads, Type column), Definitions. Every sheet: "Contains customer
// data: do not share" on top, A4 landscape, fit to width, header row repeats, footer "Page X of N", AutoFilter on.
// % columns last (Summary). Plain values only (no formulas). exceljs is passed in, so the builder also runs in node.
import {
  ALL_HEAD, ASSIST_HEAD, CUSTOMER_DATA_NOTE, EFFORT_NOTE, EMP_HEAD, FAIR_NOTE, MISSED_HEAD, SUMMARY_HEAD, WON_HEAD, allRow, buildLists, listCheck, sheetName, summaryRow,
  type ExportRow, type JourneyReport, type ListKind
} from "@/lib/perfJourney";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Excel = any;
type Sheet = any;

export interface JourneyExcelInput {
  report: JourneyReport;
  rows: ExportRow[];
  total: number;
  filterText: string;
  perEmployee: boolean;
  nameOf: (id: string) => string;
  withContacts: boolean;
}
export interface JourneyExcelResult { wb: any; counts: Record<ListKind | "all", number>; problems: string[] }

const BLUE = "FF1D4ED8";
const HEAD = 4;

function sheet(wb: any, name: string, title: string, filterText: string, head: string[], widths: number[]) {
  const ws = wb.addWorksheet(name);
  ws.pageSetup = {
    orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 }, printTitlesRow: `${HEAD}:${HEAD}`
  };
  ws.headerFooter = { oddHeader: `&L&B${title.replace(/&/g, "&&")}&R${CUSTOMER_DATA_NOTE}`, oddFooter: "&LDivya Padma · Performance report&CPage &P of &N&R&D" };
  ws.getCell("A1").value = CUSTOMER_DATA_NOTE;
  ws.getCell("A1").font = { bold: true, color: { argb: "FFB91C1C" } };
  ws.getCell("A2").value = title;
  ws.getCell("A2").font = { bold: true, size: 14 };
  ws.getCell("A3").value = filterText;
  ws.getCell("A3").font = { size: 9, color: { argb: "FF475569" } };
  const r = ws.getRow(HEAD);
  r.values = head;
  r.font = { bold: true, color: { argb: "FFFFFFFF" } };
  r.alignment = { wrapText: true, vertical: "middle" };
  r.height = 32;
  r.eachCell((c: any) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } }));
  ws.views = [{ state: "frozen", ySplit: HEAD }];
  head.forEach((_, i) => (ws.getColumn(i + 1).width = widths[i] ?? 12));
  return ws;
}
const filterOn = (ws: Sheet, cols: number) => (ws.autoFilter = { from: { row: HEAD, column: 1 }, to: { row: HEAD, column: cols } });
const W_LEAD = [18, 13, 10, 11, 8];

export function buildJourneyWorkbook(ExcelJS: Excel, input: JourneyExcelInput): JourneyExcelResult {
  const { report, rows, total, filterText, perEmployee, nameOf, withContacts } = input;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Performance report";
  const range = `${report.from} to ${report.to}`;
  const lists = buildLists(rows);
  const problems = rows.length < total ? [`only ${rows.length} of ${total} leads loaded`] : listCheck(lists, report.by_employee);
  const name = (id: string) => report.by_employee.find((e) => e.employee_id === id)?.name ?? nameOf(id);

  const s = sheet(wb, "Summary", `Lead Journey · Employee summary · ${range}`, filterText, SUMMARY_HEAD, [24, 10, 11, 11, 11, 10, 11, 10, 9, 11, 11, 11, 10, 11, 9, 9]);
  for (const e of report.by_employee) {
    const row = s.addRow(summaryRow(`${e.name ?? nameOf(e.employee_id)}${e.active === false ? " (inactive)" : ""}`, e, report.team));
    if (row.getCell(12).value === "Low sample") row.font = { color: { argb: "FF64748B" } };
  }
  s.addRow(summaryRow("Team (each row's leads added)", report.team, report.team, true)).font = { bold: true };
  filterOn(s, SUMMARY_HEAD.length);
  s.addRow([]);
  s.addRow([`${FAIR_NOTE} ${EFFORT_NOTE} % = of leads given, never over 100%.`]).font = { italic: true, size: 9 };
  s.addRow([problems.length ? `Check: the lists do not match the counts (${problems.slice(0, 3).join("; ")}).` : `Check: every Missed / Won / Assist list has exactly as many rows as its count (${lists.missed.length} / ${lists.won.length} / ${lists.assist.length}).`])
    .font = { bold: true, color: { argb: problems.length ? "FFB91C1C" : "FF047857" } };
  if (!withContacts) s.addRow(["Lead names, mobiles and positive dates need the latest database update; this file shows the lead id only."]).font = { size: 9 };

  const lists3: [ListKind, string, string[], number[]][] = [
    ["missed", "Missed by me", MISSED_HEAD, [20, ...W_LEAD, 11, 13, 8, 8, 14, 20, 13, 11, 9]],
    ["won", "Won from others", WON_HEAD, [20, ...W_LEAD, 11, 20, 13, 8, 8, 13, 11, 9]],
    ["assist", "Assists", ASSIST_HEAD, [20, ...W_LEAD, 13, 11, 20, 13, 11, 9]]
  ];
  for (const [k, title, head, widths] of lists3) {
    const ws = sheet(wb, title, `Lead Journey · ${title} · ${range}`, filterText, head, widths);
    lists[k].forEach((x) => ws.addRow(x.cells));
    filterOn(ws, head.length);
  }

  const a = sheet(wb, "All journeys", `Lead Journey · All journeys · ${range}`, filterText, ALL_HEAD, [10, 18, 13, 11, 8, 11, ...Array.from({ length: 4 }, () => [14, 10, 12, 7, 6, 12]).flat(), 7, 13, 14, 14, 14, 14]);
  rows.forEach((r) => a.addRow(allRow(r)));
  filterOn(a, ALL_HEAD.length);

  if (perEmployee) {
    const used = new Set(["summary", "missed by me", "won from others", "assists", "all journeys", "definitions"]);
    for (const e of report.by_employee) {
      const nm = name(e.employee_id);
      const mine = (["missed", "won", "assist"] as ListKind[]).flatMap((k) => lists[k].filter((x) => x.employee_id === e.employee_id));
      const ws = sheet(wb, sheetName(nm, used), `Lead Journey · ${nm} · ${range}`, filterText, EMP_HEAD, [16, ...W_LEAD, 11, 13, 8, 8, 20, 13, 11, 8]);
      mine.forEach((x) => ws.addRow(x.emp));
      filterOn(ws, EMP_HEAD.length);
      const sr = summaryRow(nm, e, report.team);
      ws.addRow([]);
      ws.addRow([`${sr[1]} leads given · missed by me ${sr[5]} (${sr[12]}, team ${sr[13]}) · won from others ${sr[7]} (${sr[14]}) · assists ${sr[8]} (${sr[15]})${sr[11] ? " · Low sample" : ""}. ${FAIR_NOTE}`]).font = { bold: true, size: 10 };
    }
  }

  const d = sheet(wb, "Definitions", `Lead Journey · Definitions v${report.def_version}`, filterText, ["Term", "Meaning"], [26, 110]);
  for (const def of report.definitions) d.addRow([def.label, def.rule]);
  d.addRow(["Approx", EFFORT_NOTE]);
  d.getColumn(2).alignment = { wrapText: true, vertical: "top" };
  return { wb, counts: { missed: lists.missed.length, won: lists.won.length, assist: lists.assist.length, all: rows.length }, problems };
}

export async function downloadJourneyExcel(input: JourneyExcelInput, fileName: string) {
  const mod = await import("exceljs");
  const ExcelJS = (mod as { default?: unknown }).default ?? mod;
  const res = buildJourneyWorkbook(ExcelJS, input);
  const buf = await res.wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { counts: res.counts, problems: res.problems };
}
