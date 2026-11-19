import { expect, test, type Page } from "@playwright/test";
import { EMP, mockSupabase, type MockState } from "./mockSupabase";

// Employee Home Phase 3 (2026-11-18): "Start with next lead" queue (Next after a saved result, Skip local only), the
// team leader card, the data-only variant. Flag off = none of it. Fake Supabase, Pixel 7 (Chromium) and iPhone 14
// (WebKit).

const H = 3600e3;

// lead-05: called an hour ago, no result yet (pending). lead-31: reminder today. lead-01..08 overdue Follow-up.
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
  });
  state.reminders = [{ lead_id: "lead-31", reminder_at: new Date(now + 60_000).toISOString() }];
}

let state: MockState;
let writes: string[];
test.beforeEach(async ({ context }) => {
  state = await mockSupabase(context);
  shape(state);
  state.workReport = { calls: 18, connected: 6, results_saved: 15, followUps: 3, visits: 1 };
  writes = [];
  context.on("request", (req) => {
    const url = new URL(req.url());
    // A write = a table insert/update/delete, or a writing RPC (log_*, *_atomic). Read RPCs (get_*) also use POST.
    const rpc = url.pathname.startsWith("/rest/v1/rpc/") ? url.pathname.slice("/rest/v1/rpc/".length) : null;
    const isWrite = rpc ? /^log_|_atomic$/.test(rpc) : req.method() !== "GET" && req.method() !== "HEAD";
    if (url.hostname === "fake-supabase.test" && url.pathname.startsWith("/rest/v1/") && isWrite && !url.pathname.includes("system_anomaly_log")) {
      writes.push(`${req.method()} ${url.pathname}`);
    }
  });
});

async function openHome(page: Page) {
  await page.goto("/");
  // E5: after the start window closes the new Home shows the one-line shift strip instead of the full card.
  await expect(page.getByText("Today's Shift").or(page.getByTestId("shift-compact")).first()).toBeVisible();
}
const modalName = (page: Page, name: string) => expect.poll(() => page.getByText(name, { exact: true }).count()).toBeGreaterThanOrEqual(1);
// The detail sheet closes with its X button (lucide X icon, no text).
const closeModal = (page: Page) => page.locator("button:has(svg.lucide-x)").first().click();
const height = async (page: Page, testId: string) => (await page.getByTestId(testId).boundingBox())?.height ?? 0;

test("flag off: no queue button, no team card, no data variant", async ({ page }) => {
  state.employee.role = "team_leader";
  state.employee.team_id = "team-1";
  await openHome(page);
  await page.waitForTimeout(1500);
  await expect(page.getByTestId("start-next")).toHaveCount(0);
  await expect(page.getByTestId("team-today")).toHaveCount(0);
  await expect(page.getByTestId("my-data")).toHaveCount(0);
});

test("queue: Start -> pending result first, a saved result opens the next lead, Skip is local, Exit", async ({ page }, info) => {
  state.settings.employee_home_mode = "on";
  await openHome(page);
  const start = page.getByTestId("start-next");
  await expect(start).toContainText("Start with next lead");
  await expect(page.getByTestId("start-next-count")).toContainText(/\d+ due now · \d+ total/);
  expect(await height(page, "start-next")).toBeGreaterThanOrEqual(44);
  const n = Number(((await page.getByTestId("start-next-count").textContent()) || "").match(/(\d+) total/)?.[1]);
  // Up next shows the queue's head: pending result, then the reminder.
  await expect(page.getByTestId("up-next").locator("li").nth(0)).toHaveAttribute("data-testid", "up-next-lead-05");
  await expect(page.getByTestId("up-next").locator("li").nth(1)).toHaveAttribute("data-testid", "up-next-lead-31");
  await page.screenshot({ path: `C:/work/reports/home_p3/home-p3-queue-button-${info.project.name}.png`, fullPage: true });

  await start.click();
  await expect(page).toHaveURL(/\/leads$/);
  await expect(page.getByRole("button", { name: /Log Update/ })).toBeVisible();
  const sheet = page.locator("div.fixed.z-50");
  await expect(sheet.getByText("Test Lead 05", { exact: true }).first()).toBeVisible();

  // Next = the modal's own result-save (log_lead_update_atomic), then the next lead opens by itself.
  await page.getByRole("button", { name: "Not Connected", exact: true }).click();
  await page.getByRole("button", { name: /Log Update/ }).click();
  await expect.poll(() => state.updates.map((u) => u.p_lead_id)).toEqual(["lead-05"]);
  await expect(sheet.getByText("Test Lead 31", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Log Update/ })).toBeVisible();

  // Close without saving: the queue bar offers Skip / Open / Exit.
  await closeModal(page);
  const bar = page.getByTestId("queue-bar");
  await expect(bar).toContainText(`Next lead 2 of ${n}`);
  for (const id of ["queue-skip", "queue-open", "queue-exit"]) expect(await height(page, id)).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: `C:/work/reports/home_p3/leads-queue-bar-${info.project.name}.png` });

  const before = writes.length;
  await page.getByTestId("queue-skip").click();
  await expect(page.getByRole("button", { name: /Log Update/ })).toBeVisible();
  expect(writes.slice(before)).toEqual([]); // Skip writes nothing
  const skipped = await page.evaluate((emp) => Object.keys(sessionStorage).filter((k) => k.startsWith(`homeQueueSkip:v1:${emp}:`)).map((k) => sessionStorage.getItem(k)), EMP);
  expect(skipped).toEqual([JSON.stringify(["lead-31"])]);

  // Saved and closed at once: the next lead does not pop open; the bar moves on to it.
  await page.getByRole("button", { name: "Not Connected", exact: true }).click();
  await page.getByRole("button", { name: /Log Update/ }).click();
  await expect.poll(() => state.updates.length).toBe(2);
  await closeModal(page);
  await expect(page.getByTestId("queue-bar")).toContainText(`Next lead 4 of ${n}`);
  await page.waitForTimeout(1500);
  await expect(page.getByRole("button", { name: /Log Update/ })).toHaveCount(0);

  // A new queue run leaves the skipped lead out.
  await page.goto("/leads?queue=1");
  await expect(page.getByRole("button", { name: /Log Update/ })).toBeVisible();
  await closeModal(page);
  // lead-05 has its result now (no longer pending), lead-31 was skipped: both are out of the new run.
  await expect(page.getByTestId("queue-bar")).toContainText(`Next lead 1 of ${n - 2}`);
  await expect(page.getByTestId("queue-bar")).not.toContainText("Test Lead 31");
  await expect(page.getByTestId("queue-bar")).not.toContainText("Test Lead 05");
  await page.getByTestId("queue-exit").click();
  await expect(page.getByTestId("queue-bar")).toHaveCount(0);
});

