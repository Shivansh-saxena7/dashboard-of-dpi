import { expect, test, type Page } from "@playwright/test";
import { EMP, mockSupabase, type MockState } from "./mockSupabase";

// Call-return (2026-11-13): after a Call tap the employee must get back the same lead, at the same place in the
// list, with its result form open, whatever happened to the app while the dialer was open:
//   - it simply came back (visibilitychange),
//   - the page was reloaded (Android tab discard),
//   - the app was killed and started again from its start_url (/login), in a new session.
// Runs on Pixel 7 (Chromium) and iPhone 14 (WebKit) emulation against a fake Supabase (see mockSupabase.ts).

const ENTRY_KEY = `activeCall:v1:${EMP}`;

async function openList(page: Page, path: "/leads" | "/data") {
  await page.goto(path);
  await expect(page.locator(path === "/leads" ? "#lead-card-lead-01" : "#data-card-data-01")).toBeVisible();
}

async function tapCall(page: Page, cardId: string) {
  const call = page.locator(`#${cardId} a[href^="tel:"]`).first();
  await call.scrollIntoViewIfNeeded();
  await call.click();
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), ENTRY_KEY)).not.toBeNull();
}

async function setVisibility(page: Page, state: "hidden" | "visible") {
  await page.evaluate((s) => {
    (window as unknown as { __vis?: string }).__vis = s;
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}

async function expectOpen(page: Page, name: string) {
  // The detail sheet (with the result buttons) is open for this lead: its name shows on the card and in the sheet.
  await expect(page.getByRole("button", { name: /Log Update/ })).toBeVisible();
  await expect.poll(() => page.getByText(name, { exact: true }).count()).toBeGreaterThanOrEqual(2);
}

const entry = (page: Page) => page.evaluate((k) => localStorage.getItem(k), ENTRY_KEY);

let state: MockState;
test.beforeEach(async ({ context }) => {
  state = await mockSupabase(context);
});

test("Leads: back from the dialer, app still alive -> same lead, result form open", async ({ page }) => {
  await openList(page, "/leads");
  await tapCall(page, "lead-card-lead-40");
  await setVisibility(page, "hidden");
  await page.evaluate(() => window.scrollTo(0, 0));
  await setVisibility(page, "visible");
  await expectOpen(page, "Test Lead 40");
  expect(JSON.parse((await entry(page)) || "{}").index).toBe(39);
});

test("Leads: page reloaded during the call -> same lead, result form open, return recorded", async ({ page }) => {
  await openList(page, "/leads");
  await tapCall(page, "lead-card-lead-40");
  await setVisibility(page, "hidden");
  await page.reload();
  await expectOpen(page, "Test Lead 40");
  await expect.poll(() => state.anomalies.filter((a) => a.source.startsWith("call_return:")).length).toBeGreaterThan(0);
  const row = state.anomalies.find((a) => a.source.startsWith("call_return:"))!;
  expect(row.severity).toBe("info");
  expect(row.context?.cold).toBe(1);
  expect(["Android", "iOS"]).toContain(row.context?.os);
});

test("Leads: app killed during the call, started again at /login -> straight back to the lead", async ({ context, page }) => {
  await openList(page, "/leads");
  await tapCall(page, "lead-card-lead-40");
  await page.close();
  const again = await context.newPage(); // new session: sessionStorage is empty, localStorage is kept
  await again.goto("/login");
  await expect(again).toHaveURL(/\/leads/);
  await expectOpen(again, "Test Lead 40");
});

test('Leads: "New" filter keeps the called lead and comes back after a reload', async ({ page }) => {
  await openList(page, "/leads");
  const status = page.locator("select").filter({ has: page.locator('option[value="NEW"]') }).first();
  await status.selectOption("NEW");
  await tapCall(page, "lead-card-lead-40");
  await page.reload(); // the lead now has a call: "New" alone would drop it
  await expectOpen(page, "Test Lead 40");
  await expect(status).toHaveValue("NEW");
  await expect(page.locator("#lead-card-lead-40")).toHaveCount(1);
});

test("Leads: saving the result ends the call", async ({ page }) => {
  await openList(page, "/leads");
  await tapCall(page, "lead-card-lead-40");
  await page.reload();
  await expectOpen(page, "Test Lead 40");
  await page.getByRole("button", { name: "Not Connected", exact: true }).click();
  await page.getByRole("button", { name: /Log Update/ }).click();
  await expect.poll(() => entry(page)).toBeNull();
  expect(state.updates.some((u) => u.p_lead_id === "lead-40" && u.p_new_status === "NOT_CONNECTED")).toBe(true);
});

test("Home: Resume your call strip opens the lead, Skip ends the call", async ({ page }) => {
  await openList(page, "/leads");
  await tapCall(page, "lead-card-lead-40");
  await page.goto("/");
  const strip = page.getByTestId("resume-call-strip");
  await expect(strip).toBeVisible();
  await expect(strip).toContainText("Resume your call with Test Lead 40");
  await strip.getByRole("button", { name: "Resume" }).click();
  await expect(page).toHaveURL(/\/leads/);
  await expectOpen(page, "Test Lead 40");
  await page.goto("/");
  await page.getByTestId("resume-call-strip").getByRole("button", { name: "Skip" }).click();
  await expect.poll(() => entry(page)).toBeNull();
  await expect(page.getByTestId("resume-call-strip")).toHaveCount(0);
});

test("Data: reload and cold start both come back to the same Data lead", async ({ context, page }) => {
  await openList(page, "/data");
  await tapCall(page, "data-card-data-30");
  await page.reload();
  await expectOpen(page, "Test Data 30");
  await page.close();
  const again = await context.newPage();
  await again.goto("/login");
  await expect(again).toHaveURL(/\/data/);
  await expectOpen(again, "Test Data 30");
});
