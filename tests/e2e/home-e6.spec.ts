import { expect, test, type Page } from "@playwright/test";
import { EMP, mockSupabase, type MockState } from "./mockSupabase";

// Employee Home E6 (2026-11-19), flag on only: leave strip (on leave / return grace / coming up), "Snooze ends today",
// "Given to you" (given_lead_context) with its queue step, the DATA count for LEAD+DATA employees, and the display-only
// Call Quality card (own score, Learning week note). Fake Supabase, Pixel 7 (Chromium) and iPhone 14 (WebKit).

const SHOTS = "C:/work/reports/home_e6";
const IST = (s: string) => new Date(`${s}+05:30`);

let state: MockState;
let cqBodies: Record<string, unknown>[];
test.beforeEach(async ({ context }) => {
  state = await mockSupabase(context);
  state.workReport = { calls: 18, connected: 6, results_saved: 15, followUps: 3, visits: 1 };
  state.settings.employee_home_mode = "on";
  cqBodies = [];
  context.on("request", (req) => {
    if (req.url().includes("/rest/v1/rpc/get_call_quality_summary")) cqBodies.push(JSON.parse(req.postData() || "{}"));
  });
});

async function openHome(page: Page) {
  await page.goto("/?home=p1");
  await expect(page.getByTestId("employee-home-p1")).toBeVisible();
  await expect(page.getByTestId("tile-calls")).toBeVisible();
}

test("flag off: no leave strip, no Given / Call Quality cards", async ({ page }) => {
  state.settings.employee_home_mode = "off";
  state.leave = [{ employee_id: EMP, start_date: "2026-11-18", end_date: "2026-11-22" }];
  state.cq = { enforced: false, estimated: false, employees: [{ by_card_type: { LEAD: { dial_clicks: 40, genuine_score: 86 } } }] };
  await page.goto("/?home=p1");
  await expect(page.getByText("Today's Shift").first()).toBeVisible();
  await page.waitForTimeout(1500);
  for (const id of ["leave-strip", "cq-card", "given-card", "my-leads-data"]) await expect(page.getByTestId(id)).toHaveCount(0);
});

for (const c of [
  { name: "on leave", at: "2026-11-19T12:00:00", rows: [{ start_date: "2026-11-18", end_date: "2026-11-22" }], kind: "ON_LEAVE", text: "On leave until 22 Nov. Your lead timers are paused." },
  { name: "open-ended leave", at: "2026-11-19T12:00:00", rows: [{ start_date: "2026-11-10", end_date: null }], kind: "ON_LEAVE", text: "On leave. Your lead timers are paused." },
  { name: "return grace Mon -> Wed (Tue off)", at: "2026-11-16T12:00:00", rows: [{ start_date: "2026-11-12", end_date: "2026-11-15" }], kind: "GRACE", text: "Back from leave. Until 18 Nov your lead timers stay paused and no recycled leads are given to you." },
  { name: "leave coming up", at: "2026-11-19T12:00:00", rows: [{ start_date: "2026-11-24", end_date: "2026-11-26" }], kind: "UPCOMING", text: "Leave coming up: 24 Nov to 26 Nov." }
] as const) {
  test(`leave strip: ${c.name}`, async ({ page }) => {
    await page.clock.setFixedTime(IST(c.at));
    state.leave = c.rows.map((r) => ({ employee_id: EMP, ...r }));
    await openHome(page);
    const strip = page.getByTestId("leave-strip");
    await expect(strip).toHaveAttribute("data-kind", c.kind);
    await expect(strip).toHaveText(c.text);
  });
}

test("leave strip: nothing when back to normal (Thu after grace)", async ({ page }) => {
  await page.clock.setFixedTime(IST("2026-11-19T12:00:00"));
  state.leave = [{ employee_id: EMP, start_date: "2026-11-12", end_date: "2026-11-15" }];
  await openHome(page);
  await page.waitForTimeout(1000);
  await expect(page.getByTestId("leave-strip")).toHaveCount(0);
});

test("Snooze ends today: row = the /leads list it opens", async ({ page }) => {
  await page.clock.setFixedTime(IST("2026-11-19T12:00:00"));
  const h = state.leads[19].lead_history[0] as Record<string, unknown>;
  h.pause_reason = "SNOOZE";
  h.paused_until = IST("2026-11-19T15:00:00").toISOString();
  const later = state.leads[20].lead_history[0] as Record<string, unknown>;
  later.pause_reason = "SNOOZE";
  later.paused_until = IST("2026-11-20T15:00:00").toISOString(); // tomorrow: not counted
  await openHome(page);
  await expect(page.getByTestId("attention-snooze-ends-today")).toHaveText(/^1\s*Snooze ends today/);
  await page.getByTestId("attention-snooze-ends-today").click();
  await expect(page.getByTestId("home-filter-chip")).toContainText("Snooze ends today (1)");
  await expect(page.locator('[id^="lead-card-"]')).toHaveCount(1);
  await expect(page.locator("#lead-card-lead-20")).toHaveCount(1);
});

