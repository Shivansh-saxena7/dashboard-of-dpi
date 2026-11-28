import { expect, test, type Page } from "@playwright/test";
import { EMP, mockSupabase, type MockState } from "./mockSupabase";

// Employee Home E4 (2026-11-19): non-sales keep the old Home; "Called, no result" opens the result form; yesterday's
// missed reminders; "N due now · M total" on the Start button; the queue resumes after a cold restart during a call;
// one-tap Skip inside the sheet (nothing typed carries over). Fake Supabase, Pixel 7 (Chromium) and iPhone 14 (WebKit).

const H = 3600e3;
const ENTRY_KEY = `activeCall:v1:${EMP}`;
const istNoonYesterday = () => {
  const ist = new Date(Date.now() + 5.5 * H);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - 1, 12) - 5.5 * H).toISOString();
};

// lead-01..08 overdue Follow-up; lead-05 called an hour ago with no result; lead-31 reminder today; lead-32 reminder
// yesterday, nothing done since (missed); lead-33 reminder yesterday but worked since (not missed, no longer New).
function shape(state: MockState) {
  const now = Date.now();
  state.leads.forEach((lead, i) => {
    const n = i + 1;
    const h = lead.lead_history[0] as Record<string, unknown>;
    if (n <= 8) {
      lead.status = "CONNECTED";
      lead.board_stage = "FOLLOW_UP";
      h.call_count = 1;
      h.first_call_at = h.assigned_at;
      h.outcome_at = h.assigned_at;
      h.last_activity_at = new Date(Date.parse(String(h.assigned_at)) + 60_000).toISOString();
    }
    if (n === 5) {
      h.last_call_click_at = new Date(now - H).toISOString();
      h.last_activity_at = h.last_call_click_at;
    }
    if (n === 33) h.last_activity_at = new Date(now - 60_000).toISOString();
  });
  state.reminders = [
    { lead_id: "lead-31", reminder_at: new Date(now + 60_000).toISOString() },
    { lead_id: "lead-32", reminder_at: istNoonYesterday() },
    { lead_id: "lead-33", reminder_at: istNoonYesterday() }
  ];
}

let state: MockState;
let writes: string[];
let apiData: number;
test.beforeEach(async ({ context }) => {
  state = await mockSupabase(context);
  shape(state);
  state.workReport = { calls: 18, connected: 6, results_saved: 15, followUps: 3, visits: 1 };
  writes = [];
  apiData = 0;
  context.on("request", (req) => {
    const url = new URL(req.url());
    if (url.pathname.startsWith("/api/data")) apiData++;
    const rpc = url.pathname.startsWith("/rest/v1/rpc/") ? url.pathname.slice("/rest/v1/rpc/".length) : null;
    const isWrite = rpc ? /^log_|_atomic$/.test(rpc) : req.method() !== "GET" && req.method() !== "HEAD";
    if (url.hostname === "fake-supabase.test" && url.pathname.startsWith("/rest/v1/") && isWrite && !url.pathname.includes("system_anomaly_log")) writes.push(`${req.method()} ${url.pathname}`);
  });
});

const sheet = (page: Page) => page.locator("div.fixed.z-50");
const closeModal = (page: Page) => page.locator("button:has(svg.lucide-x)").first().click();
const height = async (page: Page, testId: string) => (await page.getByTestId(testId).boundingBox())?.height ?? 0;
async function openHome(page: Page) {
  await page.goto("/?home=p1");
  // E5: after the start window closes the new Home shows the one-line shift strip instead of the full card.
  await expect(page.getByText("Today's Shift").or(page.getByTestId("shift-compact")).first()).toBeVisible();
}

test("flag off: none of E4 shows", async ({ page }) => {
  await openHome(page);
  await expect.poll(() => apiData).toBeGreaterThan(0);
  await expect(page.getByTestId("attention-pending-result")).toHaveCount(0);
  await expect(page.getByTestId("start-next")).toHaveCount(0);
});

for (const department of ["marketing", "accounts"]) {
  test(`non-sales (${department}), flag on: the old Home, no lead widgets`, async ({ page }) => {
    state.settings.employee_home_mode = "on";
    state.employee.department = department;
    await page.goto("/?home=p1");
    await expect.poll(() => apiData).toBeGreaterThan(0); // old social posts card, open as before
    await page.waitForTimeout(1500);
    await expect(page.getByTestId("employee-home-p1")).toHaveCount(0);
    await expect(page.getByTestId("start-next")).toHaveCount(0);
    await expect(page.getByText("Today's Shift")).toHaveCount(0); // Start Shift is Sales-only, as before
  });
}

