import { expect, test } from "@playwright/test";
import path from "path";
import { A, B, C, SHOTS, desktop, drillCalls, noSideScroll, openReport, readDownload, reportCalls, total, type Ctx, type Row } from "./perfReportFixture";

// Admin Performance Report, simple view (2026-11-23; first build 2026-11-20): /admin/performance-report behind
// admin_report_mode. One main table (counts, then every % at the end), one-employee line, Split by, "More details"
// with the earlier sections, flat CSV, Journey per lead. Fake Supabase (tests/e2e/perfReportFixture.ts). Pixel 7,
// iPhone 14, desktop Chromium. The give-leads controls are tested in admin-perf-reassign.spec.ts.

const AXE = path.join(process.cwd(), "node_modules/axe-core/axe.min.js");
let ctx: Ctx;

for (const flag of ["off", "missing"] as const) {
  test(`flag ${flag}: the page stays hidden, no report is read, no menu link`, async ({ page, context }, info) => {
    ctx = await openReport(context, page, { flag });
    await expect(page.getByTestId("perf-hidden")).toBeVisible();
    await expect(page.getByTestId("perf-report")).toHaveCount(0);
    expect(reportCalls(ctx)).toBe(0);
    if (desktop(info)) await expect(page.getByTestId("nav-performance-report")).toHaveCount(0);
  });
}

test("menu: Performance Report link only while the flag is on, 44px, opens the page", async ({ page, context }, info) => {
  ctx = await openReport(context, page, { goto: "/admin/leaderboard" });
  if (!desktop(info)) await page.getByRole("button", { name: "Open menu" }).click();
  const link = page.getByTestId("nav-performance-report");
  await expect(link).toBeVisible();
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await link.click();
  await expect(page).toHaveURL(/\/admin\/performance-report$/);
  await expect(total(page, info)).toContainText("600");
});

for (const role of ["admin", "super_admin"] as const) {
  test(`main table (${role}): columns in order, % at the end, v3 call, chips send several values, no polling, screenshot`, async ({ page, context }, info) => {
    ctx = await openReport(context, page, { role });
    await expect(total(page, info)).toContainText("600");
    expect(ctx.calls.filter((c) => c.rpc.startsWith("get_perf_report")).every((c) => c.rpc === "get_perf_report_v3")).toBe(true);
    if (desktop(info)) {
      await expect(page.getByTestId("perf-main-pct-head")).toHaveText("% of leads given");
      const heads = await page.getByTestId("perf-main-table").locator("thead tr:last-child th").evaluateAll((els) => els.map((e) => e.getAttribute("data-label")));
      expect(heads).toEqual(["Employee", "Leads given", "Follow-ups", "Visits done", "Connected", "Converted", "Not interested", "Not connected",
        "Details shared (estimate)", "Follow-ups %", "Visits done %", "Connected %", "Converted %", "Not interested %", "Not connected %", "Details shared %"]);
      for (const [k, v] of [["leads", "400"], ["followup", "30"], ["visit", "6"], ["connected", "120"], ["converted", "3"], ["not_interested", "70"], ["not_connected", "160"], ["details_est", "5"]])
        await expect(page.getByTestId(`perf-main-cell-${A}-${k}`)).toHaveText(v);
      for (const [k, v] of [["followup", "7.5%"], ["visit", "1.5%"], ["connected", "30.0%"], ["converted", "0.8%"]]) await expect(page.getByTestId(`perf-main-pct-${A}-${k}`)).toHaveText(v);
      await expect(page.getByTestId("perf-main-total")).toContainText("190");
    } else {
      await expect(page.getByTestId("perf-main-table")).toBeHidden();
      await expect(page.getByTestId(`perf-main-card-cell-${A}-connected`)).toHaveText(/Connected\s*120\s*30\.0%/);
      await expect(page.getByTestId(`perf-main-card-cell-${A}-details_est`)).toContainText("Details shared (estimate)");
    }
    await page.waitForTimeout(600);
    const first = reportCalls(ctx);
    expect(first).toBeGreaterThanOrEqual(1);
    expect(first).toBeLessThanOrEqual(2); // React dev StrictMode runs the first effect twice
    await page.getByTestId("perf-chip-type-DATA").click();
    await expect.poll(() => reportCalls(ctx)).toBe(first + 1);
    expect(ctx.calls.at(-1)!.body.p_filters).toEqual({ lead_types: ["DATA"] });
    await page.getByTestId("perf-chip-origin-FRESH").click();
    await page.getByTestId("perf-chip-origin-ADMIN_GIVEN").click();
    await expect.poll(() => reportCalls(ctx)).toBe(first + 3);
    expect(ctx.calls.at(-1)!.body.p_filters).toEqual({ lead_types: ["DATA"], origins: ["FRESH", "ADMIN_GIVEN"] });
    await expect(page.getByTestId("perf-chip-origin-FRESH")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("perf-tag-origins")).toContainText("Fresh, Given by admin");
    await page.screenshot({ path: `${SHOTS}/simple-chips-${role}-${info.project.name}.png`, fullPage: true });
    await page.getByTestId("perf-clear").click();
    await expect.poll(() => reportCalls(ctx)).toBe(first + 4);
    expect(ctx.calls.at(-1)!.body.p_filters).toEqual({});
    await page.waitForTimeout(3000);
    expect(reportCalls(ctx)).toBe(first + 4); // no polling
    if (role === "admin") await page.screenshot({ path: `${SHOTS}/simple-default-${info.project.name}.png`, fullPage: true });
  });
}

