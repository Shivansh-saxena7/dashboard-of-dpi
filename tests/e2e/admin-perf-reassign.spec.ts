import { expect, test, type Page } from "@playwright/test";
import path from "path";
import { A, D, SHOTS, desktop, noSideScroll, openReport, total, type Ctx, type Row } from "./perfReportFixture";

// Performance Report: give leads from the report (2026-11-23), behind admin_report_reassign_mode. Fake Supabase
// (tests/e2e/perfReportFixture.ts): the SQL guards themselves are tested in PGlite; here the page must preview before
// anything moves, send at most 200 leads a call in the request body with one idempotency key per page, keep positive
// leads out unless ticked, and show the result, the journey's admin tags, the batch before / after and undo.
// Pixel 7, iPhone 14, desktop Chromium.

const AXE = path.join(process.cwd(), "node_modules/axe-core/axe.min.js");
let ctx: Ctx;
const giveCalls = () => ctx.calls.filter((c) => c.rpc === "admin_reassign_leads_from_report");
const previewCalls = () => ctx.calls.filter((c) => c.rpc === "admin_report_reassign_preview");
const writeRpcs = () => ctx.calls.filter((c) => /^admin_/.test(c.rpc));

async function openVisits(page: Page, info: { project: { name: string } }) {
  await expect(total(page, info)).toContainText("600");
  await page.getByTestId(desktop(info) ? `perf-main-cell-${A}-visit` : `perf-main-card-cell-${A}-visit`).click();
  const sheet = page.getByTestId("perf-drill");
  await expect(sheet.getByTestId("perf-drill-row")).toHaveCount(200);
  return sheet;
}

test("flag off: no select boxes, no Give buttons, no batches, no write RPC", async ({ page, context }, info) => {
  ctx = await openReport(context, page, { reassign: "off" });
  const sheet = await openVisits(page, info);
  await expect(sheet.getByTestId("perf-drill-check")).toHaveCount(0);
  await expect(sheet.getByTestId("perf-drill-select-all")).toHaveCount(0);
  await expect(page.getByTestId("perf-batches")).toHaveCount(0);
  expect(writeRpcs()).toEqual([]);
});

test("give 2 leads: preview first (no write), reason needed, then one call with the owner the admin saw; screenshots", async ({ page, context }, info) => {
  ctx = await openReport(context, page, { reassign: "on" });
  const sheet = await openVisits(page, info);
  await sheet.getByTestId("perf-drill-check").nth(0).check();
  await sheet.getByTestId("perf-drill-check").nth(2).check();
  await expect(sheet.getByTestId("perf-drill-selected")).toHaveText("2 selected");
  await sheet.getByTestId("perf-drill-give").click();
  const give = page.getByTestId("perf-give");
  await expect(give.getByTestId("perf-give-warning")).toContainText("This is a deliberate admin decision.");
  await expect(give.getByTestId("perf-give-warning")).toContainText("The employee sees only “Given by admin”.");
  await give.getByTestId("perf-give-to").selectOption(D);
  await expect(give.getByTestId("perf-give-will-move")).toHaveText("2");
  await expect(give.getByTestId("perf-give-from")).toHaveText("Employee A (2)");
  await expect(give.getByTestId("perf-give-positive")).toHaveText("0 left out");
  expect(giveCalls()).toHaveLength(0); // preview only
  expect(previewCalls().at(-1)!.body).toEqual({ p_items: [{ lead_id: "00000000-0000-4000-9000-000000000000", expected_owner: A }, { lead_id: "00000000-0000-4000-9000-000000000002", expected_owner: A }],
    p_to_employee: D, p_mode: "give", p_include_positive: false });
  await expect(give.getByTestId("perf-give-confirm")).toBeDisabled(); // no reason yet
  await give.getByTestId("perf-give-reason").fill("No visits in 3 weeks");
  await give.getByTestId("perf-give-label").fill("Oct visits to D");
  await expect(give.getByTestId("perf-give-confirm")).toBeEnabled();
  await noSideScroll(page);
  await page.screenshot({ path: `${SHOTS}/give-confirm-${info.project.name}.png` });
  await give.getByTestId("perf-give-confirm").click();
  await expect(give.getByTestId("perf-give-result-line")).toContainText("1 moved to Employee D, 1 skipped.");
  await expect(give.getByTestId("perf-give-result-skips")).toContainText("Skipped 1: Owner changed since the list was opened");
  await expect(give.getByTestId("perf-give-batches")).toContainText("Batch b0000001");
  const call = giveCalls()[0];
  expect(call.body).toMatchObject({ p_to_employee: D, p_mode: "give", p_reason: "No visits in 3 weeks", p_label: "Oct visits to D", p_include_positive: false });
  expect(String(call.body.p_idempotency_key)).toMatch(/-0$/);
  expect(call.url).not.toContain("0000-4000-9000"); // lead ids only in the body
  await page.screenshot({ path: `${SHOTS}/give-result-${info.project.name}.png` });
  const reportsBefore = ctx.calls.filter((c) => c.rpc === "get_perf_report_v3").length;
  await give.getByTestId("perf-give-done").click();
  await expect.poll(() => ctx.calls.filter((c) => c.rpc === "get_perf_report_v3").length).toBeGreaterThan(reportsBefore); // numbers reload
});

