import fs from "fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { EMP, FAKE_SUPABASE, UID, mockSupabase, type MockState } from "./mockSupabase";
import { openReport } from "./perfReportFixture";
import { ADMIN_SCENARIOS, T0 } from "./adminCardFixture";

// Full lead history (2026-11-29): every History button (Admin Leads card, Positive-history junk, Lead Journey) opens
// the same admin modal with the WHOLE journey from get_admin_lead_full_journey: every owner in order (incl. the first
// owner of a junk lead), status / stage moves, calls, notes, visits and the rest. Coordinators keep the old timeline;
// before the SQL is applied admins fall back to it too. Fake names / numbers only. Pixel 7, iPhone 14, desktop.

const SHOTS = "C:/work/reports/lead_full_history";
fs.mkdirSync(SHOTS, { recursive: true });
const json = (b: unknown, status = 200, headers: Record<string, string> = {}) => ({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-expose-headers": "content-range", ...headers }, body: JSON.stringify(b) });
const H = 3600e3;
const at = (h: number) => new Date(Date.parse("2026-09-21T08:50:00Z") + h * H).toISOString();
const K = "00000000-0000-4000-8000-000000000e01";

// A fake junk lead shaped like the real report: K first (calls, a note, Connected), then three more owners, then junk.
function journey(id: string) {
  const owners = [["Fake Owner K", K, "FRESH", "FOLLOWUP_INACTIVITY_RECYCLE_READY"], ["Fake Owner 2", "e2", "RECYCLED", "FOLLOWUP_INACTIVITY_RECYCLE_READY"], ["Fake Owner 3", "e3", "RECYCLED", "SLA_BREACHED"], ["Fake Owner 4", "e4", "RECYCLED", "JUNK"]];
  const stints = owners.map(([name, emp, origin, ended], i) => ({
    stint_id: `s${i + 1}`, employee_id: emp, employee_name: name, assigned_at: at(i * 300), ended_at: i < 3 ? at((i + 1) * 300) : null, active: false, origin,
    employee_sees: origin === "FRESH" ? "New lead" : "Recycled lead", assigned_by_type: "SYSTEM", assigned_by_name: null, reassign_note: null, ended_reason: ended,
    outcome: i === 0 ? "CONNECTED" : null, call_count: i === 0 ? 2 : 0, recycle_reason: null, recycled_from_status: null, recycled_from_stage: null,
    paused_until: null, pause_reason: null, result: i === 0 ? "CONNECTED" : null, restore: null, batch: i === 2 ? { mode: "give", label: "Fake batch", reason: "Fake admin reason", at: at(600), from_name: "Fake Owner 2" } : null
  }));
  const events = [
    { at: at(0.1), kind: "CALL", detail: null, employee_id: K, employee_name: "Fake Owner K", stint_id: "s1", text: null, extra: null },
    { at: at(0.15), kind: "CALL", detail: null, employee_id: K, employee_name: "Fake Owner K", stint_id: "s1", text: null, extra: null },
    { at: at(0.16), kind: "STATUS", detail: "CONNECTED", employee_id: K, employee_name: "Fake Owner K", stint_id: "s1", text: null, extra: null },
    { at: at(0.17), kind: "NOTE", detail: null, employee_id: K, employee_name: "Fake Owner K", stint_id: "s1", text: "Fake note from K", extra: null },
    { at: at(2), kind: "VISIT", detail: "VISIT", employee_id: K, employee_name: "Fake Owner K", stint_id: null, text: null, extra: { denied_at: at(3), deny_reason: "Fake deny" } },
    { at: at(301), kind: "STATUS", detail: "NOT_CONNECTED", employee_id: "e2", employee_name: "Fake Owner 2", stint_id: "s2", text: null, extra: null },
    { at: at(950), kind: "GUARD", detail: "db_sibling_guard/RECYCLE_REFUSED", employee_id: null, employee_name: null, stint_id: null, text: null, extra: {} }
  ];
  return { found: true, lead: { id, id8: id.slice(0, 8), lead_type: "LEAD", status: "JUNK", board_stage: "LEADS", project: "Test Project", source: "Meta", catcher_name: null, is_personal_lead: false,
    created_at: at(-1), recycle_count: 3, last_unjunked_at: null, current_owner_id: null, current_owner_name: null, pending_team_name: null, merged_into8: null, csv_batch8: "ab12cd34", csv_batch_file: null },
    stints, events, truncated: false };
}

async function checkModal(page: Page, info: { project: { name: string } }, shotName: string) {
  const m = page.getByTestId("lfj");
  await expect(m.getByTestId("lfj-owner-1")).toContainText("Fake Owner K");
  await expect(m.getByTestId("lfj-owners").locator("li")).toHaveCount(4);
  await expect(m.getByTestId("lfj-owner-3")).toContainText("Admin reason (admins only): Fake batch · Fake admin reason");
  await expect(m.getByTestId("lfj-owner-1")).toContainText("Employee saw: New lead");
  await expect(m.getByTestId("lfj-now")).toContainText("Now: Junk");
  await expect(m.getByTestId("lfj-ev-NOTE")).toContainText("Fake note from K");
  await expect(m.getByTestId("lfj-ev-VISIT")).toContainText("Visit (denied)");
  await expect(m.getByTestId("lfj-ev-GUARD")).toContainText("Recycle stopped");
  await expect(m.getByTestId("lfj-chip-calls")).toHaveText("Calls (2)");
  await m.getByTestId("lfj-chip-calls").click();
  await expect(m.getByTestId("lfj-events").locator("li")).toHaveCount(2);
  for (const b of await m.getByRole("button").all()) if (await b.isVisible()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: `${SHOTS}/${shotName}-${info.project.name}.png` });
  await m.getByTestId("lfj-close").click();
  await expect(m).toHaveCount(0);
}

// Admin Leads (Status = Junk view): a minimal list with the admin card; View History opens the full journey.
async function openAdminLeads(context: BrowserContext, page: Page, role: "admin" | "super_admin" | "sales_coordinator", withRpc = true) {
  const state: MockState = await mockSupabase(context);
  await page.clock.setFixedTime(T0);
  const me = { id: EMP, auth_user_id: UID, name: "Test Admin", role, department: "admin", is_active: true, team_id: null };
  state.employee = me;
  state.settings.admin_card_mode = "on";
  const rows = [structuredClone(ADMIN_SCENARIOS[10][1])]; // S11 JUNK
  if (withRpc) state.fullJourneys = { [rows[0].id]: journey(rows[0].id) };
  await context.route(`${FAKE_SUPABASE}/rest/v1/employees**`, (route) => {
    const one = (route.request().headers()["accept"] || "").includes("vnd.pgrst.object");
    return route.fulfill(json(decodeURIComponent(route.request().url()).includes("auth_user_id=eq.") ? (one ? me : [me]) : [me]));
  });
  await context.route(`${FAKE_SUPABASE}/rest/v1/leads?**`, (route) => route.request().method() === "GET" ? route.fulfill(json(rows, 200, { "content-range": `0-0/1` })) : route.fallback());
  await context.route(`${FAKE_SUPABASE}/rest/v1/teams**`, (route) => route.fulfill(json([])));
  await context.route(`${FAKE_SUPABASE}/rest/v1/lead_team_reservations**`, (route) => route.fulfill(json([])));
  await context.route(`${FAKE_SUPABASE}/rest/v1/rpc/get_lead_siblings`, (route) => route.fulfill(json({})));
  await context.route(`${FAKE_SUPABASE}/rest/v1/rpc/get_last_notes`, (route) => route.fulfill(json([])));
  await page.goto(role === "sales_coordinator" ? "/coordinator" : "/admin/leads");
  return { state, lead: rows[0] };
}

test("Admin Leads: View History on a junk lead shows the whole journey (first owner K too), one call, id in the body", async ({ page, context }, info) => {
  const { state, lead } = await openAdminLeads(context, page, "super_admin");
  await page.getByRole("button", { name: /View History/ }).first().click();
  await checkModal(page, info, "admin-leads");
  // one lead per call (dev mode may run the effect twice)
  expect(state.fullJourneyCalls.length).toBeGreaterThanOrEqual(1);
  expect([...new Set(state.fullJourneyCalls.map((c) => c.id))]).toEqual([lead.id]);
  for (const c of state.fullJourneyCalls) expect(c.url).not.toContain(lead.id);
});

test("Admin Leads before the SQL is applied: admins fall back to the old timeline (nothing breaks)", async ({ page, context }) => {
  await openAdminLeads(context, page, "admin", false);
  await page.getByRole("button", { name: /View History/ }).first().click();
  await expect(page.getByTestId("lfj")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Admin Lead 11/ })).toBeVisible();
});

