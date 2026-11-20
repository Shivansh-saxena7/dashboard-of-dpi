import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import path from "path";
import { mockSupabase, type MockState } from "./mockSupabase";

// Admin Home A4 (2026-11-20), admin_home_mode on only: "Visits and bookings" (site visit events, bookings today and
// this month, each vs yesterday at this time), "System controls" (display only) and "Junk today" in the Lead engine
// card (the viewer's own LEAD_JUNKED notifications minus admin junk). Fixed clock: Fri 20 Nov 2026, 14:00 IST.

const SHOTS = "C:/work/reports/admin_a4";
const AXE = path.join(process.cwd(), "node_modules/axe-core/axe.min.js");
const NOW = Date.parse("2026-11-20T14:00:00+05:30");
const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60000;
const DAY = 86400e3;

let state: MockState;

async function setup(context: BrowserContext, page: Page, role: "admin" | "super_admin" = "admin") {
  await page.clock.setFixedTime(new Date(NOW));
  state = await mockSupabase(context);
  state.employee.role = role;
  state.employee.department = null;
  Object.assign(state.settings, {
    admin_home_mode: "on",
    auto_junk_enabled: true,
    auto_recycle_enabled: true,
    positive_junk_guard_mode: "enforce",
    restore_hold_mode: "enforce",
    reminder_hold_mode: "shadow",
    recycle_sibling_guard_mode: "shadow",
    given_lead_context_mode: "on",
    given_lead_context_pilot_ids: [],
    call_quality_enforced: false,
    employee_home_mode: "admin_pilot",
    employee_home_pilot_ids: ["p1", "p2"]
  });
  state.heartbeats = [{ function_name: "recycle-stale-leads", max_silence_minutes: 30, last_succeeded_at: iso(NOW - 5 * MIN) }];
  state.backups = [{ run_at: iso(NOW - 8 * 3600e3), status: "SUCCESS" }];
  const v = (ms: number, event_type: string) => ({ created_at: iso(ms), event_type });
  state.visits = [v(NOW - 10 * MIN, "VISIT"), v(NOW - 70 * MIN, "VISIT"), v(NOW - 30 * MIN, "BOOKED"), v(NOW - DAY - 20 * MIN, "VISIT"), v(NOW - DAY + 20 * MIN, "VISIT")];
  state.bookings = [{ board_stage_changed_at: iso(NOW - 40 * MIN) }, { board_stage_changed_at: "2026-11-05T08:00:00Z" }];
  const me = String(state.employee.id);
  state.junkNotes = [
    ...[1, 2, 3, 4, 5].map((i) => ({ created_at: iso(NOW - i * 10 * MIN), employee_id: me })),
    ...[1, 2, 3].map((i) => ({ created_at: iso(NOW - DAY - i * MIN), employee_id: me })),
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => ({ created_at: iso(NOW - i * MIN), employee_id: "other-admin" }))
  ];
  state.guardEvents = [{ created_at: iso(NOW - 15 * MIN), source: "admin_junk", action: "ADMIN_JUNK" }];
}

test("flag off: no Visits and bookings, no System controls", async ({ page, context }) => {
  await setup(context, page);
  state.settings.admin_home_mode = "off";
  await page.goto("/admin");
  await page.waitForTimeout(2000);
  await expect(page.getByTestId("admin-sales")).toHaveCount(0);
  await expect(page.getByTestId("admin-controls")).toHaveCount(0);
});

