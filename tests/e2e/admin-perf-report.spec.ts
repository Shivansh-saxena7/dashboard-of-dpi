import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import path from "path";
import { EMP, FAKE_SUPABASE, UID, mockSupabase, type MockState } from "./mockSupabase";

// Admin Performance Report (2026-11-20): /admin/performance-report behind admin_report_mode. Fake Supabase answers the
// two report RPCs with a fixed report (counts already per definitions v1; the SQL itself is tested in PGlite).
// Pixel 7, iPhone 14, desktop Chromium.

const SHOTS = "C:/work/reports/perf_report_build";
const AXE = path.join(process.cwd(), "node_modules/axe-core/axe.min.js");
const A = "00000000-0000-4000-8000-0000000000a1", B = "00000000-0000-4000-8000-0000000000a2", C = "00000000-0000-4000-8000-0000000000a3";
const row = (o: Record<string, unknown>) => ({
  leads: 0, stints: 0, fresh: 0, recycled: 0, restored: 0, admin_given: 0, other: 0, followup: 0, visit: 0, visit_verified: 0, booked: 0,
  converted: 0, details_est: 0, not_connected: 0, not_interested: 0, no_result: 0, calls: 0, ...o
});
function report(filters: Record<string, unknown>) {
  const emp = [
    { employee_id: A, name: "Employee A", ...row({ leads: 400, stints: 420, fresh: 60, recycled: 330, restored: 6, admin_given: 4, followup: 30, visit: 6, visit_verified: 4, booked: 1, converted: 3, details_est: 5, not_connected: 160, not_interested: 70, no_result: 120,
      status_mix: { NOT_CONNECTED: 150, SWITCHED_OFF: 10, NOT_INTERESTED: 70, CONNECTED: 35, CONVERTED: 3, NO_RESULT: 120, CALLBACK_LATER: 12 },
      stage_mix: { LEADS: 360, FOLLOW_UP: 30, VISIT: 5, BOOKING: 1, NEGOTIATION: 4 } }) },
    { employee_id: B, name: "Employee B", ...row({ leads: 250, stints: 260, fresh: 40, recycled: 200, restored: 2, admin_given: 8, followup: 12, visit: 2, visit_verified: 2, converted: 1, details_est: 2, not_connected: 90, not_interested: 40, no_result: 100,
      status_mix: { NOT_CONNECTED: 90, NOT_INTERESTED: 40, CONNECTED: 19, CONVERTED: 1, NO_RESULT: 100 }, stage_mix: { LEADS: 236, FOLLOW_UP: 12, VISIT: 2 } }) },
    { employee_id: C, name: "Employee C", ...row({ status_mix: {}, stage_mix: {} }) }
  ];
  const pick = filters.employee_ids as string[] | undefined;
  const by_employee = pick ? emp.filter((e) => pick.includes(e.employee_id)) : emp;
  const sum = (k: string) => by_employee.reduce((a, e) => a + Number((e as Record<string, unknown>)[k] ?? 0), 0);
  const mix = (f: "status_mix" | "stage_mix") => by_employee.reduce((a, e) => { for (const [k, v] of Object.entries(e[f] as Record<string, number>)) a[k] = (a[k] ?? 0) + v; return a; }, {} as Record<string, number>);
  const totals = row({ ...Object.fromEntries(Object.keys(row({})).map((k) => [k, sum(k)])), status_mix: mix("status_mix"), stage_mix: mix("stage_mix") });
  return {
    def_version: 1, as_of: "2026-11-20T09:37:00Z", from: "2026-10-01", to: "2026-10-31", totals, by_employee,
    by_source: [
      { source: "99acres", ...row({ leads: 520, fresh: 80, recycled: 420, followup: 36, visit: 7, booked: 1, converted: 3, not_connected: 205, not_interested: 92 }) },
      { source: "Meta", ...row({ leads: 130, fresh: 20, recycled: 110, followup: 6, visit: 1, converted: 1, not_connected: 45, not_interested: 18 }) },
      { source: "Other: NewPortal", ...row({ leads: 0 }) }
    ],
    by_employee_type: [
      { employee_id: A, lead_type: "LEAD", ...row({ leads: 300, fresh: 50, recycled: 240, visit: 6, converted: 3 }) },
      { employee_id: A, lead_type: "DATA", ...row({ leads: 100, fresh: 10, recycled: 90 }) }
    ],
    options: { employees: [{ id: A, name: "Employee A" }, { id: B, name: "Employee B" }, { id: C, name: "Employee C" }], teams: [{ id: "t1", name: "Team One" }], sources: ["99acres", "Meta", "Other: NewPortal"], projects: ["P1", "P2"] },
    definitions: [
      { key: "range", label: "Date range", rule: "Counts leads whose assignment started in the range (India time)." },
      { key: "percent", label: "% of leads", rule: "Each number divided by the leads in that row. No leads shows “–”." },
      { key: "visit", label: "Visit", rule: "A visit or revisit logged by this person during the assignment, pending or verified, not denied. One lead counts once." },
      { key: "status_mix", label: "Status mix", rule: "The last result of each lead’s latest assignment in the range." }
    ]
  };
}

