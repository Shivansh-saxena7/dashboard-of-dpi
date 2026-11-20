import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { EMP, FAKE_SUPABASE, UID, mockSupabase } from "./mockSupabase";

// A0 (2026-11-20): the Admin dashboard (/admin) no longer polls /api/data every 5 seconds. It loads once, again when
// the date changes, when the app comes back to the foreground after at least a minute, and on Refresh.
// Fake clock, so "15 seconds" and "a minute later" are exact. Pixel 7 (Chromium) and iPhone 14 (WebKit).

let apiCalls: number;

async function openDashboard(context: BrowserContext, page: Page) {
  await mockSupabase(context);
  const admin = { id: EMP, auth_user_id: UID, name: "Test Admin", role: "admin", department: null, is_active: true, team_id: null };
  await context.route(`${FAKE_SUPABASE}/rest/v1/employees**`, (route) => {
    const one = (route.request().headers()["accept"] || "").includes("vnd.pgrst.object");
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(one ? admin : [admin]) });
  });
  apiCalls = 0;
  await page.route("**/api/data**", (route) => {
    apiCalls++;
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.clock.install({ time: new Date("2026-11-20T09:00:00+05:30") });
  await page.goto("/admin");
  await expect(page.getByTestId("admin-dashboard-refresh")).toHaveText("Refresh");
  await expect.poll(() => apiCalls).toBeGreaterThanOrEqual(1);
  await page.clock.runFor(2000);
  expect(apiCalls).toBe(1);
}

async function setVisibility(page: Page, state: "hidden" | "visible") {
  await page.evaluate((s) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => s });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}

test("no repeat for 15 s (was 3 calls); foreground after a minute = 1 call; a quick switch back = none; Refresh = 1 call", async ({ page, context }) => {
  await openDashboard(context, page);
  await page.clock.runFor(15_000);
  await page.waitForTimeout(300);
  expect(apiCalls).toBe(1);

  // Back within a minute: nothing.
  await setVisibility(page, "hidden");
  await setVisibility(page, "visible");
  await page.waitForTimeout(300);
  expect(apiCalls).toBe(1);

  // Away for more than a minute, then back: one call.
  await setVisibility(page, "hidden");
  await page.clock.runFor(61_000);
  await setVisibility(page, "visible");
  await expect.poll(() => apiCalls).toBe(2);

  // Refresh: one call.
  await page.getByTestId("admin-dashboard-refresh").click();
  await expect.poll(() => apiCalls).toBe(3);
  await expect(page.getByTestId("admin-dashboard-refresh")).toHaveText("Refresh");
  await page.clock.runFor(15_000);
  await page.waitForTimeout(300);
  expect(apiCalls).toBe(3);
});

test("changing the date loads at once (one call)", async ({ page, context }) => {
  await openDashboard(context, page);
  await page.locator('input[type="date"]').fill("2026-11-18");
  await expect.poll(() => apiCalls).toBe(2);
  await page.clock.runFor(10_000);
  await page.waitForTimeout(300);
  expect(apiCalls).toBe(2);
});
