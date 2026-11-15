import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { FAKE_SUPABASE, mockSupabase, type MockState } from "./mockSupabase";

// Lead moved away while its card was open (2026-11-15): the sweep or an Admin gave the lead to someone else, so the
// save is refused with "not owned by the calling employee". The employee sees a clear message and what they typed
// (with Copy), the save is not retried, nothing is kept as pending, and the card leaves the list. Pixel 7 (Chromium)
// and iPhone 14 (WebKit), fake Supabase. Network failures keep their own behaviour (result-save.spec.ts).

let state: MockState;
test.beforeEach(async ({ context }) => {
  state = await mockSupabase(context);
});

const MESSAGE = "This lead has been reassigned to someone else, so your update was not saved.";
const draft = (page: Page, id: string) => page.evaluate((k) => localStorage.getItem(k), `lead_update_draft:${id}`);

async function refuseAsMovedAway(context: BrowserContext, id: string, list: "leads" | "data") {
  const calls = { n: 0 };
  await context.route(`${FAKE_SUPABASE}/rest/v1/rpc/log_lead_update_atomic`, (route) => {
    calls.n += 1;
    // The lead now belongs to someone else: it is no longer in this employee's list either.
    state[list] = state[list].filter((l: { id: string }) => l.id !== id) as typeof state.leads;
    return route.fulfill({
      status: 400,
      headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
      body: JSON.stringify({ code: "P0001", message: `log_lead_update_atomic: lead ${id} is not owned by the calling employee`, details: null, hint: null })
    });
  });
  return calls;
}

for (const { path, list, id, name, card } of [
  { path: "/leads", list: "leads", id: "lead-40", name: "Test Lead 40", card: "#lead-card-lead-40" },
  { path: "/data", list: "data", id: "data-30", name: "Test Data 30", card: "#data-card-data-30" }
] as const) {
  test(`${path}: a save refused because the lead moved away shows a clear message, keeps nothing, drops the card`, async ({ context, page }) => {
    const calls = await refuseAsMovedAway(context, id, list);
    await page.goto(`${path}?openLead=${id}`);
    await expect(page.getByRole("button", { name: /Log Update/ })).toBeVisible();
    await expect.poll(() => page.getByText(name, { exact: true }).count()).toBeGreaterThanOrEqual(1);
    // An older kept draft for this lead (from an earlier network failure) must not stay pending either.
    await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ status: "NOT_CONNECTED", note: "old", savedAt: Date.now(), pendingSince: Date.now() })), `lead_update_draft:${id}`);
    await page.getByRole("button", { name: "Not Connected", exact: true }).click();
    await page.getByPlaceholder("Add a note (optional)...").fill("Client asked for a callback on Monday");
    await page.getByRole("button", { name: /Log Update/ }).click();

    const toast = page.getByTestId("lead-moved-away-toast");
    await expect(toast).toContainText(MESSAGE);
    await expect(toast).toContainText("Client asked for a callback on Monday");
    await expect(toast.getByRole("button", { name: "Copy note" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Log Update/ })).toHaveCount(0);
    await expect(page.locator(card)).toHaveCount(0);
    await page.waitForTimeout(4000); // longer than the network retry delay: a refusal must never be sent again
    expect(calls.n).toBe(1);
    expect(await draft(page, id)).toBeNull();
    await expect(page.getByText("Could not save. Your update is kept, we will retry.")).toHaveCount(0);
    await expect.poll(() => state.anomalies.filter((a: { source?: string; severity?: string }) => a.source === "lead_update:moved_away" && a.severity === "info").length).toBe(1);
    // Only that info row: no warning for the refused request itself (5 warnings would notify Admins).
    expect(state.anomalies.filter((a: { severity?: string; message?: string }) => a.severity !== "info" && /log_lead_update_atomic/.test(a.message || "")).length).toBe(0);
  });
}