test("multi-select: two employees and two sources in one call each (request body, not URL), tags, Reset", async ({ page, context }, info) => {
  ctx = await openReport(context, page);
  await expect(total(page, info)).toContainText("600");
  const before = reportCalls(ctx);
  await page.getByTestId("perf-ms-employee").click();
  const opts = page.getByTestId("perf-ms-employee-opt");
  await opts.nth(0).check();
  await opts.nth(1).check();
  await expect(page.getByTestId("perf-ms-employee-panel")).toContainText("(inactive)");
  expect(reportCalls(ctx)).toBe(before); // nothing until Done
  await page.getByTestId("perf-ms-employee-done").click();
  await expect.poll(() => reportCalls(ctx)).toBe(before + 1);
  expect((ctx.calls.at(-1)!.body.p_filters as Row).employee_ids).toEqual([A, B]);
  await expect(page.getByTestId("perf-ms-employee")).toHaveText(/2 selected/);
  await expect(page.getByTestId("perf-tag-employee")).toContainText("Employee A, Employee B");
  await expect(total(page, info)).toContainText("650");
  await expect(page.getByTestId("perf-summary")).toHaveCount(0); // two people: no one-person line
  await page.getByTestId("perf-ms-source").click();
  await page.getByTestId("perf-ms-source-opt").nth(0).check();
  await page.getByTestId("perf-ms-source-opt").nth(1).check();
  await page.getByTestId("perf-ms-source-done").click();
  await expect.poll(() => reportCalls(ctx)).toBe(before + 2);
  expect((ctx.calls.at(-1)!.body.p_filters as Row).sources).toEqual(["99acres", "Meta"]);
  expect(ctx.calls.every((c) => !c.url.includes("employee_ids") && !c.url.includes(A))).toBe(true);
  await page.getByTestId("perf-tag-source").click(); // removing one tag removes that filter only
  await expect.poll(() => reportCalls(ctx)).toBe(before + 3);
  expect(ctx.calls.at(-1)!.body.p_filters).toEqual({ employee_ids: [A, B] });
  await page.getByTestId("perf-clear").click();
  await expect.poll(() => reportCalls(ctx)).toBe(before + 4);
  expect(ctx.calls.at(-1)!.body.p_filters).toEqual({});
});