let state: MockState;
let calls: { rpc: string; body: Record<string, unknown> }[];

async function open(context: BrowserContext, page: Page, opts: { flag?: "on" | "off" | "missing"; role?: "admin" | "super_admin"; fail?: boolean } = {}) {
  state = await mockSupabase(context);
  calls = [];
  const admin = { id: EMP, auth_user_id: UID, name: "Test Admin", role: opts.role ?? "admin", department: null, is_active: true, team_id: null };
  const settings: Record<string, unknown> = { id: 1, auto_junk_enabled: true };
  if ((opts.flag ?? "on") !== "missing") settings.admin_report_mode = opts.flag ?? "on";
  const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  await context.route(`${FAKE_SUPABASE}/rest/v1/employees**`, (r) => r.fulfill(json((r.request().headers()["accept"] || "").includes("object") ? admin : [admin])));
  await context.route(`${FAKE_SUPABASE}/rest/v1/lead_engine_settings**`, (r) => r.fulfill(json((r.request().headers()["accept"] || "").includes("object") ? settings : [settings])));
  let failLeft = opts.fail ? 2 : 0; // the first load (twice under React dev StrictMode) fails
  await context.route(`${FAKE_SUPABASE}/rest/v1/rpc/get_perf_report*`, async (r) => {
    const url = new URL(r.request().url());
    const body = JSON.parse(r.request().postData() || "{}");
    const rpc = url.pathname.endsWith("get_perf_report_leads") ? "get_perf_report_leads" : "get_perf_report";
    calls.push({ rpc, body });
    if (rpc === "get_perf_report") {
      if (failLeft > 0) { failLeft--; return r.fulfill(json({ message: "fake failure" }, 500)); }
      return r.fulfill(json(report(body.p_filters ?? {})));
    }
    const total = body.p_metric === "visit" ? 450 : 3;
    const rows = Array.from({ length: Math.max(0, Math.min(body.p_limit, total - body.p_offset)) }, (_, i) => ({
      stint_id: `s${body.p_offset + i}`, lead_id: `l${body.p_offset + i}`, lead_name: `Lead ${1000 + body.p_offset + i}`, employee_name: "Employee A",
      source: "99acres", project: "P1", origin: i % 2 ? "RECYCLED" : "FRESH", assigned_at: "2026-10-12T05:00:00Z",
      last_result: ["NOT_CONNECTED", "CONNECTED", "CALLBACK_LATER"][i % 3], last_stage: i % 2 ? "VISIT" : "LEADS"
    }));
    return r.fulfill(json({ metric: body.p_metric, total, rows }));
  });
  await page.goto("/admin/performance-report");
}
const reportCalls = () => calls.filter((c) => c.rpc === "get_perf_report").length;
const desktop = (info: { project: { name: string } }) => info.project.name === "desktop-chromium";

for (const flag of ["off", "missing"] as const) {
  test(`flag ${flag}: the page stays hidden and no report is read`, async ({ page, context }) => {
    await open(context, page, { flag });
    await expect(page.getByTestId("perf-hidden")).toBeVisible();
    await expect(page.getByTestId("perf-report")).toHaveCount(0);
    expect(reportCalls()).toBe(0);
  });
}

