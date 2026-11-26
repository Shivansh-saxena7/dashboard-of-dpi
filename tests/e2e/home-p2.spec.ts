import { expect, test, type Page } from "@playwright/test";
import { EMP, mockSupabase, type MockState } from "./mockSupabase";

// Employee Home Phase 2 (2026-11-18): Needs attention (overdue follow-ups, reminders today, visits due today), Up next
// with LeadCard's Call, and the /leads "From Home" filters. Flag off = no Phase 2 at all. Home numbers = the /leads
// filter it opens. A Call from Up next comes back through the existing call-return flow. Fake Supabase, Pixel 7
// (Chromium) and iPhone 14 (WebKit).

const ENTRY_KEY = `activeCall:v1:${EMP}`;
const H = 3600e3;

// lead-01..08 called Follow-up with no activity for days (overdue), lead-10 Visit with a lock that ended an hour ago
// (due today), lead-11 Visit locked for a week (not due), lead-30 / lead-31 have a reminder today, the rest untouched.
function shape(state: MockState) {
  const now = Date.now();
  state.leads.forEach((lead, i) => {
    const n = i + 1;
    const h = lead.lead_history[0] as Record<string, unknown>;
    const called = (status: string, stage: string) => {
      lead.status = status;
      lead.board_stage = stage;
      h.call_count = 1;
      h.first_call_at = h.assigned_at;
      h.outcome_at = h.assigned_at;
      h.last_activity_at = new Date(Date.parse(String(h.assigned_at)) + 60_000).toISOString();
    };
    if (n <= 8) called("CONNECTED", "FOLLOW_UP");
    if (n === 10 || n === 11) {
      called("CONNECTED", "VISIT");
      h.pause_reason = "VISIT_LOCK";
      h.paused_until = new Date(n === 10 ? now - H : now + 7 * 24 * H).toISOString();
    }
  });
  state.reminders = [
    { lead_id: "lead-30", reminder_at: new Date(now + 60_000).toISOString() },
    { lead_id: "lead-31", reminder_at: new Date(now - 60_000).toISOString() }
  ];
}

let state: MockState;
let apiData: number;
test.beforeEach(async ({ context }) => {
  state = await mockSupabase(context);
  shape(state);
  state.workReport = { calls: 18, connected: 6, results_saved: 15, followUps: 3, visits: 1 };
  apiData = 0;
  context.on("request", (req) => {
    if (new URL(req.url()).pathname.startsWith("/api/data")) apiData++;
  });
});

async function openHome(page: Page) {
  await page.goto("/");
  // E5: after the start window closes the new Home shows the one-line shift strip instead of the full card.
  await expect(page.getByText("Today's Shift").or(page.getByTestId("shift-compact")).first()).toBeVisible();
}
const count = async (page: Page, testId: string) => Number((await page.getByTestId(testId).locator("b").first().textContent()) || "NaN");

test("flag off: no Needs attention, no Up next, the old Home", async ({ page }) => {
  await openHome(page);
  await expect.poll(() => apiData).toBeGreaterThan(0);
  await expect(page.getByTestId("needs-attention")).toHaveCount(0);
  await expect(page.getByTestId("up-next")).toHaveCount(0);
});

test("flag on: Needs attention, Up next order, 44px targets, screenshot", async ({ page }, info) => {
  state.settings.employee_home_mode = "on";
  await openHome(page);
  await expect(page.getByTestId("needs-attention")).toBeVisible();
  await expect(page.getByTestId("attention-reminders-today")).toContainText(/^2\s*Reminders today/);
  await expect(page.getByTestId("attention-visits-today")).toContainText(/^1\s*Visits due today/);
  expect(await count(page, "attention-followup-overdue")).toBeGreaterThan(0);
  // Reminders first (earliest first), then overdue follow-ups.
  const rows = page.getByTestId("up-next").locator("li");
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(0)).toHaveAttribute("data-testid", "up-next-lead-31");
  await expect(rows.nth(1)).toHaveAttribute("data-testid", "up-next-lead-30");
  await expect(rows.nth(0)).toContainText("Reminder today");
  await expect(rows.nth(2)).toContainText("Follow-up overdue");
  for (const id of ["attention-reminders-today", "attention-followup-overdue", "attention-visits-today", "up-next-call-lead-31"]) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box && box.height, id).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({ path: `C:/work/reports/home_p2/home-p2-on-${info.project.name}.png`, fullPage: true });
});