test("flag on: Called no result + missed reminders rows, due-now count, screenshot", async ({ page }, info) => {
  state.settings.employee_home_mode = "on";
  await openHome(page);
  const rows = page.getByTestId("needs-attention").locator("li");
  await expect(rows.nth(0)).toHaveText(/^1\s*Called, no result/);
  await expect(rows.nth(1)).toHaveText(/^1\s*Missed reminders \(yesterday\)/);
  for (const id of ["attention-pending-result", "attention-reminders-missed", "start-next"]) expect(await height(page, id)).toBeGreaterThanOrEqual(44);
  // Queue: pending 1, missed 1, reminder today 1, overdue 7; plus 49 untouched New (lead-33 was worked) = 59.
  await expect(page.getByTestId("start-next-count")).toHaveText("10 due now · 59 total");
  const upNext = page.getByTestId("up-next").locator("li");
  await expect(upNext.nth(0)).toContainText("Called, no result");
  await expect(upNext.nth(1)).toHaveAttribute("data-testid", "up-next-lead-32");
  await expect(upNext.nth(1)).toContainText("Missed reminder (yesterday)");
  await expect(upNext.nth(2)).toHaveAttribute("data-testid", "up-next-lead-31");
  await page.screenshot({ path: `C:/work/reports/home_e4/home-e4-${info.project.name}.png`, fullPage: true });
});

test("Called, no result: one lead -> its sheet with the result form; two -> the /leads list", async ({ page }) => {
  state.settings.employee_home_mode = "on";
  await openHome(page);
  await page.getByTestId("attention-pending-result").click();
  await expect(page).toHaveURL(/\/leads$/);
  await expect(page.getByRole("button", { name: /Log Update/ })).toBeVisible();
  await expect(sheet(page).getByText("Test Lead 05", { exact: true }).first()).toBeVisible();

  (state.leads[5].lead_history[0] as Record<string, unknown>).last_call_click_at = new Date(Date.now() - 2 * H).toISOString();
  await openHome(page);
  await expect(page.getByTestId("attention-pending-result")).toHaveText(/^2\s*Called, no result/);
  await page.getByTestId("attention-pending-result").click();
  await expect(page.getByTestId("home-filter-chip")).toContainText("Called, no result (2)");
  await expect(page.locator('[id^="lead-card-"]')).toHaveCount(2);
});

test("missed reminders row = the /leads list it opens", async ({ page }) => {
  state.settings.employee_home_mode = "on";
  await openHome(page);
  await page.getByTestId("attention-reminders-missed").click();
  await expect(page.getByTestId("home-filter-chip")).toContainText("Missed reminders (yesterday) (1)");
  await expect(page.locator('[id^="lead-card-"]')).toHaveCount(1);
  await expect(page.locator("#lead-card-lead-32")).toHaveCount(1);
});

test("one-tap Skip inside the sheet: next lead, nothing written, typed note does not carry over", async ({ page }) => {
  state.settings.employee_home_mode = "on";
  await openHome(page);
  await page.getByTestId("start-next").click();
  await expect(sheet(page).getByText("Test Lead 05", { exact: true }).first()).toBeVisible();
  await page.getByPlaceholder("Add a note (optional)...").fill("half-typed note");
  expect(await height(page, "sheet-queue-skip")).toBeGreaterThanOrEqual(44);
  const before = writes.length;
  await page.getByTestId("sheet-queue-skip").click();
  await expect(sheet(page).getByText("Test Lead 32", { exact: true }).first()).toBeVisible();
  await expect(page.getByPlaceholder("Add a note (optional)...")).toHaveValue("");
  expect(writes.slice(before)).toEqual([]);
  const skips = await page.evaluate((emp) => Object.keys(sessionStorage).filter((k) => k.startsWith(`homeQueueSkip:v1:${emp}:`)).map((k) => sessionStorage.getItem(k)), EMP);
  expect(skips).toEqual([JSON.stringify(["lead-05"])]);
});

test("queue resumes after a cold restart during a call; bar screenshot after the sheet closes", async ({ page }, info) => {
  state.settings.employee_home_mode = "on";
  await openHome(page);
  const total = Number(((await page.getByTestId("start-next-count").textContent()) || "").match(/(\d+) total/)?.[1]);
  await page.getByTestId("start-next").click();
  await expect(sheet(page).getByText("Test Lead 05", { exact: true }).first()).toBeVisible();
  await sheet(page).locator('a[href^="tel:"]').first().click();
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), ENTRY_KEY)).not.toBeNull();

  // The OS closed the app during the call: a new session starts at Home and call-return opens the lead.
  await page.evaluate(() => sessionStorage.clear());
  await page.goto("/?home=p1");
  await expect(page).toHaveURL(/\/leads/);
  await expect(sheet(page).getByText("Test Lead 05", { exact: true }).first()).toBeVisible();
  await closeModal(page);
  const bar = page.getByTestId("queue-bar");
  await expect(bar).toContainText(`Next lead 1 of ${total}`);
  await page.waitForTimeout(600); // sheet slide-out finished
  await page.screenshot({ path: `C:/work/reports/home_e4/leads-queue-bar-${info.project.name}.png` });

  // The resumed queue goes on: save -> the next lead opens.
  await page.getByTestId("queue-open").click();
  await page.getByRole("button", { name: "Not Connected", exact: true }).click();
  await page.getByRole("button", { name: /Log Update/ }).click();
  await expect.poll(() => state.updates.map((u) => u.p_lead_id)).toEqual(["lead-05"]);
  await expect(sheet(page).getByText("Test Lead 32", { exact: true }).first()).toBeVisible();

  // Exit clears today's stored run.
  await closeModal(page);
  await page.getByTestId("queue-exit").click();
  expect(await page.evaluate((emp) => localStorage.getItem(`homeQueue:v1:${emp}:LEAD`), EMP)).toBeNull();
});
