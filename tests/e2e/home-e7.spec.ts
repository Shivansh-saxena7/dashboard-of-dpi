import { expect, test, type BrowserContext, type Page, type WebSocketRoute } from "@playwright/test";
import { EMP, mockSupabase, type MockState } from "./mockSupabase";

// Employee Home E7 (2026-11-19), flag on only: reminders over the Home's one realtime channel (own lead_notes), with a
// self-healing fallback when the server refuses that binding, the old refresh when realtime is down, and the one-line
// social posts summary (no /api/data while collapsed). Fake Supabase + fake Realtime (Phoenix protocol), Pixel 7 and
// iPhone 14.

type Binding = { event: string; schema: string; table: string; filter?: string; id: number };
type Refuse = "none" | "join-error" | "system-error";
interface FakeRealtime {
  joined: { topic: string; bindings: Binding[] }[];
  push: (topic: string, binding: Binding, record: Record<string, unknown>) => void;
}

async function fakeRealtime(context: BrowserContext, refuse: Refuse): Promise<FakeRealtime> {
  const rt: FakeRealtime = { joined: [], push: () => {} };
  const sockets: WebSocketRoute[] = [];
  let nextId = 3000;
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
        const hasNotes = bindings.some((b) => b.table === "lead_notes");
        if (hasNotes && refuse === "join-error") {
          ws.send(JSON.stringify([joinRef, ref, topic, "phx_reply", { status: "error", response: { reason: "Unable to subscribe to changes with given parameters" } }]));
          return;
        }
        ws.send(JSON.stringify([joinRef, ref, topic, "phx_reply", { status: "ok", response: { postgres_changes: bindings } }]));
        if (hasNotes && refuse === "system-error") {
          ws.send(JSON.stringify([null, null, topic, "system", { extension: "postgres_changes", status: "error", message: "Unable to subscribe to changes: lead_notes is not published" }]));
        }
      } else if (ref) {
        ws.send(JSON.stringify([joinRef, ref, topic, "phx_reply", { status: "ok", response: {} }]));
      }
    });
  });
  rt.push = (topic, binding, record) => {
    const frame = JSON.stringify([null, null, topic, "postgres_changes", {
      ids: [binding.id],
      data: { schema: binding.schema, table: binding.table, commit_timestamp: new Date().toISOString(), type: "INSERT", record, old_record: {}, columns: [] }
    }]);
    for (const ws of sockets) ws.send(frame);
  };
  return rt;
}

const TOPIC = `realtime:employee-home-${EMP}`;
let state: MockState;
let apiData: number;

async function setup(context: BrowserContext) {
  state = await mockSupabase(context);
  state.workReport = { calls: 18, connected: 6, results_saved: 15, followUps: 3, visits: 1 };
  state.settings.employee_home_mode = "on";
  apiData = 0;
  context.on("request", (req) => {
    if (new URL(req.url()).pathname.startsWith("/api/data")) apiData++;
  });
}

async function openHome(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("employee-home-p1")).toBeVisible();
  await expect(page.getByTestId("tile-calls")).toBeVisible();
}

const lastJoin = (rt: FakeRealtime) => [...rt.joined].reverse().find((j) => j.topic === TOPIC);
const addReminder = (leadId: string) => state.reminders.push({ lead_id: leadId, reminder_at: new Date(Date.now() + 60_000).toISOString() });

test("a reminder saved elsewhere shows on the Home at once (own lead_notes on the same channel)", async ({ page, context }, info) => {
  await setup(context);
  const rt = await fakeRealtime(context, "none");
  await openHome(page);
  await expect.poll(() => lastJoin(rt)?.bindings.length ?? 0).toBe(3);
  await page.waitForTimeout(1200); // the last join (dev mode joins twice) is the live one
  const join = lastJoin(rt)!;
  const notes = join.bindings.find((b) => b.table === "lead_notes")!;
  expect(notes.filter).toBe(`employee_id=eq.${EMP}`);
  expect(new Set(rt.joined.map((j) => j.topic).filter((t) => t.startsWith("realtime:employee-home"))).size).toBe(1);
  await expect(page.getByTestId("attention-reminders-today")).toHaveCount(0);
  addReminder("lead-31");
  rt.push(TOPIC, notes, { id: "n1", employee_id: EMP, lead_id: "lead-31" });
  await expect(page.getByTestId("attention-reminders-today")).toHaveText(/^1\s*Reminders today/);
  await page.screenshot({ path: `C:/work/reports/home_e7/home-e7-realtime-${info.project.name}.png`, fullPage: true });
});

