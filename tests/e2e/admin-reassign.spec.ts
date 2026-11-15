import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { EMP, FAKE_SUPABASE, UID, mockSupabase } from "./mockSupabase";

// Admin bulk Reassign goes through admin_reassign_leads (2026-11-15), which enforces the limit, Admin-only, reason and
// an active receiver on the server. The fake Supabase answers that RPC the way the real function does; the SQL itself
// is tested against Postgres separately. Pixel 7 (Chromium) and iPhone 14 (WebKit).

const RECEIVER = "00000000-0000-4000-8000-0000000000e2";
const LEAD_IDS = ["00000000-0000-4000-8000-00000000b001", "00000000-0000-4000-8000-00000000b002"];
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
    const rows = LEAD_IDS.map((id, i) => ({
      id,
      name: `Lead ${i + 1}`,
      mobile: `90000000${i}1`,
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
    return route.fulfill(json(rows, 200, { "content-range": `0-${rows.length - 1}/${rows.length}` }));
  });
}

async function selectAndConfirm(page: Page) {
  await page.goto("/admin/leads");
  // Position-based, so a box whose label just flipped to "Deselect lead" is not clicked twice.
  const boxes = page.locator('[role="checkbox"][aria-label$="lead"]');
  await expect(boxes).toHaveCount(2);
  // toPass: a click that lands before the page has hydrated does nothing, so it is tried again.
  for (const i of [0, 1]) {
    await expect(async () => {
      if ((await boxes.nth(i).getAttribute("aria-checked")) !== "true") await boxes.nth(i).click();
      await expect(boxes.nth(i)).toHaveAttribute("aria-checked", "true", { timeout: 2000 });
    }).toPass({ timeout: 20000 });
  }
  await page.locator("select").filter({ has: page.locator("option", { hasText: "Assign to..." }) }).selectOption(RECEIVER);
  await page.getByPlaceholder("Reason (required)").fill("Rebalance");
  await page.getByRole("button", { name: "Reassign (2)" }).click();
  await expect(page.getByRole("dialog")).toContainText("Reassign 2 leads to");
  await page.getByRole("dialog").getByRole("button", { name: "Reassign", exact: true }).click();
}

test("Reassign: calls admin_reassign_leads with the ids, the receiver and the reason", async ({ context, page }) => {
  await adminLeadsPage(context);
  const bodies: Record<string, unknown>[] = [];
  let oldRpc = 0;
  await context.route(`${FAKE_SUPABASE}/rest/v1/rpc/bulk_reassign_leads_atomic`, (route) => {
    oldRpc += 1;
    return route.fulfill(json([]));
  });
  await context.route(`${FAKE_SUPABASE}/rest/v1/rpc/admin_reassign_leads`, (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill(json({ requested: 2, reassigned: 2, results: LEAD_IDS.map((lead_id) => ({ lead_id, success: true })) }));
  });
  await selectAndConfirm(page);
  await expect(page.getByText("Reassigned 2 leads.")).toBeVisible();
  expect(bodies).toHaveLength(1);
  expect((bodies[0].p_lead_ids as string[]).slice().sort()).toEqual(LEAD_IDS);
  expect(bodies[0].p_to_employee_id).toBe(RECEIVER);
  expect(bodies[0].p_reason).toBe("Rebalance");
  expect(oldRpc).toBe(0);
});

for (const [name, message] of [
  ["more than 500 leads", "admin_reassign_leads: at most 500 leads at a time (got 501)"],
  ["a non-admin caller", "admin_reassign_leads: caller is not an admin"],
  ["an inactive receiver", "admin_reassign_leads: the receiving employee is not active"]
] as const) {
  test(`Reassign: the server refusing ${name} shows its message and moves nothing`, async ({ context, page }) => {
    await adminLeadsPage(context);
    await context.route(`${FAKE_SUPABASE}/rest/v1/rpc/admin_reassign_leads`, (route) =>
      route.fulfill(json({ code: "P0001", message, details: null, hint: null }, 400))
    );
    await selectAndConfirm(page);
    await expect(page.getByText(message)).toBeVisible();
    await expect(page.getByText(/Reassigned \d+ lead/)).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: "Deselect lead" })).toHaveCount(2);
  });
}

test("Reassign: a partial failure is shown and logged to System Health", async ({ context, page }) => {
  await adminLeadsPage(context);
  const anomalies: { source?: string }[] = [];
  await context.route(`${FAKE_SUPABASE}/rest/v1/system_anomaly_log**`, (route) => {
    if (route.request().method() === "POST") {
      const b = route.request().postDataJSON();
      anomalies.push(...(Array.isArray(b) ? b : [b]));
    }
    return route.fulfill(json([]));
  });
  await context.route(`${FAKE_SUPABASE}/rest/v1/rpc/admin_reassign_leads`, (route) =>
    route.fulfill(
      json({
        requested: 2,
        reassigned: 1,
        results: [
          { lead_id: LEAD_IDS[0], success: true },
          { lead_id: LEAD_IDS[1], success: false, error: "force_reassign_lead_atomic: lead x is already assigned to that employee" }
        ]
      })
    )
  );
  await selectAndConfirm(page);
  await expect(page.getByText(/1 reassigned, 1 failed/)).toBeVisible();
  await expect.poll(() => anomalies.filter((a) => a.source === "admin_reassign:partial").length).toBe(1);
});