for (const [filter, testId] of [
  ["followup-overdue", "attention-followup-overdue"],
  ["reminders-today", "attention-reminders-today"],
  ["visits-today", "attention-visits-today"]
] as const) {
  test(`parity: Home ${filter} number = the /leads list it opens, chip clears it`, async ({ page }) => {
    state.settings.employee_home_mode = "on";
    await openHome(page);
    const n = await count(page, testId);
    expect(n).toBeGreaterThan(0);
    await page.getByTestId(testId).click();
    await expect(page).toHaveURL(/\/leads$/);
    const chip = page.getByTestId("home-filter-chip");
    await expect(chip).toContainText(`(${n})`);
    await expect(page.locator('[id^="lead-card-"]')).toHaveCount(n);
    if (filter === "visits-today") await expect(page.locator("#lead-card-lead-10")).toHaveCount(1);
    if (filter === "reminders-today") await expect(page.locator("#lead-card-lead-30, #lead-card-lead-31")).toHaveCount(2);
    const box = await chip.boundingBox();
    expect(box && box.height).toBeGreaterThanOrEqual(44);
    await chip.click();
    await expect(chip).toHaveCount(0);
    await expect(page.locator('[id^="lead-card-"]')).not.toHaveCount(n);
  });
}

test("Up next Call = LeadCard's Call: click logged, active call recorded, back from the dialer -> result form", async ({ page, context }) => {
  state.settings.employee_home_mode = "on";
  const clicks: string[] = [];
  await context.route("**/rest/v1/rpc/log_call_click_atomic", async (route) => {
    clicks.push(JSON.parse(route.request().postData() || "{}").p_lead_history_id);
    await route.fallback();
  });
  await openHome(page);
  const call = page.getByTestId("up-next-call-lead-31");
  await expect(call).toHaveAttribute("href", "tel:9000000031");
  await call.click();
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), ENTRY_KEY)).not.toBeNull();
  const entry = JSON.parse((await page.evaluate((k) => localStorage.getItem(k), ENTRY_KEY)) || "{}");
  expect(entry).toMatchObject({ leadId: "lead-31", listType: "LEAD", employeeId: EMP });
  await expect.poll(() => clicks).toEqual(["h-lead-31"]);
  // Warm return: the existing Resume strip on Home.
  await page.evaluate(() => {
    (window as unknown as { __vis?: string }).__vis = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    (window as unknown as { __vis?: string }).__vis = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByTestId("resume-call-strip")).toContainText("Test Lead 31");
  // Cold return: the OS closed the app during the call, so it starts a new session (sessionStorage empty) and the
  // first page goes straight to the lead with its result form (app/page.tsx takeColdStartResume, unchanged).
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expect(page).toHaveURL(/\/leads/);
  await expect(page.getByRole("button", { name: /Log Update/ })).toBeVisible();
  await expect.poll(() => page.getByText("Test Lead 31", { exact: true }).count()).toBeGreaterThanOrEqual(1);
});

test("all caught up: nothing overdue, no reminders, no visits", async ({ page }) => {
  state.settings.employee_home_mode = "on";
  state.reminders = [];
  for (const lead of state.leads) {
    const h = lead.lead_history[0] as Record<string, unknown>;
    lead.status = "NEW";
    lead.board_stage = "LEADS";
    h.call_count = 0;
    h.first_call_at = null;
    h.outcome_at = null;
    h.pause_reason = null;
    h.paused_until = null;
    h.last_activity_at = h.assigned_at;
  }
  await openHome(page);
  await expect(page.getByTestId("all-caught-up")).toBeVisible();
  await expect(page.getByTestId("up-next").locator("li").first()).toContainText("New");
});

test("reminders fail to load: said so, the other numbers still show", async ({ page }) => {
  state.settings.employee_home_mode = "on";
  state.remindersFail = true;
  await openHome(page);
  await expect(page.getByTestId("reminders-error")).toHaveText("Reminders couldn't load, so they are not counted here.");
  await expect(page.getByTestId("attention-reminders-today")).toHaveCount(0);
  await expect(page.getByTestId("attention-visits-today")).toContainText(/^1\s*Visits due today/);
  await expect(page.getByTestId("tile-new")).toBeVisible();
});