test("select all 450: preview and give go in pages of 200 / 200 / 50, one run key, a key per page", async ({ page, context }, info) => {
  ctx = await openReport(context, page, { reassign: "on" });
  const sheet = await openVisits(page, info);
  await sheet.getByTestId("perf-drill-select-all").click();
  await expect(sheet.getByTestId("perf-drill-selected")).toHaveText("450 selected");
  await expect(sheet.getByTestId("perf-drill-select-all")).toHaveText("Clear selection");
  await sheet.getByTestId("perf-drill-give").click();
  const give = page.getByTestId("perf-give");
  await give.getByTestId("perf-give-to").selectOption(D);
  await expect(give.getByTestId("perf-give-will-move")).toHaveText("240"); // 450 - 90 owner changed - 120 positive (of the rest)
  expect(previewCalls().map((c) => (c.body.p_items as unknown[]).length)).toEqual([200, 200, 50]);
  await expect(give.getByTestId("perf-give-skips")).toContainText("Skipped 90: Owner changed since the list was opened");
  await expect(give.getByTestId("perf-give-from")).toHaveText("Employee A (360), Employee B (90)");
  await give.getByTestId("perf-give-reason").fill("Rebalance after leave");
  await give.getByTestId("perf-give-confirm").click();
  await expect(give.getByTestId("perf-give-result-line")).toContainText("447 moved to Employee D, 3 skipped.");
  const keys = giveCalls().map((c) => String(c.body.p_idempotency_key));
  expect(giveCalls().map((c) => (c.body.p_items as unknown[]).length)).toEqual([200, 200, 50]);
  expect(keys.map((k) => k.slice(-2))).toEqual(["-0", "-1", "-2"]);
  expect(new Set(keys.map((k) => k.slice(0, -2))).size).toBe(1);
  await expect(give.getByTestId("perf-give-batches")).toContainText("Batch b0000001, b0000002, b0000003");
});

test("include positive leads: counted separately and sent only when ticked", async ({ page, context }, info) => {
  ctx = await openReport(context, page, { reassign: "on" });
  const sheet = await openVisits(page, info);
  for (const i of [0, 1, 2]) await sheet.getByTestId("perf-drill-check").nth(i).check();
  await expect(sheet.getByTestId("perf-drill-row").nth(1)).toContainText("Positive");
  await sheet.getByTestId("perf-drill-give").click();
  const give = page.getByTestId("perf-give");
  await give.getByTestId("perf-give-to").selectOption(D);
  await expect(give.getByTestId("perf-give-positive")).toHaveText("1 left out");
  await expect(give.getByTestId("perf-give-will-move")).toHaveText("2");
  await give.getByTestId("perf-give-incpos").check();
  await expect(give.getByTestId("perf-give-positive")).toHaveText("1 included");
  await expect(give.getByTestId("perf-give-will-move")).toHaveText("3");
  expect(previewCalls().at(-1)!.body.p_include_positive).toBe(true);
  await give.getByTestId("perf-give-reason").fill("Positive ones too, owner left");
  await give.getByTestId("perf-give-confirm").click();
  await expect(give.getByTestId("perf-give-result-line")).toBeVisible();
  expect(giveCalls()[0].body.p_include_positive).toBe(true);
});

test("give back to the row's employee: no picker, mode give_back", async ({ page, context }, info) => {
  ctx = await openReport(context, page, { reassign: "on" });
  const sheet = await openVisits(page, info);
  await sheet.getByTestId("perf-drill-check").nth(0).check();
  await expect(sheet.getByTestId("perf-drill-give-back")).toHaveText("Give back to Employee A");
  await sheet.getByTestId("perf-drill-give-back").click();
  const give = page.getByTestId("perf-give");
  await expect(give).toContainText("Give 1 leads back to Employee A");
  await expect(give.getByTestId("perf-give-to")).toHaveCount(0);
  await expect.poll(() => previewCalls().at(-1)?.body.p_mode).toBe("give_back");
  expect(previewCalls().at(-1)!.body.p_to_employee).toBe(A);
});

