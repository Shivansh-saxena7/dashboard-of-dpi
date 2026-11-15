import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { EMP, FAKE_SUPABASE, UID, mockSupabase } from "./mockSupabase";

// Bulk Reassign stage mode (2026-11-15): "Keep stage for positive leads (default)" or "Reset all leads to New", sent as
// p_stage_mode to the 4-parameter admin_reassign_leads. The confirm dialog says how many keep their stage and how many
// reset, and that kept leads are protected for 14 days. Pixel 7 (Chromium) and iPhone 14 (WebKit), fake Supabase.

const RECEIVER = "00000000-0000-4000-8000-0000000000e2";
const POSITIVE = "00000000-0000-4000-8000-00000000c001";
const FRESH = "00000000-0000-4000-8000-00000000c002";
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => ({
  status,
  headers: { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-expose-headers": "content-range", ...extra },
  body: JSON.stringify(body)
});

async function adminLeadsPage(context: BrowserContext) {
  await mockSupabase(context);
  const admin = { id: EMP, auth_user_id: UID, name: "Test Admin", role: "admin", department: "sales", is_active: true, team_id: null };
  const receiver = { id: RECEIVER, auth_user_id: null, name: "Rama Receiver", role: "employee", department: "sales", is_active: true, team_id: null };
  await context.route(`${FAKE_SUPABASE}/rest/v1/employees**`, (route) => {
    const url = decodeURIComponent(route.request().url());
    const one = (route.request().headers()["accept"] || "").includes("vnd.pgrst.object");
    if (url.includes("auth_user_id=eq.")) return route.fulfill(json(one ? admin : [admin]));
    return route.fulfill(json([admin, receiver]));
  });
  await context.route(`${FAKE_SUPABASE}/rest/v1/leads?**`, (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const rows = [
      { id: POSITIVE, status: "CONNECTED", board_stage: "FOLLOW_UP" },
      { id: FRESH, status: "NEW", board_stage: "LEADS" }
    ].map((l, i) => ({
      ...l,
      name: `Lead ${i + 1}`,
      mobile: `90000000${i}2`,
      project: "P",
      source: "Meta",
      catcher_name: null,
      priority: "warm",
      sla_deadline: null,
      recycle_count: 0,
      created_at: "2026-11-10T05:00:00Z",
      current_owner_id: EMP,
      pending_team_id: null,
      lead_type: "LEAD",
      is_personal_lead: false,
      employees: { name: "Test Admin" },
      pending_team: null,
      lead_history: [{ is_active: true, assigned_at: "2026-11-10T05:00:00Z", call_count: 1, recycle_reason: null }]
    }));
    return route.fulfill(json(rows, 200, { "content-range": `0-${rows.length - 1}/${rows.length}` }));
  });
}

async function selectBothAndOpen(page: Page, mode?: "reset") {
  await page.goto("/admin/leads");
  const boxes = page.locator('[role="checkbox"][aria-label$="lead"]');
  await expect(boxes).toHaveCount(2);
  for (const i of [0, 1]) {
    await expect(async () => {
      if ((await boxes.nth(i).getAttribute("aria-checked")) !== "true") await boxes.nth(i).click();
      await expect(boxes.nth(i)).toHaveAttribute("aria-checked", "true", { timeout: 2000 });
    }).toPass({ timeout: 20000 });
  }
  await page.locator("select").filter({ has: page.locator("option", { hasText: "Assign to..." }) }).selectOption(RECEIVER);
  await page.getByPlaceholder("Reason (required)").fill("Rebalance team");
  const stage = page.locator("select").filter({ has: page.locator("option", { hasText: "Keep stage for positive leads (default)" }) });
  await expect(stage).toHaveValue("auto");
  if (mode) await stage.selectOption(mode);
  await page.getByRole("button", { name: "Reassign (2)" }).click();
  await expect(page.getByRole("dialog")).toContainText("Reassign 2 leads to");
}

test("Reassign, default stage mode: positive lead keeps its stage, the dialog says so, p_stage_mode auto", async ({ context, page }) => {
  await adminLeadsPage(context);
  const bodies: Record<string, unknown>[] = [];
  await context.route(`${FAKE_SUPABASE}/rest/v1/rpc/admin_reassign_leads`, (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill(json({ requested: 2, reassigned: 2, kept: 1, reset: 1, stage_mode: "auto", results: [
      { lead_id: POSITIVE, success: true, path: "keep" }, { lead_id: FRESH, success: true, path: "reset" }] }));
  });
  await selectBothAndOpen(page);
  const summary = page.getByTestId("reassign-stage-summary");
  await expect(summary).toContainText("1 lead will keep its stage, 1 lead will be reset to New.");
  await expect(summary).toContainText("Kept leads are protected from recycling for 14 days.");
  await page.getByRole("dialog").getByRole("button", { name: "Reassign", exact: true }).click();
  await expect(page.getByText("Reassigned 2 leads (1 kept its stage).")).toBeVisible();
  expect(bodies).toHaveLength(1);
  expect(bodies[0].p_stage_mode).toBe("auto");
  expect(bodies[0].p_reason).toBe("Rebalance team");
});

test("Reassign, Reset all leads to New: the dialog says both reset, p_stage_mode reset", async ({ context, page }) => {
  await adminLeadsPage(context);
  const bodies: Record<string, unknown>[] = [];
  await context.route(`${FAKE_SUPABASE}/rest/v1/rpc/admin_reassign_leads`, (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill(json({ requested: 2, reassigned: 2, kept: 0, reset: 2, stage_mode: "reset", results: [
      { lead_id: POSITIVE, success: true, path: "reset" }, { lead_id: FRESH, success: true, path: "reset" }] }));
  });
  await selectBothAndOpen(page, "reset");
  const summary = page.getByTestId("reassign-stage-summary");
  await expect(summary).toContainText("2 leads will be reset to New.");
  await expect(summary).not.toContainText("protected");
  await page.getByRole("dialog").getByRole("button", { name: "Reassign", exact: true }).click();
  await expect(page.getByText("Reassigned 2 leads.")).toBeVisible();
  expect(bodies[0].p_stage_mode).toBe("reset");
});