for (const role of ["admin", "super_admin"] as const) {
  test(`report (${role}): tiles with % of leads, Estimate label, as-of, one call per filter change, screenshot`, async ({ page, context }, info) => {
    await open(context, page, { role });
    await expect(page.getByTestId("perf-tile-leads")).toContainText("650");
    await expect(page.getByTestId("perf-tile-converted-pct")).toHaveText("0.6% of leads");
    await expect(page.getByTestId("perf-tile-visit-pct")).toHaveText("1.2% of leads");
    await expect(page.getByTestId("perf-tile-details_est")).toContainText("Estimate");
    await expect(page.getByTestId("perf-asof")).toContainText("As of 15:07, 20 Nov");
    await page.waitForTimeout(600);
    const first = reportCalls();
    expect(first).toBeGreaterThanOrEqual(1);
    expect(first).toBeLessThanOrEqual(2); // React dev StrictMode runs the first effect twice
    await page.getByTestId("perf-filter-employee").selectOption(B);
    await expect(page.getByTestId("perf-tile-leads")).toContainText("250");
    expect(reportCalls()).toBe(first + 1);
    expect(calls.at(-1)!.body.p_filters).toEqual({ employee_ids: [B] });
    await page.getByTestId("perf-filter-employee").selectOption("");
    await expect(page.getByTestId("perf-tile-leads")).toContainText("650");
    expect(reportCalls()).toBe(first + 2);
    await page.waitForTimeout(3000);
    expect(reportCalls()).toBe(first + 2); // no polling
    await page.screenshot({ path: `${SHOTS}/perf-report-${role}-${info.project.name}.png`, fullPage: true });
  });
}

