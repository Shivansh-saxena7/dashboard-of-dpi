import { expect, test } from "@playwright/test";
import { FAKE_SUPABASE, mockSupabase } from "./mockSupabase";

// Login check on a bad network (2026-11-14): a page must not send a logged-in employee to /login just because the
// "who am I" call (auth/v1/user) failed for network reasons. Pixel 7 (Chromium) and iPhone 14 (WebKit), fake Supabase.

for (const path of ["/leads", "/data"] as const) {
  test(`${path}: a network failure on the login check keeps the employee on the page`, async ({ context, page }) => {
    await mockSupabase(context);
    let failed = 0;
    // Registered after the mock, so it is tried first: the first "who am I" call fails like a dropped connection.
    await context.route(`${FAKE_SUPABASE}/auth/v1/user**`, async (route) => {
      if (failed === 0) {
        failed += 1;
        return route.abort("failed");
      }
      return route.fallback();
    });
    await page.goto(path);
    await expect(page.locator(path === "/leads" ? "#lead-card-lead-01" : "#data-card-data-01")).toBeVisible();
    expect(page.url()).not.toContain("/login");
    expect(failed).toBe(1);
  });
}

test("/leads: no session at all still goes to /login", async ({ context, page }) => {
  await mockSupabase(context);
  await context.addInitScript(() => {
    try {
      localStorage.removeItem("sb-fake-supabase-auth-token");
    } catch {
      // ignore
    }
  });
  await page.goto("/leads");
  await expect(page).toHaveURL(/\/login/);
});
