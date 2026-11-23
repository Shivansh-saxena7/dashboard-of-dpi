import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { FAKE_SUPABASE, LEAD_ENGINE_SETTINGS, mockSupabase, type MockState } from "./mockSupabase";

// "Previously with" tag + Journey (2026-11-23) on the employee's lead / data cards, only for leads an admin gave from
// the Performance Report. Flag reassigned_journey_mode (default off). Fake Supabase (tests/e2e/mockSupabase.ts); the SQL
// (owner-only, no admin reason) is tested in PGlite. Pixel 7, iPhone 14, desktop Chromium.

const SHOTS = "C:/work/reports/reassigned_journey";
const TAGGED = { LEAD: "lead-40", DATA: "data-30" };
type Opts = { mode?: "on" | "off" | "missing" | "slow"; listFail?: boolean; listOff?: boolean };
let state: MockState;
let calls: { rpc: string; body: Record<string, unknown>; url: string }[];

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
const CONTEXT = (leadId: string) => ({
  lead_id: leadId, previously_with: "Employee P", given_at: "2026-11-20T05:00:00Z",
  previous: { assigned_at: "2026-11-01T05:00:00Z", ended_at: "2026-11-20T05:00:00Z", followup: false, visit: false, converted: false, result: "NOT_CONNECTED" },
  journey: [
    { employee: "Employee Q", is_you: false, origin: "FRESH", given_by_admin: false, assigned_at: "2026-10-20T05:00:00Z", ended_at: "2026-11-01T05:00:00Z", current: false, followup: true, visit: false, converted: false, result: "NOT_INTERESTED" },
    { employee: "Employee P", is_you: false, origin: "RECYCLED", given_by_admin: false, assigned_at: "2026-11-01T05:00:00Z", ended_at: "2026-11-20T05:00:00Z", current: false, followup: false, visit: false, converted: false, result: "NOT_CONNECTED" },
    { employee: "You", is_you: true, origin: "ADMIN_GIVEN", given_by_admin: true, assigned_at: "2026-11-20T05:00:00Z", ended_at: null, current: true, followup: false, visit: false, converted: false, result: null }
  ]
});

async function open(context: BrowserContext, page: Page, path: "/leads" | "/data", opts: Opts = {}) {
  state = await mockSupabase(context);
  calls = [];
  const mode = opts.mode ?? "on";
  await context.route(`${FAKE_SUPABASE}/rest/v1/lead_engine_settings**`, async (r) => {
    const row: Record<string, unknown> = { ...LEAD_ENGINE_SETTINGS };
    if (mode !== "missing") row.reassigned_journey_mode = mode === "slow" ? "on" : mode;
    if (mode === "slow") await new Promise((res) => setTimeout(res, 3500));
    return r.fulfill(json((r.request().headers()["accept"] || "").includes("object") ? row : [row]));
  });
  await context.route(`${FAKE_SUPABASE}/rest/v1/rpc/get_my_reassigned_leads`, (r) => {
    calls.push({ rpc: "list", body: JSON.parse(r.request().postData() || "{}"), url: r.request().url() });
    if (opts.listFail) return r.fulfill(json({ message: "fake failure" }, 500));
    if (opts.listOff) return r.fulfill(json({ enabled: false, leads: [] }));
    return r.fulfill(json({ enabled: true, leads: [{ lead_id: TAGGED.LEAD, previously_with: "Employee P", given_at: "2026-11-20T05:00:00Z" }, { lead_id: TAGGED.DATA, previously_with: "Employee P", given_at: "2026-11-20T05:00:00Z" }] }));
  });
  await context.route(`${FAKE_SUPABASE}/rest/v1/rpc/get_reassigned_lead_context`, (r) => {
    const body = JSON.parse(r.request().postData() || "{}");
    calls.push({ rpc: "context", body, url: r.request().url() });
    return r.fulfill(json(CONTEXT(String(body.p_lead_id))));
  });
  await page.goto(path);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; pointer-events: none !important; }" }).catch(() => undefined);
}
const card = (page: Page, path: "/leads" | "/data", id: string) => page.locator(path === "/leads" ? `#lead-card-${id}` : `#data-card-${id}`);
const listCalls = () => calls.filter((c) => c.rpc === "list").length;