test("one employee chosen: plain-English line with counts and %, screenshot", async ({ page, context }, info) => {
  ctx = await openReport(context, page);
  await expect(total(page, info)).toContainText("600");
  await page.getByTestId("perf-ms-employee").click();
  await page.getByTestId("perf-ms-employee-opt").nth(0).check();
  await page.getByTestId("perf-ms-employee-done").click();
  await expect(page.getByTestId("perf-summary")).toHaveText(
    /^Employee A was given 400 leads \(50 fresh, 230 recycled, 120 other\) in .+: 30 follow-ups \(7\.5%\), 6 visits \(1\.5%\), 120 connected \(30\.0%\), 3 converted \(0\.8%\), 70 not interested \(17\.5%\), 160 not connected \(40\.0%\); details shared to about 5 \(estimate\)\.$/);
  await page.screenshot({ path: `${SHOTS}/simple-one-employee-${info.project.name}.png`, fullPage: true });
});

test("split by Given as and by Source: rows under each employee; a split cell filters both", async ({ page, context }, info) => {
  ctx = await openReport(context, page);
  await expect(total(page, info)).toContainText("600");
  const before = reportCalls(ctx);
  await page.getByTestId("perf-split-origin").click();
  expect(reportCalls(ctx)).toBe(before); // splitting needs no new call
  if (desktop(info)) {
    await expect(page.getByTestId(`perf-split-row-${A}-RECYCLED`)).toContainText("Recycled");
    await expect(page.getByTestId(`perf-split-row-${A}-RECYCLED`)).toContainText("230");
    await page.getByTestId(`perf-split-row-${A}-RECYCLED`).getByRole("button").nth(2).click(); // Visits done
    await expect.poll(() => drillCalls(ctx).length).toBe(1);
    expect(drillCalls(ctx)[0].body).toMatchObject({ p_metric: "visit", p_filters: { employee_ids: [A], origins: ["RECYCLED"] } });
    await page.getByTestId("perf-drill-close").click();
    await page.getByTestId("perf-split-source").click();
    await expect(page.getByTestId(`perf-split-row-${A}-Meta`)).toContainText("100");
  } else {
    await expect(page.getByTestId(`perf-main-card-split-${A}`)).toContainText("Recycled: 230 leads");
    await page.getByTestId("perf-split-source").click();
    await expect(page.getByTestId(`perf-main-card-split-${A}`)).toContainText("Meta: 100 leads");
  }
  await page.screenshot({ path: `${SHOTS}/simple-split-${info.project.name}.png`, fullPage: true });
});

test("desktop sorts by any count column; phone shows one card per employee", async ({ page, context }, info) => {
  ctx = await openReport(context, page);
  await expect(total(page, info)).toContainText("600");
  if (desktop(info)) {
    await page.getByTestId("perf-sort-name").click();
    await expect(page.locator('[data-testid^="perf-main-row-"]').first()).toHaveAttribute("data-testid", `perf-main-row-${A}`);
    await page.getByTestId("perf-sort-name").click();
    await expect(page.locator('[data-testid^="perf-main-row-"]').first()).toHaveAttribute("data-testid", `perf-main-row-${C}`);
    await page.getByTestId("perf-sort-connected").click();
    await expect(page.locator('[data-testid^="perf-main-row-"]').first()).toHaveAttribute("data-testid", `perf-main-row-${A}`);
    await expect(page.getByTestId(`perf-main-row-${B}`)).toContainText("(inactive)");
  } else {
    await expect(page.locator('[data-testid^="perf-main-card-"][data-testid$="' + A + '"]').first()).toBeVisible();
    expect(await page.locator(`[data-testid="perf-main-card-${A}"], [data-testid="perf-main-card-${B}"], [data-testid="perf-main-card-${C}"]`).count()).toBe(3);
  }
});

