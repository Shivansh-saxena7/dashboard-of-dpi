import { expect, test, type Page } from "@playwright/test";
import fs from "fs";
import ExcelJS from "exceljs";
import { A, B, D, desktop, journeyCalls, journeyExportCalls, journeyRowCalls, noSideScroll, openReport, reportCalls, type Ctx } from "./perfReportFixture";
import { LJ_SHOTS } from "./perfJourneyFixture";

// Performance Report "Lead Journey" tab (2026-11-26, definitions v3): its own tab; only the open tab reads (one
// get_perf_journey per filter change, filters in the POST body); employee summary with Missed by me / Won from others /
// Assists, % of leads given (never over 100), the team average, Low sample in grey; journeys with owners in order;
// drill-down on a number; Excel (Summary, Journeys, one sheet per employee, Definitions; landscape, fit to width,
// Page X of N). Fake Supabase. Pixel 7, iPhone 14, desktop Chromium.

fs.mkdirSync(LJ_SHOTS, { recursive: true });
let ctx: Ctx;
const shot = (page: Page, name: string, project: string) => page.screenshot({ path: `${LJ_SHOTS}/${name}-${project}.png`, fullPage: true, scale: "css" });
async function openJourney(page: Page) {
  await page.getByTestId("perf-tab-journey").click();
  await expect(page.getByTestId("lj")).toBeVisible();
}

test("tab: report reads only on its tab, journey reads once per filter change, body not URL, no polling", async ({ page, context }, info) => {
  ctx = await openReport(context, page, { api: 4 });
  await expect(page.getByTestId("perf-tab-report")).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => reportCalls(ctx)).toBeGreaterThan(0);
  expect(journeyCalls(ctx).length).toBe(0);
  const rep0 = reportCalls(ctx);
  await openJourney(page);
  await expect.poll(() => journeyCalls(ctx).length).toBeGreaterThan(0);
  const j0 = journeyCalls(ctx).length;
  // a filter change on the journey tab: one more journey call, no report call
  await page.getByTestId("perf-chip-type-DATA").click();
  await expect.poll(() => journeyCalls(ctx).length).toBe(j0 + 1);
  expect(reportCalls(ctx)).toBe(rep0);
  const last = journeyCalls(ctx).at(-1)!;
  expect(last.body.p_filters).toEqual({ lead_types: ["DATA"] });
  expect(ctx.calls.every((c) => !c.url.includes(A) && !c.url.includes("p_filters"))).toBe(true);
  await page.waitForTimeout(2500);
  expect(journeyCalls(ctx).length).toBe(j0 + 1); // no polling
  await expect(page.getByTestId("perf-csv")).toHaveCount(0);
  await shot(page, "journey-tab", info.project.name);
});

test("summary: counts, % of leads given never over 100, team average, Low sample grey, fairness and approx notes", async ({ page, context }, info) => {
  ctx = await openReport(context, page, { api: 4 });
  await openJourney(page);
  await expect(page.getByTestId("lj-fair")).toContainText("A signal, not a verdict.");
  await expect(page.getByTestId("lj-fair")).toContainText("approx");
  await expect(page.getByTestId("lj-tile-missed")).toContainText("38");
  if (desktop(info)) {
    await expect(page.getByTestId("lj-pct-head")).toHaveText("% of leads given");
    await expect(page.getByTestId(`lj-pct-${A}-missed`)).toHaveText("25.0%");
    await expect(page.getByTestId(`lj-row-${D}`)).toHaveAttribute("data-low", "1");
    await expect(page.getByTestId(`lj-row-${D}`)).toContainText("Low sample");
    await expect(page.getByTestId(`lj-row-${A}`)).toHaveAttribute("data-low", "0");
    await expect(page.getByTestId(`lj-row-${B}`)).toContainText("(inactive)");
    await expect(page.getByTestId("lj-team")).toContainText("17.9%");
    await expect(page.getByTestId("lj-table")).toContainText("Calls / assignment (approx)");
  } else {
    await expect(page.getByTestId(`lj-card-${D}`)).toHaveAttribute("data-low", "1");
    await expect(page.getByTestId(`lj-card-cell-${A}-missed`)).toContainText("25.0%");
    await expect(page.getByTestId(`lj-card-${A}`)).toContainText("Team avg missed 17.9%");
  }
  const pcts = await page.getByTestId("lj").innerText();
  expect([...pcts.matchAll(/(\d+(?:\.\d)?)%/g)].every((m) => Number(m[1]) <= 100)).toBe(true);
  await noSideScroll(page);
  const small = await page.getByTestId("lj").locator("button:visible").evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height < 44).map((e) => e.textContent));
  expect(small).toEqual([]);
  await shot(page, "journey-summary", info.project.name);
});

