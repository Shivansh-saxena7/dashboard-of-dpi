import fs from "fs";
import { expect, test, type Page } from "@playwright/test";
import { mockSupabase, type MockState } from "./mockSupabase";

// Employee Home v3 (2026-11-29): greeting + message of the day, "Do this now" (one main action), today's progress,
// today's follow-ups (late first, then today's by time, Call keeps the old flow), quick-number tiles. Numbers from one
// source (the same hook as the previous Home). Phone: one column; desktop: two columns. Fake data only.
// Pixel 7, iPhone 14, desktop. Screenshots old (?home=p1, local only) vs new.

const SHOTS = "C:/work/reports/employee_home_v3";
fs.mkdirSync(SHOTS, { recursive: true });
let state: MockState;
const DAY = 86400e3;

function istNoonYesterday(): string {
  const ist = new Date(Date.now() + 5.5 * 3600e3);
  const d = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - DAY + 6.5 * 3600e3;
  return new Date(d).toISOString();
}

function shape(state: MockState) {
  const now = Date.now();
  state.leads.forEach((lead, i) => {
    const n = i + 1;
    const h = lead.lead_history[0] as Record<string, unknown>;
    const work = (status: string, stage: string, lastMs: number) => {
      lead.status = status;
      lead.board_stage = stage;
      h.call_count = 1;
      h.first_call_at = h.assigned_at;
      h.outcome_at = new Date(lastMs).toISOString();
      h.last_activity_at = new Date(lastMs).toISOString();
    };
    if (n <= 2) work("CONNECTED", "FOLLOW_UP", now - 3600e3);
    else if (n === 3) work("CONNECTED", "FOLLOW_UP", now - 2 * DAY); // missed yesterday reminder, nothing done since
    else if (n === 4) work("CONNECTED", "FOLLOW_UP", now - 6 * DAY); // overdue follow-up
    else if (n <= 8) work("CONNECTED", "VISIT", now - 3600e3);
  });
  state.reminders = [
    { lead_id: "lead-01", reminder_at: new Date(now + 2 * 3600e3).toISOString() },
    { lead_id: "lead-02", reminder_at: new Date(now + 1 * 3600e3).toISOString() },
    { lead_id: "lead-03", reminder_at: istNoonYesterday() }
  ];
  state.workReport = { calls: 18, connected: 6, results_saved: 15, followUps: 3, visits: 1 };
}

