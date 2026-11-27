import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import path from "path";
import { mockSupabase, type MockState } from "./mockSupabase";

// Admin Home A2 (2026-11-19), admin_home_mode on only: "Today so far" (4 counts, each vs yesterday at this time; zero =
// grey) and "Team today" (states by HR attendance's rule, leave / grace by the shared lib, call quality band; workload
// only when asked). Fixed clock: Thursday 19 Nov 2026, 14:00 IST. Pixel 7, iPhone 14, desktop Chromium.

const SHOTS = "C:/work/reports/admin_a2";
const AXE = path.join(process.cwd(), "node_modules/axe-core/axe.min.js");
const NOW = Date.parse("2026-11-19T14:00:00+05:30");
const iso = (ms: number) => new Date(ms).toISOString();
const IST = (s: string) => iso(Date.parse(`${s}+05:30`));
const MIN = 60000;
const DAY = 86400e3;

let state: MockState;
let workloadReads: number;

async function setup(context: BrowserContext, page: Page, role: "admin" | "super_admin" = "admin") {
  await page.clock.setFixedTime(new Date(NOW));
  state = await mockSupabase(context);
  state.employee.role = role;
  state.employee.department = null;
  state.settings.admin_home_mode = "on";
  state.heartbeats = [{ function_name: "recycle-stale-leads", max_silence_minutes: 30, last_succeeded_at: iso(NOW - 5 * MIN) }];
  state.backups = [{ run_at: iso(NOW - 8 * 3600e3), status: "SUCCESS" }];
  state.clicks = [
    { clicked_at: iso(NOW - 10 * MIN), click_type: "CALL" },
    { clicked_at: iso(NOW - 20 * MIN), click_type: "CALL" },
    { clicked_at: iso(NOW - 30 * MIN), click_type: "CALL" },
    { clicked_at: iso(NOW - 40 * MIN), click_type: "WHATSAPP" },
    { clicked_at: iso(NOW - DAY - 10 * MIN), click_type: "CALL" }, // yesterday before this time
    { clicked_at: iso(NOW - DAY + 10 * MIN), click_type: "CALL" } // yesterday after this time: not counted
  ];
  state.activities = [
    { created_at: iso(NOW - 15 * MIN), activity_type: "STATUS_UPDATE" },
    ...[1, 2, 3, 4].map((i) => ({ created_at: iso(NOW - DAY - i * MIN), activity_type: "STATUS_UPDATE" }))
  ];
  state.staff = [
    { id: "e-on", name: "Olivia", is_active: true, role: "employee", department: "sales", created_at: "2026-09-01T05:00:00Z" },
    { id: "e-late", name: "Liam", is_active: true, role: "employee", department: "sales", created_at: "2026-09-01T05:00:00Z" },
    { id: "e-none", name: "Noah", is_active: true, role: "employee", department: "sales", created_at: "2026-09-01T05:00:00Z" },
    { id: "e-leave", name: "Leah", is_active: true, role: "employee", department: "sales", created_at: "2026-09-01T05:00:00Z" },
    { id: "e-grace", name: "Grace", is_active: true, role: "team_leader", department: null, created_at: "2026-09-01T05:00:00Z" },
    { id: "e-test", name: "Testing", is_active: true, role: "employee", department: "sales", created_at: "2026-09-01T05:00:00Z" },
    { id: String(state.employee.id), name: "Admin", is_active: true, role, department: null, created_at: "2026-09-01T05:00:00Z" }
  ];
  state.attendanceByDate = [
    { employee_id: "e-on", date: "2026-11-19", shift_start_at: IST("2026-11-19T10:32:00"), shift_end_at: null, attendance_type: "FULL_DAY" },
    { employee_id: "e-late", date: "2026-11-19", shift_start_at: IST("2026-11-19T10:53:00"), shift_end_at: null, attendance_type: "FULL_DAY" },
    { employee_id: "e-on", date: "2026-11-18", shift_start_at: IST("2026-11-18T10:31:00"), shift_end_at: IST("2026-11-18T18:40:00"), attendance_type: "FULL_DAY" },
    { employee_id: "e-late", date: "2026-11-18", shift_start_at: IST("2026-11-18T10:40:00"), shift_end_at: null, attendance_type: "FULL_DAY" },
    { employee_id: "e-none", date: "2026-11-18", shift_start_at: IST("2026-11-18T14:30:00"), shift_end_at: null, attendance_type: "HALF_DAY_SECOND" } // after 14:00: not counted
  ];
  state.leave = [
    { employee_id: "e-leave", start_date: "2026-11-18", end_date: "2026-11-22" },
    { employee_id: "e-grace", start_date: "2026-11-12", end_date: "2026-11-17" } // back Wed 18 + Thu 19 = grace
  ];
  state.cqAll = {
    estimated: true,
    employees: [
      { employee_id: "e-on", by_card_type: { LEAD: { dial_clicks: 40, genuine_score: 88 }, DATA: { dial_clicks: 0, genuine_score: null } } },
      { employee_id: "e-late", by_card_type: { LEAD: { dial_clicks: 30, genuine_score: 52 }, DATA: { dial_clicks: 0, genuine_score: null } } }
    ]
  };
  const hist = (owner: string, daysAgo: number, active = true) => ({
    employee_id: owner, is_active: active, call_count: 1, outcome_at: iso(NOW - daysAgo * DAY), assigned_at: iso(NOW - (daysAgo + 1) * DAY),
    first_call_at: iso(NOW - daysAgo * DAY), first_whatsapp_at: null, last_activity_at: iso(NOW - daysAgo * DAY), paused_until: null, pause_reason: null
  });
  state.workloadLeads = [
    { current_owner_id: "e-late", status: "CONNECTED", board_stage: "FOLLOW_UP", sla_deadline: null, recycle_count: 0, is_personal_lead: false, lead_history: [hist("e-late", 4)] },
    { current_owner_id: "e-late", status: "CONNECTED", board_stage: "FOLLOW_UP", sla_deadline: null, recycle_count: 0, is_personal_lead: false, lead_history: [hist("e-late", 9)] },
    { current_owner_id: "e-on", status: "CONNECTED", board_stage: "FOLLOW_UP", sla_deadline: null, recycle_count: 0, is_personal_lead: false, lead_history: [hist("e-on", 1)] }
  ];
  workloadReads = 0;
  context.on("request", (req) => {
    const u = new URL(req.url());
    if (u.pathname === "/rest/v1/leads" && (u.searchParams.get("current_owner_id") || "").startsWith("in.")) workloadReads++;
  });
}