test("journeys and drill-down: owners in order, no client name, tap a number -> that person's leads, Show more", async ({ page, context }, info) => {
  ctx = await openReport(context, page, { api: 4 });
  await openJourney(page);
  const list = desktop(info) ? page.getByTestId("lj-jtable") : page.getByTestId("lj-journeys").getByTestId("lj-jcards");
  await expect(list).toContainText("00000000");
  await expect(list).toContainText("Employee A");
  await expect(page.getByTestId("lj-journeys")).toContainText("Latest 50 of 260");
  await page.getByTestId(desktop(info) ? `lj-cell-${A}-missed` : `lj-card-cell-${A}-missed`).click();
  await expect(page.getByTestId("lj-drill")).toBeVisible();
  await expect.poll(() => journeyRowCalls(ctx).length).toBeGreaterThan(0);
  const call = journeyRowCalls(ctx).at(-1)!;
  expect([call.body.p_view, call.body.p_employee, call.body.p_limit, call.body.p_offset]).toEqual(["missed", A, 200, 0]);
  await expect(page.getByTestId("lj-drill-total")).toContainText("Missed by me");
  await expect(page.getByTestId("lj-drill").getByTestId("lj-step").first()).toBeVisible();
  const more = page.getByTestId("lj-drill-more");
  if (await more.count()) {
    await more.click();
    await expect.poll(() => journeyRowCalls(ctx).at(-1)!.body.p_offset).toBe(200);
  }
  await noSideScroll(page);
  await shot(page, "journey-drill", info.project.name);
  await page.getByTestId("lj-drill-close").click();
  await page.getByTestId("lj-view-won").click();
  await expect.poll(() => journeyRowCalls(ctx).at(-1)!.body.p_view).toBe("won");
  expect(journeyRowCalls(ctx).at(-1)!.body.p_employee).toBeNull();
});

async function download(page: Page, file: string) {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("lj-excel-btn").click()]);
  expect(dl.suggestedFilename()).toMatch(/^lead-journey-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.xlsx$/);
  await dl.saveAs(file);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  return wb;
}
const dataRows = (ws: ExcelJS.Worksheet) => { const out: unknown[][] = []; ws.eachRow((r, i) => { if (i > 4 && r.getCell(1).value != null && r.getCell(1).value !== "") out.push((r.values as unknown[]).slice(1)); }); return out; };

test("Excel lists: Missed / Won / Assists / All journeys / per employee; customer-data line; lists = counts = drill-down", async ({ page, context }, info) => {
  ctx = await openReport(context, page, { api: 4, journey: { consistent: true } });
  await openJourney(page);
  const wb = await download(page, `${LJ_SHOTS}/sample-${info.project.name}.xlsx`);
  expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "Missed by me", "Won from others", "Assists", "All journeys", "Employee A", "Employee B", "Employee D", "Definitions"]);
  for (const ws of wb.worksheets) {
    expect(ws.getCell("A1").value).toBe("Contains customer data: do not share");
    expect([ws.pageSetup.orientation, ws.pageSetup.fitToWidth, ws.pageSetup.fitToHeight, ws.pageSetup.printTitlesRow]).toEqual(["landscape", 1, 0, "4:4"]);
    expect(ws.headerFooter.oddFooter).toContain("Page &P of &N");
    if (ws.name !== "Definitions") expect(ws.autoFilter).toBeTruthy();
  }
  const s = wb.getWorksheet("Summary")!;
  expect((s.getRow(4).values as unknown[]).slice(-4)).toEqual(["Missed %", "Team avg missed %", "Won %", "Assist %"]);
  const sumRow = (name: string) => (dataRows(s).find((r) => String(r[0]).startsWith(name)) ?? []) as unknown[];
  const missedA = Number(sumRow("Employee A")[5]), wonB = Number(sumRow("Employee B")[7]), assistA = Number(sumRow("Employee A")[8]);
  const m = dataRows(wb.getWorksheet("Missed by me")!), w = dataRows(wb.getWorksheet("Won from others")!), a = dataRows(wb.getWorksheet("Assists")!);
  expect([m.filter((r) => r[0] === "Employee A").length, w.filter((r) => r[0] === "Employee B").length, a.filter((r) => r[0] === "Employee A").length]).toEqual([missedA, wonB, assistA]);
  expect(m[0].slice(1, 3)).toEqual(["Client 0", "'+919000000000"]);
  expect(m[0].slice(-4)).toEqual(["Employee B", "Connected", "2026-10-12", 7]);
  expect(String(s.getCell(`A${s.rowCount}`).value ?? "") + String(s.getCell(`A${s.rowCount - 1}`).value ?? "")).toContain("exactly as many rows as its count");
  const empA = dataRows(wb.getWorksheet("Employee A")!);
  expect([empA.filter((r) => r[0] === "Missed by me").length, empA.filter((r) => r[0] === "Assist").length]).toEqual([missedA, assistA]);
  expect(dataRows(wb.getWorksheet("All journeys")!).length).toBe(260);
  await expect(page.getByTestId("lj-excel-done")).toContainText("Lists match the counts.");
  // rows = drill-down count
  await page.getByTestId(desktop(info) ? `lj-cell-${A}-missed` : `lj-card-cell-${A}-missed`).click();
  await expect(page.getByTestId("lj-drill-total")).toContainText(`${missedA} lead`);
  await page.getByTestId("lj-drill-close").click();
  // per-employee option off: no person sheets
  await page.getByTestId("lj-per-employee").uncheck();
  const wb2 = await download(page, `${LJ_SHOTS}/sample-flat-${info.project.name}.xlsx`);
  expect(wb2.worksheets.map((x) => x.name)).toEqual(["Summary", "Missed by me", "Won from others", "Assists", "All journeys", "Definitions"]);
});

