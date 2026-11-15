import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { EMP, FAKE_SUPABASE, UID, mockSupabase } from "./mockSupabase";

// Chunked bulk Reassign (2026-11-15): the page sends 100 leads per admin_reassign_leads call, one call after the
// other; a call that fails as a whole stops the rest and those leads stay selected. Pixel 7 + iPhone 14, fake Supabase.

const RECEIVER = "00000000-0000-4000-8000-0000000000e2";
const id = (i: number) => `00000000-0000-4000-8000-${String(10000 + i).padStart(12, "0")}`;
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => ({
  status,
  headers: { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-expose-headers": "content-range", ...extra },
  body: JSON.stringify(body)
});

async function adminLeadsPage(context: BrowserContext, total: number) {
  await mockSupabase(context);
  const admin = { id: EMP, auth_user_id: UID, name: "Test Admin", role: "admin", department: "sales", is_active: true, team_id: null };
  const receiver = { id: RECEIVER, auth_user_id: null, name: "Rama Receiver", role: "employee", department: "sales", is_active: true, team_id: null };
  await context.route(`${FAKE_SUPABASE}/rest/v1/employees**`, (route) => {
    const url = decodeURIComponent(route.request().url());
    const one = (route.request().headers()["accept"] || "").includes("vnd.pgrst.object");
    if (url.includes("auth_user_id=eq.")) return route.fulfill(json(one ? admin : [admin]));
    return route.fulfill(json([admin, receiver]));
  });
  const all = Array.from({ length: total }, (_, i) => ({
    id: id(i),
    name: `Lead ${i + 1}`,
    mobile: `9${String(100000000 + i)}`,
    project: "P",
    source: "Meta",
    catcher_name: null,
    status: "NEW",
    priority: "warm",
    board_stage: "LEADS",
    sla_deadline: null,
    recycle_count: 0,
    created_at: "2026-11-10T05:00:00Z",
    current_owner_id: EMP,
    pending_team_id: null,
    lead_type: "LEAD",
    is_personal_lead: false,
    employees: { name: "Test Admin" },
    pending_team: null,
    lead_history: [{ is_active: true, assigned_at: "2026-11-10T05:00:00Z", call_count: 0, recycle_reason: null }]
  }));
  await context.route(`${FAKE_SUPABASE}/rest/v1/leads?**`, (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const u = new URL(route.request().url());
    const offset = Number(u.searchParams.get("offset") || 0);
    const limit = Number(u.searchParams.get("limit") || all.length);
    const rows = all.slice(offset, offset + limit);
    return route.fulfill(json(rows, 200, { "content-range": `${offset}-${offset + Math.max(rows.length - 1, 0)}/${all.length}` }));
  });
}

async function selectAllAndConfirm(page: Page, total: number) {
  await page.goto("/admin/leads");
  await page.getByRole("button", { name: `Select All Filtered (${total})` }).click();
  await expect(page.getByText(`${total} leads selected`)).toBeVisible({ timeout: 20000 });
  await page.locator("select").filter({ has: page.locator("option", { hasText: "Assign to..." }) }).selectOption(RECEIVER);
  await page.getByPlaceholder("Reason (required)").fill("Rebalance team");
}

test("250 leads go as 3 calls of 100, 100 and 50, one after the other", async ({ context, page }) => {
  await adminLeadsPage(context, 250);
  const calls: { size: number; at: number; body: Record<string, unknown> }[] = [];
  let inFlight = 0;
  let overlap = false;
  await context.route(`${FAKE_SUPABASE}/rest/v1/rpc/admin_reassign_leads`, async (route) => {
    inFlight += 1;
    if (inFlight > 1) overlap = true;
    const body = route.request().postDataJSON();
    calls.push({ size: (body.p_lead_ids as string[]).length, at: Date.now(), body });
    await new Promise((r) => setTimeout(r, 300));
    inFlight -= 1;
    const ids = body.p_lead_ids as string[];
    return route.fulfill(json({ requested: ids.length, reassigned: ids.length, kept: 0, reset: ids.length, results: ids.map((lead_id) => ({ lead_id, success: true })) }));
  });
  await selectAllAndConfirm(page, 250);
  await page.getByRole("button", { name: "Reassign (250)" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Reassign", exact: true }).click();
  await expect(page.getByText(/Reassigning (100|200|250) of 250\.\.\./).first()).toBeVisible();
  await expect(page.getByText("Reassigned 250 leads.")).toBeVisible({ timeout: 20000 });
  expect(calls.map((c) => c.size)).toEqual([100, 100, 50]);
  expect(overlap).toBe(false);
  expect(new Set(calls.map((c) => `${c.body.p_to_employee_id}|${c.body.p_reason}|${c.body.p_stage_mode}`)).size).toBe(1);
  expect(new Set(calls.flatMap((c) => c.body.p_lead_ids as string[])).size).toBe(250);
});

test("a server error on the 2nd chunk stops the rest; the unsent leads stay selected", async ({ context, page }) => {
  await adminLeadsPage(context, 250);
  const sizes: number[] = [];
  await context.route(`${FAKE_SUPABASE}/rest/v1/rpc/admin_reassign_leads`, (route) => {
    const ids = route.request().postDataJSON().p_lead_ids as string[];
    sizes.push(ids.length);
    if (sizes.length === 2) return route.fulfill(json({ code: "57014", message: "canceling statement due to statement timeout" }, 500));
    return route.fulfill(json({ requested: ids.length, reassigned: ids.length, kept: 0, reset: ids.length, results: ids.map((lead_id) => ({ lead_id, success: true })) }));
  });
  await selectAllAndConfirm(page, 250);
  await page.getByRole("button", { name: "Reassign (250)" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Reassign", exact: true }).click();
  await expect(page.getByText("100 reassigned, 150 not processed: canceling statement due to statement timeout")).toBeVisible({ timeout: 20000 });
  expect(sizes).toEqual([100, 100]);
  await expect(page.getByText("150 leads selected")).toBeVisible();
});

test("more than 500 selected: Reassign is refused in the UI", async ({ context, page }) => {
  await adminLeadsPage(context, 501);
  let rpc = 0;
  await context.route(`${FAKE_SUPABASE}/rest/v1/rpc/admin_reassign_leads`, (route) => {
    rpc += 1;
    return route.fulfill(json({}));
  });
  await selectAllAndConfirm(page, 501);
  await expect(page.getByRole("button", { name: "Reassign (501)" })).toBeDisabled();
  await expect(page.getByText("Select at most 500 leads")).toBeVisible();
  expect(rpc).toBe(0);
});