test("Coordinator: the old timeline, the admin journey is never asked", async ({ page, context }) => {
  const { state } = await openAdminLeads(context, page, "sales_coordinator");
  await page.getByRole("button", { name: /View History/ }).first().click();
  await expect(page.getByRole("heading", { name: /Admin Lead 11/ })).toBeVisible();
  await expect(page.getByTestId("lfj")).toHaveCount(0);
  expect(state.fullJourneyCalls.length).toBe(0);
});

test("Positive-history junk: History opens the same full journey", async ({ page, context }, info) => {
  const state = await mockSupabase(context);
  state.employee.role = "admin";
  state.employee.department = null;
  const id = "c0000001-0000-4000-8000-d00000000001";
  state.positiveJunk = { rows: [{ lead_id: id, lead_id8: id.slice(0, 8), card_type: "LEAD", project: "Test Project", stage_at_junk: "LEADS", highest_positive: "CONNECTED", restore_status: "CONNECTED", restore_stage: "LEADS",
    first_positive: "CONNECTED", first_positive_at: at(0.16), first_positive_by: K, first_positive_by_name: "Fake Owner K", last_owner_id: "e4", last_owner_name: "Fake Owner 4", recycle_count: 3,
    junked_at: at(950), junked_by: "SYSTEM", junk_reason: "Max recycles reached", last_activity_at: at(301), not_interested_count: 0, is_data_copy: false, sibling: null, restored_before: 0 }], employees: [], max_batch: 25, protection_days: 14 } as never;
  state.fullJourneys = { [id]: journey(id) };
  await page.goto("/admin/positive-junk");
  await page.locator(`[data-testid="pj-history-${id.slice(0, 8)}"]:visible, [data-testid="pj-card-history-${id.slice(0, 8)}"]:visible`).first().click();
  await checkModal(page, info, "positive-junk");
});