test("Given to you: card, queue step, = the /leads Given by admin filter", async ({ page }) => {
  state.settings.given_lead_context_mode = "on";
  const given = (id: string) => ({ lead_id: id, lead_type: "LEAD", given_at: new Date(Date.now() - 3600e3).toISOString(), protected_until: "2026-12-02T08:47:00Z", in_filter: true, last_positive: null, note: null, after: null, your_notes: [] });
  state.given = { enabled: true, leads: [given("lead-40"), given("lead-41")] };
  await openHome(page);
  await expect(page.getByTestId("given-count")).toHaveText("2");
  await expect(page.getByTestId("given-card")).toContainText("Protected until 2 Dec");
  await expect(page.getByTestId("up-next").locator("li").first()).toContainText("Given to you");
  await page.getByTestId("given-open").click();
  await expect(page).toHaveURL(/\/leads$/);
  await expect(page.locator('[id^="lead-card-"]')).toHaveCount(2);
  await expect(page.locator("#lead-card-lead-40, #lead-card-lead-41")).toHaveCount(2);
});

test("Given to you: feature off -> no card", async ({ page }) => {
  state.given = { enabled: true, leads: [] };
  await openHome(page);
  await page.waitForTimeout(1000);
  await expect(page.getByTestId("given-card")).toHaveCount(0);
});

test("LEAD + DATA employee: Data count in My leads = /data's cards", async ({ page }) => {
  await openHome(page);
  const row = page.getByTestId("my-leads-data");
  await expect(row).toContainText("40 Data");
  expect((await row.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await row.click();
  await expect(page).toHaveURL(/\/data$/);
  await expect(page.locator('[id^="data-card-"]')).toHaveCount(40);
});

test("Call Quality card: own score, band + Learning week + Estimated, link to My report", async ({ page }) => {
  state.cq = { enforced: false, estimated: true, employees: [{ by_card_type: { LEAD: { dial_clicks: 40, genuine_score: 86 }, DATA: { dial_clicks: 12, genuine_score: 55 } } }] };
  await openHome(page);
  const card = page.getByTestId("cq-card");
  await expect(card.getByTestId("cq-line").nth(0)).toHaveText(/Lead cards:\s*Green\s*\(86\)/);
  await expect(card.getByTestId("cq-line").nth(1)).toHaveText(/Data cards:\s*Red\s*\(55\)/);
  await expect(card).toContainText("Learning week: no action is taken on this score");
  await expect(card).toContainText("Estimated");
  expect(cqBodies.length).toBeGreaterThan(0);
  expect(cqBodies.every((b) => b.p_employee_id === EMP)).toBe(true);
  await expect(page.getByTestId("cq-open")).toHaveAttribute("href", "/report");
});

test("Call Quality card: enforced -> no Learning week note; not enough data", async ({ page }) => {
  state.cq = { enforced: true, estimated: false, employees: [{ by_card_type: { LEAD: { dial_clicks: 3, genuine_score: null } } }] };
  await openHome(page);
  const card = page.getByTestId("cq-card");
  await expect(card.getByTestId("cq-line")).toHaveText(/Not enough data yet/);
  await expect(card).not.toContainText("Learning week");
});

test("Call Quality hidden from employees -> no card", async ({ page }) => {
  await openHome(page);
  await page.waitForTimeout(1000);
  await expect(page.getByTestId("cq-card")).toHaveCount(0);
});

test("screenshot: leave coming up, Given, Snooze, Data, Call Quality", async ({ page }, info) => {
  await page.clock.setFixedTime(IST("2026-11-19T12:00:00"));
  state.leave = [{ employee_id: EMP, start_date: "2026-11-24", end_date: "2026-11-26" }];
  state.settings.given_lead_context_mode = "on";
  state.given = { enabled: true, leads: [{ lead_id: "lead-40", lead_type: "LEAD", given_at: "2026-11-18T08:00:00Z", protected_until: "2026-12-02T08:47:00Z", in_filter: true, last_positive: null, note: null, after: null, your_notes: [] }] };
  const h = state.leads[19].lead_history[0] as Record<string, unknown>;
  h.pause_reason = "SNOOZE";
  h.paused_until = IST("2026-11-19T15:00:00").toISOString();
  state.cq = { enforced: false, estimated: false, employees: [{ by_card_type: { LEAD: { dial_clicks: 40, genuine_score: 72 } } }] };
  await openHome(page);
  await expect(page.getByTestId("cq-card")).toBeVisible();
  await expect(page.getByTestId("given-card")).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/home-e6-${info.project.name}.png`, fullPage: true });
});
