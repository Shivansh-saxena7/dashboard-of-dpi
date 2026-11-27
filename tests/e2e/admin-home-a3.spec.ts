import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import path from "path";
import { mockSupabase, type MockState } from "./mockSupabase";

// Admin Home A3 (2026-11-19), admin_home_mode on only: "Lead engine today" (recycled, positive-junk refusals, given-back
// protections, guard / hold events, each vs yesterday at this time) and positive-history junk counted only on "Check"
// (then a Needs action row, hidden at 0). Fixed clock: Thu 19 Nov 2026, 14:00 IST. Pixel 7, iPhone 14, desktop.

const SHOTS = "C:/work/reports/admin_a3";
const AXE = path.join(process.cwd(), "node_modules/axe-core/axe.min.js");
const NOW = Date.parse("2026-11-19T14:00:00+05:30");
const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60000;
const DAY = 86400e3;

let state: MockState;

async function setup(context: BrowserContext, page: Page, role: "admin" | "super_admin" = "admin") {
  await page.clock.setFixedTime(new Date(NOW));
  state = await mockSupabase(context);
  state.employee.role = role;
  state.employee.department = null;
  state.settings.admin_home_mode = "on";
  state.heartbeats = [{ function_name: "recycle-stale-leads", max_silence_minutes: 30, last_succeeded_at: iso(NOW - 5 * MIN) }];
  state.backups = [{ run_at: iso(NOW - 8 * 3600e3), status: "SUCCESS" }];
  state.recycles = [iso(NOW - 5 * MIN), iso(NOW - 50 * MIN), iso(NOW - 90 * MIN), ...[1, 2, 3, 4, 5].map((i) => iso(NOW - DAY - i * MIN)), iso(NOW - DAY + 30 * MIN)];
  const ev = (ms: number, source: string, action: string) => ({ created_at: iso(ms), source, action });
  state.guardEvents = [
    ...[1, 2, 3, 4].map((i) => ev(NOW - i * MIN, "db_positive_junk_guard", "JUNK_REFUSED")),
    ev(NOW - 10 * MIN, "reminder_hold", "REMINDER_HOLD"),
    ev(NOW - 11 * MIN, "reminder_hold", "REMINDER_HOLD"),
    ev(NOW - 12 * MIN, "db_sibling_guard", "RECYCLE_REFUSED"),
    ev(NOW - DAY - MIN, "db_positive_junk_guard", "JUNK_REFUSED"),
    ev(NOW - DAY - 2 * MIN, "db_positive_junk_guard", "JUNK_REFUSED")
  ];
  state.restoreRows = [
    { protected_until: "2026-12-02T08:47:00Z", restored_at: iso(NOW - DAY - 3 * 3600e3), undone_at: null },
    { protected_until: "2026-11-25T00:00:00Z", restored_at: iso(NOW - 2 * 3600e3), undone_at: null }
  ];
  state.positiveJunk = { rows: [{ lead_id: "a" }, { lead_id: "b" }, { lead_id: "c" }] };
}

test("flag off: no Lead engine card, the positive-junk list is never asked", async ({ page, context }) => {
  await setup(context, page);
  state.settings.admin_home_mode = "off";
  await page.goto("/admin");
  await page.waitForTimeout(2000);
  await expect(page.getByTestId("admin-engine")).toHaveCount(0);
  expect(state.positiveJunkCalls).toBe(0);
});