test("More details: closed by default; opens the earlier tiles, % view, employee x source and mixes", async ({ page, context }, info) => {
  ctx = await openReport(context, page);
  await expect(total(page, info)).toContainText("600");
  await expect(page.getByTestId("perf-more-body")).toHaveCount(0);
  await expect(page.getByTestId("perf-tile-leads")).toHaveCount(0);
  await page.getByTestId("perf-more-toggle").click();
  await expect(page.getByTestId("perf-tile-leads")).toContainText("600");
  await expect(page.getByTestId("perf-tile-recycled_any-pct")).toHaveText("80.0% of leads");
  await expect(page.getByTestId("perf-tile-details_est")).toContainText("Estimate");
  await expect(page.getByTestId("perf-es-grand")).toContainText("650");
  await page.getByTestId("perf-view-pct").click();
  await expect(page.getByTestId("perf-src-cell-Meta-visit")).toHaveText("1.3%");
  await expect(page.getByTestId("perf-src-cell-Other: NewPortal-visit")).toHaveText("–");
  await expect(page.getByTestId("perf-mix-col-status_mix-CALLBACK_LATER")).toContainText("Callback later");
  await expect(page.getByTestId(`perf-mix-cell-status_mix-${A}-NOT_CONNECTED`)).toHaveText("37.5%");
  await expect(page.getByTestId("perf-status-mix-label")).toHaveText("Final status of each lead in this period (last result)");
  await page.getByTestId(`perf-es-cell-${A}-Meta-came_recycled`).click();
  await expect.poll(() => drillCalls(ctx).length).toBe(1);
  expect(drillCalls(ctx)[0].body).toMatchObject({ p_metric: "came:RECYCLED", p_filters: { employee_ids: [A], sources: ["Meta"] } });
  await page.getByTestId("perf-drill-close").click();
  await noSideScroll(page);
  await page.screenshot({ path: `${SHOTS}/simple-more-details-${info.project.name}.png`, fullPage: true });
});

test("drill-down: 200 per page, Load more, CSV header + rows only (paged), Journey per lead, screenshots", async ({ page, context }, info) => {
  ctx = await openReport(context, page);
  await expect(total(page, info)).toContainText("600");
  await page.getByTestId(desktop(info) ? `perf-main-cell-${A}-visit` : `perf-main-card-cell-${A}-visit`).click();
  const sheet = page.getByTestId("perf-drill");
  await expect(sheet.getByTestId("perf-drill-row")).toHaveCount(200);
  await expect(sheet).toContainText("450 leads");
  await expect(sheet.getByTestId("perf-drill-check")).toHaveCount(0); // give controls are off
  expect(drillCalls(ctx)[0]).toMatchObject({ rpc: "get_perf_report_leads_v3", body: { p_metric: "visit", p_filters: { employee_ids: [A] } } });
  await page.screenshot({ path: `${SHOTS}/simple-drill-${info.project.name}.png` });
  await sheet.getByTestId("perf-drill-more").click();
  await expect(sheet.getByTestId("perf-drill-row")).toHaveCount(400);
  const before = drillCalls(ctx).length;
  const { name, text } = await readDownload(page, () => sheet.getByTestId("perf-drill-csv").click());
  expect(name).toMatch(/^performance-report-leads-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/);
  const lines = text.trim().split("\n");
  expect(lines[0]).toBe("Lead,Employee,Type,Source,Project,Given as,Given on (IST),Last result,Stage");
  expect(lines.length).toBe(1 + 450);
  expect(text).toContain("Lead 1449,Employee A,LEAD,99acres,P1,Recycled,2026-10-12,Connected,Visit");
  expect(drillCalls(ctx).slice(before).map((c) => [c.body.p_metric, c.body.p_offset, c.body.p_limit])).toEqual([["visit", 0, 200], ["visit", 200, 200], ["visit", 400, 200]]);
  await sheet.getByTestId("perf-drill-journey").first().click();
  const j = page.getByTestId("perf-journey");
  await expect(j.getByTestId("perf-journey-stint")).toHaveCount(3);
  await expect(j.getByTestId("perf-journey-stint").nth(0)).toContainText("Employee B · Fresh");
  await expect(j.getByTestId("perf-journey-stint").nth(2)).toContainText("Employee D · Given by admin");
  await expect(j.getByTestId("perf-journey-admin")).toHaveCount(0); // batch tags only with the give controls on
  expect(ctx.calls.some((c) => c.rpc === "get_lead_report_batches")).toBe(false);
  await page.screenshot({ path: `${SHOTS}/simple-journey-${info.project.name}.png` });
  await page.getByTestId("perf-journey-close").click();
  await sheet.getByTestId("perf-drill-close").click();
  await expect(sheet).toHaveCount(0);
});

