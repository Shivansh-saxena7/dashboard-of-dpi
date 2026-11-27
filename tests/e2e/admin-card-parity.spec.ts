import { expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import crypto from "crypto";
import fs from "fs";
import { EMP, FAKE_SUPABASE, UID, mockSupabase, type MockState } from "./mockSupabase";
import { ADMIN_SCENARIOS, NOTES, OWNER, OWNER_ON_LEAVE, RECEIVER, SIBLINGS, T0, TEAM } from "./adminCardFixture";

// Admin card parity (2026-11-27 admin card port): the old AdminLeadCard (admin_card_mode off) and AdminLeadCardV2 (on)
// render the SAME page data on /admin/leads (admin, super_admin) and /coordinator (read-only). For every scenario card:
// every line of text the old card shows, and its hover texts, must be visible in the new card; anything the new card
// adds must be on the redesign-only list (last note, the visible "Exact time"); the controls (checkbox, team select +
// its options, View History, JUNK Reassign, the existing-client button) are the same; the actions send the same
// requests. Flag off / missing / slow / pilot-without-me = the old card; a late answer never swaps after a touch.
// Fake Supabase, fixed clock. Masked live rows with ADMIN_LIVE_FILE. Pixel 7, iPhone 14, desktop Chromium.

const SHOTS = "C:/work/reports/admin_card_parity";
const GRID = 'div[class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"]';
type Mode = "off" | "on" | "missing" | "slow" | "pilot_me" | "pilot_other";
type Role = "admin" | "super_admin" | "sales_coordinator";
type CardInfo = { key: string; v2: boolean; lines: string[]; titles: string[]; controls: string[]; options: string[] };
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => ({
  status,
  headers: { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-expose-headers": "content-range", ...extra },
  body: JSON.stringify(body)
});
type Captured = { notes: unknown[]; patches: unknown[]; unjunk: unknown[]; reservations: unknown[] };
let state: MockState;
const newCtx = (browser: Browser, info: TestInfo) => {
  const u = info.project.use;
  return browser.newContext({ baseURL: u.baseURL, viewport: u.viewport, userAgent: u.userAgent, deviceScaleFactor: u.deviceScaleFactor, isMobile: u.isMobile, hasTouch: u.hasTouch });
};
let cap: Captured;

async function open(context: BrowserContext, page: Page, path: "/admin/leads" | "/coordinator", role: Role, mode: Mode, opts: { rows?: unknown[]; now?: Date; noClock?: boolean } = {}) {
  state = await mockSupabase(context);
  cap = { notes: [], patches: [], unjunk: [], reservations: [] };
  const rows = opts.rows ?? ADMIN_SCENARIOS.map(([, r]) => structuredClone(r));
  if (!opts.noClock) await page.clock.setFixedTime(opts.now ?? T0);
  const me = { id: EMP, auth_user_id: UID, name: "Test Admin", role, department: "admin", is_active: true, team_id: null };
  state.employee = me;
  state.leave = [{ employee_id: OWNER_ON_LEAVE, start_date: "2026-11-20", end_date: null }];
  if (mode === "on") state.settings.admin_card_mode = "on";
  if (mode === "off") state.settings.admin_card_mode = "off";
  if (mode === "pilot_me") Object.assign(state.settings, { admin_card_mode: "admin_pilot", admin_card_pilot_ids: [EMP] });
  if (mode === "pilot_other") Object.assign(state.settings, { admin_card_mode: "admin_pilot", admin_card_pilot_ids: ["00000000-0000-4000-8000-00000000ffff"] });
  if (mode === "slow") {
    state.settings.admin_card_mode = "on";
    state.settingsDelayMs = 3500;
  }
  const staff = [me, { id: OWNER, name: "Owner One", is_active: true, role: "employee" }, { id: OWNER_ON_LEAVE, name: "Owner Leave", is_active: true, role: "employee" }, { id: RECEIVER, name: "Rama Receiver", is_active: true, role: "employee" }];
  await context.route(`${FAKE_SUPABASE}/rest/v1/employees**`, (route) => {
    const url = decodeURIComponent(route.request().url());
    const one = (route.request().headers()["accept"] || "").includes("vnd.pgrst.object");
    return route.fulfill(json(url.includes("auth_user_id=eq.") ? (one ? me : [me]) : staff));
  });
  await context.route(`${FAKE_SUPABASE}/rest/v1/leads?**`, (route) => {
    const req = route.request();
    if (req.method() === "PATCH") {
      cap.patches.push({ url: decodeURIComponent(req.url()).replace(/^.*\/leads\?/, ""), body: req.postDataJSON() });
      return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } });
    }
    if (req.method() !== "GET") return route.fallback();
    return route.fulfill(json(rows, 200, { "content-range": `0-${rows.length - 1}/${rows.length}` }));
  });
  await context.route(`${FAKE_SUPABASE}/rest/v1/teams**`, (route) => route.fulfill(json([TEAM])));
  await context.route(`${FAKE_SUPABASE}/rest/v1/lead_team_reservations**`, (route) => {
    if (route.request().method() !== "POST") return route.fulfill(json([])); // the history modal reads it
    cap.reservations.push(route.request().postDataJSON());
    return route.fulfill({ status: 201, headers: { "access-control-allow-origin": "*" } });
  });
  await context.route(`${FAKE_SUPABASE}/rest/v1/rpc/get_lead_siblings`, (route) => route.fulfill(json(opts.rows ? {} : SIBLINGS)));
  await context.route(`${FAKE_SUPABASE}/rest/v1/rpc/get_last_notes`, (route) => {
    const body = route.request().postDataJSON() as { p_history_ids: string[] };
    cap.notes.push({ url: route.request().url(), n: body.p_history_ids.length });
    const rowsOut = body.p_history_ids.filter((id) => NOTES[id]).map((id) => ({ lead_history_id: id, note: NOTES[id], created_at: new Date(T0.getTime() - 3 * 3600e3).toISOString() }));
    return route.fulfill(json(rowsOut));
  });
  await context.route(`${FAKE_SUPABASE}/rest/v1/rpc/unjunk_and_reassign_lead_atomic`, (route) => {
    cap.unjunk.push(route.request().postDataJSON());
    return route.fulfill(json(null));
  });
  await page.goto(path);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; pointer-events: none !important; }" }).catch(() => undefined);
  await expect(page.locator(`${GRID} > div`).first()).toBeVisible({ timeout: 20000 });
}

