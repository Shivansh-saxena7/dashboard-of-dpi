import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import fs from "fs";
import { EMP, mockSupabase } from "./mockSupabase";

// Desktop grid for the redesign cards (2026-11-26): from 1024 px the /leads and /data card lists are a grid of columns at
// least 460 px wide (2 at 1280, 3 at 1440, 4 at 1920); below 1024 px one column as before; the old card (flag off)
// keeps exactly the old container class. Fake data. Pixel 7, iPhone 14, desktop Chromium.

const SHOTS = process.env.GRID_SHOTS || "C:/work/reports/card_desktop_grid";
const OLD_CLASS = "mx-4 mt-4 space-y-3 pb-6";

async function open(context: BrowserContext, page: Page, path: "/leads" | "/data", cardOn: boolean, queue = false) {
  const state = await mockSupabase(context);
  void state;
  await context.addInitScript(([key, on]) => {
    try {
      sessionStorage.setItem(key as string, JSON.stringify({ on, at: Date.now() }));
    } catch { /* ignore */ }
  }, [`employee-card-mode:v1:${EMP}`, cardOn] as const);
  // ?queue=1 = "Start with next lead" (Home): the first lead's sheet opens; closing it shows the queue bar.
  await page.goto(queue ? `${path}?queue=1` : path);
  if (queue) {
    await expect(page.getByRole("button", { name: /Log Update/ })).toBeVisible();
    await page.locator("button:has(svg.lucide-x)").first().click();
  }
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; pointer-events: none !important; }" }).catch(() => undefined);
  await expect(page.locator(path === "/leads" ? "#lead-card-lead-01" : "#data-card-data-01")).toBeVisible();
  await page.waitForTimeout(800);
}
const cards = (page: Page, path: string) => page.locator(path === "/leads" ? '[id^="lead-card-"]' : '[id^="data-card-"]');
async function columns(page: Page, path: string) {
  return cards(page, path).evaluateAll((els) => {
    const top = Math.round(els[0].getBoundingClientRect().top);
    return new Set(els.filter((e) => Math.abs(Math.round(e.getBoundingClientRect().top) - top) < 4).map((e) => Math.round(e.getBoundingClientRect().left))).size;
  });
}
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

for (const path of ["/leads", "/data"] as const) {
  test(`${path}: new card - columns by width (desktop 2 / 3 / 4, phone and tablet 1), no side scroll, taps 44 px, screenshots`, async ({ context, page }, info) => {
    await open(context, page, path, true);
    const desktop = info.project.name === "desktop-chromium";
    const widths: [number, number][] = desktop ? [[1280, 2], [1440, 3], [1920, 4]] : [[page.viewportSize()!.width, 1], [768, 1]];
    fs.mkdirSync(SHOTS, { recursive: true });
    const got: [number, number][] = [];
    for (const [w] of widths) {
      await page.setViewportSize({ width: w, height: desktop ? 1000 : page.viewportSize()!.height });
      await page.waitForTimeout(400);
      if (desktop) await page.screenshot({ path: `${SHOTS}/${process.env.GRID_TAG || "after"}${path.replace("/", "-")}-${w}.png` });
      got.push([w, await columns(page, path)]);
      expect(await noSideScroll(page), `no side scroll at ${w}`).toBe(true);
      const small = await page.locator('[data-card="v2"] button:visible, [data-card="v2"] a:visible').evaluateAll((els) =>
        els.filter((e) => e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 44).length);
      expect(small, `taps under 44 px at ${w}`).toBe(0);
    }
    expect(got).toEqual(widths);
  });

  test(`${path}: flag off - the old card keeps exactly the old container (one column at every width)`, async ({ context, page }, info) => {
    await open(context, page, path, false);
    const list = cards(page, path).first().locator("xpath=..");
    expect([await list.getAttribute("class"), await list.getAttribute("data-testid")]).toEqual([OLD_CLASS, null]);
    expect(await cards(page, path).first().getAttribute("data-card")).toBeNull();
    if (info.project.name === "desktop-chromium") {
      await page.setViewportSize({ width: 1920, height: 1000 });
      await page.waitForTimeout(300);
      expect(await columns(page, path)).toBe(1);
    }
  });

  test(`${path}: new card with the queue bar open - on desktop the last row is not hidden under the bar`, async ({ context, page }, info) => {
    test.skip(info.project.name !== "desktop-chromium", "desktop only (phones keep the old spacing)");
    await open(context, page, path, true, true);
    const bar = page.getByTestId("queue-bar");
    await expect(bar).toBeVisible();
    await expect(page.getByTestId("card-list")).toHaveClass(/lg:pb-40/);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(400);
    const lastBottom = await cards(page, path).last().evaluate((e) => e.getBoundingClientRect().bottom);
    const barTop = await bar.evaluate((e) => e.getBoundingClientRect().top);
    expect(lastBottom).toBeLessThanOrEqual(barTop);
  });
}

test("call-return in the grid: back from the dialer, the lead in the second column opens again", async ({ context, page }, info) => {
  test.skip(info.project.name !== "desktop-chromium", "the grid is desktop only");
  await open(context, page, "/leads", true);
  const card = page.locator("#lead-card-lead-40");
  await card.scrollIntoViewIfNeeded();
  await card.locator('a[href^="tel:"]').first().click();
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), `activeCall:v1:${EMP}`)).not.toBeNull();
  await page.evaluate(() => { (window as unknown as { __vis?: string }).__vis = "hidden"; document.dispatchEvent(new Event("visibilitychange")); });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => { (window as unknown as { __vis?: string }).__vis = "visible"; document.dispatchEvent(new Event("visibilitychange")); });
  await expect(page.getByRole("button", { name: /Log Update/ })).toBeVisible();
  await expect.poll(() => page.getByText("Test Lead 40", { exact: true }).count()).toBeGreaterThanOrEqual(2);
});
