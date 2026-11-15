import { expect, test, type BrowserContext } from "@playwright/test";
import { EMP, FAKE_SUPABASE, UID, mockSupabase } from "./mockSupabase";

// No data query before the login is confirmed (2026-11-15). The Admin / HR / Payroll / Coordinator layouts used to
// render their page while the access check was still running, so a visit without a session sent the page's own
// queries (employees, teams, settings, leave, HR documents, ...) with the anon key. Now the page renders only after
// the layout's check passes. Pixel 7 (Chromium) and iPhone 14 (WebKit), fake Supabase.

const SECTIONS = [
  { path: "/admin", role: "admin" },
  { path: "/admin/leads", role: "admin" },
  { path: "/hr", role: "hr" },
  { path: "/hr/candidates", role: "hr" },
  { path: "/payroll", role: "payroll" },
  { path: "/coordinator", role: "sales_coordinator" }
] as const;

// The layout's own access check reads the caller's employee row (auth_user_id=eq...): that one is expected.
const isLayoutCheck = (url: string) => url.includes("/rest/v1/employees") && url.includes("auth_user_id=eq.");

async function trackDataQueries(context: BrowserContext) {
  const dataQueries: string[] = [];
  await context.route(`${FAKE_SUPABASE}/rest/v1/**`, (route) => {
    const url = decodeURIComponent(route.request().url());
    if (!isLayoutCheck(url) && !url.includes("/rest/v1/system_anomaly_log")) dataQueries.push(url.replace(FAKE_SUPABASE, "").slice(0, 80));
    return route.fallback();
  });
  return dataQueries;
}

async function employeeWithRole(context: BrowserContext, role: string) {
  await context.route(`${FAKE_SUPABASE}/rest/v1/employees**`, (route) => {
    const row = { id: EMP, auth_user_id: UID, name: "Test User", role, department: "sales", is_active: true, team_id: null };
    const one = (route.request().headers()["accept"] || "").includes("vnd.pgrst.object");
    return route.fulfill({
      status: 200,
      headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
      body: JSON.stringify(one ? row : [row])
    });
  });
}

for (const { path, role } of SECTIONS) {
  test(`${path}: without a session, no data query is sent before /login`, async ({ context, page }) => {
    await mockSupabase(context);
    await employeeWithRole(context, role);
    const dataQueries = await trackDataQueries(context);
    await context.addInitScript(() => {
      try {
        localStorage.removeItem("sb-fake-supabase-auth-token");
      } catch {
        // ignore
      }
    });
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/, { timeout: 20000 });
    await page.waitForTimeout(1500);
    expect(dataQueries).toEqual([]);
  });

  test(`${path}: with a session, the page loads its data as before`, async ({ context, page }) => {
    await mockSupabase(context);
    await employeeWithRole(context, role);
    const dataQueries = await trackDataQueries(context);
    await page.goto(path);
    await expect.poll(() => dataQueries.length, { timeout: 20000 }).toBeGreaterThan(0);
    expect(new URL(page.url()).pathname).toBe(path);
    await expect(page.getByText("Checking access...")).toHaveCount(0);
  });
}
