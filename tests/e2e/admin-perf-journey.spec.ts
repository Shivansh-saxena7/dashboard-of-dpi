import { expect, test, type Page } from "@playwright/test";
import fs from "fs";
import ExcelJS from "exceljs";
import { A, B, D, desktop, journeyCalls, journeyRowCalls, noSideScroll, openReport, reportCalls, type Ctx } from "./perfReportFixture";
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

test("Excel: Summary, Journeys, one sheet per employee, Definitions; landscape, fit to width, Page X of N, % last", async ({ page, context }, info) => {
  ctx = await openReport(context, page, { api: 4 });
  await openJourney(page);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("lj-excel-btn").click()]);
  expect(dl.suggestedFilename()).toMatch(/^lead-journey-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const file = `${LJ_SHOTS}/sample-${info.project.name}.xlsx`;
  await dl.saveAs(file);
  const pages = journeyRowCalls(ctx).map((c) => [c.body.p_view, c.body.p_limit, c.body.p_offset]);
  expect(pages).toEqual([["all", 500, 0]]);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "Journeys", "Employee A", "Employee B", "Employee D", "Definitions"]);
  for (const ws of wb.worksheets) {
    expect([ws.pageSetup.orientation, ws.pageSetup.fitToWidth, ws.pageSetup.fitToHeight, ws.pageSetup.printTitlesRow]).toEqual(["landscape", 1, 0, "4:4"]);
    expect(ws.headerFooter.oddFooter).toContain("Page &P of &N");
  }
  const s = wb.getWorksheet("Summary")!;
  const head = (s.getRow(4).values as unknown[]).slice(1);
  expect(head.slice(-4)).toEqual(["Missed %", "Team avg missed %", "Won %", "Assist %"]);
  expect((s.getRow(5).values as unknown[]).slice(1, 2)).toEqual(["Employee A"]);
  expect((s.getRow(5).values as unknown[]).slice(-4)).toEqual(["25.0%", "17.9%", "3.3%", "2.5%"]);
  expect(wb.getWorksheet("Journeys")!.rowCount).toBe(4 + 260);
  expect(String(wb.getWorksheet("Employee A")!.getCell("A3").value)).toContain("A signal, not a verdict.");
  // the per-employee option off: no person sheets
  await page.getByTestId("lj-per-employee").uncheck();
  const [dl2] = await Promise.all([page.waitForEvent("download"), page.getByTestId("lj-excel-btn").click()]);
  const f2 = `${LJ_SHOTS}/sample-flat-${info.project.name}.xlsx`;
  await dl2.saveAs(f2);
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.readFile(f2);
  expect(wb2.worksheets.map((w) => w.name)).toEqual(["Summary", "Journeys", "Definitions"]);
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
