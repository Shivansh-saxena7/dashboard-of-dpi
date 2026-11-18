import { expect, test, type BrowserContext, type Page, type WebSocketRoute } from "@playwright/test";
import { EMP, mockSupabase, type MockState } from "./mockSupabase";

// Employee Home Phase 1 (2026-11-18), lead_engine_settings.employee_home_mode. Flag off (or the column missing) = the
// old Home exactly: social posts card open, no tiles. Flag on = Today tiles, My leads, social posts collapsed (no
// /api/data until opened). Tile numbers must equal what /leads shows. One realtime channel. Fake Supabase, Pixel 7
// (Chromium) and iPhone 14 (WebKit).

type Binding = { event: string; schema: string; table: string; filter?: string; id: number };
interface FakeRealtime {
  joined: { topic: string; bindings: Binding[] }[];
  push: (topic: string, binding: Binding, record: Record<string, unknown>) => void;
}

async function fakeRealtime(context: BrowserContext): Promise<FakeRealtime> {
  const rt: FakeRealtime = { joined: [], push: () => {} };
  const sockets: WebSocketRoute[] = [];
  let nextId = 2000;
  await context.routeWebSocket(/fake-supabase\.test\/realtime\/v1\/websocket/, (ws) => {
    sockets.push(ws);
    ws.onMessage((raw) => {
      let msg: unknown;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!Array.isArray(msg)) return;
      const [joinRef, ref, topic, event, payload] = msg as [string | null, string | null, string, string, any];
      if (event === "phx_join") {
        const bindings: Binding[] = (payload?.config?.postgres_changes || []).map((b: Omit<Binding, "id">) => ({ ...b, id: nextId++ }));
        rt.joined.push({ topic, bindings });
        ws.send(JSON.stringify([joinRef, ref, topic, "phx_reply", { status: "ok", response: { postgres_changes: bindings } }]));
      } else if (ref) {
        ws.send(JSON.stringify([joinRef, ref, topic, "phx_reply", { status: "ok", response: {} }]));
      }
    });
  });
  rt.push = (topic, binding, record) => {
    const frame = JSON.stringify([null, null, topic, "postgres_changes", {
      ids: [binding.id],
      data: { schema: binding.schema, table: binding.table, commit_timestamp: new Date().toISOString(), type: "UPDATE", record, old_record: { id: record.id }, columns: [] }
    }]);
    for (const ws of sockets) ws.send(frame);
  };
  return rt;
}

// 60 leads: 8 called Follow-up + 1 untouched Follow-up, 3 Visit, 1 Booking, 7 called Leads, 40 untouched Leads.
function shapeLeads(state: MockState) {
  const call = (lead: MockState["leads"][number], status: string, stage: string) => {
    const h = lead.lead_history[0] as Record<string, unknown>;
    lead.status = status;
    lead.board_stage = stage;
    h.call_count = 1;
    h.first_call_at = h.assigned_at;
    h.outcome_at = h.assigned_at;
    h.last_activity_at = new Date(Date.parse(String(h.assigned_at)) + 60_000).toISOString();
  };
  state.leads.forEach((lead, i) => {
    const n = i + 1;
    if (n <= 8) call(lead, "CONNECTED", "FOLLOW_UP");
    else if (n === 9) lead.board_stage = "FOLLOW_UP";
    else if (n <= 12) call(lead, "CONNECTED", "VISIT");
    else if (n === 13) call(lead, "CONVERTED", "BOOKING");
    else if (n <= 20) call(lead, "NOT_CONNECTED", "LEADS");
  });
}
const EXPECTED = { LEADS: 47, FOLLOW_UP: 9, VISIT: 3, BOOKING: 1, total: 60, newCount: 41 };

let state: MockState;
let rt: FakeRealtime;
let apiData: string[];
let apiDataAt: number[];
let loginCheckAt: number[];
let settingsAnsweredAt: number[];
test.beforeEach(async ({ context }) => {
  state = await mockSupabase(context);
  rt = await fakeRealtime(context);
  shapeLeads(state);
  state.workReport = { calls: 18, connected: 6, results_saved: 15, followUps: 3, visits: 1 };
  apiData = [];
  apiDataAt = [];
  loginCheckAt = [];
  settingsAnsweredAt = [];
  context.on("request", (req) => {
    if (new URL(req.url()).pathname.startsWith("/api/data")) {
      apiData.push(req.url());
      apiDataAt.push(Date.now());
    }
  });
  context.on("response", (res) => {
    const url = decodeURIComponent(res.url());
    if (url.includes("/rest/v1/employees") && url.includes("auth_user_id=eq.")) loginCheckAt.push(Date.now());
    if (url.includes("/rest/v1/lead_engine_settings")) settingsAnsweredAt.push(Date.now());
  });
});