const desktop = (info: { project: { name: string } }) => info.project.name === "desktop-chromium";

test("flag off: no Today so far, no Team today", async ({ page, context }) => {
  await setup(context, page);
  state.settings.admin_home_mode = "off";
  await page.goto("/admin");
  await page.waitForTimeout(2000);
  await expect(page.getByTestId("admin-today")).toHaveCount(0);
  await expect(page.getByTestId("admin-team")).toHaveCount(0);
});

for (const role of ["admin", "super_admin"] as const) {
  test(`Today so far + Team today (${role}): counts vs yesterday, zero grey, states, bands, screenshot`, async ({ page, context }, info) => {
    await setup(context, page, role);
    await page.goto("/admin");
    await expect(page.getByTestId("admin-today")).toBeVisible();
    await expect(page.getByTestId("admin-tile-calls")).toContainText("3");
    await expect(page.getByTestId("admin-tile-calls-delta")).toHaveText("▲ 2 more");
    await expect(page.getByTestId("admin-tile-results-delta")).toHaveText("▼ 3 fewer");
    await expect(page.getByTestId("admin-tile-bookings")).toHaveAttribute("data-tone", "zero");
    await expect(page.getByTestId("admin-tile-bookings-delta")).toHaveText("same as yesterday");
    // On shift: 2 of 5 field people (Testing and the admin are not field staff); yesterday at 14:00 also 2.
    await expect(page.getByTestId("admin-tile-shift")).toContainText("2/5");
    await expect(page.getByTestId("admin-tile-shift-delta")).toHaveText("same as yesterday");
    // Team: who needs a look first.
    const order = ["e-none", "e-late", "e-grace", "e-on", "e-leave"];
    const states = ["NOT_STARTED", "LATE", "IN_GRACE", "ON_SHIFT", "ON_LEAVE"];
    for (const [i, id] of order.entries()) await expect(page.getByTestId(`admin-team-state-${id}`).locator("visible=true")).toHaveAttribute("data-state", states[i]);
    await expect(page.getByTestId("admin-team-state-e-late").locator("visible=true")).toContainText("Late 10:53");
    await expect(page.getByTestId("admin-team-state-e-test")).toHaveCount(0);
    if (desktop(info)) {
      await expect(page.getByTestId("admin-team-table")).toBeVisible();
      await expect(page.getByTestId("admin-team-list")).toBeHidden();
      await expect(page.locator('[data-testid="admin-team-table"] [data-band="Red"]')).toHaveCount(1);
    } else {
      await expect(page.getByTestId("admin-team-list")).toBeVisible();
      await expect(page.getByTestId("admin-team-table")).toBeHidden();
      await expect(page.getByTestId("admin-team-row-e-late")).toContainText("Call quality: Red");
    }
    await expect(page.getByTestId("admin-team")).toContainText("Call quality is estimated");
    expect(workloadReads).toBe(0);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/admin-a2-${role}-${info.project.name}.png`, fullPage: true });
  });
}

test("workload: not read on load or Refresh; read once on Show workload; overdue = the card badge", async ({ page, context }, info) => {
  await setup(context, page);
  await page.goto("/admin");
  await expect(page.getByTestId("admin-show-workload")).toBeVisible();
  await page.getByTestId("admin-refresh").click();
  await page.waitForTimeout(1500);
  expect(workloadReads).toBe(0);
  expect((await page.getByTestId("admin-show-workload").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await page.getByTestId("admin-show-workload").click();
  await expect(page.getByTestId("admin-show-workload")).toHaveCount(0);
  expect(workloadReads).toBe(1);
  if (desktop(info)) {
    await expect(page.getByTestId("admin-work-overdue-e-late")).toHaveText("2");
    await expect(page.getByTestId("admin-work-overdue-e-on")).toHaveText("0");
  } else {
    await expect(page.getByTestId("admin-team-row-e-late")).toContainText("2 overdue");
  }
});

test("one card fails: Today so far says so + Retry, Team today still shows", async ({ page, context }) => {
  await setup(context, page);
  state.fail.add("contact_click_log");
  await page.goto("/admin");
  await expect(page.getByTestId("admin-retry-today")).toHaveText("Couldn't load today's numbers. Tap to try again.");
  await expect(page.getByTestId("admin-team-state-e-late").locator("visible=true")).toBeVisible();
  await expect.poll(() => state.anomalies.some((a) => a.message.startsWith("admin-home:today:"))).toBe(true);
  state.fail.delete("contact_click_log");
  await page.getByTestId("admin-retry-today").click();
  await expect(page.getByTestId("admin-tile-calls-delta")).toHaveText("▲ 2 more");
});

test("axe: colour contrast and target size with the A2 cards", async ({ page, context }) => {
  await setup(context, page);
  await page.goto("/admin");
  await expect(page.getByTestId("admin-tile-calls-delta")).toBeVisible();
  await expect(page.getByTestId("admin-team-state-e-late").locator("visible=true")).toBeVisible();
  await page.waitForTimeout(400);
  await page.addScriptTag({ path: AXE });
  const violations = await page.evaluate(async () => {
    const w = window as unknown as { axe: { run: (c: Element, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } };
    const res = await w.axe.run(document.querySelector('[data-testid="admin-home-a1"]') as Element, { runOnly: { type: "rule", values: ["color-contrast", "target-size"] } });
    return res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 4).join(", ")}`);
  });
  expect(violations).toEqual([]);
});
