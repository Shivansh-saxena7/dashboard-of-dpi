import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import path from "path";
import { mockSupabase, type MockState } from "./mockSupabase";

// Admin Home A1 (2026-11-19), lead_engine_settings.admin_home_mode: one Home for admin and super_admin. Flag off /
// missing / unknown / slow = the old dashboard at once. On: header, Needs action (worst first, empty rows hidden,
// "All clear"), System card, Social posts collapsed (no /api/data until opened, no polling). One failing card does not
// stop the others. Fake Supabase; Pixel 7, iPhone 14 and desktop Chromium.

const SHOTS = "C:/work/reports/admin_a1";
const AXE = path.join(process.cwd(), "node_modules/axe-core/axe.min.js");
const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();

let state: MockState;
let apiData: number[];
let heartbeatReads: number;

function healthy(s: MockState) {
  s.heartbeats = [
    { function_name: "recycle-stale-leads", max_silence_minutes: 30, last_succeeded_at: ago(5) },
    { function_name: "check-lead-reminders", max_silence_minutes: 120, last_succeeded_at: ago(40) },
    { function_name: "db-backup", max_silence_minutes: 1560, last_succeeded_at: ago(300) },
    { function_name: "backup-to-google-sheets", max_silence_minutes: 1500, last_succeeded_at: ago(500) },
    { function_name: "send-meta-capi-events", max_silence_minutes: 20, last_succeeded_at: ago(3) }
  ];
  s.backups = [{ run_at: ago(500), status: "SUCCESS" }];
  s.anomalyRows = [{ source: "network:x", severity: "info" }];
}

async function setup(context: BrowserContext, role: "admin" | "super_admin" = "admin") {
  state = await mockSupabase(context);
  state.employee.role = role;
  state.employee.department = null;
  healthy(state);
  apiData = [];
  heartbeatReads = 0;
  context.on("request", (req) => {
    const u = new URL(req.url());
    if (u.pathname.startsWith("/api/data")) apiData.push(Date.now());
    if (u.pathname === "/rest/v1/cron_heartbeats") heartbeatReads++;
  });
}

async function openAdmin(page: Page) {
  await page.goto("/admin");
}

for (const [label, settings] of [
  ["column missing", {}],
  ["off", { admin_home_mode: "off" }],
  ["unknown value", { admin_home_mode: "ON" }],
  ["pilot, not listed", { admin_home_mode: "admin_pilot", admin_home_pilot_ids: ["someone-else"] }],
  ["employee Home flag only", { employee_home_mode: "on" }]
] as const) {
  test(`flag ${label}: the old dashboard`, async ({ page, context }) => {
    await setup(context);
    Object.assign(state.settings, settings);
    await openAdmin(page);
    await expect.poll(() => apiData.length).toBeGreaterThan(0);
    await page.waitForTimeout(1200);
    await expect(page.getByTestId("admin-home-a1")).toHaveCount(0);
  });
}

