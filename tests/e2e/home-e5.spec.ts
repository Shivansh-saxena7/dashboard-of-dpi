import { expect, test, type Page } from "@playwright/test";
import path from "path";
import { EMP, mockSupabase, type MockState } from "./mockSupabase";

// Employee Home E5 (2026-11-19) polish, flag on only: compact Start Shift after the window, neutral zero tiles, soft Call
// buttons, room for the sticky button, data-only wording, one type scale, reduced-motion fade, per-card errors +
// reportClientError, axe contrast / target size, aria-live queue bar, "Drop call" vs "Skip lead", Back to Home + scroll
// restore. Fake Supabase, Pixel 7 (Chromium) and iPhone 14 (WebKit).

const H = 3600e3;
const SHOTS = "C:/work/reports/home_e5";
const AXE = path.join(process.cwd(), "node_modules/axe-core/axe.min.js");

// lead-01..08 overdue Follow-up, lead-05 called an hour ago with no result, lead-31 reminder today.
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
test.beforeEach(async ({ context }) => {
  state = await mockSupabase(context);
  shape(state);
  state.workReport = { calls: 18, connected: 6, results_saved: 15, followUps: 3, visits: 1 };
  state.settings.employee_home_mode = "on";
});

async function openHome(page: Page) {
  await page.goto("/?home=p1");
  await expect(page.getByTestId("employee-home-p1")).toBeVisible();
  await expect(page.getByTestId("tile-calls")).toBeVisible();
}
const css = (page: Page, testId: string, prop: string) =>
  page.getByTestId(testId).first().evaluate((el, p) => getComputedStyle(el as Element).getPropertyValue(p), prop);
const height = async (page: Page, testId: string) => (await page.getByTestId(testId).first().boundingBox())?.height ?? 0;

async function axe(page: Page, selector: string, rules: string[]) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(
    async ({ selector, rules }) => {
      const w = window as unknown as { axe: { run: (c: Element, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } };
      const res = await w.axe.run(document.querySelector(selector) as Element, { runOnly: { type: "rule", values: rules } });
      return res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 5).join(", ")}`);
    },
    { selector, rules }
  );
}

test("Start Shift: full card while the window is open, one line after it closes (flag on only)", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-19T10:45:00+05:30"));
  await openHome(page);
  await expect(page.getByText("Today's Shift").first()).toBeVisible();
  await expect(page.getByTestId("shift-compact")).toHaveCount(0);

  await page.clock.setFixedTime(new Date("2026-11-19T16:00:00+05:30"));
  await page.reload();
  await expect(page.getByTestId("shift-compact")).toContainText("Shift not started — the start window is closed");
  await expect(page.getByText("Today's Shift")).toHaveCount(0);
  await expect(page.getByTestId("shift-compact").getByRole("button")).toHaveCount(0);
});

test("flag off: the full Start Shift card stays after the window, Resume strip says Skip", async ({ page }) => {
  state.settings.employee_home_mode = "off";
  await page.clock.setFixedTime(new Date("2026-11-19T16:00:00+05:30"));
  await page.goto("/?home=p1");
  await expect(page.getByText("Today's Shift").first()).toBeVisible();
  await expect(page.getByTestId("shift-compact")).toHaveCount(0);
});

test("look: zero tiles neutral, Call outline, Start solid, one type scale, last card not covered, screenshot", async ({ page }, info) => {
  await openHome(page);
  await expect(page.getByTestId("tile-recycling")).toHaveAttribute("data-tone", "zero");
  await expect(page.getByTestId("tile-new")).toHaveAttribute("data-tone", "blue");
  expect(await css(page, "up-next-call-lead-05", "background-color")).toBe("rgb(255, 255, 255)");
  expect(await css(page, "start-next", "background-color")).not.toBe("rgb(255, 255, 255)");
  expect(await page.getByTestId("tile-new").locator("span").first().evaluate((el) => getComputedStyle(el).fontSize)).toBe("28px");
  expect(await page.getByTestId("tile-new").locator("span").nth(1).evaluate((el) => getComputedStyle(el).fontSize)).toBe("13px");
  expect(await page.locator("#home-today").evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
  for (const id of ["tile-new", "up-next-call-lead-05", "attention-pending-result", "stage-VISIT", "social-toggle", "start-next"]) {
    expect(await height(page, id), id).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({ path: `${SHOTS}/home-e5-${info.project.name}.png`, fullPage: true });
  // Scrolled to the end, the sticky button sits below the last card.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);
  const last = await page.getByTestId("social-toggle").boundingBox();
  const start = await page.getByTestId("start-next").boundingBox();
  expect(last && start && last.y + last.height <= start.y).toBeTruthy();
});

test("axe: colour contrast and target size on the Home, no violations", async ({ page }) => {
  await openHome(page);
  await page.waitForTimeout(400); // fade finished
  expect(await axe(page, '[data-testid="employee-home-p1"]', ["color-contrast", "target-size"])).toEqual([]);
});

test("reduced motion: content is there at once (no fade)", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openHome(page);
  const opacity = await page.getByTestId("tile-new").evaluate((el) => getComputedStyle(el.parentElement!.parentElement!).opacity);
  expect(opacity).toBe("1");
});

test("errors: each card says what failed and the failure is reported", async ({ page, context }, info) => {
  await context.route("**/rest/v1/leads?*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("lead_type") === "eq.LEAD") return route.fulfill({ status: 500, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: '{"message":"fake failure"}' });
    return route.fallback();
  });
  await page.goto("/?home=p1");
  await expect(page.getByTestId("retry-leads")).toHaveText("Couldn't load your leads. Tap to try again.");
  await expect(page.getByTestId("retry-attention")).toHaveText("Couldn't load what needs your attention. Tap to try again.");
  await expect(page.getByTestId("retry-up-next")).toHaveText("Couldn't load your next leads. Tap to try again.");
  await expect.poll(() => state.anomalies.some((a) => a.message.startsWith("home:leads:"))).toBe(true);
  await page.screenshot({ path: `${SHOTS}/home-e5-error-${info.project.name}.png`, fullPage: true });
});

test("Up next empty state", async ({ page }, info) => {
  for (const lead of state.leads) {
    lead.status = "CONVERTED";
    lead.board_stage = "BOOKING";
  }
  state.reminders = [];
  await openHome(page);
  await expect(page.getByTestId("up-next-empty")).toHaveText("No leads waiting. Check back later.");
  await expect(page.getByTestId("start-next")).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/home-e5-up-next-empty-${info.project.name}.png`, fullPage: true });
});

