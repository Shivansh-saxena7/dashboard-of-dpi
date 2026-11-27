import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { mockSupabase, type MockState } from "./mockSupabase";

// Admin Home engine RPC (2026-11-28): the Lead engine tile reads guard counts through get_admin_guard_event_counts, never
// lead_guard_events directly (the mock refuses that table with 42501, exactly like production). "Couldn't load..." only
// on a real RPC error. Fixed clock: Thu 19 Nov 2026, 14:00 IST. Pixel 7, iPhone 14, desktop.

const NOW = Date.parse("2026-11-19T14:00:00+05:30");
const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60000;
const DAY = 86400e3;
const COULDNT = "Couldn't load the lead engine numbers. Tap to try again.";

let state: MockState;

async function setup(context: BrowserContext, page: Page, role: "admin" | "super_admin" = "admin") {
  await page.clock.setFixedTime(new Date(NOW));
  state = await mockSupabase(context);
  state.employee.role = role;
  state.employee.department = null;
  state.settings.admin_home_mode = "on";
  // 700 refusals today (more than the old 500-row read could see), 3 yesterday before this time, 2 admin junks today.
  state.guardEvents = [
    ...Array.from({ length: 700 }, (_, i) => ({ created_at: iso(NOW - (i + 1) * 1000), source: "db_positive_junk_guard", action: "JUNK_REFUSED" })),
    ...[1, 2, 3].map((i) => ({ created_at: iso(NOW - DAY - i * MIN), source: "db_positive_junk_guard", action: "JUNK_REFUSED" })),
    ...[1, 2].map((i) => ({ created_at: iso(NOW - i * 20 * MIN), source: "admin_junk", action: "ADMIN_JUNK" }))
  ];
}

for (const role of ["admin", "super_admin"] as const) {
  test(`success (${role}): counts come from the RPC, no 500 cap, no direct table read, no error`, async ({ page, context }) => {
    await setup(context, page, role);
    await page.goto("/admin");
    await expect(page.getByTestId("admin-engine")).toBeVisible();
    await expect(page.getByTestId("admin-engine-refused")).toContainText("700");
    await expect(page.getByTestId("admin-engine-refused-delta")).toHaveText("▲ 697 more");
    await expect(page.getByTestId("admin-retry-engine")).toHaveCount(0);
    await expect(page.getByText(COULDNT)).toHaveCount(0);
    // Today + yesterday per load (dev mode may load the tile twice): always in pairs, at least one pair.
    expect(state.guardRpcCalls).toBeGreaterThanOrEqual(2);
    expect(state.guardRpcCalls % 2).toBe(0);
    expect(state.guardTableReads).toBe(0);
    await page.waitForTimeout(1000);
    expect(state.anomalies.filter((a) => a.message.startsWith("admin-home:engine") || a.message.includes("lead_guard_events"))).toEqual([]);
  });
}

test("RPC refused (42501): Couldn't load + report once; Retry after it works shows the numbers", async ({ page, context }) => {
  await setup(context, page);
  state.fail.add("rpc/get_admin_guard_event_counts");
  await page.goto("/admin");
  await expect(page.getByTestId("admin-retry-engine")).toHaveText(COULDNT);
  await expect.poll(() => state.anomalies.some((a) => a.message.startsWith("admin-home:engine:"))).toBe(true);
  await expect(page.getByTestId("admin-team")).toBeVisible();
  expect(state.guardTableReads).toBe(0);
  state.fail.delete("rpc/get_admin_guard_event_counts");
  await page.getByTestId("admin-retry-engine").click();
  await expect(page.getByTestId("admin-engine-refused")).toContainText("700");
  await expect(page.getByText(COULDNT)).toHaveCount(0);
});

test("flag off: old dashboard, the guard RPC and the table are never asked", async ({ page, context }) => {
  await setup(context, page);
  state.settings.admin_home_mode = "off";
  await page.goto("/admin");
  await page.waitForTimeout(2500);
  await expect(page.getByTestId("admin-engine")).toHaveCount(0);
  expect(state.guardRpcCalls).toBe(0);
  expect(state.guardTableReads).toBe(0);
});