for (const role of ["admin", "super_admin"] as const) {
  test(`Lead engine today (${role}): numbers vs yesterday, guard rows, nothing heavy on load, screenshot`, async ({ page, context }, info) => {
    await setup(context, page, role);
    await page.goto("/admin");
    await expect(page.getByTestId("admin-engine")).toBeVisible();
    await expect(page.getByTestId("admin-engine-recycled")).toContainText("3");
    await expect(page.getByTestId("admin-engine-recycled-delta")).toHaveText("▼ 2 fewer");
    await expect(page.getByTestId("admin-engine-refused")).toContainText("4");
    await expect(page.getByTestId("admin-engine-refused-delta")).toHaveText("▲ 2 more");
    await expect(page.getByTestId("admin-engine-protected")).toContainText("2");
    await expect(page.getByTestId("admin-engine-protected")).toContainText("first ends 25 Nov");
    await expect(page.getByTestId("admin-guard-reminder_hold/REMINDER_HOLD")).toContainText("Reminder hold");
    await expect(page.getByTestId("admin-guard-reminder_hold/REMINDER_HOLD")).toContainText("2");
    await expect(page.getByTestId("admin-guard-db_sibling_guard/RECYCLE_REFUSED")).toContainText("Recycle refused");
    // A4 (2026-11-20): junk today is now counted from the admin's LEAD_JUNKED notifications.
    await expect(page.getByTestId("admin-engine-junk-note")).toContainText("Junk today is counted from your Lead marked JUNK notifications");
    await expect(page.getByTestId("admin-check-positive-junk")).toBeVisible();
    await expect(page.getByTestId("admin-row-positive-junk")).toHaveCount(0);
    expect(state.positiveJunkCalls).toBe(0);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/admin-a3-${role}-${info.project.name}.png`, fullPage: true });
  });
}

test("positive junk: Check once -> amber Needs action row = the Positive-history Junk page's All; Refresh does not ask again", async ({ page, context }, info) => {
  await setup(context, page);
  await page.goto("/admin");
  const check = page.getByTestId("admin-check-positive-junk");
  expect((await check.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await check.click();
  await expect(page.getByTestId("admin-engine-pj-count")).toContainText("3");
  expect(state.positiveJunkCalls).toBe(1);
  const row = page.getByTestId("admin-row-positive-junk");
  await expect(row).toHaveAttribute("data-severity", "warning");
  await expect(row).toContainText("3 leads with a positive history are in Junk");
  await page.getByTestId("admin-refresh").click();
  await page.waitForTimeout(1500);
  expect(state.positiveJunkCalls).toBe(1);
  await expect(row).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/admin-a3-checked-${info.project.name}.png`, fullPage: true });
  // The page itself, same RPC: its "All" count is the Home's number.
  await row.click();
  await expect(page).toHaveURL(/\/admin\/positive-junk/);
  await expect(page.getByRole("button", { name: /^All\b/ }).first()).toContainText("3");
});

test("zero: no positive junk -> row hidden, grey 0; no recycles -> grey 0", async ({ page, context }) => {
  await setup(context, page);
  state.positiveJunk = { rows: [] };
  state.recycles = [];
  await page.goto("/admin");
  await expect(page.getByTestId("admin-engine-recycled")).toHaveAttribute("data-tone", "zero");
  await page.getByTestId("admin-check-positive-junk").click();
  await expect(page.getByTestId("admin-engine-pj-count")).toContainText("0");
  await expect(page.getByTestId("admin-row-positive-junk")).toHaveCount(0);
});

test("one card fails: Lead engine says so + Retry, Team today still shows; a failed Check can be tried again", async ({ page, context }) => {
  await setup(context, page);
  state.fail.add("rpc/get_admin_guard_event_counts");
  state.fail.add("rpc/get_positive_junk_leads");
  await page.goto("/admin");
  await expect(page.getByTestId("admin-retry-engine")).toHaveText("Couldn't load the lead engine numbers. Tap to try again.");
  await expect(page.getByTestId("admin-team")).toBeVisible();
  await expect.poll(() => state.anomalies.some((a) => a.message.startsWith("admin-home:engine:"))).toBe(true);
  state.fail.delete("rpc/get_admin_guard_event_counts");
  await page.getByTestId("admin-retry-engine").click();
  await expect(page.getByTestId("admin-engine-recycled")).toBeVisible();
  await page.getByTestId("admin-check-positive-junk").click();
  await expect(page.getByTestId("admin-check-positive-junk")).toHaveText("Couldn't check. Try again");
  state.fail.delete("rpc/get_positive_junk_leads");
  await page.getByTestId("admin-check-positive-junk").click();
  await expect(page.getByTestId("admin-engine-pj-count")).toContainText("3");
});

test("axe: colour contrast and target size with the Lead engine card", async ({ page, context }) => {
  await setup(context, page);
  await page.goto("/admin");
  await expect(page.getByTestId("admin-engine-recycled")).toBeVisible();
  await page.getByTestId("admin-check-positive-junk").click();
  await expect(page.getByTestId("admin-row-positive-junk")).toBeVisible();
  await page.waitForTimeout(400);
  await page.addScriptTag({ path: AXE });
  const violations = await page.evaluate(async () => {
    const w = window as unknown as { axe: { run: (c: Element, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } };
    const res = await w.axe.run(document.querySelector('[data-testid="admin-home-a1"]') as Element, { runOnly: { type: "rule", values: ["color-contrast", "target-size"] } });
    return res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 4).join(", ")}`);
  });
  expect(violations).toEqual([]);
});