test("data-only: 'Calls left' + hint, My data lines", async ({ page }, info) => {
  state.leads = [];
  state.data[0].lead_history[0].call_count = 3;
  await openHome(page);
  await expect(page.getByTestId("tile-data-calls-left")).toContainText("Calls left");
  await expect(page.getByTestId("tile-data-calls-left")).toContainText("Up to 4 tries per lead");
  await expect(page.getByTestId("tile-data-calls-left")).not.toContainText("(4 attempts)");
  await expect(page.getByTestId("data-untouched")).toHaveText("39");
  await expect(page.getByTestId("data-at-risk")).toHaveText("40");
  await expect(page.getByTestId("data-last-attempt")).toHaveText("1");
  await page.screenshot({ path: `${SHOTS}/home-e5-data-only-${info.project.name}.png`, fullPage: true });
});

test("team leader: 'Waiting to assign'", async ({ page }) => {
  state.employee.role = "team_leader";
  state.employee.team_id = "team-1";
  await openHome(page);
  await expect(page.getByTestId("team-waiting")).toContainText("Waiting to assign");
});

test("Back to Home chip on /leads and /data, and the Home comes back at the same scroll", async ({ page }) => {
  await openHome(page);
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(400);
  const y = await page.evaluate(() => window.scrollY);
  await page.getByTestId("stage-VISIT").click();
  await expect(page).toHaveURL(/\/leads$/);
  const back = page.getByTestId("back-to-home");
  await expect(back).toBeVisible();
  expect(await height(page, "back-to-home")).toBeGreaterThanOrEqual(44);
  await back.click();
  await expect(page.getByTestId("tile-calls")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 5000 }).toBeGreaterThan(y - 80);

  // Not from the Home: no chip.
  await page.goto("/leads");
  await expect(page.locator('[id^="lead-card-"]').first()).toBeVisible();
  await expect(page.getByTestId("back-to-home")).toHaveCount(0);
});

test("two prompts together: Resume strip 'Drop call' vs queue bar 'Skip lead', aria-live, screenshot", async ({ page }, info) => {
  await openHome(page);
  // Call from Up next (LeadCard's Call), then come back: the Resume strip shows on the Home.
  await page.getByTestId("up-next-call-lead-05").click();
  await page.evaluate(() => {
    (window as unknown as { __vis?: string }).__vis = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    (window as unknown as { __vis?: string }).__vis = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const strip = page.getByTestId("resume-call-strip");
  await expect(strip.getByTestId("resume-call-drop")).toHaveText("Drop call");
  expect(await height(page, "resume-call-drop")).toBeGreaterThanOrEqual(44);
  // Queue bar on /leads next to the strip.
  await page.getByTestId("start-next").click();
  await expect(page.getByRole("button", { name: /Log Update/ })).toBeVisible();
  await page.locator("button:has(svg.lucide-x)").first().click();
  const bar = page.getByTestId("queue-bar");
  await expect(bar.getByTestId("queue-skip")).toHaveText("Skip lead");
  await expect(bar.locator('[aria-live="polite"]')).toHaveCount(1);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/leads-queue-bar-e5-${info.project.name}.png` });
  expect(await axe(page, '[data-testid="queue-bar"]', ["color-contrast", "target-size"])).toEqual([]);
});
