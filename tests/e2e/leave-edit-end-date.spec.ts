import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { EMP, FAKE_SUPABASE, UID, mockSupabase } from "./mockSupabase";

// /admin/leave Edit end date (2026-11-16): any leave gets "Edit end date" (reason required); a running leave with an
// end date also gets "Mark Returned Today" (end date = yesterday). Saved through admin_edit_leave_end_date, which
// refuses a date before the start and records every change. Pixel 7 (Chromium) and iPhone 14 (WebKit), fake Supabase.

const ist = (offsetDays: number) => new Date(Date.now() + 5.5 * 3600e3 + offsetDays * 864e5).toISOString().slice(0, 10);
const RUNNING = "00000000-0000-4000-8000-00000000aa01";
const FUTURE = "00000000-0000-4000-8000-00000000aa02";
const json = (body: unknown, status = 200) => ({
  status,
  headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  body: JSON.stringify(body)
});

async function leavePage(context: BrowserContext) {
  await mockSupabase(context);
  const admin = { id: EMP, auth_user_id: UID, name: "Test Admin", role: "admin", department: "admin", is_active: true, team_id: null };
  await context.route(`${FAKE_SUPABASE}/rest/v1/employees**`, (route) => {
    const url = decodeURIComponent(route.request().url());
    const one = (route.request().headers()["accept"] || "").includes("vnd.pgrst.object");
    return route.fulfill(json(url.includes("auth_user_id=eq.") ? (one ? admin : [admin]) : [admin]));
  });
  await context.route(`${FAKE_SUPABASE}/rest/v1/employee_leave_periods**`, (route) =>
    route.fulfill(json([
      { id: RUNNING, employee_id: "e-tanu", start_date: ist(-4), end_date: ist(0), reason: "Personal leave", marked_by_employee_id: EMP, created_at: "2026-11-11T05:00:00Z", employee: { name: "Tanu Test" }, marked_by: { name: "Test Admin" } },
      { id: FUTURE, employee_id: "e-raja", start_date: ist(5), end_date: ist(8), reason: "Family", marked_by_employee_id: EMP, created_at: "2026-11-11T05:00:00Z", employee: { name: "Raja Test" }, marked_by: { name: "Test Admin" } }
    ]))
  );
}

async function rpcBodies(context: BrowserContext, answer: (body: Record<string, unknown>) => { status: number; body: unknown }) {
  const bodies: Record<string, unknown>[] = [];
  await context.route(`${FAKE_SUPABASE}/rest/v1/rpc/admin_edit_leave_end_date`, (route) => {
    const b = route.request().postDataJSON();
    bodies.push(b);
    const a = answer(b);
    return route.fulfill(json(a.body, a.status));
  });
  return bodies;
}

const card = (page: Page, name: string) => page.locator("div.rounded-2xl").filter({ hasText: name }).first();

test("running leave with an end date: Mark Returned Today saves yesterday with a reason", async ({ context, page }) => {
  await leavePage(context);
  const bodies = await rpcBodies(context, (b) => ({ status: 200, body: { leave_id: b.p_leave_id, old_end_date: ist(0), new_end_date: b.p_end_date } }));
  await page.goto("/admin/leave");
  const tanu = card(page, "Tanu Test");
  await tanu.getByRole("button", { name: "Mark Returned Today" }).click();
  await expect(tanu.getByLabel("New end date")).toHaveValue(ist(-1));
  await expect(tanu.getByPlaceholder("Reason (required)")).toHaveValue("Returned to work today");
  await tanu.getByRole("button", { name: "Save end date" }).click();
  await expect(page.getByText("Leave end date updated.")).toBeVisible();
  expect(bodies).toEqual([{ p_leave_id: RUNNING, p_end_date: ist(-1), p_reason: "Returned to work today" }]);
});

test("any leave: Edit end date; a date before the start and an empty reason are refused before sending", async ({ context, page }) => {
  await leavePage(context);
  const bodies = await rpcBodies(context, (b) => ({ status: 200, body: { leave_id: b.p_leave_id, new_end_date: b.p_end_date } }));
  await page.goto("/admin/leave");
  const raja = card(page, "Raja Test");
  await expect(raja.getByRole("button", { name: "Mark Returned Today" })).toHaveCount(0); // not running yet
  await raja.getByRole("button", { name: "Edit end date" }).click();
  await raja.getByLabel("New end date").fill(ist(3));
  await raja.getByPlaceholder("Reason (required)").fill("Typo");
  await raja.getByRole("button", { name: "Save end date" }).click();
  await expect(page.getByText("The end date cannot be before the start date.")).toBeVisible();
  await raja.getByLabel("New end date").fill(ist(6));
  await raja.getByPlaceholder("Reason (required)").fill("");
  await raja.getByRole("button", { name: "Save end date" }).click();
  await expect(page.getByText("A reason is required.")).toBeVisible();
  expect(bodies).toHaveLength(0);
  await raja.getByPlaceholder("Reason (required)").fill("Coming back early");
  await raja.getByRole("button", { name: "Save end date" }).click();
  await expect(page.getByText("Leave end date updated.")).toBeVisible();
  expect(bodies).toEqual([{ p_leave_id: FUTURE, p_end_date: ist(6), p_reason: "Coming back early" }]);
});

test("a server refusal is shown in plain English and the form stays open", async ({ context, page }) => {
  await leavePage(context);
  await rpcBodies(context, () => ({ status: 400, body: { code: "P0001", message: "admin_edit_leave_end_date: this would overlap another leave of the same employee" } }));
  await page.goto("/admin/leave");
  const raja = card(page, "Raja Test");
  await raja.getByRole("button", { name: "Edit end date" }).click();
  await raja.getByLabel("New end date").fill(ist(10));
  await raja.getByPlaceholder("Reason (required)").fill("Extended");
  await raja.getByRole("button", { name: "Save end date" }).click();
  await expect(page.getByText("this would overlap another leave of the same employee", { exact: true })).toBeVisible();
  await expect(raja.getByRole("button", { name: "Save end date" })).toBeVisible();
});