for (const role of ["admin", "super_admin"] as const) {
  test(`flag on (${role}): the new Home, All clear, no /api/data, screenshot`, async ({ page, context }, info) => {
    await setup(context, role);
    state.settings.admin_home_mode = role === "admin" ? "on" : "admin_pilot";
    state.settings.admin_home_pilot_ids = [String(state.employee.id)];
    await openAdmin(page);
    await expect(page.getByTestId("admin-home-a1")).toBeVisible();
    await expect(page.getByTestId("admin-all-clear")).toHaveText(/All clear/);
    await expect(page.getByTestId("admin-job-recycle-stale-leads")).toContainText("5 min ago");
    await expect(page.getByTestId("admin-errors")).toContainText("None");
    await expect(page.getByTestId("admin-updated")).toHaveText(/^Updated \d\d:\d\d$/);
    expect((await page.getByTestId("admin-refresh").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    // First visit of the tab: the old dashboard may ask once before the flag is known (twice in React dev mode, which
    // runs effects twice); after that nothing.
    const before = apiData.length;
    expect(before).toBeLessThanOrEqual(2);
    await page.waitForTimeout(6000);
    expect(apiData.length).toBe(before);
    await page.screenshot({ path: `${SHOTS}/admin-a1-all-clear-${role}-${info.project.name}.png`, fullPage: true });
  });
}

test("Needs action: worst first, empty rows hidden, links to their pages; screenshot", async ({ page, context }, info) => {
  await setup(context);
  state.settings.admin_home_mode = "on";
  state.heartbeats[0].last_succeeded_at = ago(35); // sweep: red
  state.heartbeats[1].last_succeeded_at = ago(130); // reminders: past 120 min = red
  state.anomalyRows = [
    { source: "recycle-stale-leads", severity: "error" },
    { source: "page:/leads", severity: "warning" },
    { source: "db_sibling_guard", severity: "warning" }, // activity, not a problem
    { source: "network:x", severity: "info" }
  ];
  state.staff = [
    { id: "s1", name: "Ravi", is_active: true, role: "employee", department: "sales", created_at: "2026-09-01T05:00:00Z" },
    { id: "s2", name: "Testing", is_active: true, role: "employee", department: "sales", created_at: "2026-09-01T05:00:00Z" },
    { id: String(state.employee.id), name: "Admin", is_active: true, role: "admin", department: null, created_at: "2026-09-01T05:00:00Z" }
  ];
  state.attendanceRows = [];
  state.transfers = [{ id: "t1" }];
  await openAdmin(page);
  const rows = page.getByTestId("admin-needs-action").locator("li a");
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(0)).toHaveAttribute("data-severity", "critical");
  await expect(page.getByTestId("admin-row-hb:recycle-stale-leads")).toContainText("Recycle sweep has not run for 35 min");
  await expect(page.getByTestId("admin-row-hb:check-lead-reminders")).toHaveAttribute("data-severity", "critical");
  await expect(page.getByTestId("admin-row-errors")).toContainText("1 error today");
  await expect(page.getByTestId("admin-row-errors")).toHaveAttribute("data-severity", "critical");
  await expect(page.getByTestId("admin-row-no-shift")).toContainText("1 employee has not started a shift for 3+ working days");
  await expect(page.getByTestId("admin-row-no-shift")).toHaveAttribute("data-severity", "warning");
  await expect(page.getByTestId("admin-row-approvals")).toContainText("1 approval waiting");
  await expect(rows.nth(4)).toHaveAttribute("data-severity", "info");
  await expect(page.getByTestId("admin-row-approvals")).toHaveAttribute("href", "/admin/lead-transfers");
  await expect(page.getByTestId("admin-row-hb:recycle-stale-leads")).toHaveAttribute("href", "/admin/system-health");
  await expect(page.getByTestId("admin-all-clear")).toHaveCount(0);
  for (let i = 0; i < 5; i++) expect((await rows.nth(i).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: `${SHOTS}/admin-a1-needs-action-${info.project.name}.png`, fullPage: true });
});

test("sweep 25 min late = amber; warnings only = amber", async ({ page, context }) => {
  await setup(context);
  state.settings.admin_home_mode = "on";
  state.heartbeats[0].last_succeeded_at = ago(25);
  state.anomalyRows = [{ source: "page:/x", severity: "warning" }];
  await openAdmin(page);
  await expect(page.getByTestId("admin-row-hb:recycle-stale-leads")).toHaveAttribute("data-severity", "warning");
  await expect(page.getByTestId("admin-row-errors")).toHaveAttribute("data-severity", "warning");
});

test("one card fails: its own message + Retry, the other rows still show", async ({ page, context }) => {
  await setup(context);
  state.settings.admin_home_mode = "on";
  state.transfers = [{ id: "t1" }];
  state.fail.add("cron_heartbeats");
  await openAdmin(page);
  await expect(page.getByTestId("admin-retry-system")).toHaveText("Couldn't load the system status. Tap to try again.");
  await expect(page.getByTestId("admin-row-approvals")).toBeVisible();
  await expect(page.getByTestId("admin-partial")).toBeVisible();
  await expect.poll(() => state.anomalies.some((a) => a.message.startsWith("admin-home:system:"))).toBe(true);
  state.fail.delete("cron_heartbeats");
  await page.getByTestId("admin-retry-system").click();
  await expect(page.getByTestId("admin-job-recycle-stale-leads")).toBeVisible();
});

test("flag read stuck (5 s): the old dashboard at once, still old after the 2 s timeout", async ({ page, context }) => {
  await setup(context);
  state.settings.admin_home_mode = "on";
  state.settingsDelayMs = 5000;
  const t0 = Date.now();
  await openAdmin(page);
  await expect.poll(() => apiData.length).toBeGreaterThan(0);
  expect(apiData[0] - t0).toBeLessThan(5000); // did not wait for the settings
  await page.waitForTimeout(3000);
  await expect(page.getByTestId("admin-home-a1")).toHaveCount(0);
});

test("social posts: nothing read while collapsed; opened = loads once, no polling", async ({ page, context }) => {
  await setup(context);
  state.settings.admin_home_mode = "on";
  await openAdmin(page);
  await expect(page.getByTestId("admin-home-a1")).toBeVisible();
  const before = apiData.length;
  await page.waitForTimeout(1500);
  expect(apiData.length).toBe(before);
  await page.getByTestId("admin-social-toggle").click();
  await expect.poll(() => apiData.length).toBeGreaterThan(before);
  await page.waitForTimeout(1000);
  const opened = apiData.length;
  expect(opened - before).toBeLessThanOrEqual(2); // one load (twice in React dev mode)
  await page.waitForTimeout(6000); // the old view polled every 5 s; here nothing more
  expect(apiData.length).toBe(opened);
});

test("Refresh reads again; axe colour contrast and target size", async ({ page, context }) => {
  await setup(context);
  state.settings.admin_home_mode = "on";
  state.transfers = [{ id: "t1" }];
  await openAdmin(page);
  await expect(page.getByTestId("admin-row-approvals")).toBeVisible();
  const reads = heartbeatReads;
  await page.getByTestId("admin-refresh").click();
  await expect.poll(() => heartbeatReads).toBeGreaterThan(reads);
  await page.waitForTimeout(400);
  await page.addScriptTag({ path: AXE });
  const violations = await page.evaluate(async () => {
    const w = window as unknown as { axe: { run: (c: Element, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } };
    const res = await w.axe.run(document.querySelector('[data-testid="admin-home-a1"]') as Element, { runOnly: { type: "rule", values: ["color-contrast", "target-size"] } });
    return res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 4).join(", ")}`);
  });
  expect(violations).toEqual([]);
});
