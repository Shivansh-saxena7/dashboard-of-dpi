import fs from "fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { fakeContact, mockSupabase, type MockState } from "./mockSupabase";
import { desktop, openReport } from "./perfReportFixture";

// Admin lead name + number (2026-11-29): the Positive-history junk page and the Lead Journey tab show the lead's name
// and a tap-to-copy number next to the short id, from get_admin_lead_contacts (ids in the POST body, 200 per call).
// Fake names and numbers only. Not on Admin Home. A failed lookup keeps the id and logs the error code only.
// Pixel 7, iPhone 14, desktop.

const SHOTS = "C:/work/reports/admin_lead_contacts";
fs.mkdirSync(SHOTS, { recursive: true });
const NOW = Date.parse("2026-11-28T11:00:00+05:30");
const id = (i: number) => `${(0xc0000000 + i).toString(16)}-0000-4000-8000-${(0xd00000000000 + i).toString(16)}`;
let state: MockState;

function pjRow(i: number) {
  return {
    lead_id: id(i), lead_id8: id(i).slice(0, 8), card_type: i % 3 ? "LEAD" : "DATA", project: "Test Project",
    stage_at_junk: "FOLLOW_UP", highest_positive: "CONNECTED", restore_status: "CONNECTED", restore_stage: "FOLLOW_UP",
    first_positive: "CONNECTED", first_positive_at: "2026-11-10T05:00:00Z", first_positive_by: null, first_positive_by_name: "Employee A",
    last_owner_id: null, last_owner_name: "Employee B", recycle_count: 2, junked_at: new Date(NOW - (i + 1) * 3600e3).toISOString(),
    junked_by: "SYSTEM", junk_reason: "Max recycles", last_activity_at: "2026-11-20T05:00:00Z", not_interested_count: 0,
    is_data_copy: false, sibling: null, restored_before: 0
  };
}

async function openPj(context: BrowserContext, page: Page, n = 250) {
  await page.clock.setFixedTime(new Date(NOW));
  state = await mockSupabase(context);
  state.employee.role = "admin";
  state.employee.department = null;
  state.positiveJunk = { rows: Array.from({ length: n }, (_, i) => pjRow(i)), employees: [], max_batch: 25, protection_days: 14 } as never;
  const consoleText: string[] = [];
  page.on("console", (m) => consoleText.push(m.text()));
  await page.addInitScript(() => {
    (window as unknown as { __copied: string[] }).__copied = [];
    Object.defineProperty(navigator, "clipboard", { value: { writeText: (t: string) => { (window as unknown as { __copied: string[] }).__copied.push(t); return Promise.resolve(); } }, configurable: true });
  });
  await page.goto("/admin/positive-junk");
  return consoleText;
}

const first = pjRow(0);
const firstContact = fakeContact(first.lead_id);

test("positive junk: name + number next to the id, ids in POST body in chunks of 200, tap copies, 44px, screenshot", async ({ page, context }, info) => {
  const consoleText = await openPj(context, page);
  const line = page.getByTestId(desktop(info) ? `pj-contact-${first.lead_id8}` : `pj-card-contact-${first.lead_id8}`);
  await expect(line).toContainText(firstContact.name);
  await expect(line).toContainText(firstContact.mobile);
  // Every call at most 200 ids, together all 250 rows (dev mode may run the lookup twice).
  await expect.poll(() => new Set(state.contactCalls.flatMap((c) => c.ids)).size).toBe(250);
  expect(Math.max(...state.contactCalls.map((c) => c.ids.length))).toBe(200);
  expect(state.contactCalls.length).toBeGreaterThanOrEqual(2);
  for (const c of state.contactCalls) expect(c.url).not.toContain("-4000-8000-");
  const copy = line.getByRole("button", { name: `Copy number ${firstContact.mobile}` });
  const box = await copy.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await copy.click();
  await expect(line).toContainText("Copied");
  expect(await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied)).toEqual([firstContact.mobile]);
  // the copy tap does not tick the row
  if (desktop(info)) await expect(page.locator("tbody tr").first().locator("input[type=checkbox]")).not.toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(consoleText.filter((t) => t.includes("Fake Lead") || t.includes(firstContact.mobile))).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/positive-junk-${info.project.name}.png`, fullPage: false });
});

test("positive junk: lookup refused (42501): ids still show, no name, the log has the code only", async ({ page, context }, info) => {
  await page.clock.setFixedTime(new Date(NOW));
  state = await mockSupabase(context);
  state.employee.role = "admin";
  state.employee.department = null;
  state.fail.add("rpc/get_admin_lead_contacts");
  state.positiveJunk = { rows: Array.from({ length: 5 }, (_, i) => pjRow(i)), employees: [], max_batch: 25, protection_days: 14 } as never;
  await page.goto("/admin/positive-junk");
  await expect(page.locator(`text=${first.lead_id8} >> visible=true`).first()).toBeVisible();
  await expect.poll(() => state.anomalies.some((a) => a.message.includes("lookup failed (42501)"))).toBe(true);
  await expect(page.getByTestId(desktop(info) ? `pj-contact-${first.lead_id8}` : `pj-card-contact-${first.lead_id8}`)).toHaveCount(0);
  expect(JSON.stringify(state.anomalies)).not.toContain("Fake Lead");
});

test("lead journey: name + number next to the id in the drill rows, chunked POST, tap copies, screenshot", async ({ page, context }, info) => {
  await page.addInitScript(() => {
    (window as unknown as { __copied: string[] }).__copied = [];
    Object.defineProperty(navigator, "clipboard", { value: { writeText: (t: string) => { (window as unknown as { __copied: string[] }).__copied.push(t); return Promise.resolve(); } }, configurable: true });
  });
  const ctx = await openReport(context, page, { api: 4 });
  await page.getByTestId("perf-tab-journey").click();
  await expect(page.getByTestId("lj")).toBeVisible();
  await page.getByTestId("lj-view-won").click();
  const line = page.getByTestId("lj-drill").locator('[data-testid^="lj-card-contact-"]').first();
  await expect(line).toContainText("Fake Lead");
  const calls = ctx.calls.filter((c) => c.rpc === "get_admin_lead_contacts");
  expect(calls.length).toBeGreaterThan(0);
  for (const c of calls) {
    expect((c.body.p_lead_ids as string[]).length).toBeLessThanOrEqual(200);
    expect(c.url).not.toContain("p_lead_ids");
  }
  const btn = line.getByRole("button");
  expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await btn.click();
  await expect(line).toContainText("Copied");
  expect((await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied)).length).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: `${SHOTS}/lead-journey-${info.project.name}.png`, fullPage: false });
});

test("lead journey: lookup refused: short ids still show, no name", async ({ page, context }) => {
  await openReport(context, page, { api: 4, contactsFail: true });
  await page.getByTestId("perf-tab-journey").click();
  await page.getByTestId("lj-view-won").click();
  await expect(page.getByTestId("lj-drill").locator('[data-testid^="lj-jcard-"]').first()).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.locator('[data-testid^="lj-contact-"], [data-testid^="lj-card-contact-"]')).toHaveCount(0);
});

test("Admin Home: the contact lookup is never asked", async ({ page, context }) => {
  await page.clock.setFixedTime(new Date(NOW));
  state = await mockSupabase(context);
  state.employee.role = "admin";
  state.employee.department = null;
  state.settings.admin_home_mode = "on";
  await page.goto("/admin");
  await expect(page.getByTestId("admin-engine")).toBeVisible();
  await page.waitForTimeout(2000);
  expect(state.contactCalls.length).toBe(0);
});