for (const refuse of ["join-error", "system-error"] as const) {
  test(`server refuses the lead_notes binding (${refuse}): one channel again without it, leads updates keep working`, async ({ page, context }) => {
    await setup(context);
    const rt = await fakeRealtime(context, refuse);
    await openHome(page);
    await expect.poll(() => lastJoin(rt)?.bindings.length ?? 0).toBe(2);
    await page.waitForTimeout(1200);
    const join = lastJoin(rt)!;
    expect(join.bindings.map((b) => b.table).sort()).toEqual(["lead_history", "leads"]);
    expect(new Set(rt.joined.map((j) => j.topic).filter((t) => t.startsWith("realtime:employee-home"))).size).toBe(1);
    const newBefore = Number(await page.getByTestId("tile-new").locator("span").first().textContent());
    const h = state.leads[20].lead_history[0] as Record<string, unknown>;
    h.call_count = 1;
    h.first_call_at = new Date().toISOString();
    rt.push(TOPIC, join.bindings.find((b) => b.table === "lead_history")!, { id: h.id, employee_id: EMP });
    await expect(page.getByTestId("tile-new").locator("span").first()).toHaveText(String(newBefore - 1));
  });
}

test("realtime down: the reminder still arrives when the app comes back (old refresh), no polling", async ({ page, context }) => {
  await setup(context); // no fake Realtime: the socket is refused
  await page.clock.install();
  await openHome(page);
  let homeReads = 0;
  page.on("request", (req) => {
    if (req.url().includes("/rest/v1/lead_notes")) homeReads++;
  });
  addReminder("lead-31");
  await page.clock.runFor(30_000);
  expect(homeReads).toBe(0); // nothing on a timer
  await expect(page.getByTestId("attention-reminders-today")).toHaveCount(0);
  await page.clock.fastForward(61_000);
  await page.evaluate(() => {
    (window as unknown as { __vis?: string }).__vis = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    (window as unknown as { __vis?: string }).__vis = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByTestId("attention-reminders-today")).toHaveText(/^1\s*Reminders today/);
});

test("social posts: one-line summary on the collapsed card, no /api/data until opened", async ({ page, context }, info) => {
  await setup(context);
  state.tracking = [
    { ig_done: true, fb_done: false },
    { ig_done: false, fb_done: false },
    { ig_done: true, fb_done: true }
  ];
  await openHome(page);
  await expect(page.getByTestId("social-summary")).toHaveText("2 posts to like today");
  // First visit of the tab: the old Home may ask /api/data once before the flag is known (Phase 1). From here on the
  // collapsed card and its summary never do.
  expect(apiData).toBeLessThanOrEqual(1);
  apiData = 0;
  await page.waitForTimeout(1500);
  expect(apiData).toBe(0);
  await page.screenshot({ path: `C:/work/reports/home_e7/home-e7-social-${info.project.name}.png`, fullPage: true });
  await page.getByTestId("social-toggle").click();
  await expect(page.getByTestId("social-summary")).toHaveCount(0);
  await expect.poll(() => apiData).toBeGreaterThan(0);
});

test("social posts: none today / all done", async ({ page, context }) => {
  await setup(context);
  await openHome(page);
  await expect(page.getByTestId("social-summary")).toHaveText("No posts today");
  state.tracking = [{ ig_done: true, fb_done: true }];
  await page.reload();
  await expect(page.getByTestId("social-summary")).toHaveText("All posts done today");
});