test("Excel big export: 500 at a time with progress, every lead, lists = counts", async ({ page, context }) => {
  ctx = await openReport(context, page, { api: 4, journey: { big: true } });
  await openJourney(page);
  const wb = await download(page, `${LJ_SHOTS}/sample-big.xlsx`);
  expect(journeyExportCalls(ctx).map((c) => [c.body.p_limit, c.body.p_offset])).toEqual([[500, 0], [500, 500], [500, 1000]]);
  expect(dataRows(wb.getWorksheet("All journeys")!).length).toBe(1234);
  await expect(page.getByTestId("lj-excel-done")).toContainText("1,234 leads");
  await expect(page.getByTestId("lj-excel-done")).toContainText("Lists match the counts.");
});

test("Excel stops half way: clear message (how far it got), no file", async ({ page, context }) => {
  ctx = await openReport(context, page, { api: 4, journey: { big: true }, journeyExportFailAt: 500 });
  await openJourney(page);
  let downloaded = false;
  page.on("download", () => (downloaded = true));
  await page.getByTestId("lj-excel-btn").click();
  await expect(page.getByTestId("lj-excel-error")).toContainText("Stopped after 500 of 1,234 leads");
  await expect(page.getByTestId("lj-excel-error")).toContainText("No file was made.");
  await page.waitForTimeout(500);
  expect(downloaded).toBe(false);
});

test("Excel on the older database (export function missing): lead id only, lists still = counts", async ({ page, context }) => {
  ctx = await openReport(context, page, { api: 4, journey: { consistent: true, exportMissing: true } });
  await openJourney(page);
  const wb = await download(page, `${LJ_SHOTS}/sample-fallback.xlsx`);
  expect(journeyRowCalls(ctx).map((c) => [c.body.p_view, c.body.p_limit, c.body.p_offset])).toEqual([["all", 500, 0]]);
  const all = dataRows(wb.getWorksheet("All journeys")!);
  expect([all.length, all[0][1]]).toEqual([260, ""]);
  const s = wb.getWorksheet("Summary")!;
  let txt = ""; s.eachRow((r) => (txt += String(r.getCell(1).value ?? "") + "\n"));
  expect(txt).toContain("need the latest database update");
  expect(txt).toContain("exactly as many rows as its count");
});

test("errors: a failed journey load shows a retry, never a blank page", async ({ page, context }) => {
  ctx = await openReport(context, page, { api: 4, journeyFail: true });
  await page.getByTestId("perf-tab-journey").click();
  await expect(page.getByTestId("lj-retry")).toBeVisible();
});

test("live data (local, read-only answer saved to a file): screenshots", async ({ page, context }, info) => {
  test.skip(!process.env.LJ_LIVE, "set LJ_LIVE to a saved live answer");
  ctx = await openReport(context, page, { api: 4 });
  await openJourney(page);
  await expect(page.getByTestId("lj-summary")).toBeVisible();
  await noSideScroll(page);
  await shot(page, "live-journey", info.project.name);
  await page.getByTestId(desktop(info) ? "lj-tile-missed" : "lj-tile-missed").click();
  await expect(page.getByTestId("lj-drill")).toBeVisible();
  await shot(page, "live-journey-drill", info.project.name);
});