test("% view: tables and mixes show %, a row with no leads shows –, new status / stage names appear, screenshot", async ({ page, context }, info) => {
  await open(context, page);
  await page.getByTestId("perf-view-pct").click();
  await expect(page.getByTestId("perf-src-cell-Meta-visit")).toHaveText("0.8%");
  await expect(page.getByTestId("perf-src-cell-Other: NewPortal-visit")).toHaveText("–");
  await expect(page.getByTestId("perf-mix-col-status_mix-CALLBACK_LATER")).toContainText("Callback later");
  await expect(page.getByTestId("perf-mix-col-stage_mix-NEGOTIATION")).toContainText("Negotiation");
  await expect(page.getByTestId(`perf-mix-cell-status_mix-${A}-NOT_CONNECTED`)).toHaveText("37.5%");
  await expect(page.getByTestId(`perf-mix-cell-status_mix-${C}-NOT_CONNECTED`)).toHaveText("–");
  if (desktop(info)) await expect(page.getByTestId(`perf-emp-cell-${A}-converted`)).toHaveText("0.8%");
  await page.getByTestId("perf-mixby-source").click();
  await expect(page.getByTestId("perf-mix-cell-status_mix-total-NO_RESULT")).toHaveText("33.8%");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/perf-report-percent-${info.project.name}.png`, fullPage: true });
});

test("drill-down: a number opens its leads, 200 per page, Load more asks for the next 200, screenshot", async ({ page, context }, info) => {
  await open(context, page);
  await page.getByTestId("perf-tile-visit").click();
  const sheet = page.getByTestId("perf-drill");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId("perf-drill-row")).toHaveCount(200);
  await expect(sheet).toContainText("450 leads");
  await page.screenshot({ path: `${SHOTS}/perf-report-drill-${info.project.name}.png` });
  await sheet.getByTestId("perf-drill-more").click();
  await expect(sheet.getByTestId("perf-drill-row")).toHaveCount(400);
  const drills = calls.filter((c) => c.rpc === "get_perf_report_leads");
  expect(drills.map((d) => [d.body.p_metric, d.body.p_limit, d.body.p_offset])).toEqual([["visit", 200, 0], ["visit", 200, 200]]);
  await expect(sheet.getByTestId("perf-drill-more")).toHaveText("Load 50 more");
  await sheet.getByTestId("perf-drill-close").click();
  await expect(sheet).toHaveCount(0);
  // An employee's number filters the drill-down to that employee.
  await page.getByTestId(desktop(info) ? `perf-emp-cell-${B}-not_connected` : `perf-emp-card-cell-${B}-not_connected`).click();
  await expect(page.getByTestId("perf-drill")).toBeVisible();
  // The sheet opens (loading) before the answer, so wait for the call itself.
  await expect.poll(() => calls.filter((c) => c.rpc === "get_perf_report_leads").length).toBe(3);
  expect(calls.filter((c) => c.rpc === "get_perf_report_leads").at(-1)!.body).toMatchObject({ p_metric: "not_connected", p_filters: { employee_ids: [B] } });
  await expect(page.getByTestId("perf-drill").getByTestId("perf-drill-row")).toHaveCount(3);
});

test("employee table: desktop sorts and expands to Leads / Data; phone shows cards", async ({ page, context }, info) => {
  await open(context, page);
  await expect(page.getByTestId("perf-tile-leads")).toContainText("650");
  if (desktop(info)) {
    await expect(page.getByTestId("perf-emp-table")).toBeVisible();
    await page.getByTestId("perf-sort-name").click();
    await expect(page.locator('[data-testid^="perf-emp-row-"]').first()).toHaveAttribute("data-testid", `perf-emp-row-${A}`);
    await page.getByTestId("perf-sort-not_interested").click();
    await expect(page.locator('[data-testid^="perf-emp-row-"]').first()).toHaveAttribute("data-testid", `perf-emp-row-${A}`);
    await page.getByTestId("perf-sort-not_interested").click();
    await expect(page.locator('[data-testid^="perf-emp-row-"]').first()).toHaveAttribute("data-testid", `perf-emp-row-${C}`);
    await page.getByTestId(`perf-emp-expand-${A}`).click();
    await expect(page.getByTestId(`perf-emp-sub-${A}-DATA`)).toContainText("100");
  } else {
    await expect(page.getByTestId("perf-emp-cards")).toBeVisible();
    await expect(page.getByTestId("perf-emp-table")).toBeHidden();
    await expect(page.getByTestId(`perf-emp-card-cell-${A}-converted`)).toContainText("0.8%");
  }
});

test("CSV: count and % columns, – for no leads, the status mix", async ({ page, context }) => {
  await open(context, page);
  await expect(page.getByTestId("perf-tile-leads")).toContainText("650");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("perf-csv").click()]);
  const text = await new Promise<string>(async (resolve) => {
    const s = await dl.createReadStream();
    let out = "";
    s.on("data", (c) => (out += c));
    s.on("end", () => resolve(out));
  });
  expect(dl.suggestedFilename()).toBe("performance-report-2026-10-01-to-2026-10-31.csv");
  expect(text).toContain("Employee,Leads received,Fresh,Fresh %");
  expect(text).toContain("Employee A,400,60,15.0%");
  expect(text).toContain("Employee C,0,0,–");
  expect(text).toContain("Callback later,Callback later %");
});

test("one card failing: error text + Retry, the error is reported, Retry loads", async ({ page, context }) => {
  await open(context, page, { fail: true });
  await expect(page.getByTestId("perf-retry")).toHaveText("Couldn't load the report. Tap to try again.");
  await expect.poll(() => state.anomalies.some((a) => String(a.message).startsWith("perf-report:load"))).toBe(true);
  await page.getByTestId("perf-retry").click();
  await expect(page.getByTestId("perf-tile-leads")).toContainText("650");
});

test("axe (contrast, target size), no horizontal scroll, definitions popup", async ({ page, context }) => {
  await open(context, page);
  await expect(page.getByTestId("perf-tile-leads")).toContainText("650");
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.addScriptTag({ path: AXE });
  const v = await page.evaluate(async () => {
    const w = window as unknown as { axe: { run: (c: Element, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } };
    const res = await w.axe.run(document.querySelector('[data-testid="perf-report"]') as Element, { runOnly: { type: "rule", values: ["color-contrast", "target-size"] } });
    return res.violations.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(" ")).slice(0, 4).join(", ")}`);
  });
  expect(v).toEqual([]);
  await page.getByRole("button", { name: "About Visits", exact: true }).click();
  await expect(page.getByTestId("perf-def")).toContainText("One lead counts once.");
});