test("team leader: My team today from the team's own rows; an employee does not see it", async ({ page }, info) => {
  state.settings.employee_home_mode = "on";
  state.employee.role = "team_leader";
  state.employee.team_id = "team-1";
  state.teamPending = [{ id: "p1" }, { id: "p2" }];
  await openHome(page);
  const card = page.getByTestId("team-today");
  await expect(card).toBeVisible();
  await expect(page.getByTestId("team-on-shift")).toContainText("0/1");
  await expect(page.getByTestId("team-waiting")).toContainText("2");
  // lead-01..08 are overdue Follow-ups except lead-05, which was called an hour ago.
  await expect(page.getByTestId("team-at-risk")).toContainText("7");
  expect(await height(page, "team-at-risk")).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: `C:/work/reports/home_p3/home-p3-team-leader-${info.project.name}.png`, fullPage: true });
  await page.getByTestId("team-waiting").click();
  await expect(page).toHaveURL(/\/team/);
});

test("employee (not team leader): no team card", async ({ page }) => {
  state.settings.employee_home_mode = "on";
  state.employee.team_id = "team-1";
  await openHome(page);
  await expect(page.getByTestId("needs-attention")).toBeVisible();
  await expect(page.getByTestId("team-today")).toHaveCount(0);
});

test("data-only: DATA numbers as /data's cards count them, lead sections hidden", async ({ page }, info) => {
  state.settings.employee_home_mode = "on";
  state.leads = [];
  state.data[0].lead_history[0].call_count = 3; // last attempt
  state.data[1].lead_history[0].call_count = 1;
  await openHome(page);
  await expect(page.getByTestId("my-data")).toBeVisible();
  await expect(page.getByTestId("tile-data-untouched").locator("span").first()).toHaveText("38"); // two were called
  await expect(page.getByTestId("tile-data-calls-left").locator("span").first()).toHaveText(String(38 * 4 + 1 + 3));
  await expect(page.getByTestId("data-last-attempt")).toHaveText("1");
  await expect(page.getByTestId("needs-attention")).toHaveCount(0);
  await expect(page.getByTestId("up-next")).toHaveCount(0);
  await expect(page.getByTestId("tile-new")).toHaveCount(0);
  await page.screenshot({ path: `C:/work/reports/home_p3/home-p3-data-only-${info.project.name}.png`, fullPage: true });
  // Data queue: 38 untouched (oldest assignment first), then the 1-attempt-left one, then the 3-left one.
  await expect(page.getByTestId("start-next-count")).toHaveText("40 in the queue");
  await page.getByTestId("start-next").click();
  await expect(page).toHaveURL(/\/data$/);
  const sheet = page.locator("div.fixed.z-50");
  await expect(sheet.getByText("Test Data 40", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Not Connected", exact: true }).click();
  await page.getByRole("button", { name: /Log Update/ }).click();
  await expect.poll(() => state.updates.map((u) => u.p_lead_id)).toEqual(["data-40"]);
  await expect(sheet.getByText("Test Data 39", { exact: true }).first()).toBeVisible();
  await closeModal(page);
  await expect(page.getByTestId("queue-bar")).toContainText("Next lead 2 of 40");
});
