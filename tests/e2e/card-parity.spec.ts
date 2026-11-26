import { expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import fs from "fs";
import { EMP, FAKE_SUPABASE, LEAD_ENGINE_SETTINGS, mockSupabase, type MockState } from "./mockSupabase";
import { DATA_SCENARIOS, LEAD_SCENARIOS, NOTES, SIBLINGS, T0, TAGGED } from "./cardParityFixture";

// Card parity (2026-11-26 port): the old LeadCard / DataCard (flag employee_card_mode off) and the redesign
// LeadCardV2 / DataCardV2 (flag on) render the SAME list data (C:/work/reports/card_parity/PARITY.md, section B). For
// every scenario card: every piece of information the old card shows (text and button names) must be in the new card
// (after normalising emoji, case, digit spacing and "×"); anything the new card adds must be on the redesign-only
// list; the actions call the same things. Flag off / missing / slow / pilot-without-me = the old card. Fake Supabase,
// fixed clock. Pixel 7, iPhone 14, desktop Chromium.

const SHOTS = "C:/work/reports/card_redesign_port";
type Mode = "off" | "on" | "missing" | "slow" | "pilot_me" | "pilot_other";
type CardInfo = { id: string; text: string; labels: string[]; v2: boolean; html: string };
let state: MockState;
let rpcs: { rpc: string; body: Record<string, unknown> }[] = [];
const newCtx = (browser: Browser, info: TestInfo) => {
  const u = info.project.use;
  return browser.newContext({ baseURL: u.baseURL, viewport: u.viewport, userAgent: u.userAgent, deviceScaleFactor: u.deviceScaleFactor, isMobile: u.isMobile, hasTouch: u.hasTouch });
};
const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });

async function open(context: BrowserContext, page: Page, path: "/leads" | "/data", mode: Mode, opts: { paused?: boolean; notesMissing?: boolean } = {}) {
  state = await mockSupabase(context);
  state.leads = LEAD_SCENARIOS.map(([, , l]) => structuredClone(l)) as typeof state.leads;
  state.data = DATA_SCENARIOS.map(([, , l]) => structuredClone(l)) as typeof state.data;
  rpcs = [];
  await page.clock.setFixedTime(T0);
  await context.route(`${FAKE_SUPABASE}/rest/v1/lead_engine_settings**`, async (r) => {
    const row: Record<string, unknown> = { ...LEAD_ENGINE_SETTINGS, reassigned_journey_mode: "on" };
    if (mode === "on") row.employee_card_mode = "on";
    if (mode === "off") row.employee_card_mode = "off";
    if (mode === "pilot_me") Object.assign(row, { employee_card_mode: "admin_pilot", employee_card_pilot_ids: [EMP] });
    if (mode === "pilot_other") Object.assign(row, { employee_card_mode: "admin_pilot", employee_card_pilot_ids: ["00000000-0000-4000-8000-00000000ffff"] });
    if (mode === "slow") {
      row.employee_card_mode = "on";
      await new Promise((res) => setTimeout(res, 3500));
    }
    return r.fulfill(json((r.request().headers()["accept"] || "").includes("object") ? row : [row]));
  });
  await context.route(`${FAKE_SUPABASE}/rest/v1/rpc/**`, async (r) => {
    const name = new URL(r.request().url()).pathname.split("/").pop() as string;
    const body = JSON.parse(r.request().postData() || "{}");
    rpcs.push({ rpc: name, body });
    if (name === "get_my_reassigned_leads") return r.fulfill(json({ enabled: true, leads: TAGGED.map((id) => ({ lead_id: id, previously_with: "Employee P", given_at: new Date(T0).toISOString() })) }));
    if (name === "get_lead_siblings") return r.fulfill(json(Object.fromEntries(Object.entries(SIBLINGS).filter(([k]) => (body.p_lead_ids as string[]).includes(k)))));
    if (name === "get_last_notes" && opts.notesMissing) return r.fulfill(json({ code: "PGRST202", message: "Could not find the function public.get_last_notes" }, 404));
    if (name === "get_last_notes")
      return r.fulfill(json((body.p_history_ids as string[]).filter((h) => NOTES[h]).map((h) => ({ lead_history_id: h, note: NOTES[h].note, created_at: NOTES[h].at }))));
    if (name === "get_reassigned_lead_context") return r.fulfill(json({ lead_id: body.p_lead_id, previously_with: "Employee P", given_at: new Date(T0).toISOString(), previous: null, journey: [] }));
    if (name === "get_working_calendar" && opts.paused)
      return r.fulfill(json({ timezone: "Asia/Kolkata", weekly_off_day: 2, timers_enabled: true, ranges: [{ starts_at: new Date(T0 - 3600e3).toISOString(), ends_at: new Date(T0 + 86400e3).toISOString(), reason: "Office closed", kind: "ADMIN_PAUSE" }] }));
    return r.fallback();
  });
  await context.route("https://wa.me/**", (r) => r.abort());
  await page.goto(path);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; pointer-events: none !important; }" }).catch(() => undefined);
  await page.getByPlaceholder(path === "/leads" ? "Search name, mobile, or project..." : "Search name or mobile...").fill("Parity");
  const ids = (path === "/leads" ? LEAD_SCENARIOS : DATA_SCENARIOS).map(([, , l]) => String(l.id));
  await expect(page.locator(`#${path === "/leads" ? "lead" : "data"}-card-${ids[0]}`)).toBeVisible();
  await page.waitForTimeout(1200); // flag answer, siblings, notes, entrance animation
}