test("receiver cannot take leads (e.g. on leave): clear message, confirm stays off", async ({ page, context }, info) => {
  ctx = await openReport(context, page, { reassign: "on", receiverProblem: "receiver is on leave today" });
  const sheet = await openVisits(page, info);
  await sheet.getByTestId("perf-drill-check").nth(0).check();
  await sheet.getByTestId("perf-drill-give").click();
  const give = page.getByTestId("perf-give");
  await give.getByTestId("perf-give-to").selectOption(D);
  await expect(give.getByTestId("perf-give-receiver")).toContainText("Can't give to Employee D: receiver is on leave today.");
  await give.getByTestId("perf-give-reason").fill("Trying anyway here");
  await expect(give.getByTestId("perf-give-confirm")).toBeDisabled();
  expect(giveCalls()).toHaveLength(0);
});

test("journey with admin tags: who had it, the batch with reason and label, then the new owner; screenshot", async ({ page, context }, info) => {
  ctx = await openReport(context, page, { reassign: "on" });
  const sheet = await openVisits(page, info);
  await sheet.getByTestId("perf-drill-journey").first().click();
  const j = page.getByTestId("perf-journey");
  await expect(j.getByTestId("perf-journey-stint")).toHaveCount(3);
  await expect(j.getByTestId("perf-journey-admin")).toHaveText(/Given by admin to Employee D · 24 Oct · “Oct visits to D”\s*Reason: No visits in 3 weeks/);
  await expect(j.getByTestId("perf-journey-stint").nth(1)).toContainText("Not interested");
  await noSideScroll(page);
  await page.screenshot({ path: `${SHOTS}/give-journey-${info.project.name}.png` });
});

test("batches: before / after for a batch, undo needs a reason and sends one key; screenshot", async ({ page, context }, info) => {
  ctx = await openReport(context, page, { reassign: "on" });
  await expect(total(page, info)).toContainText("600");
  await page.getByTestId("perf-batch-row").first().click();
  const b = page.getByTestId("perf-batch");
  await expect(b.getByTestId("perf-batch-table")).toContainText("Before · Employee A");
  await expect(b.getByTestId("perf-batch-line")).toHaveText(/With Employee A: 0 follow-ups, 0 visits, 1 connected, 0 converted\.\s+Given to Employee D: 3 follow-ups, 2 visits, 6 connected, 1 converted\./);
  await noSideScroll(page);
  await page.screenshot({ path: `${SHOTS}/give-batch-${info.project.name}.png` });
  await b.getByTestId("perf-batch-undo").click();
  await expect(b.getByTestId("perf-batch-undo-confirm")).toBeDisabled();
  await b.getByTestId("perf-batch-undo-reason").fill("Wrong receiver");
  await b.getByTestId("perf-batch-undo-confirm").click();
  await expect(b.getByTestId("perf-batch-undo-result")).toContainText("4 given back, 5 stayed (5 the new owner already worked on it).");
  const undo = ctx.calls.filter((c) => c.rpc === "admin_undo_report_batch");
  expect(undo).toHaveLength(1);
  expect(undo[0].body).toMatchObject({ p_batch_id: "b0000001-0000-4000-8000-000000000001", p_reason: "Wrong receiver" });
});

test("axe on the confirm sheet (contrast, target size)", async ({ page, context }, info) => {
  ctx = await openReport(context, page, { reassign: "on" });
  const sheet = await openVisits(page, info);
  await sheet.getByTestId("perf-drill-check").nth(0).check();
  await sheet.getByTestId("perf-drill-give").click();
  await page.getByTestId("perf-give-to").selectOption(D);
  await expect(page.getByTestId("perf-give-will-move")).toHaveText("1");
  await page.addScriptTag({ path: AXE });
  const v = await page.evaluate(async () => {
    const w = window as unknown as { axe: { run: (c: Element, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } };
    const res = await w.axe.run(document.querySelector('[data-testid="perf-give"]') as Element, { runOnly: { type: "rule", values: ["color-contrast", "target-size"] } });
    return res.violations.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(" ")).slice(0, 4).join(", ")}`);
  });
  expect(v).toEqual([]);
  expect((ctx.calls as { body: Row }[]).length).toBeGreaterThan(0);
});