const value = (page: Page, id: string) => page.getByTestId(id).locator("span").first();
const homeTopic = `realtime:employee-home-${EMP}`;

async function openHome(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Today's Shift").first()).toBeVisible();
}

test("flag off (column missing): the old Home, social posts open, no tiles", async ({ page }, info) => {
  await openHome(page);
  await expect.poll(() => apiData.length).toBeGreaterThan(0);
  await expect(page.getByTestId("employee-home-p1")).toHaveCount(0);
  await expect(page.getByTestId("tile-new")).toHaveCount(0);
  expect(rt.joined.some((j) => j.topic === homeTopic)).toBe(false);
  await page.screenshot({ path: `C:/work/reports/home_p1/home-off-${info.project.name}.png`, fullPage: true });
});

for (const settings of [{ employee_home_mode: "off" }, { employee_home_mode: "admin_pilot", employee_home_pilot_ids: ["someone-else"] }, { employee_home_mode: "ON" }]) {
  test(`flag ${JSON.stringify(settings)}: old Home`, async ({ page }) => {
    Object.assign(state.settings, settings);
    await openHome(page);
    await expect.poll(() => apiData.length).toBeGreaterThan(0);
    await expect(page.getByTestId("employee-home-p1")).toHaveCount(0);
  });
}

for (const settings of [{ employee_home_mode: "on" }, { employee_home_mode: "admin_pilot", employee_home_pilot_ids: [EMP] }]) {
  test(`flag ${settings.employee_home_mode}: new Home, tiles, My leads, social collapsed`, async ({ page }, info) => {
    Object.assign(state.settings, settings);
    await openHome(page);
    await expect(page.getByTestId("employee-home-p1")).toBeVisible();
    await expect(value(page, "tile-new")).toHaveText(String(EXPECTED.newCount));
    await expect(value(page, "tile-calls")).toHaveText("18");
    await expect(value(page, "tile-saved")).toHaveText("15");
    await expect(page.getByTestId("today-line")).toHaveText("Connected 6 · Follow-ups 3 · Visits 1");
    for (const stage of ["LEADS", "FOLLOW_UP", "VISIT", "BOOKING"] as const) {
      await expect(page.getByTestId(`stage-${stage}`).locator("span").first()).toHaveText(String(EXPECTED[stage]));
    }
    await expect(page.getByRole("link", { name: `All ${EXPECTED.total} ›` })).toBeVisible();
    await expect(page.getByTestId("social-toggle")).toHaveAttribute("aria-expanded", "false");
    // Every tap target is at least 44px high.
    for (const id of ["tile-new", "tile-recycling", "tile-calls", "tile-saved", "stage-VISIT", "social-toggle"]) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box && box.height).toBeGreaterThanOrEqual(44);
    }
    // First visit of the tab: the old Home is up before the flag is known, so its social card may ask /api/data once
    // before the switch. After that, nothing while collapsed (the old card asked at once and every minute).
    expect(apiData.length).toBeLessThanOrEqual(1);
    apiData.length = 0;
    await page.waitForTimeout(3000);
    expect(apiData).toHaveLength(0);
    // Exactly one Home channel (React dev mode joins the same topic twice; the topic is one).
    expect(new Set(rt.joined.map((j) => j.topic).filter((t) => t.startsWith("realtime:employee-home"))).size).toBe(1);
    await page.screenshot({ path: `C:/work/reports/home_p1/home-on-${settings.employee_home_mode}-${info.project.name}.png`, fullPage: true });

    await page.getByTestId("social-toggle").click();
    await expect(page.getByTestId("social-toggle")).toHaveAttribute("aria-expanded", "true");
    await expect.poll(() => apiData.length).toBeGreaterThan(0);
  });
}