for (const role of ["admin", "super_admin"] as const) {
  test(`A4 cards (${role}): visits, bookings, junk today, controls, screenshot`, async ({ page, context }, info) => {
    await setup(context, page, role);
    await page.goto("/admin");
    await expect(page.getByTestId("admin-sales-visit")).toContainText("2");
    await expect(page.getByTestId("admin-sales-visit-delta")).toHaveText("▲ 1 more");
    await expect(page.getByTestId("admin-sales-booked-delta")).toHaveText("▲ 1 more");
    await expect(page.getByTestId("admin-sales-bookings")).toContainText("1");
    await expect(page.getByTestId("admin-sales-month")).toContainText("2");
    await expect(page.getByTestId("admin-sales-month-delta")).toHaveText("▲ 1 more");
    // Junk today: my 5 notifications - 1 admin junk = 4 sweep (yesterday 3); another admin's notifications ignored.
    await expect(page.getByTestId("admin-engine-junk")).toContainText("4");
    await expect(page.getByTestId("admin-engine-junk-delta")).toHaveText("▲ 1 more");
    await expect(page.getByTestId("admin-engine-admin-junk")).toContainText("1");
    await expect(page.getByTestId("admin-engine-junk-note")).toContainText("notifications");
    await expect(page.getByTestId("admin-guard-admin_junk/ADMIN_JUNK")).toHaveCount(0);
    // System controls: word + state per switch.
    const expectCtl = async (key: string, st: string, text: string) => {
      const row = page.getByTestId(`admin-control-${key}`);
      await expect(row).toHaveAttribute("data-state", st);
      await expect(row).toContainText(text);
    };
    await expectCtl("auto_junk_enabled", "ON", "On");
    await expectCtl("positive_junk_guard_mode", "ENFORCE", "Enforce");
    await expectCtl("reminder_hold_mode", "SHADOW", "Shadow");
    await expectCtl("call_quality_enforced", "OFF", "Off");
    await expectCtl("employee_home_mode", "PILOT", "Pilot · 2 pilots");
    await expectCtl("admin_home_mode", "ON", "On");
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/admin-a4-${role}-${info.project.name}.png`, fullPage: true });
  });
}

test("zero is neutral: grey numbers, 'same as yesterday'; a missing switch reads Not set up", async ({ page, context }) => {
  await setup(context, page);
  state.visits = [];
  state.bookings = [];
  state.junkNotes = [];
  state.guardEvents = [];
  delete (state.settings as Record<string, unknown>).employee_home_mode;
  await page.goto("/admin");
  for (const id of ["admin-sales-visit", "admin-sales-revisit", "admin-sales-booked", "admin-sales-bookings", "admin-sales-month", "admin-engine-junk"]) {
    await expect(page.getByTestId(id)).toHaveAttribute("data-tone", "zero");
    await expect(page.getByTestId(`${id}-delta`)).toHaveText("same as yesterday");
  }
  await expect(page.getByTestId("admin-control-employee_home_mode")).toHaveAttribute("data-state", "NOT_SET");
  await expect(page.getByTestId("admin-control-employee_home_mode")).toContainText("Not set up");
});

test("one card fails: Visits and bookings says so + Retry; System controls still shows", async ({ page, context }) => {
  await setup(context, page);
  state.fail.add("site_visits");
  await page.goto("/admin");
  await expect(page.getByTestId("admin-retry-sales")).toHaveText("Couldn't load visits and bookings. Tap to try again.");
  await expect(page.getByTestId("admin-control-auto_junk_enabled")).toBeVisible();
  await expect.poll(() => state.anomalies.some((a) => a.message.startsWith("admin-home:sales:"))).toBe(true);
  state.fail.delete("site_visits");
  await page.getByTestId("admin-retry-sales").click();
  await expect(page.getByTestId("admin-sales-visit-delta")).toHaveText("▲ 1 more");
});

test("System controls is display only: no buttons, inputs or switches", async ({ page, context }) => {
  await setup(context, page);
  await page.goto("/admin");
  await expect(page.getByTestId("admin-control-auto_junk_enabled")).toBeVisible();
  const card = page.getByTestId("admin-controls");
  await expect(card.locator("button, input, select, [role=switch]")).toHaveCount(0);
});

test("axe: colour contrast and target size with the A4 cards", async ({ page, context }) => {
  await setup(context, page);
  await page.goto("/admin");
  await expect(page.getByTestId("admin-sales-visit-delta")).toBeVisible();
  await expect(page.getByTestId("admin-control-auto_junk_enabled")).toBeVisible();
  await expect(page.getByTestId("admin-engine-junk")).toBeVisible();
  await page.waitForTimeout(400);
  await page.addScriptTag({ path: AXE });
  const violations = await page.evaluate(async () => {
    const w = window as unknown as { axe: { run: (c: Element, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } };
    const res = await w.axe.run(document.querySelector('[data-testid="admin-home-a1"]') as Element, { runOnly: { type: "rule", values: ["color-contrast", "target-size"] } });
    return res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 4).join(", ")}`);
  });
  expect(violations).toEqual([]);
});
