import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { EMP, FAKE_SUPABASE, LEAD_ENGINE_SETTINGS, mockSupabase } from "./mockSupabase";

// employee_card_mode switch (2026-11-26, option B): the list never waits for the flag. The old card shows at once;
// a late "on" answer switches the card only if the person has not touched the page yet; after a touch (e.g. a Call
// tap) this visit keeps the old card and the next load shows the new one (remembered for the session). Flag off /
// slow = the old card at once. Fake Supabase. Pixel 7, iPhone 14, desktop Chromium.

const json = (body: unknown) => ({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
let answeredAt: number[] = [];
async function open(context: BrowserContext, page: Page, mode: "on" | "off", delayMs: number) {
  await mockSupabase(context);
  answeredAt = [];
  await context.route(`${FAKE_SUPABASE}/rest/v1/lead_engine_settings**`, async (r) => {
    const row = { ...LEAD_ENGINE_SETTINGS, employee_card_mode: mode };
    await new Promise((res) => setTimeout(res, delayMs));
    answeredAt.push(Date.now());
    return r.fulfill(json((r.request().headers()["accept"] || "").includes("object") ? row : [row]));
  });
  await page.goto("/leads");
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; pointer-events: none !important; }" }).catch(() => undefined);
}
const first = (page: Page) => page.locator("#lead-card-lead-01");
const isV2 = async (page: Page) => (await first(page).getAttribute("data-card")) === "v2";

test("flag off and slow: the old card shows at once (no wait for the flag)", async ({ context, page }) => {
  await open(context, page, "off", 1800);
  await expect(first(page)).toBeVisible();
  const shownAt = Date.now();
  expect(await isV2(page)).toBe(false);
  await page.waitForTimeout(2200);
  expect(answeredAt.length).toBeGreaterThan(0);
  expect(shownAt).toBeLessThan(Math.min(...answeredAt)); // the card was on screen before any settings answer
  expect(await isV2(page)).toBe(false);
});

test("flag on, nobody touched the page: the card switches to the new one when the answer arrives", async ({ context, page }) => {
  await open(context, page, "on", 900);
  await expect(first(page)).toBeVisible();
  await expect.poll(() => isV2(page), { timeout: 5000 }).toBe(true);
});

test("flag on, a Call tap before the answer: this visit keeps the old card (the tapped link stays), the next load shows the new one", async ({ context, page }) => {
  await open(context, page, "on", 1500);
  await expect(first(page)).toBeVisible();
  expect(await isV2(page)).toBe(false);
  const call = first(page).locator('a[href^="tel:"]').first();
  await call.click();
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), `activeCall:v1:${EMP}`)).not.toBeNull();
  await page.waitForTimeout(2200); // the answer ("on") has arrived by now
  expect(await isV2(page)).toBe(false);
  await expect(call).toBeAttached();
  await page.reload();
  await expect(first(page)).toBeVisible();
  expect(await isV2(page)).toBe(true); // remembered for the session: the new card from the first paint
});
