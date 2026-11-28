import fs from "fs";
import { expect, test, type Page } from "@playwright/test";
import { mockSupabase, type MockState } from "./mockSupabase";

// Employee Home v3 (2026-11-29, final): hero band (greeting, message of the day, shift status, progress ring, numbers),
// Today's plan stepper (results -> callbacks due now -> new leads -> late follow-ups; done = tick, first open = "You
// are here", one primary button), Next best lead, Today's follow-ups (Late / Due today tabs, late-day chips, the full
// list behind View all), Recycle alert, Visits today. Every number from one source; the test checks they match.
// Desktop 1366x768 and 1920x1080 (main things visible without scrolling), Pixel 7, iPhone 14. Fake data only.

const SHOTS = "C:/work/reports/employee_home_v3";
fs.mkdirSync(SHOTS, { recursive: true });
let state: MockState;
const DAY = 86400e3;

function istYesterdayAt(h: number): string {
  const ist = new Date(Date.now() + 5.5 * 3600e3);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - DAY + (h - 5.5) * 3600e3).toISOString();
}
function istTodayEnd(): number {
  const ist = new Date(Date.now() + 5.5 * 3600e3);
  return Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) + DAY - 5.5 * 3600e3;
}

// 2 callbacks today (one due now, one later), 5 missed yesterday + 2 overdue = 7 late, 1 visit today, 40 untouched new.
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
    else if (n <= 7) work("CONNECTED", "FOLLOW_UP", now - 2 * DAY); // missed yesterday's reminder, nothing done since
    else if (n <= 9) work("CONNECTED", "FOLLOW_UP", now - 6 * DAY); // overdue follow-up
    else if (n === 10) {
      work("CONNECTED", "VISIT", now - 3600e3);
      h.pause_reason = "VISIT_LOCK";
      h.paused_until = new Date(Math.min(now + 2 * 3600e3, istTodayEnd() - 60_000)).toISOString();
    } else if (n <= 20) work("NOT_CONNECTED", "LEADS", now - 3600e3);
  });
  state.reminders = [
    { lead_id: "lead-01", reminder_at: new Date(now - 30 * 60_000).toISOString() },
    { lead_id: "lead-02", reminder_at: new Date(now + 3600e3).toISOString() },
    ...[3, 4, 5, 6, 7].map((n) => ({ lead_id: `lead-0${n}`, reminder_at: istYesterdayAt(12) }))
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

// The tiles sit in the hero on desktop and at the end on a phone: read the visible one.
const num = async (page: Page, id: string) => Number(((await page.locator(`[data-testid="${id}"]:visible`).first().textContent()) ?? "").match(/\d+/)?.[0] ?? NaN);
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
async function roleShots(page: Page, project: string, role: string) {
  if (project !== "desktop-chromium") return page.screenshot({ path: `${SHOTS}/${role}-${project}.png`, fullPage: true });
  for (const [w, hh] of [[1366, 768], [1920, 1080]] as const) {
    await page.setViewportSize({ width: w, height: hh });
    await page.waitForTimeout(400);
    expect(await noSideScroll(page)).toBe(true);
    await page.screenshot({ path: `${SHOTS}/${role}-${w}x${hh}.png` });
  }
}

test("Home v3: plan stepper, spotlight, follow-ups (full list), recycle, visits, tiles; one number source; 44px", async ({ page }, info) => {
  state.settings.employee_home_mode = "on";
  shape(state);
  await page.goto("/");
  const home = page.getByTestId("home3");
  await expect(home.getByTestId("home3-plan")).toBeVisible();
  await expect(home.getByTestId("home3-greeting").locator("h1")).toHaveText(/^Good (morning|afternoon|evening)(, \S+)?$/);
  await expect(home.getByTestId("home3-motd")).not.toBeEmpty();
  await expect(home.getByTestId("shift-hero")).toBeVisible();
  await expect(page.getByTestId("shift-compact")).toHaveCount(0); // no separate white shift strip
  // stepper: order, tick for done, the first open step is current
  const keys = await home.locator('[data-testid^="home3-step-"][data-state]').evaluateAll((els) => els.map((e) => `${e.getAttribute("data-testid")!.replace("home3-step-", "")}:${e.getAttribute("data-state")}`));
  expect(keys).toEqual(["results:done", "callbacks:current", "new:later", "late:later"]);
  await expect(home.getByTestId("home3-step-callbacks")).toContainText("You are here");
  const results = await num(page, "home3-step-results-count"), callbacks = await num(page, "home3-step-callbacks-count");
  const fresh = await num(page, "home3-step-new-count"), late = await num(page, "home3-step-late-count");
  expect([results, callbacks, late]).toEqual([0, 1, 7]);
  await expect(home.getByTestId("home3-left")).toHaveText(`${results + callbacks + fresh + late} more to finish today's list`);
  await expect(home.getByTestId("home3-start")).toHaveAttribute("href", /\/leads\?queue=1/);
  // one source: the same numbers everywhere
  expect(await num(page, "home3-tab-late")).toBe(late);
  expect(await num(page, "home3-tab-today")).toBe(2);
  expect(await num(page, "home3-fu-count")).toBe(late + 2);
  expect(await num(page, "home3-tile-new")).toBe(fresh);
  const chips = (await home.getByTestId("home3-late-chips").locator("span").allTextContents()).map((t) => Number(t.split("·")[1]));
  expect(chips.reduce((a, b) => a + b, 0)).toBe(late); // "1 day · a" + "2-3 days · b" + "4+ days · c"
  // the full list: 5 shown, View all with the full count
  await expect(home.getByTestId("home3-fu-list").locator("li")).toHaveCount(5);
  await expect(home.getByTestId("home3-fu-all")).toHaveText(new RegExp(`View all ${late}`));
  await home.getByTestId("home3-tab-today").click();
  const todayRows = home.getByTestId("home3-fu-list").locator("li");
  await expect(todayRows).toHaveCount(2);
  await expect(todayRows.nth(0)).toContainText(/Due now \(\d{1,2}:\d{2} (AM|PM)\)/);
  await expect(todayRows.nth(1)).toContainText(/Due \d{1,2}:\d{2} (AM|PM)/);
  await expect(todayRows.nth(0)).toContainText("Fake note: call after 5");
  // spotlight: a late Follow-up lead first, with the big Call (old call flow: tel:)
  const spot = home.getByTestId("home3-spotlight");
  await expect(spot).toContainText(/Missed yesterday|Missed \d+ days ago|\d+ days? late/);
  const bigCall = spot.locator('a[href^="tel:"]');
  expect((await bigCall.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  // recycle alert and visits use the same numbers as the tiles
  const recycle = await num(page, "home3-tile-recycling");
  await expect(home.getByTestId("home3-recycle")).toHaveAttribute("href", /filter=recycling-tomorrow/);
  if (recycle > 0) await expect(home.getByTestId("home3-recycle")).toContainText(`${recycle} lead`);
  expect(await num(page, "home3-tile-visits")).toBe(await home.getByTestId("home3-visits").locator("li").count());
  for (const a of await home.locator("a, button").all()) if (await a.isVisible()) expect((await a.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await noSideScroll(page)).toBe(true);
  expect(await home.evaluate((el) => /purple|violet|fuchsia/.test(el.innerHTML))).toBe(false);
  if (info.project.name === "desktop-chromium") {
    await expect(page.getByRole("link", { name: "Home" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Posts" })).toHaveCount(0);
  }
  await home.getByTestId("home3-tab-late").click();
  await page.waitForTimeout(900);
  if (info.project.name === "desktop-chromium") {
    for (const [w, h] of [[1366, 768], [1920, 1080]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(400);
      // main things visible without scrolling: hero, plan + button, follow-ups header
      for (const id of ["home3-hero-band", "home3-start", "home3-followups"]) {
        const b = (await home.getByTestId(id).boundingBox())!;
        expect(b.y, `${id} at ${w}x${h}`).toBeLessThan(h);
      }
      const plan = (await home.getByTestId("home3-plan").boundingBox())!;
      const fu = (await home.getByTestId("home3-followups").boundingBox())!;
      expect(fu.x).toBeGreaterThan(plan.x + plan.width - 1); // right column
      expect(await noSideScroll(page)).toBe(true);
      await page.screenshot({ path: `${SHOTS}/employee-${w}x${h}.png` });
    }
  } else {
    await page.screenshot({ path: `${SHOTS}/employee-${info.project.name}.png`, fullPage: true });
  }
});

test("Home v3: nothing due -> every step ticked, All caught up, no follow-ups", async ({ page }) => {
  state.settings.employee_home_mode = "on";
  state.leads.forEach((l) => {
    l.status = "CONVERTED";
    l.board_stage = "BOOKING";
  });
  state.workReport = { calls: 5, connected: 3, results_saved: 5, followUps: 1, visits: 0 };
  await page.goto("/");
  await expect(page.getByTestId("home3-clear")).toContainText("All caught up");
  const states = await page.locator('[data-testid^="home3-step-"][data-state]').evaluateAll((els) => els.map((e) => e.getAttribute("data-state")));
  expect(states).toEqual(["done", "done", "done", "done"]);
  await expect(page.getByTestId("home3-fu-empty")).toHaveText("No follow-ups today");
  await expect(page.getByTestId("home3-spot-clear")).toContainText("All caught up");
  await expect(page.getByTestId("home3-progress")).toContainText("Today's list is done");
});

test("Home v3: leads fail to load -> friendly Retry", async ({ page }) => {
  state.settings.employee_home_mode = "on";
  state.fail.add("leads");
  await page.goto("/");
  await expect(page.getByTestId("home3-error")).toContainText("We couldn't load your leads just now.");
  state.fail.delete("leads");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("home3-plan")).toBeVisible();
});

test("Home v3: a team leader gets v3 with My team today (after the follow-ups)", async ({ page }, info) => {
  state.settings.employee_home_mode = "on";
  shape(state);
  state.employee.role = "team_leader";
  (state.employee as Record<string, unknown>).team_id = "team-1";
  state.teamPending = [{ id: "p1" }, { id: "p2" }];
  await page.goto("/");
  await expect(page.getByTestId("home3-plan")).toBeVisible();
  const team = page.getByTestId("home3-team");
  await expect(team).toContainText("My team today");
  await expect(team.getByTestId("team-waiting")).toContainText("2");
  const fu = (await page.getByTestId("home3-followups").boundingBox())!;
  const tb = (await team.boundingBox())!;
  expect(tb.y).toBeGreaterThan(fu.y); // below the follow-ups (same column on desktop, after them on a phone)
  await page.waitForTimeout(800);
  await roleShots(page, info.project.name, "team-leader");
});

test("Home v3: a DATA-only employee gets v3 with a DATA plan (lead-only parts hidden)", async ({ page }, info) => {
  state.settings.employee_home_mode = "on";
  state.leads = [];
  state.data[0].lead_history[0].call_count = 3; // last attempt
  state.data[1].lead_history[0].call_count = 1;
  await page.goto("/");
  const home = page.getByTestId("home3");
  await expect(home).toHaveAttribute("data-variant", "data");
  await expect(home.getByTestId("home3-plan")).toHaveAttribute("data-variant", "data");
  const steps = await home.locator('[data-testid^="home3-step-"][data-state]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")!.replace("home3-step-", "")));
  expect(steps).toEqual(["untouched", "lastAttempt", "atRisk"]);
  expect(await num(page, "home3-step-untouched-count")).toBe(await num(page, "home3-tile-data-untouched"));
  expect(await num(page, "home3-step-lastAttempt-count")).toBe(await num(page, "home3-tile-data-last"));
  await expect(home.getByTestId("home3-start")).toHaveAttribute("href", /\/data\?queue=1/);
  for (const id of ["home3-followups", "home3-spotlight", "home3-recycle", "home3-visits", "home3-stages"]) await expect(home.getByTestId(id)).toHaveCount(0);
  await expect(home.getByTestId("home3-social")).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
  await page.waitForTimeout(800);
  await roleShots(page, info.project.name, "data-only");
});

test("Home v3: leave strip from the light read; when that read fails the Home still works; no call-quality call on load", async ({ page }) => {
  state.settings.employee_home_mode = "on";
  shape(state);
  const cqCalls: string[] = [];
  page.on("request", (r) => r.url().includes("get_call_quality_summary") && cqCalls.push(r.url()));
  const ist = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  state.leave = [{ employee_id: String(state.employee.id), start_date: ist, end_date: ist }];
  await page.goto("/");
  await expect(page.getByTestId("home3-leave")).toBeVisible();
  await page.waitForTimeout(1500);
  expect(cqCalls).toEqual([]);
  // call quality only on tap
  state.cq = { enforced: false, estimated: false, employees: [{ by_card_type: { LEAD: { dial_clicks: 40, genuine_score: 86 } } }] };
  await page.getByTestId("home3-cq-check").click();
  await expect(page.getByTestId("home3-cq-line").first()).toBeVisible();
  expect(cqCalls.length).toBe(1);
  // the leave read failing never breaks the Home
  await page.evaluate(() => sessionStorage.clear());
  state.fail.add("employee_leave_periods");
  await page.goto("/");
  await expect(page.getByTestId("home3-plan")).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.getByTestId("home3-leave")).toHaveCount(0);
  await expect(page.getByTestId("home3-error")).toHaveCount(0);
});

test("Home v3: social posts kept at the bottom (collapsed, opens the posts view)", async ({ page }) => {
  state.settings.employee_home_mode = "on";
  shape(state);
  await page.goto("/");
  const social = page.getByTestId("home3-social");
  await expect(social).toBeVisible();
  const toggle = social.getByTestId("home3-social-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
});

test("Home v3: flag off -> the old Home exactly (no v3)", async ({ page }) => {
  state.settings.employee_home_mode = "off";
  await page.goto("/");
  await page.waitForTimeout(2500);
  await expect(page.getByTestId("home3")).toHaveCount(0);
});

test("screenshots: previous Home, and header + lead cards + Home side by side (colour check)", async ({ page }, info) => {
  state.settings.employee_home_mode = "on";
  shape(state);
  await page.goto("/?home=p1");
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${SHOTS}/old-${info.project.name}.png`, fullPage: info.project.name !== "desktop-chromium" });
  if (info.project.name !== "desktop-chromium") return;
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/leads");
  await page.waitForTimeout(2500);
  const leads = await page.screenshot();
  await page.goto("/?home=v3");
  await expect(page.getByTestId("home3-plan")).toBeVisible();
  await page.waitForTimeout(900);
  const home = await page.screenshot();
  const b64 = (b: Buffer) => `data:image/png;base64,${b.toString("base64")}`;
  await page.setViewportSize({ width: 1600, height: 560 });
  await page.setContent(`<body style="margin:0;background:#fff;display:flex;gap:12px;padding:12px;font:14px sans-serif">
    <figure style="margin:0;width:780px"><img src="${b64(leads)}" style="width:100%;border:1px solid #e8edf3"/><figcaption>Header + lead cards (/leads)</figcaption></figure>
    <figure style="margin:0;width:780px"><img src="${b64(home)}" style="width:100%;border:1px solid #e8edf3"/><figcaption>Home v3</figcaption></figure></body>`);
  await page.screenshot({ path: `${SHOTS}/colour-side-by-side.png`, fullPage: true });
});