async function waitMode(page: Page, v2: boolean) {
  await expect.poll(async () => page.locator(`${GRID} > div[data-card="v2"]`).count(), { timeout: 8000 }).toBe(v2 ? await page.locator(`${GRID} > div`).count() : 0);
  await page.waitForTimeout(900); // fade-in done, last notes loaded
}

async function cards(page: Page): Promise<CardInfo[]> {
  return page.locator(GRID).first().evaluate((grid) =>
    [...grid.children].map((c) => {
      const el = c as HTMLElement;
      const selects = [...el.querySelectorAll("select")] as HTMLElement[];
      selects.forEach((s) => (s.style.display = "none"));
      const lines = el.innerText.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
      selects.forEach((s) => (s.style.display = ""));
      const titles = [...el.querySelectorAll("[title]")].map((t) => (t.getAttribute("title") || "").trim()).filter(Boolean);
      const controls = [...el.querySelectorAll("button, select, [role=checkbox], a[href]")]
        .filter((b) => (b as HTMLElement).offsetParent !== null || b.tagName === "SELECT")
        .map((b) => `${b.tagName === "SELECT" ? "select" : b.getAttribute("role") || "button"}:${((b.getAttribute("role") === "checkbox" ? b.getAttribute("aria-label") : b.tagName === "SELECT" ? "" : (b as HTMLElement).innerText || b.getAttribute("aria-label")) || "").replace(/\s+/g, " ").trim()}`)
        .sort();
      const options = selects.flatMap((s) => [...(s as HTMLSelectElement).options].map((o) => o.text.trim()));
      const key = (el.innerText.match(/9\d{9}/) || ["?"])[0];
      return { key, v2: el.dataset.card === "v2", lines, titles, controls, options };
    })
  );
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const NEW_ONLY = [/^No note yet$/, /^Last note · /, /^· ?(\d+[mhd] ago|just now)$/, /^Exact time: /, ...Object.values(NOTES).map((n) => new RegExp(`^${n}$`))];
function compare(oldCards: CardInfo[], newCards: CardInfo[]) {
  const gaps: string[] = [];
  expect(newCards.map((c) => c.key)).toEqual(oldCards.map((c) => c.key));
  for (const o of oldCards) {
    const n = newCards.find((c) => c.key === o.key)!;
    const newText = norm(n.lines.join(" "));
    const oldText = norm(o.lines.join(" "));
    for (const line of o.lines) if (!newText.includes(line)) gaps.push(`${o.key}: missing "${line}"`);
    // Hover texts: "Exact time" must be visible; the others (catcher, siblings) visible or still a hover text.
    for (const t of o.titles) {
      if (t.startsWith("Exact time:") ? !newText.includes(t) : !newText.includes(t.split("\n")[0]) && !n.titles.includes(t)) gaps.push(`${o.key}: hover text "${t}" not shown`);
    }
    for (const line of n.lines) if (!oldText.includes(line) && !NEW_ONLY.some((r) => r.test(line)) && !o.titles.some((t) => t.includes(line))) gaps.push(`${o.key}: new-only "${line}"`);
    if (JSON.stringify(n.controls) !== JSON.stringify(o.controls)) gaps.push(`${o.key}: controls ${JSON.stringify(o.controls)} -> ${JSON.stringify(n.controls)}`);
    if (JSON.stringify(n.options) !== JSON.stringify(o.options)) gaps.push(`${o.key}: options ${JSON.stringify(o.options)} -> ${JSON.stringify(n.options)}`);
  }
  return gaps;
}

// Per-card screenshots for the side-by-side index (fake scenarios: chosen cards; live: the first 6, masked).
const SHOT_KEYS = ["9000010002", "9000010003", "9000010004", "9000010005", "9000010006", "9000010009", "9000010010", "9000010011", "9000010014", "9000010016", "9000010017", "9000010018", "9000010019"];
async function shot(page: Page, info: TestInfo, tag: string, live = false) {
  if (!process.env.ADMIN_SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  const all = page.locator(`${GRID} > div`);
  const n = await all.count();
  for (let i = 0; i < n; i++) {
    const c = all.nth(i);
    const key = ((await c.innerText()).match(/9\d{9}/) || ["?"])[0];
    if (live ? i >= 6 : !SHOT_KEYS.includes(key)) continue;
    await c.scrollIntoViewIfNeeded();
    await c.screenshot({ path: `${SHOTS}/${tag}-${info.project.name}-${live ? "live" + (i + 1) : key.slice(-2)}.png`, animations: "disabled" });
  }
}

for (const [path, role] of [["/admin/leads", "admin"], ["/admin/leads", "super_admin"], ["/coordinator", "sales_coordinator"], ["/coordinator", "admin"]] as const) {
  test(`${path} as ${role}: every scenario card shows the same text, hover texts, controls and options (old vs new)`, async ({ context, page, browser }, info) => {
    await open(context, page, path, role, "off");
    await waitMode(page, false);
    const oldCards = await cards(page);
    expect(oldCards.length).toBe(ADMIN_SCENARIOS.length);
    if (role === "admin" && path === "/admin/leads") await shot(page, info, "old");
    const ctx2 = await newCtx(browser, info);
    const page2 = await ctx2.newPage();
    await open(ctx2, page2, path, role, "on");
    await waitMode(page2, true);
    const newCards = await cards(page2);
    if (role === "admin" && path === "/admin/leads") await shot(page2, info, "new");
    const gaps = compare(oldCards, newCards);
    expect(gaps, gaps.join("\n")).toEqual([]);
    // Read-only on /coordinator: no checkbox, no team select, no Reassign (both cards).
    const actionable = newCards.flatMap((c) => c.controls).filter((c) => /^checkbox:|^select:|Reassign/.test(c));
    if (path === "/coordinator") expect(actionable).toEqual([]);
    else expect(actionable.length).toBeGreaterThan(0);
    // Last note: one batched RPC in the POST body (no id list in a URL), at most 200 ids a call.
    expect(cap.notes.length).toBeGreaterThan(0);
    for (const c of cap.notes as { url: string; n: number }[]) expect([c.url.includes("p_history_ids"), c.n <= 200]).toEqual([false, true]);
    await ctx2.close();
  });
}

test("actions on /admin/leads send the same requests with either card: tick, team reserve, JUNK Reassign, history", async ({ context, page, browser }, info) => {
  const results: Record<string, unknown>[] = [];
  for (const mode of ["off", "on"] as const) {
    const ctx = mode === "off" ? context : await newCtx(browser, info);
    const pg = mode === "off" ? page : await ctx.newPage();
    await open(ctx, pg, "/admin/leads", "admin", mode);
    await waitMode(pg, mode === "on");
    const card = (mobile: string) => pg.locator(`${GRID} > div`).filter({ hasText: mobile });
    // Tick (S1) flips at once; JUNK (S11) and booked (S12) have no box.
    const box = card("9000010001").getByRole("checkbox");
    await expect(async () => {
      if ((await box.getAttribute("aria-checked")) !== "true") await box.click();
      await expect(box).toHaveAttribute("aria-checked", "true", { timeout: 1500 });
    }).toPass({ timeout: 15000 });
    const noBox = [await card("9000010011").getByRole("checkbox").count(), await card("9000010012").getByRole("checkbox").count()];
    // Team reserve on the unowned lead (S15).
    await card("9000010016").locator("select").selectOption(TEAM.id);
    await expect.poll(() => cap.patches.length).toBe(1);
    // JUNK Reassign (S11).
    await card("9000010011").getByRole("button", { name: "🔁 Reassign" }).click();
    await card("9000010011").locator("select").selectOption(RECEIVER);
    await card("9000010011").getByPlaceholder("Reason (mandatory)").fill("Worth another try");
    await card("9000010011").getByRole("button", { name: "Reassign", exact: true }).click();
    await expect.poll(() => cap.unjunk.length).toBe(1);
    // History opens with the lead's name.
    await card("9000010002").getByRole("button", { name: /View History/ }).click();
    await expect(pg.getByRole("heading", { name: "Admin Lead 02" })).toBeVisible();
    results.push({ noBox, patches: cap.patches, reservations: cap.reservations.length, unjunk: cap.unjunk });
    if (mode === "on") await ctx.close();
  }
  expect(results[1]).toEqual(results[0]);
});

test("flag: off / missing / slow / pilot-without-me = old card; on / pilot-with-me = new card", async ({ context, page, browser }, info) => {
  const got: Record<string, boolean> = {};
  for (const mode of ["off", "missing", "slow", "pilot_other", "on", "pilot_me"] as const) {
    const ctx = await newCtx(browser, info);
    const pg = await ctx.newPage();
    await open(ctx, pg, "/admin/leads", "admin", mode);
    if (mode === "slow") await pg.waitForTimeout(4500);
    else await pg.waitForTimeout(1500);
    got[mode] = (await pg.locator(`${GRID} > div[data-card="v2"]`).count()) > 0;
    await ctx.close();
  }
  void context;
  void page;
  expect(got).toEqual({ off: false, missing: false, slow: false, pilot_other: false, on: true, pilot_me: true });
});

test("flag: the list never waits; a tick before the answer keeps the old card (and the tick); the next load shows the new card", async ({ context, page }) => {
  await open(context, page, "/admin/leads", "admin", "on", { noClock: true });
  // Answer held back 1.5 s, nothing remembered yet: the old cards are on screen before it.
  state.settingsDelayMs = 1500;
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expect(page.locator(`${GRID} > div`).first()).toBeVisible();
  expect(await page.locator(`${GRID} > div[data-card="v2"]`).count()).toBe(0);
  const box = page.locator(`${GRID} > div`).filter({ hasText: "9000010001" }).getByRole("checkbox");
  await box.click();
  await expect(box).toHaveAttribute("aria-checked", "true");
  await page.waitForTimeout(2500);
  expect(await page.locator(`${GRID} > div[data-card="v2"]`).count()).toBe(0);
  await expect(box).toHaveAttribute("aria-checked", "true");
  state.settingsDelayMs = 0;
  await page.reload();
  await expect.poll(() => page.locator(`${GRID} > div[data-card="v2"]`).count(), { timeout: 8000 }).toBeGreaterThan(0);
});

test("new card: taps at least 44 px, no side scroll, no purple", async ({ context, page }) => {
  await open(context, page, "/admin/leads", "admin", "on");
  await waitMode(page, true);
  const small = await page.locator(`${GRID} > div[data-card="v2"]`).evaluateAll((els) =>
    els.flatMap((c) =>
      [...c.querySelectorAll("button, select, [role=checkbox]")]
        .map((b) => b.getBoundingClientRect())
        .filter((r) => r.height > 0 && r.height < 44)
        .map((r) => Math.round(r.height))
    )
  );
  expect(small).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  const purple = await page.locator(`${GRID} > div[data-card="v2"]`).evaluateAll((els) =>
    els.flatMap((c) => [c, ...c.querySelectorAll("*")]).filter((e) => {
      const s = getComputedStyle(e);
      return [s.color, s.backgroundColor, s.borderColor].some((v) => {
        const m = v.match(/rgba?\((\d+), (\d+), (\d+)/);
        if (!m) return false;
        const [r, g, b] = m.slice(1).map(Number);
        return b > 150 && r > 110 && g < r - 20; // violet / purple family
      });
    }).length
  );
  expect(purple).toBe(0);
});

test("flag off: the list HTML is the old card's (hash written for the main comparison)", async ({ context, page }, info) => {
  await open(context, page, "/admin/leads", "admin", "off");
  await page.waitForTimeout(1500);
  const html = await page.locator(GRID).first().evaluate((g) => g.outerHTML);
  expect(html).not.toContain('data-card="v2"');
  if (process.env.ADMIN_HTML_OUT) fs.appendFileSync(process.env.ADMIN_HTML_OUT, `${info.project.name} ${crypto.createHash("sha256").update(html).digest("hex")}\n`);
});

test("masked live rows: same text and controls (ADMIN_LIVE_FILE)", async ({ context, page, browser }, info) => {
  test.skip(!process.env.ADMIN_LIVE_FILE, "needs ADMIN_LIVE_FILE (masked export)");
  const rows = JSON.parse(fs.readFileSync(process.env.ADMIN_LIVE_FILE!, "utf8")) as unknown[];
  const now = new Date();
  await open(context, page, "/admin/leads", "admin", "off", { rows, now });
  await waitMode(page, false);
  const oldCards = await cards(page);
  await shot(page, info, "old", true);
  const ctx2 = await newCtx(browser, info);
  const page2 = await ctx2.newPage();
  await open(ctx2, page2, "/admin/leads", "admin", "on", { rows, now });
  await waitMode(page2, true);
  const newCards = await cards(page2);
  await shot(page2, info, "new", true);
  const gaps = compare(oldCards, newCards);
  expect(gaps, gaps.join("\n")).toEqual([]);
  await ctx2.close();
});
