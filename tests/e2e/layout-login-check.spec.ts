import { expect, test, type BrowserContext } from "@playwright/test";
import { EMP, FAKE_SUPABASE, UID, mockSupabase } from "./mockSupabase";

// Admin / HR / Payroll layout access check on a bad network (2026-11-14). The layout reads the session, then the
// employee's own row (name, role, is_active). A network failure on that row must not send a logged-in admin / HR /
// Payroll user to /login; a real answer (no session, wrong role) must redirect exactly as before. Every navigation
// is checked, not only the final URL. Pixel 7 (Chromium) and iPhone 14 (WebKit), fake Supabase.
// The Supabase client already retries a failed GET 3 times (about 1 s, 2 s, 4 s apart), so a short drop recovers on
// its own; the layout used to send to /login when the connection stayed down for about 8 s (a lift, a tunnel, a
// network switch). DROP_MS keeps it down past those retries and lets the layout's own retry (1.5 s later) succeed.

const LAYOUTS = [
  { path: "/admin", role: "admin" },
  { path: "/hr", role: "hr" },
  { path: "/payroll", role: "payroll" }
] as const;
const DROP_MS = 7800;
const SETTLE_MS = 14000;

test.setTimeout(60000);

// Registered after mockSupabase, so it is tried first: the employee row with the given role.
async function employeeWithRole(context: BrowserContext, role: string, drop: "none" | "long-drop" | "always") {
  let firstAbortAt = 0;
  const counter = { failed: 0 };
  await context.route(`${FAKE_SUPABASE}/rest/v1/employees**`, async (route) => {
    const now = Date.now();
    if (firstAbortAt === 0) firstAbortAt = now;
    if (drop === "always" || (drop === "long-drop" && now - firstAbortAt < DROP_MS)) {
      counter.failed += 1;
      return route.abort("failed");
    }
    const row = { id: EMP, auth_user_id: UID, name: "Test Employee", role, department: "sales", is_active: true, team_id: null };
    const wantsObject = (route.request().headers()["accept"] || "").includes("vnd.pgrst.object");
    return route.fulfill({
      status: 200,
      headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
      body: JSON.stringify(wantsObject ? row : [row])
    });
  });
  return counter;
}

function trackPaths(page: import("@playwright/test").Page) {
  const visited: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) visited.push(new URL(frame.url()).pathname);
  });
  return visited;
}

for (const { path, role } of LAYOUTS) {
  test(`${path}: a dropped connection on the access check keeps the ${role} on the page`, async ({ context, page }) => {
    await mockSupabase(context);
    const counter = await employeeWithRole(context, role, "long-drop");
    const visited = trackPaths(page);
    await page.goto(path);
    await page.waitForTimeout(SETTLE_MS);
    expect(counter.failed).toBeGreaterThan(0);
    expect(visited.filter((p) => p.startsWith("/login"))).toEqual([]);
    expect(new URL(page.url()).pathname).toBe(path);
    await expect(page.getByTestId("connection-retry-notice")).toHaveCount(0);
  });

  test(`${path}: still offline after the retry shows a retry notice, not /login`, async ({ context, page }) => {
    await mockSupabase(context);
    await employeeWithRole(context, role, "always");
    const visited = trackPaths(page);
    await page.goto(path);
    await expect(page.getByTestId("connection-retry-notice")).toBeVisible({ timeout: 30000 });
    expect(visited.filter((p) => p.startsWith("/login"))).toEqual([]);
    expect(new URL(page.url()).pathname).toBe(path);
  });

  test(`${path}: a real wrong role still goes to Home`, async ({ context, page }) => {
    await mockSupabase(context);
    await employeeWithRole(context, "employee", "none");
    const visited = trackPaths(page);
    await page.goto(path);
    await expect(page).toHaveURL((u) => u.pathname === "/", { timeout: 20000 });
    expect(visited.filter((p) => p.startsWith("/login"))).toEqual([]);
  });

  test(`${path}: no session at all still goes to /login`, async ({ context, page }) => {
    await mockSupabase(context);
    await employeeWithRole(context, role, "none");
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