test("Lead Journey: History in the drill sheet opens the same full journey", async ({ page, context }, info) => {
  await openReport(context, page, { api: 4 });
  await page.getByTestId("perf-tab-journey").click();
  await page.getByTestId("lj-view-won").click();
  const first = page.getByTestId("lj-drill").locator('[data-testid^="lj-card-history-"]').first();
  const short = (await first.getAttribute("data-testid"))!.replace("lj-card-history-", "");
  // The fixture's journey rows use ids that start with the short id: answer any id with the fake journey.
  await context.route(`${FAKE_SUPABASE}/rest/v1/rpc/get_admin_lead_full_journey`, (route) => {
    const id = String((route.request().postDataJSON() as { p_lead_id: string }).p_lead_id);
    expect(id.startsWith(short)).toBe(true);
    return route.fulfill(json(journey(id)));
  });
  await first.click();
  await checkModal(page, info, "lead-journey");
});

test("RPC error: Couldn't load + Retry, the log has the code only", async ({ page, context }) => {
  const { state } = await openAdminLeads(context, page, "admin");
  state.fail.add("rpc/get_admin_lead_full_journey");
  await page.getByRole("button", { name: /View History/ }).first().click();
  await expect(page.getByTestId("lfj-retry")).toHaveText("Couldn't load the history. Tap to try again.");
  await expect.poll(() => state.anomalies.some((a) => a.message.includes("load failed (42501)"))).toBe(true);
  state.fail.delete("rpc/get_admin_lead_full_journey");
  await page.getByTestId("lfj-retry").click();
  await expect(page.getByTestId("lfj-owner-1")).toContainText("Fake Owner K");
});
