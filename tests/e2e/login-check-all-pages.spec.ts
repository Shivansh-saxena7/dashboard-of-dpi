import { expect, test } from "@playwright/test";
import { FAKE_SUPABASE, mockSupabase } from "./mockSupabase";

// Login check on a bad network, every other page that sends a logged-out visitor to /login (2026-11-14).
// The connection drops for the first second of the page load: every "who am I" call (auth/v1/user) in that window
// fails, as on a weak network or a reload. A logged-in employee must stay on the page; with no session at all the
// page must still go to /login. Pixel 7 (Chromium) and iPhone 14 (WebKit), fake Supabase. /leads and /data are in
// login-check.spec.ts. The /login page sends a logged-in visitor back to Home, so the bounce is checked on every
// navigation, not only on the final URL: the employee would still lose the page they were on.

const PAGES = ["/", "/attendance", "/documents", "/expenses", "/leaderboard", "/report", "/team", "/tickets"] as const;
// Where the page normally ends up for the test employee (role "employee"): /team sends anyone who is not a
// team_leader to Home; that role check is unchanged.
const EXPECTED_FINAL: Record<string, string> = { "/team": "/" };
const DROP_MS = 1000;
const SETTLE_MS = 8000;

for (const path of PAGES) {
  test(`${path}: a dropped connection on the login check keeps the employee on the page`, async ({ context, page }) => {
    await mockSupabase(context);
    let firstAbortAt = 0;
    let failed = 0;
    // Registered after the mock, so it is tried first.
    await context.route(`${FAKE_SUPABASE}/auth/v1/user**`, async (route) => {
      const now = Date.now();
      if (firstAbortAt === 0) firstAbortAt = now;
      if (now - firstAbortAt < DROP_MS) {
        failed += 1;
        return route.abort("failed");
      }
      return route.fallback();
    });
    const visited: string[] = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) visited.push(new URL(frame.url()).pathname);
    });
    await page.goto(path);
    await page.waitForTimeout(SETTLE_MS);
    expect(failed).toBeGreaterThan(0);
    expect(visited.filter((p) => p.startsWith("/login"))).toEqual([]);
    expect(new URL(page.url()).pathname).toBe(EXPECTED_FINAL[path] ?? path);
  });

  test(`${path}: no session at all still goes to /login`, async ({ context, page }) => {
    await mockSupabase(context);
    await context.addInitScript(() => {
      try {
        localStorage.removeItem("sb-fake-supabase-auth-token");
      } catch {
        // ignore
      }
    });
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/, { timeout: 20000 });
  });
}