test.beforeEach(async ({ context }) => {
  state = await mockSupabase(context);
  await context.routeWebSocket(/fake-supabase\.test\/realtime\/v1\/websocket/, () => {});
  await context.route("https://fake-supabase.test/rest/v1/rpc/get_last_notes", (route) => {
    const ids = (route.request().postDataJSON() as { p_history_ids: string[] }).p_history_ids;
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(ids.map((id) => ({ lead_history_id: id, note: "Fake note: call after 5", created_at: new Date().toISOString() }))) });
  });
});

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test("Home v3: greeting, Do this now, progress, follow-ups (late first), tiles; one number source; 44px; screenshots", async ({ page }, info) => {
  state.settings.employee_home_mode = "on";
  shape(state);
  await page.goto("/");
  const home = page.getByTestId("home3");
  await expect(home.getByTestId("home3-hero")).toBeVisible();
  await expect(home.getByTestId("home3-greeting").locator("h1")).toHaveText(/^Good (morning|afternoon|evening)(, \S+)?$/);
  await expect(home.getByTestId("home3-motd")).not.toBeEmpty();
  // Do this now = the late follow-ups (1 missed yesterday + 1 overdue), the same number the follow-up card shows as late
  await expect(home.getByTestId("home3-hero-title")).toHaveText(/^Call your late follow-ups \d+$/);
  const heroN = Number((await home.getByTestId("home3-hero-title").textContent())!.match(/(\d+)$/)![1]);
  const lateLine = (await home.getByTestId("home3-fu-late").textContent())!.match(/(\d+) late · (\d+) due later today/)!;
  expect(Number(lateLine[1])).toBe(heroN); // one source: the same late number in both places
  expect(Number(lateLine[2])).toBe(2);
  await expect(home.getByTestId("home3-fu-count")).toHaveText(String(heroN + 2));
  const start = home.getByTestId("home3-start");
  await expect(start).toHaveAttribute("href", /\/leads\?queue=1/);
  expect((await start.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  // follow-ups: late first, then today's by time (lead-02 at +1 h before lead-01 at +2 h)
  const cards = home.getByTestId("home3-followups").locator('li[data-testid^="home3-fu-lead"]');
  await expect(cards.first()).toBeVisible();
  const order = await cards.evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")!.replace("home3-fu-", "")));
  expect(order.slice(-2)).toEqual(["lead-02", "lead-01"]); // today's by time, after the late ones
  expect(order[0]).toBe("lead-03"); // late first (missed yesterday)
  await expect(home.getByTestId("home3-fu-lead-02")).toContainText(/Due \d{1,2}:\d{2} (AM|PM)/);
  await expect(home.getByTestId("home3-fu-lead-03")).toContainText("Missed yesterday");
  await expect(home.getByTestId("home3-fu-lead-02")).toContainText("Fake note: call after 5");
  const call = home.getByTestId("home3-fu-call-lead-02");
  await expect(call).toHaveAttribute("href", /^tel:/);
  expect((await call.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  // progress from the same work report as the old Home
  await expect(home.getByTestId("home3-progress-text")).toContainText("15 results saved");
  // tiles open the right filtered lists
  await expect(home.getByTestId("home3-tile-new")).toHaveAttribute("href", /filter=new/);
  await expect(home.getByTestId("home3-tile-visits")).toHaveAttribute("href", /filter=visits-today/);
  await expect(home.getByTestId("home3-tile-recycling")).toHaveAttribute("href", /filter=recycling-tomorrow/);
  for (const a of await home.locator("a, button").all()) if (await a.isVisible()) expect((await a.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await noSideScroll(page)).toBe(true);
  expect(await home.evaluate((el) => /purple|violet|fuchsia/.test(el.innerHTML))).toBe(false);
  if (info.project.name === "desktop-chromium") {
    const hero = (await home.getByTestId("home3-hero").boundingBox())!;
    const fu = (await home.getByTestId("home3-followups").boundingBox())!;
    expect(fu.x).toBeGreaterThan(hero.x + hero.width - 1); // follow-ups in the right column
  }
  // the tab says Home
  // the tab bar (desktop only) says Home, never Posts
  if (info.project.name === "desktop-chromium") {
    await expect(page.getByRole("link", { name: "Home" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Posts" })).toHaveCount(0);
  }
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/new-${info.project.name}.png`, fullPage: true });
  // the previous Home for comparison (local / preview only)
  await page.goto("/?home=p1");
  await expect(page.getByTestId("home3")).toHaveCount(0);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/old-${info.project.name}.png`, fullPage: true });
});

test("Home v3: nothing due -> All caught up, no follow-ups", async ({ page }) => {
  state.settings.employee_home_mode = "on";
  state.leads.forEach((l) => {
    l.status = "CONVERTED";
    l.board_stage = "BOOKING";
  });
  state.workReport = { calls: 5, connected: 3, results_saved: 5, followUps: 1, visits: 0 };
  await page.goto("/");
  await expect(page.getByTestId("home3-hero")).toHaveAttribute("data-state", "clear");
  await expect(page.getByTestId("home3-hero")).toContainText("All caught up");
  await expect(page.getByTestId("home3-fu-empty")).toHaveText(/No follow-ups today/);
  await expect(page.getByTestId("home3-progress")).toContainText("Today's list is done");
});

test("Home v3: leads fail to load -> friendly retry", async ({ page }) => {
  state.settings.employee_home_mode = "on";
  state.fail.add("leads");
  await page.goto("/");
  await expect(page.getByTestId("home3-error")).toContainText("We couldn't load your leads just now.");
  state.fail.delete("leads");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("home3-hero")).toBeVisible();
});

test("Home v3: flag off -> the old Home exactly (no v3)", async ({ page }) => {
  state.settings.employee_home_mode = "off";
  await page.goto("/");
  await page.waitForTimeout(2500);
  await expect(page.getByTestId("home3")).toHaveCount(0);
});
