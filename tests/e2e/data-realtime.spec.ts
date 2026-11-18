import { expect, test, type BrowserContext, type WebSocketRoute } from "@playwright/test";
import { EMP, mockSupabase, type MockState } from "./mockSupabase";

// /data realtime (2026-11-15), same pattern as /leads: when one of the employee's own assignments ends (the sweep or
// an Admin gave the DATA lead to someone else), the card leaves at once, and an open card closes the way a refused
// save does (message, what was typed with Copy). The channel exists only after the login check. A fake Realtime
// server speaks the Phoenix protocol the Supabase client uses. Pixel 7 (Chromium) and iPhone 14 (WebKit).

type Binding = { event: string; schema: string; table: string; filter?: string; id: number };
interface FakeRealtime {
  joined: { topic: string; bindings: Binding[]; at: number }[];
  push: (topic: string, binding: Binding, record: Record<string, unknown>) => void;
}

async function fakeRealtime(context: BrowserContext): Promise<FakeRealtime> {
  const state: FakeRealtime = { joined: [], push: () => {} };
  const sockets: WebSocketRoute[] = [];
  let nextId = 1000;
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
        state.joined.push({ topic, bindings, at: Date.now() });
        ws.send(JSON.stringify([joinRef, ref, topic, "phx_reply", { status: "ok", response: { postgres_changes: bindings } }]));
      } else if (ref) {
        ws.send(JSON.stringify([joinRef, ref, topic, "phx_reply", { status: "ok", response: {} }]));
      }
    });
  });
  state.push = (topic, binding, record) => {
    const frame = JSON.stringify([null, null, topic, "postgres_changes", {
      ids: [binding.id],
      data: { schema: binding.schema, table: binding.table, commit_timestamp: new Date().toISOString(), type: "UPDATE", record, old_record: { id: record.id }, columns: [], errors: null }
    }]);
    for (const ws of sockets) ws.send(frame);
  };
  return state;
}

let state: MockState;
let rt: FakeRealtime;
test.beforeEach(async ({ context }) => {
  state = await mockSupabase(context);
  rt = await fakeRealtime(context);
});

const dataTopic = `realtime:data-list-${EMP}`;
const historyBinding = () => {
  // The last join counts: in development React mounts twice, so the channel joins, leaves and joins again.
  const join = [...rt.joined].reverse().find((j) => j.topic === dataTopic);
  return join?.bindings.find((b) => b.table === "lead_history" && b.filter === `employee_id=eq.${EMP}`);
};

// In development React mounts twice, so the channel joins, leaves and joins again, and each join gets new binding
// ids. An event sent with the first join's id is (rightly) ignored by the client. Wait until the data-list channel has
// joined and no further join has come for a moment, so the event uses the final join's binding.
const QUIET_MS = 1000;
async function waitForFinalJoin() {
  await expect
    .poll(() => {
      const joins = rt.joined.filter((j) => j.topic === dataTopic);
      const last = joins[joins.length - 1];
      return !!last && !!historyBinding() && Date.now() - last.at >= QUIET_MS;
    }, { timeout: 20000, intervals: [200] })
    .toBe(true);
}

async function giveAway(id: string) {
  // The lead now belongs to someone else: no longer in this employee's list, and their assignment row ended.
  state.data = state.data.filter((l: { id: string }) => l.id !== id) as typeof state.data;
  rt.push(dataTopic, historyBinding()!, { id: `h-${id}`, lead_id: id, employee_id: EMP, is_active: false, ended_reason: "DATA_MAX_ATTEMPTS_REACHED" });
}

test("/data: an assignment ending in realtime drops that card", async ({ page }) => {
  await page.goto("/data");
  await expect(page.locator("#data-card-data-30")).toBeVisible();
  await waitForFinalJoin();
  await giveAway("data-30");
  await expect(page.locator("#data-card-data-30")).toHaveCount(0);
  await expect(page.locator("#data-card-data-29")).toBeVisible();
});

test("/data: the open card closes with the reassigned message and keeps what was typed to copy", async ({ page }) => {
  await page.goto("/data?openLead=data-30");
  await expect(page.getByRole("button", { name: /Log Update/ })).toBeVisible();
  await waitForFinalJoin();
  await page.getByPlaceholder("Add a note (optional)...").fill("Asked to call back after 6 pm");
  await giveAway("data-30");
  const toast = page.getByTestId("lead-moved-away-toast");
  await expect(toast).toContainText("This lead has been reassigned to someone else, so it was closed.");
  await expect(toast).toContainText("Asked to call back after 6 pm");
  await expect(toast.getByRole("button", { name: "Copy note" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Log Update/ })).toHaveCount(0);
  await expect(page.locator("#data-card-data-30")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("lead_update_draft:data-30"))).toBeNull();
  expect(state.updates.filter((u) => u.p_lead_id === "data-30")).toHaveLength(0);
});

test("/data: no session, no realtime channel", async ({ context, page }) => {
  await context.addInitScript(() => {
    try {
      localStorage.removeItem("sb-fake-supabase-auth-token");
    } catch {
      // ignore
    }
  });
  await page.goto("/data");
  await expect(page).toHaveURL(/\/login/, { timeout: 20000 });
  await page.waitForTimeout(1500);
  expect(rt.joined.filter((j) => j.topic.startsWith("realtime:data-list-"))).toEqual([]);
});
