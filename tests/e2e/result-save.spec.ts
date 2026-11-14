import { expect, test, type Page } from "@playwright/test";
import { mockSupabase, type MockState } from "./mockSupabase";

// Result save on a bad network (2026-11-14): a network failure gets one automatic retry; if that fails too the
// update is kept (survives a reload) and saved later exactly once; a save that landed but whose answer was lost is
// never written twice. Pixel 7 (Chromium) and iPhone 14 (WebKit), fake Supabase only (mockSupabase.ts).

let state: MockState;
test.beforeEach(async ({ context }) => {
  state = await mockSupabase(context);
});

async function openLead(page: Page, path: "/leads" | "/data", id: string, name: string) {
  await page.goto(`${path}?openLead=${id}`);
  await expect(page.getByRole("button", { name: /Log Update/ })).toBeVisible();
  await expect.poll(() => page.getByText(name, { exact: true }).count()).toBeGreaterThanOrEqual(1);
}

async function saveNotConnected(page: Page) {
  await page.getByRole("button", { name: "Not Connected", exact: true }).click();
  await page.getByRole("button", { name: /Log Update/ }).click();
}

const draft = (page: Page, id: string) => page.evaluate((k) => localStorage.getItem(k), `lead_update_draft:${id}`);
const savesFor = (id: string) => state.updates.filter((u) => u.p_lead_id === id).length;

test("Leads: first save lost to the network, automatic retry saves it once", async ({ page }) => {
  await openLead(page, "/leads", "lead-40", "Test Lead 40");
  state.failUpdates = 1;
  await saveNotConnected(page);
  await expect(page.getByText("Update logged.")).toBeVisible({ timeout: 20_000 });
  expect(savesFor("lead-40")).toBe(1);
  expect(await draft(page, "lead-40")).toBeNull();
});

test("Leads: save reached the database but the answer was lost -> not written twice", async ({ page }) => {
  await openLead(page, "/leads", "lead-40", "Test Lead 40");
  state.landThenLose = 1;
  await saveNotConnected(page);
  await expect(page.getByText("Update logged.")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1000);
  expect(savesFor("lead-40")).toBe(1);
});

test("Leads: both tries fail -> update kept, survives a reload, saved once later", async ({ page }) => {
  await openLead(page, "/leads", "lead-40", "Test Lead 40");
  state.failUpdates = 2;
  await saveNotConnected(page);
  await expect(page.getByText("Could not save. Your update is kept, we will retry.")).toBeVisible({ timeout: 20_000 });
  const kept = JSON.parse((await draft(page, "lead-40")) || "{}");
  expect([kept.status, typeof kept.pendingSince]).toEqual(["NOT_CONNECTED", "number"]);
  expect(savesFor("lead-40")).toBe(0);

  await page.reload(); // app closed and opened again: the kept update is still on the phone
  // Let the reloaded page finish loading (login check, list) before navigating again, so the two do not overlap.
  await expect(page.locator("#lead-card-lead-01")).toBeVisible();
  expect(JSON.parse((await draft(page, "lead-40")) || "{}").status).toBe("NOT_CONNECTED");
  await openLead(page, "/leads", "lead-40", "Test Lead 40"); // opening the lead brings it back
  await expect(page.getByText("Your unsaved update was restored. Check it and save again.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Discard kept update" })).toBeVisible();
  await page.getByRole("button", { name: /Log Update/ }).click();
  await expect(page.getByText("Update logged.")).toBeVisible({ timeout: 20_000 });
  expect(savesFor("lead-40")).toBe(1);
  expect(await draft(page, "lead-40")).toBeNull();
});

test("Leads: Retry button on the kept toast saves once", async ({ page }) => {
  await openLead(page, "/leads", "lead-41", "Test Lead 41");
  state.failUpdates = 2;
  await saveNotConnected(page);
  await expect(page.getByText("Could not save. Your update is kept, we will retry.")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("Update logged.")).toBeVisible({ timeout: 20_000 });
  expect(savesFor("lead-41")).toBe(1);
});

test("Leads: Discard kept update removes it", async ({ page }) => {
  await openLead(page, "/leads", "lead-42", "Test Lead 42");
  state.failUpdates = 2;
  await saveNotConnected(page);
  await expect(page.getByRole("button", { name: "Discard kept update" })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Discard kept update" }).click();
  await expect.poll(() => draft(page, "lead-42")).toBeNull();
  expect(savesFor("lead-42")).toBe(0);
});

test("Data: first save lost to the network, automatic retry saves it once", async ({ page }) => {
  await openLead(page, "/data", "data-30", "Test Data 30");
  state.failUpdates = 1;
  await saveNotConnected(page);
  await expect(page.getByText("Update logged.")).toBeVisible({ timeout: 20_000 });
  expect(savesFor("data-30")).toBe(1);
});
