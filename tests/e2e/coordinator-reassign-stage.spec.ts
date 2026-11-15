import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { EMP, FAKE_SUPABASE, UID, mockSupabase } from "./mockSupabase";

// /coordinator single Reassign with a stage mode (2026-11-15): it goes through admin_reassign_leads (4 parameters)
// with one lead, like the Admin Leads bulk Reassign. "Keep stage for positive leads (default)" keeps a positive lead's
// stage; "Reset to New" resets it. Admin only, as before. Pixel 7 (Chromium) and iPhone 14 (WebKit), fake Supabase.

const OWNER = "00000000-0000-4000-8000-0000000000e3";
const RECEIVER = "00000000-0000-4000-8000-0000000000e4";
const LEAD = "00000000-0000-4000-8000-00000000d001";
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => ({
  status,
  headers: { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-expose-headers": "content-range", ...extra },
  body: JSON.stringify(body)
});

async function coordinatorPage(context: BrowserContext, lead: { status: string; board_stage: string }) {
  await mockSupabase(context);
  const admin = { id: EMP, auth_user_id: UID, name: "Test Admin", role: "admin", department: "admin", is_active: true, team_id: null };
  const owner = { id: OWNER, auth_user_id: null, name: "Owner One", role: "employee", department: "sales", is_active: true, team_id: null };
  const receiver = { id: RECEIVER, auth_user_id: null, name: "Rama Receiver", role: "employee", department: "sales", is_active: true, team_id: null };
  await context.route(`${FAKE_SUPABASE}/rest/v1/employees**`, (route) => {
    const url = decodeURIComponent(route.request().url());
    const one = (route.request().headers()["accept"] || "").includes("vnd.pgrst.object");
    return route.fulfill(json(url.includes("auth_user_id=eq.") ? (one ? admin : [admin]) : [admin, owner, receiver]));
  });
  await context.route(`${FAKE_SUPABASE}/rest/v1/leads?**`, (route) => {
    const row = {
      id: LEAD, name: "Lead A", mobile: "9000000001", project: "P", source: "Meta", catcher_name: null, priority: "warm",
      ...lead, board_stage_changed_at: "2026-11-14T05:00:00Z", sla_deadline: null, recycle_count: 0, created_at: "2026-11-10T05:00:00Z",
      current_owner_id: OWNER, lead_type: "LEAD", is_personal_lead: false, employees: { name: "Owner One" },
      lead_history: [{ id: "00000000-0000-4000-8000-00000000f001", is_active: true, assigned_at: "2026-11-10T05:00:00Z", call_count: 0,
        first_call_at: null, first_whatsapp_at: null, outcome_at: null, last_activity_at: "2026-11-14T05:00:00Z" }]
    };
    return route.fulfill(json([row], 200, { "content-range": "0-0/1" }));
  });
}

async function openReassign(page: Page) {
  await page.goto("/coordinator");
  await page.getByRole("button", { name: /Employee Summary/ }).click();
  await page.getByRole("button", { name: "1 ▼" }).click();
  await page.getByRole("button", { name: "Add note ▼" }).click();
  await page.getByRole("button", { name: "🔁 Force Reassign this lead" }).click();
  await page.locator("select").filter({ has: page.locator("option", { hasText: "Select employee..." }) }).selectOption(RECEIVER);
  await page.getByPlaceholder("Reason (mandatory)").fill("Owner on leave");
}

const stageSelect = (page: Page) => page.locator("select").filter({ has: page.locator("option", { hasText: "Keep stage for positive leads (default)" }) });

test("positive lead, default: keeps its stage through admin_reassign_leads (auto)", async ({ context, page }) => {
  await coordinatorPage(context, { status: "CONNECTED", board_stage: "FOLLOW_UP" });
  const bodies: Record<string, unknown>[] = [];
  let oldRpc = 0;
  await context.route(`${FAKE_SUPABASE}/rest/v1/rpc/force_reassign_lead_atomic`, (route) => {
    oldRpc += 1;
    return route.fulfill(json(null));
  });
  await context.route(`${FAKE_SUPABASE}/rest/v1/rpc/admin_reassign_leads`, (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill(json({ requested: 1, reassigned: 1, kept: 1, reset: 0, results: [{ lead_id: LEAD, success: true, path: "keep" }] }));
  });
  await openReassign(page);
  await expect(stageSelect(page)).toHaveValue("auto");
  await expect(page.getByTestId("coordinator-reassign-stage-note")).toHaveText("This lead keeps its stage and is protected from recycling for 14 days.");
  await page.getByRole("button", { name: "Confirm Reassign" }).click();
  await expect(page.getByText("Lead reassigned, stage kept (protected from recycling for 14 days)")).toBeVisible();
  expect(bodies).toEqual([{ p_lead_ids: [LEAD], p_to_employee_id: RECEIVER, p_reason: "Owner on leave", p_stage_mode: "auto" }]);
  expect(oldRpc).toBe(0);
});

test("Reset to New: sends reset and says the lead was reset", async ({ context, page }) => {
  await coordinatorPage(context, { status: "CONNECTED", board_stage: "FOLLOW_UP" });
  const bodies: Record<string, unknown>[] = [];
  await context.route(`${FAKE_SUPABASE}/rest/v1/rpc/admin_reassign_leads`, (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill(json({ requested: 1, reassigned: 1, kept: 0, reset: 1, results: [{ lead_id: LEAD, success: true, path: "reset" }] }));
  });
  await openReassign(page);
  await stageSelect(page).selectOption("reset");
  await expect(page.getByTestId("coordinator-reassign-stage-note")).toHaveText("This lead will be reset to New.");
  await page.getByRole("button", { name: "Confirm Reassign" }).click();
  await expect(page.getByText("Lead reassigned and reset to New")).toBeVisible();
  expect(bodies[0].p_stage_mode).toBe("reset");
});

test("a lead that cannot be moved shows the server's reason and stays open", async ({ context, page }) => {
  await coordinatorPage(context, { status: "CONNECTED", board_stage: "FOLLOW_UP" });
  await context.route(`${FAKE_SUPABASE}/rest/v1/rpc/admin_reassign_leads`, (route) =>
    route.fulfill(json({ requested: 1, reassigned: 0, kept: 0, reset: 0, results: [{ lead_id: LEAD, success: false, path: "keep",
      error: "a lead keeps its stage only with a sales employee: choose a sales employee, or Reset all leads to New" }] }))
  );
  await openReassign(page);
  await page.getByRole("button", { name: "Confirm Reassign" }).click();
  await expect(page.getByText(/Not reassigned: a lead keeps its stage only with a sales employee/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm Reassign" })).toBeVisible();
});