test("page CSV: one flat table exactly like the screen (same columns and order, % at the end)", async ({ page, context }, info) => {
  ctx = await openReport(context, page);
  await expect(total(page, info)).toContainText("600");
  const { name, text } = await readDownload(page, () => page.getByTestId("perf-csv").click());
  expect(name).toBe("performance-report-2026-10-01-to-2026-10-31.csv");
  expect(text.trim().split("\n")).toEqual([
    "Employee,Leads given,Follow-ups,Visits done,Connected,Converted,Not interested,Not connected,Details shared (estimate),Follow-ups %,Visits done %,Connected %,Converted %,Not interested %,Not connected %,Details shared %",
    "Employee A,400,30,6,120,3,70,160,5,7.5%,1.5%,30.0%,0.8%,17.5%,40.0%,1.3%",
    "Employee B,250,12,2,70,1,40,90,2,4.8%,0.8%,28.0%,0.4%,16.0%,36.0%,0.8%",
    "Employee C,0,0,0,0,0,0,0,0,–,–,–,–,–,–,–",
    "Total,600,42,8,190,4,110,250,7,7.0%,1.3%,31.7%,0.7%,18.3%,41.7%,1.2%"
  ]);
  await page.getByTestId("perf-split-origin").click();
  const split = (await readDownload(page, () => page.getByTestId("perf-csv").click())).text.trim().split("\n");
  expect(split[0].startsWith("Employee,Given as,Leads given,")).toBe(true);
  expect(split.slice(1, 5).map((l) => l.split(",").slice(0, 3).join(","))).toEqual(["Employee A,Fresh,50", "Employee A,Recycled,230", "Employee A,Other,120", "Employee A,All,400"]);
});

test("range: over 800 days shows a clear message and asks nothing; future days say no data yet", async ({ page, context }, info) => {
  ctx = await openReport(context, page);
  await expect(total(page, info)).toContainText("600");
  await page.getByTestId("perf-preset-custom").click();
  const from = page.getByTestId("perf-custom-from"), to = page.getByTestId("perf-custom-to");
  await from.fill("2026-11-01");
  await to.fill("2026-12-31");
  await expect(page.getByTestId("perf-range-note")).toHaveText(/No data yet after today/);
  await expect(to).toHaveAttribute("max", "2029-01-09");
  await page.waitForTimeout(1200);
  const before = reportCalls(ctx);
  await from.fill("2024-01-01");
  await expect(page.getByTestId("perf-range-problem")).toContainText("Please choose a range of 800 days or less.");
  await page.waitForTimeout(800);
  expect(reportCalls(ctx)).toBe(before);
  await expect(page.getByTestId("perf-csv")).toBeDisabled();
  await from.fill("2027-01-01");
  await to.fill("2027-01-31");
  await expect(page.getByTestId("perf-range-note")).toContainText("No data yet: these dates are in the future.");
});

for (const api of [2, 1] as const) {
  test(`v3 not applied yet: falls back to v${api} with a note, no Connected column, journey hidden`, async ({ page, context }, info) => {
    ctx = await openReport(context, page, { api });
    await expect(total(page, info)).toContainText("600");
    await expect(page.getByTestId("perf-v1-note")).toBeVisible();
    if (desktop(info)) {
      await expect(page.getByTestId("perf-main-table")).not.toContainText("Connected");
      await expect(page.getByTestId(`perf-main-cell-${A}-visit`)).toHaveText("6");
    } else await expect(page.getByTestId(`perf-main-card-cell-${A}-connected`)).toHaveCount(0);
    await expect(page.getByTestId("perf-split-origin")).toBeDisabled();
    expect(ctx.calls.some((c) => c.rpc === (api === 2 ? "get_perf_report_v2" : "get_perf_report"))).toBe(true);
    await page.getByTestId("perf-chip-type-LEAD").click();
    await expect.poll(() => (ctx.calls.at(-1)!.body.p_filters as Row)?.lead_type).toBe("LEAD");
    await page.getByTestId(desktop(info) ? `perf-main-cell-${A}-visit` : `perf-main-card-cell-${A}-visit`).click();
    await expect.poll(() => drillCalls(ctx).some((c) => c.rpc === (api === 2 ? "get_perf_report_leads_v2" : "get_perf_report_leads"))).toBe(true);
    await expect(page.getByTestId("perf-drill-row").first()).toBeVisible();
    await expect(page.getByTestId("perf-drill-journey")).toHaveCount(0);
  });
}