test("parity: Home numbers equal the /leads tabs and filters they open", async ({ page }) => {
  state.settings.employee_home_mode = "on";
  await openHome(page);
  await expect(value(page, "tile-new")).toHaveText(String(EXPECTED.newCount));
  const recycling = Number(await value(page, "tile-recycling").textContent());

  await page.goto("/leads");
  await expect(page.locator('[id^="lead-card-"]').first()).toBeVisible();
  for (const [stage, label] of [["LEADS", "Leads"], ["FOLLOW_UP", "Follow-up"], ["VISIT", "Visit"], ["BOOKING", "Booking"]] as const) {
    const text = await page.getByRole("button", { name: new RegExp(`^\\S*\\s*${label}\\s*\\d+$`) }).first().textContent();
    expect(Number((text || "").match(/(\d+)\s*$/)?.[1]), label).toBe(EXPECTED[stage]);
  }
  const recyclingText = (await page.getByRole("button", { name: /Recycling Tomorrow/ }).textContent()) || "";
  expect(Number(recyclingText.match(/\((\d+)\)/)?.[1] ?? 0)).toBe(recycling);

  // New tile -> Status = New over every tab.
  await page.goto("/");
  await page.getByTestId("tile-new").click();
  await expect(page).toHaveURL(/\/leads$/);
  await expect(page.locator('[id^="lead-card-"]')).toHaveCount(EXPECTED.newCount);
  await expect(page.locator("#lead-card-lead-09")).toHaveCount(1);

  // Visit tile -> the Visit tab.
  await page.goto("/");
  await page.getByTestId("stage-VISIT").click();
  await expect(page).toHaveURL(/\/leads$/);
  await expect(page.locator('[id^="lead-card-"]')).toHaveCount(EXPECTED.VISIT);
});

test("realtime: a change to the employee's lead updates the tiles, no reload", async ({ page }) => {
  state.settings.employee_home_mode = "on";
  await openHome(page);
  await expect(value(page, "tile-new")).toHaveText(String(EXPECTED.newCount));
  await expect.poll(() => rt.joined.filter((j) => j.topic === homeTopic).length).toBeGreaterThan(0);
  await page.waitForTimeout(1200);
  const join = [...rt.joined].reverse().find((j) => j.topic === homeTopic)!;
  const binding = join.bindings.find((b) => b.table === "lead_history" && b.filter === `employee_id=eq.${EMP}`)!;
  expect(binding).toBeTruthy();
  const h = state.leads[20].lead_history[0] as Record<string, unknown>;
  h.call_count = 1;
  h.first_call_at = new Date().toISOString();
  rt.push(homeTopic, binding, { id: h.id, employee_id: EMP });
  await expect(value(page, "tile-new")).toHaveText(String(EXPECTED.newCount - 1));
});

// Risk 1 (2026-11-18): the flag is read in the background, the old Home never waits for it.
test("slow settings (5 s), flag off: the old Home is up within 0.5 s of the login check", async ({ page }) => {
  state.settingsDelayMs = 5000;
  await openHome(page);
  await expect.poll(() => apiDataAt.length).toBeGreaterThan(0);
  const shown = apiDataAt[0];
  const check = Math.max(...loginCheckAt.filter((t) => t <= shown));
  console.log(`old Home ${shown - check} ms after the login check, settings still pending`);
  expect(shown - check).toBeLessThan(500);
  expect(settingsAnsweredAt.filter((t) => t <= shown)).toHaveLength(0);
  await expect(page.getByTestId("employee-home-p1")).toHaveCount(0);
});

test("flag on, settings 1 s late: old Home first, then the new Home in place (no page reload)", async ({ page }) => {
  state.settingsDelayMs = 1000;
  state.settings.employee_home_mode = "on";
  await openHome(page);
  await page.evaluate(() => ((window as unknown as { __samePage?: number }).__samePage = 1));
  await expect(page.getByTestId("employee-home-p1")).toBeVisible();
  await expect(value(page, "tile-new")).toHaveText(String(EXPECTED.newCount));
  expect(await page.evaluate(() => (window as unknown as { __samePage?: number }).__samePage)).toBe(1);
  await expect(page.getByText("Today's Shift").first()).toBeVisible();
});

test("flag on, settings 5 s late: stays on the old Home (2 s timeout), nothing remembered, next visit asks again", async ({ page }) => {
  state.settingsDelayMs = 5000;
  state.settings.employee_home_mode = "on";
  await openHome(page);
  await expect.poll(() => apiData.length).toBeGreaterThan(0);
  await page.waitForTimeout(6000);
  await expect(page.getByTestId("employee-home-p1")).toHaveCount(0);
  await expect(page.getByText("Today's Shift").first()).toBeVisible();
  state.settingsDelayMs = 0;
  await page.reload();
  await expect(page.getByTestId("employee-home-p1")).toBeVisible();
});

test("remembered on: the next visit shows the new Home at once, the social card is never mounted", async ({ page }) => {
  state.settings.employee_home_mode = "on";
  await openHome(page);
  await expect(page.getByTestId("employee-home-p1")).toBeVisible();
  apiData.length = 0;
  state.settingsDelayMs = 5000;
  await page.reload();
  await expect(page.getByTestId("employee-home-p1")).toBeVisible({ timeout: 1500 });
  await page.waitForTimeout(2000);
  expect(apiData).toHaveLength(0);
});