async function cards(page: Page, path: "/leads" | "/data"): Promise<CardInfo[]> {
  const prefix = path === "/leads" ? "lead-card-" : "data-card-";
  return page.evaluate((prefix) =>
    [...document.querySelectorAll<HTMLElement>(`[id^="${prefix}"]`)].map((el) => ({
      id: el.id.slice(prefix.length),
      text: el.innerText,
      labels: [...el.querySelectorAll("a[aria-label],button[aria-label]")].map((b) => b.getAttribute("aria-label") || ""),
      v2: el.getAttribute("data-card") === "v2",
      html: el.outerHTML
    })), prefix);
}

const norm = (s: string) =>
  s.replace(/×/g, "x").replace(/[^\p{L}\p{N}\s:.,\-—'\/()]/gu, " ").replace(/(\d)\s+(?=\d)/g, "$1").replace(/\s+/g, " ").trim().toLowerCase();
const items = (text: string) => text.split(/\n| · /).map(norm).filter(Boolean);
// What only the redesign shows (PARITY.md "redesign-only"): labels of the facts row, the last-note panel, the extra
// buttons and the data card's "Assigned".
const NEW_ONLY = [/^last activity$/, /^assigned$/, /^calls$/, /^no note yet$/, /^last note$/, /^called$/, /^note$/, /^update status$/, /^show details$/, /^hide details$/,
  /^quick dial a new number$/, /^whatsapp$/, /^\d+(m|h|d) ago$/, /^just now$/, /^connected$/, /^not connected$/, /^switched off$/, /^not interested$/, /^converted$/,
  /^client asked to call back/, /^[a-z]{3} \d{1,2}, \d{1,2}:\d{2} (am|pm)$/];

function compare(oldCard: CardInfo, newCard: CardInfo): string[] {
  const problems: string[] = [];
  const newText = norm([newCard.text, ...newCard.labels].join("\n"));
  for (const it of items([oldCard.text, ...oldCard.labels].join("\n"))) if (!newText.includes(it)) problems.push(`missing "${it}"`);
  const oldText = norm([oldCard.text, ...oldCard.labels].join("\n"));
  for (const it of items([newCard.text, ...newCard.labels].join("\n"))) if (!oldText.includes(it) && !NEW_ONLY.some((re) => re.test(it))) problems.push(`new-only "${it}"`);
  return problems;
}

const SCENARIO_OF = new Map([...LEAD_SCENARIOS, ...DATA_SCENARIOS].map(([s, what, l]) => [String(l.id), `${s} ${what}`]));
const results: Record<string, string> = {};

for (const path of ["/leads", "/data"] as const) {
  for (const paused of [false, true]) {
    test(`${path}${paused ? " (timers paused)" : ""}: every scenario, old (flag off) vs new (flag on) - same information, nothing extra`, async ({ browser }, info) => {
      const ctxOld = await newCtx(browser, info);
      const pOld = await ctxOld.newPage();
      await open(ctxOld, pOld, path, "off", { paused });
      const old = await cards(pOld, path);
      const ctxNew = await newCtx(browser, info);
      const pNew = await ctxNew.newPage();
      await open(ctxNew, pNew, path, "on", { paused });
      const neu = await cards(pNew, path);
      expect(old.every((c) => !c.v2), "flag off shows the old card").toBe(true);
      expect(neu.every((c) => c.v2), "flag on shows the redesign card").toBe(true);
      const expected = (path === "/leads" ? LEAD_SCENARIOS : DATA_SCENARIOS).map(([, , l]) => String(l.id)).sort();
      expect(old.map((c) => c.id).sort()).toEqual(expected);
      expect(neu.map((c) => c.id).sort()).toEqual(expected);
      const fails: string[] = [];
      for (const o of old) {
        const n = neu.find((c) => c.id === o.id)!;
        const p = compare(o, n);
        results[`${info.project.name} ${path}${paused ? " paused" : ""} ${SCENARIO_OF.get(o.id)}`] = p.length ? `FAIL: ${p.join("; ")}` : "PASS";
        if (p.length) fails.push(`${SCENARIO_OF.get(o.id)}: ${p.join("; ")}`);
      }
      // Phone: no side scroll, every button 44 px or more.
      expect(await pNew.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      const small = await pNew.locator('[data-card="v2"] button:visible, [data-card="v2"] a:visible').evaluateAll((els) =>
        els.filter((e) => e.getBoundingClientRect().height < 44 && e.getBoundingClientRect().height > 0).map((e) => e.getAttribute("aria-label") || (e.textContent || "").trim()));
      expect(small, "taps under 44 px").toEqual([]);
      // Side-by-side screenshots (fake data).
      if (!paused) {
        const dir = `${SHOTS}/${info.project.name}${path.replace("/", "-")}`;
        fs.mkdirSync(dir, { recursive: true });
        for (const o of old) {
          const tag = SCENARIO_OF.get(o.id)!.split(" ")[0];
          await pOld.locator(`#${path === "/leads" ? "lead" : "data"}-card-${o.id}`).screenshot({ path: `${dir}/${tag}-old.png` }).catch(() => undefined);
          await pNew.locator(`#${path === "/leads" ? "lead" : "data"}-card-${o.id}`).screenshot({ path: `${dir}/${tag}-new.png` }).catch(() => undefined);
        }
      }
      if (process.env.PARITY_OUT) fs.writeFileSync(`${process.env.PARITY_OUT}/${info.project.name}${path.replace("/", "-")}${paused ? "-paused" : ""}-off.json`, JSON.stringify(old.map((c) => ({ id: c.id, text: c.text }))));
      fs.mkdirSync(SHOTS, { recursive: true });
      fs.writeFileSync(`${SHOTS}/parity-${info.project.name}${path.replace("/", "-")}${paused ? "-paused" : ""}.json`, JSON.stringify(results, null, 1));
      await ctxOld.close();
      await ctxNew.close();
      expect(fails, "information gaps").toEqual([]);
    });
  }

  test(`${path}: actions are the same on both cards (open, Call -> logCallClick, WhatsApp, Journey${path === "/leads" ? ", Quick Dial" : ""})`, async ({ browser }, info) => {
    const out: Record<string, unknown> = {};
    for (const mode of ["off", "on"] as const) {
      const ctx = await newCtx(browser, info);
      const page = await ctx.newPage();
      await open(ctx, page, path, mode);
      const id = path === "/leads" ? "p-s18" : "p-d39";
      const card = page.locator(`#${path === "/leads" ? "lead" : "data"}-card-${id}`);
      await card.scrollIntoViewIfNeeded();
      const before = rpcs.length;
      await card.locator('a[href^="tel:"]').first().click();
      await expect.poll(() => rpcs.slice(before).some((c) => c.rpc === "log_call_click_atomic" && c.body.p_lead_history_id === `h-${id}`)).toBe(true);
      const active = await page.evaluate((k) => localStorage.getItem(k), `activeCall:v1:${EMP}`);
      await card.locator('a[href^="https://wa.me/"]').first().click();
      await expect.poll(() => rpcs.some((c) => c.rpc === "log_whatsapp_click_atomic" && c.body.p_lead_history_id === `h-${id}`)).toBe(true);
      await card.getByTestId("reassigned-journey").click();
      await expect.poll(() => rpcs.some((c) => c.rpc === "get_reassigned_lead_context" && c.body.p_lead_id === id)).toBe(true);
      await page.goto(path); // fresh list for the next action
      await page.getByPlaceholder(path === "/leads" ? "Search name, mobile, or project..." : "Search name or mobile...").fill("Parity");
      const c2 = page.locator(`#${path === "/leads" ? "lead" : "data"}-card-${id}`);
      await c2.click({ position: { x: 12, y: 6 } });
      const opened = await page.getByRole("button", { name: /Log Update/ }).isVisible({ timeout: 10_000 }).catch(() => false);
      let quick = null;
      if (path === "/leads") {
        await page.goto(path);
        await page.getByPlaceholder("Search name, mobile, or project...").fill("Parity");
        const c3 = page.locator(`#lead-card-${id}`);
        await c3.locator('button[title^="Quick Dial"]').first().click();
        quick = await page.getByText("Quick Dial", { exact: false }).first().isVisible();
      }
      out[mode] = { active: Boolean(active && JSON.parse(active).leadId === id), opened, quick };
      await ctx.close();
    }
    expect(out.on).toEqual(out.off);
    expect(out.on).toEqual({ active: true, opened: true, quick: path === "/leads" ? true : null });
  });
}

for (const mode of ["missing", "slow", "pilot_other"] as const) {
  test(`flag ${mode}: the old card, exactly as with the flag off`, async ({ browser }, info) => {
    const ctx = await newCtx(browser, info);
    const page = await ctx.newPage();
    await open(ctx, page, "/leads", mode);
    const c = await cards(page, "/leads");
    expect(c.length).toBe(LEAD_SCENARIOS.length);
    expect(c.every((x) => !x.v2)).toBe(true);
    await ctx.close();
  });
}
test("flag admin_pilot with this employee: the redesign card", async ({ browser }, info) => {
  const ctx = await newCtx(browser, info);
  const page = await ctx.newPage();
  await open(ctx, page, "/data", "pilot_me");
  expect((await cards(page, "/data")).every((x) => x.v2)).toBe(true);
  await ctx.close();
});
test("redesign card: one batched last-note call (POST body, no id list in a URL), no booking chip, no new countdown", async ({ browser }, info) => {
  const ctx = await newCtx(browser, info);
  const page = await ctx.newPage();
  const urls: string[] = [];
  page.on("request", (r) => urls.push(r.url()));
  await open(ctx, page, "/leads", "on");
  const notes = rpcs.filter((c) => c.rpc === "get_last_notes");
  expect(notes.length).toBeGreaterThanOrEqual(1);
  expect(notes.length).toBeLessThanOrEqual(2);
  expect((notes[0].body.p_history_ids as string[]).length).toBeGreaterThan(1);
  expect(urls.some((u) => /lead_notes|in\.\(/.test(u))).toBe(false);
  await expect(page.locator("#lead-card-p-s05").getByTestId("last-note")).toContainText("Client asked to call back");
  const all = await page.locator('[data-card="v2"]').allInnerTexts();
  expect(all.join("\n")).not.toMatch(/Booking pending|Recycles in|Call first|Contacted|Last attempt/);
  await ctx.close();
});
test("redesign card: last-note function missing (older database) -> the panel is simply not shown", async ({ browser }, info) => {
  const ctx = await newCtx(browser, info);
  const page = await ctx.newPage();
  await open(ctx, page, "/leads", "on", { notesMissing: true });
  await expect(page.locator('[data-testid="last-note"], [data-testid="last-note-loading"], [data-testid="last-note-none"]')).toHaveCount(0);
  await ctx.close();
});
test("the comparison itself catches a missing word, a changed word and an unexpected new word", () => {
  const base = { id: "x", labels: ["WhatsApp"], v2: false, html: "" };
  const old = { ...base, text: "1\n9000000001\nWarm\nNew\n🔒 Locked until Dec 15\nLast activity 2h ago · Assigned Nov 25, 10:50 AM · 1 call · Test Source" };
  const same = { ...base, v2: true, text: "1\nWarm\nNew\n🔒 Locked until Dec 15\n90000 00001\nLast activity\n2h ago\nAssigned\nNov 25, 10:50 AM\nCalls\n1 call\nTest Source" };
  expect(compare(old, same)).toEqual([]);
  expect(compare(old, { ...same, text: same.text.replace("Locked until", "Until") })).toContain('missing "locked until dec 15"');
  expect(compare(old, { ...same, text: same.text.replace("Test Source", "") })).toContain('missing "test source"');
  expect(compare(old, { ...same, text: `${same.text}\nRecycles in 2d` })).toContain('new-only "recycles in 2d"');
});