for (const [path, type] of [["/leads", "LEAD"], ["/data", "DATA"]] as const) {
  test(`${path}: flag on - only the report-given card shows the tag and Journey; one list call; Journey opens the timeline (screenshots)`, async ({ page, context }, info) => {
    await open(context, page, path);
    const tagged = card(page, path, TAGGED[type]);
    await tagged.scrollIntoViewIfNeeded();
    await expect(tagged.getByTestId("reassigned-tag")).toHaveText("Previously with Employee P");
    await expect(page.getByTestId("reassigned-tag")).toHaveCount(1);
    const btn = tagged.getByTestId("reassigned-journey");
    expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(listCalls()).toBe(1);
    expect(calls[0].body).toEqual({});
    await page.screenshot({ path: `${SHOTS}/${type.toLowerCase()}-tag-card-${info.project.name}.png` });
    await btn.click();
    const sheet = page.getByTestId("journey-sheet");
    await expect(sheet.getByTestId("journey-row")).toHaveCount(3);
    await expect(sheet.getByTestId("journey-row").nth(0)).toContainText("Employee Q · Fresh");
    await expect(sheet.getByTestId("journey-row").nth(0)).toContainText("Follow-up");
    await expect(sheet.getByTestId("journey-row").nth(1)).toContainText("Not connected");
    await expect(sheet.getByTestId("journey-row").nth(2)).toContainText("Given by admin");
    await expect(sheet.getByTestId("journey-row").nth(2)).toContainText("With you now");
    const ctx = calls.filter((c) => c.rpc === "context");
    expect(ctx.length).toBeLessThanOrEqual(2); // one tap = one call (React dev StrictMode may run the effect twice)
    expect([...new Set(ctx.map((c) => JSON.stringify(c.body)))]).toEqual([JSON.stringify({ p_lead_id: TAGGED[type] })]);
    expect(calls.every((c) => !c.url.includes(TAGGED[type]))).toBe(true); // ids only in the body
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `${SHOTS}/${type.toLowerCase()}-journey-sheet-${info.project.name}.png` });
    await sheet.getByTestId("journey-close").click();
    await expect(sheet).toHaveCount(0);
    await page.waitForTimeout(3000);
    expect(listCalls()).toBe(1); // no polling
  });
}

for (const mode of ["missing", "off", "slow"] as const) {
  test(`flag ${mode}: no tag anywhere, no list call, cards unchanged (screenshot)`, async ({ page, context }, info) => {
    await open(context, page, "/leads", { mode });
    const plain = card(page, "/leads", TAGGED.LEAD);
    await plain.scrollIntoViewIfNeeded();
    await expect(plain).toBeVisible();
    await page.waitForTimeout(mode === "slow" ? 4500 : 1500);
    await expect(page.getByTestId("reassigned-tag")).toHaveCount(0);
    await expect(page.getByTestId("reassigned-journey")).toHaveCount(0);
    expect(listCalls()).toBe(0);
    if (mode === "missing") await page.screenshot({ path: `${SHOTS}/lead-tagless-card-${info.project.name}.png` });
  });
}

for (const [name, opts] of [["list call fails", { listFail: true }], ["database says off", { listOff: true }]] as const) {
  test(`${name}: no tag, nothing else changes`, async ({ page, context }) => {
    await open(context, page, "/leads", opts);
    await expect.poll(() => listCalls()).toBe(1);
    await page.waitForTimeout(500);
    await expect(page.getByTestId("reassigned-tag")).toHaveCount(0);
    await expect(card(page, "/leads", TAGGED.LEAD)).toBeVisible();
  });
}

test("tapping the card itself still opens the lead as before (Journey tap does not)", async ({ page, context }) => {
  await open(context, page, "/leads");
  const tagged = card(page, "/leads", TAGGED.LEAD);
  await tagged.scrollIntoViewIfNeeded();
  await tagged.getByTestId("reassigned-journey").click();
  await expect(page.getByTestId("journey-sheet")).toBeVisible();
  await page.getByTestId("journey-close").click();
  await tagged.getByText("Test Lead 40", { exact: true }).click();
  await expect(page.getByTestId("journey-sheet")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Log Update/ })).toBeVisible(); // the lead opened as before
});