test("v4 (exact history) applied: definitions v2, v4 calls, drill rows show the date the result happened", async ({ page, context }, info) => {
  ctx = await openReport(context, page, { api: 4 });
  await expect(total(page, info)).toContainText("600");
  await expect(page.getByTestId("perf-asof")).toContainText("Definitions v2");
  if (desktop(info)) {
    await expect(page.getByTestId("perf-main-pct-head")).toHaveText("% of leads handled");
    await expect(page.getByTestId(`perf-main-cell-${A}-leads_handled`)).toHaveText("420");
    await expect(page.getByTestId(`perf-main-pct-${A}-visit`)).toHaveText("1.4%"); // 6 of 420 handled, not of 400 given
  } else await expect(page.getByTestId(`perf-main-card-cell-${A}-visit`)).toContainText("1.4%");
  const csv = (await readDownload(page, () => page.getByTestId("perf-csv").click())).text.trim().split("\n");
  expect(csv[0]).toContain("Leads given,Leads handled,Follow-ups");
  expect(csv[0]).toContain("Visits done (% of leads handled)");
  expect(csv[1].startsWith("Employee A,400,420,")).toBe(true);
  expect(ctx.calls.filter((c) => c.rpc.startsWith("get_perf_report")).every((c) => c.rpc === "get_perf_report_v4")).toBe(true);
  await page.getByTestId(desktop(info) ? `perf-main-cell-${A}-visit` : `perf-main-card-cell-${A}-visit`).click();
  await expect(page.getByTestId("perf-drill-row").first()).toContainText("On 20 Oct");
  expect(drillCalls(ctx)[0].rpc).toBe("get_perf_report_leads_v4");
});

test("report failing: error text + Retry, the error is reported, Retry loads", async ({ page, context }, info) => {
  ctx = await openReport(context, page, { fail: true });
  await expect(page.getByTestId("perf-retry")).toHaveText("Couldn't load the report. Tap to try again.");
  await expect.poll(() => ctx.state.anomalies.some((a) => String(a.message).startsWith("perf-report:load"))).toBe(true);
  await page.getByTestId("perf-retry").click();
  await expect(total(page, info)).toContainText("600");
});

test("axe (contrast, target size), no horizontal scroll, Connected and Visits definitions", async ({ page, context }, info) => {
  ctx = await openReport(context, page);
  await expect(total(page, info)).toContainText("600");
  await page.waitForTimeout(400);
  await noSideScroll(page);
  await page.addScriptTag({ path: AXE });
  const axe = async () => page.evaluate(async () => {
    const w = window as unknown as { axe: { run: (c: Element, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } };
    const res = await w.axe.run(document.querySelector('[data-testid="perf-report"]') as Element, { runOnly: { type: "rule", values: ["color-contrast", "target-size"] } });
    return res.violations.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(" ")).slice(0, 4).join(", ")}`);
  });
  expect(await axe()).toEqual([]);
  await page.getByRole("button", { name: "About Connected", exact: true }).click();
  await expect(page.getByTestId("perf-def")).toContainText("The client was reached during the assignment");
  await page.getByTestId("perf-def-close").click();
  await page.getByTestId("perf-more-toggle").click();
  await expect(page.getByTestId("perf-tile-leads")).toBeVisible();
  await noSideScroll(page);
  expect(await axe()).toEqual([]);
  await page.getByRole("button", { name: "About Visits", exact: true }).click();
  await expect(page.getByTestId("perf-def")).toContainText("One lead counts once.");
  await page.getByTestId("perf-def-close").click();
  await page.getByRole("button", { name: "About Converted", exact: true }).click();
  await expect(page.getByTestId("perf-def-converted-note")).toHaveText("Tile counts leads ever marked Converted; the mix shows each lead's final status, so the two can differ.");
});
