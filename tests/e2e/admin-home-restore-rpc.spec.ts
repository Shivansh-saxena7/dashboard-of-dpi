import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { mockSupabase, type MockState } from "./mockSupabase";

// Admin Home restore RPC (2026-11-29): "Restore protections" in the Lead engine tile comes from
// get_admin_restore_protection_counts, never lead_restore_log directly (the mock refuses that table with 42501, exactly
// like production). "Couldn't load..." only on a real RPC error. Fixed clock: Thu 19 Nov 2026, 14:00 IST.

const NOW = Date.parse("2026-11-19T14:00:00+05:30");
const iso = (ms: number) => new Date(ms).toISOString();
const DAY = 86400e3;
const COULDNT = "Couldn't load the lead engine numbers. Tap to try again.";

let state: MockState;

async function setup(context: BrowserContext, page: Page, role: "admin" | "super_admin" = "admin") {
  await page.clock.setFixedTime(new Date(NOW));
  state = await mockSupabase(context);
  state.employee.role = role;
  state.employee.department = null;
  state.settings.admin_home_mode = "on";
  // 250 open now (more than the old 200-row read could see), 240 of them open 24 h ago too; the first ends 21 Nov.
  state.restoreRows = [
    ...Array.from({ length: 240 }, (_, i) => ({ protected_until: iso(NOW + 2 * DAY + i * 60000), restored_at: iso(NOW - 3 * DAY), undone_at: null })),
    ...Array.from({ length: 10 }, (_, i) => ({ protected_until: iso(NOW + 5 * DAY + i * 60000), restored_at: iso(NOW - 3600e3), undone_at: null })),
    { protected_until: iso(NOW + 3 * DAY), restored_at: iso(NOW - 2 * DAY), undone_at: iso(NOW - 3600e3) }
  ];
}

for (const role of ["admin", "super_admin"] as const) {
  test(`success (${role}): protections come from the RPC, no 200 cap, no direct table read, no error`, async ({ page, context }) => {
    await setup(context, page, role);
    await page.goto("/admin");
    await expect(page.getByTestId("admin-engine")).toBeVisible();
    await expect(page.getByTestId("admin-engine-protected")).toContainText("250");
    await expect(page.getByTestId("admin-engine-protected")).toContainText("first ends 21 Nov");
    await expect(page.getByText(COULDNT)).toHaveCount(0);
    expect(state.restoreRpcCalls).toBeGreaterThanOrEqual(1);
    expect(state.restoreTableReads).toBe(0);
    expect(state.guardTableReads).toBe(0);
    await page.waitForTimeout(1000);
    expect(state.anomalies.filter((a) => a.message.startsWith("admin-home:engine") || /lead_restore_log|lead_guard_events/.test(a.message))).toEqual([]);
  });
}

test("restore RPC refused (42501): Couldn't load + reported; Retry after it works shows the numbers", async ({ page, context }) => {
  await setup(context, page);
  state.fail.add("rpc/get_admin_restore_protection_counts");
  await page.goto("/admin");
  await expect(page.getByTestId("admin-retry-engine")).toHaveText(COULDNT);
  await expect.poll(() => state.anomalies.some((a) => a.message.startsWith("admin-home:engine:"))).toBe(true);
  await expect(page.getByTestId("admin-team")).toBeVisible();
  expect(state.restoreTableReads).toBe(0);
  state.fail.delete("rpc/get_admin_restore_protection_counts");
  await page.getByTestId("admin-retry-engine").click();
  await expect(page.getByTestId("admin-engine-protected")).toContainText("250");
  await expect(page.getByText(COULDNT)).toHaveCount(0);
});

test("flag off: old dashboard, the restore RPC and the table are never asked", async ({ page, context }) => {
  await setup(context, page);
  state.settings.admin_home_mode = "off";
  await page.goto("/admin");
  await page.waitForTimeout(2500);
  await expect(page.getByTestId("admin-engine")).toHaveCount(0);
  expect(state.restoreRpcCalls).toBe(0);
  expect(state.restoreTableReads).toBe(0);
});
