import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import path from "path";
import { EMP, FAKE_SUPABASE, UID, mockSupabase, type MockState } from "./mockSupabase";

// Admin Performance Report (2026-11-20, v2 2026-11-23): /admin/performance-report behind admin_report_mode. Fake
// Supabase answers the report RPCs with a fixed report (counts already per definitions v1; the SQL itself is tested
// in PGlite). Pixel 7, iPhone 14, desktop Chromium.

const SHOTS = "C:/work/reports/perf_report_build";
const AXE = path.join(process.cwd(), "node_modules/axe-core/axe.min.js");
const A = "00000000-0000-4000-8000-0000000000a1", B = "00000000-0000-4000-8000-0000000000a2", C = "00000000-0000-4000-8000-0000000000a3";
type Row = Record<string, unknown>;
const row = (o: Row): Row => ({
  leads: 0, stints: 0, fresh: 0, recycled: 0, restored: 0, admin_given: 0, other: 0, came_fresh: 0, came_recycled: 0, came_data: 0, came_restored: 0,
  came_admin_given: 0, came_other: 0, recycled_any: 0, followup: 0, visit: 0, visit_verified: 0, booked: 0, converted: 0, details_est: 0,
  not_connected: 0, not_interested: 0, no_result: 0, calls: 0, status_mix: {}, stage_mix: {}, ...o
});
const EMPS: Row[] = [
  { employee_id: A, name: "Employee A", active: true, ...row({ leads: 400, stints: 420, fresh: 60, recycled: 330, restored: 6, admin_given: 4, came_fresh: 50, came_recycled: 230, came_data: 100, came_restored: 6, came_admin_given: 4, came_other: 10,
    recycled_any: 300, followup: 30, visit: 6, visit_verified: 4, booked: 1, converted: 3, details_est: 5, not_connected: 160, not_interested: 70, no_result: 120,
    status_mix: { NOT_CONNECTED: 150, SWITCHED_OFF: 10, NOT_INTERESTED: 70, CONNECTED: 35, CONVERTED: 3, NO_RESULT: 120, CALLBACK_LATER: 12 },
    stage_mix: { LEADS: 360, FOLLOW_UP: 30, VISIT: 5, BOOKING: 1, NEGOTIATION: 4 } }) },
  { employee_id: B, name: "Employee B", active: false, ...row({ leads: 250, stints: 260, fresh: 40, recycled: 200, restored: 2, admin_given: 8, came_fresh: 40, came_recycled: 150, came_data: 50, came_restored: 2, came_admin_given: 8,
    recycled_any: 180, followup: 12, visit: 2, visit_verified: 2, converted: 1, details_est: 2, not_connected: 90, not_interested: 40, no_result: 100,
    status_mix: { NOT_CONNECTED: 90, NOT_INTERESTED: 40, CONNECTED: 19, CONVERTED: 1, NO_RESULT: 100 }, stage_mix: { LEADS: 236, FOLLOW_UP: 12, VISIT: 2 } }) },
  { employee_id: C, name: "Employee C", active: true, ...row({}) }
];
const ES: Row[] = [
  { employee_id: A, source: "99acres", ...row({ leads: 300, came_fresh: 40, came_recycled: 180, came_data: 70, came_restored: 4, came_admin_given: 2, came_other: 4, followup: 25, visit: 5, converted: 2, details_est: 4, not_connected: 120, not_interested: 50 }) },
  { employee_id: A, source: "Meta", ...row({ leads: 100, came_fresh: 10, came_recycled: 50, came_data: 30, came_restored: 2, came_admin_given: 2, came_other: 6, followup: 5, visit: 1, converted: 1, details_est: 1, not_connected: 40, not_interested: 20 }) },
  { employee_id: B, source: "99acres", ...row({ leads: 250, came_fresh: 40, came_recycled: 150, came_data: 50, came_restored: 2, came_admin_given: 8, followup: 12, visit: 2, converted: 1, details_est: 2, not_connected: 90, not_interested: 40 }) }
];
function report(filters: Row, api: 1 | 2) {
  const pick = filters.employee_ids as string[] | undefined;
  const by_employee = pick ? EMPS.filter((e) => pick.includes(String(e.employee_id))) : EMPS;
  const sum = (k: string) => by_employee.reduce((a, e) => a + Number(e[k] ?? 0), 0);
  const mix = (f: string) => by_employee.reduce((a: Record<string, number>, e) => { for (const [k, v] of Object.entries(e[f] as Record<string, number>)) a[k] = (a[k] ?? 0) + v; return a; }, {});
  const totals = row({ ...Object.fromEntries(Object.keys(row({})).filter((k) => !k.endsWith("_mix")).map((k) => [k, sum(k)])), leads: pick ? sum("leads") : 600, status_mix: mix("status_mix"), stage_mix: mix("stage_mix") });
  const out: Row = {
    def_version: 1, as_of: "2026-11-20T09:37:00Z", from: "2026-10-01", to: "2026-10-31", totals, by_employee,
    by_source: [
      { source: "99acres", ...row({ leads: 520, fresh: 80, recycled: 420, came_fresh: 80, came_recycled: 330, came_data: 100, came_other: 10, followup: 36, visit: 7, booked: 1, converted: 3, not_connected: 205, not_interested: 92 }) },
      { source: "Meta", ...row({ leads: 80, fresh: 20, recycled: 110, came_fresh: 10, came_recycled: 40, came_data: 30, followup: 6, visit: 1, converted: 1, not_connected: 45, not_interested: 18 }) },
      { source: "Other: NewPortal", ...row({}) }
    ],
    by_employee_type: [
      { employee_id: A, lead_type: "LEAD", ...row({ leads: 300, came_fresh: 50, came_recycled: 230, visit: 6, converted: 3 }) },
      { employee_id: A, lead_type: "DATA", ...row({ leads: 100, came_data: 100 }) }
    ],
    options: { employees: [{ id: A, name: "Employee A", active: true }, { id: B, name: "Employee B", active: false }, { id: C, name: "Employee C", active: true }], teams: [{ id: "t1", name: "Team One" }], sources: ["99acres", "Meta", "Other: NewPortal"], projects: ["P1", "P2"] },
    definitions: [
      { key: "range", label: "Date range", rule: "Counts leads whose assignment started in the range (India time)." },
      { key: "percent", label: "% of leads", rule: "Each number divided by the leads in that row. No leads shows “–”." },
      { key: "visit", label: "Visit", rule: "A visit or revisit logged by this person during the assignment, pending or verified, not denied. One lead counts once." },
      { key: "came_as", label: "Came as", rule: "Each lead once per row, by its first assignment in that row." },
      { key: "status_mix", label: "Status mix", rule: "The last result of each lead’s latest assignment in the range." }
    ]
  };
  if (api === 2) Object.assign(out, { api: 2, today: "2026-11-23", data_since: "2026-08-17", max_days: 800, by_emp_source: pick ? ES.filter((x) => pick.includes(String(x.employee_id))) : ES });
  return out;
}

let state: MockState;
let calls: { rpc: string; body: Row }[];

async function open(context: BrowserContext, page: Page, opts: { flag?: "on" | "off" | "missing"; role?: "admin" | "super_admin"; fail?: boolean; v1only?: boolean; goto?: string } = {}) {
  state = await mockSupabase(context);
  calls = [];
  const admin = { id: EMP, auth_user_id: UID, name: "Test Admin", role: opts.role ?? "admin", department: null, is_active: true, team_id: null };
  const settings: Row = { id: 1, auto_junk_enabled: true };
  if ((opts.flag ?? "on") !== "missing") settings.admin_report_mode = opts.flag ?? "on";
  const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  await context.route(`${FAKE_SUPABASE}/rest/v1/employees**`, (r) => r.fulfill(json((r.request().headers()["accept"] || "").includes("object") ? admin : [admin])));
  await context.route(`${FAKE_SUPABASE}/rest/v1/lead_engine_settings**`, (r) => r.fulfill(json((r.request().headers()["accept"] || "").includes("object") ? settings : [settings])));
  let failLeft = opts.fail ? 2 : 0; // the first load (twice under React dev StrictMode) fails
  await context.route(`${FAKE_SUPABASE}/rest/v1/rpc/get_perf_report*`, async (r) => {
    const rpc = new URL(r.request().url()).pathname.split("/").pop() as string;
    const body = JSON.parse(r.request().postData() || "{}");
    calls.push({ rpc, body });
    if (rpc.endsWith("_v2") && opts.v1only) return r.fulfill(json({ code: "PGRST202", message: `Could not find the function public.${rpc}` }, 404));
    if (rpc.startsWith("get_perf_report_leads")) {
      const total = body.p_metric === "visit" ? 450 : 3;
      const rows = Array.from({ length: Math.max(0, Math.min(body.p_limit, total - body.p_offset)) }, (_, i) => ({
        stint_id: `s${body.p_offset + i}`, lead_id: `l${body.p_offset + i}`, lead_name: `Lead ${1000 + body.p_offset + i}`, employee_name: "Employee A",
        source: "99acres", project: "P1", lead_type: "LEAD", origin: i % 2 ? "RECYCLED" : "FRESH", assigned_at: "2026-10-12T05:00:00Z",
        last_result: ["NOT_CONNECTED", "CONNECTED", "CALLBACK_LATER"][i % 3], last_stage: i % 2 ? "VISIT" : "LEADS"
      }));
      return r.fulfill(json({ metric: body.p_metric, total, rows }));
    }
    if (failLeft > 0) { failLeft--; return r.fulfill(json({ message: "fake failure" }, 500)); }
    return r.fulfill(json(report(body.p_filters ?? {}, rpc.endsWith("_v2") ? 2 : 1)));
  });
  await page.goto(opts.goto ?? "/admin/performance-report");
}
const reportCalls = () => calls.filter((c) => !c.rpc.startsWith("get_perf_report_leads")).length;
const drillCalls = () => calls.filter((c) => c.rpc.startsWith("get_perf_report_leads"));
const desktop = (info: { project: { name: string } }) => info.project.name === "desktop-chromium";
async function readDownload(page: Page, click: () => Promise<void>) {
  const [dl] = await Promise.all([page.waitForEvent("download"), click()]);
  const s = await dl.createReadStream();
  const text = await new Promise<string>((resolve) => { let out = ""; s.on("data", (c) => (out += c)); s.on("end", () => resolve(out)); });
  return { name: dl.suggestedFilename(), text };
}

for (const flag of ["off", "missing"] as const) {
  test(`flag ${flag}: the page stays hidden, no report is read, no menu link`, async ({ page, context }, info) => {
    await open(context, page, { flag });
    await expect(page.getByTestId("perf-hidden")).toBeVisible();
    await expect(page.getByTestId("perf-report")).toHaveCount(0);
    expect(reportCalls()).toBe(0);
    if (desktop(info)) await expect(page.getByTestId("nav-performance-report")).toHaveCount(0);
  });
}

test("menu: Performance Report link only while the flag is on, 44px, opens the page", async ({ page, context }, info) => {
  await open(context, page, { goto: "/admin/leaderboard" });
  if (!desktop(info)) await page.getByRole("button", { name: "Open menu" }).click();
  const link = page.getByTestId("nav-performance-report");
  await expect(link).toBeVisible();
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await link.click();
  await expect(page).toHaveURL(/\/admin\/performance-report$/);
  await expect(page.getByTestId("perf-tile-leads")).toContainText("600");
});

for (const role of ["admin", "super_admin"] as const) {
  test(`report (${role}): v2 tiles, came-as, one call per filter change, no polling, screenshot`, async ({ page, context }, info) => {
    await open(context, page, { role });
    await expect(page.getByTestId("perf-tile-leads")).toContainText("600");
    await expect(page.getByTestId("perf-tile-came_data")).toContainText("150");
    await expect(page.getByTestId("perf-tile-recycled_any-pct")).toHaveText("80.0% of leads");
    await expect(page.getByTestId("perf-tile-details_est")).toContainText("Estimate");
    await expect(page.getByTestId("perf-asof")).toContainText("As of 15:07, 20 Nov");
    expect(calls.every((c) => c.rpc === "get_perf_report_v2")).toBe(true);
    await page.waitForTimeout(600);
    const first = reportCalls();
    expect(first).toBeGreaterThanOrEqual(1);
    expect(first).toBeLessThanOrEqual(2); // React dev StrictMode runs the first effect twice
    await page.getByTestId("perf-filter-leadType").selectOption("DATA");
    await expect.poll(() => reportCalls()).toBe(first + 1);
    expect(calls.at(-1)!.body.p_filters).toEqual({ lead_type: "DATA" });
    await page.getByTestId("perf-filter-leadType").selectOption("");
    await expect.poll(() => reportCalls()).toBe(first + 2);
    await page.waitForTimeout(3000);
    expect(reportCalls()).toBe(first + 2); // no polling
    await page.screenshot({ path: `${SHOTS}/perf-report-${role}-${info.project.name}.png`, fullPage: true });
  });
}

test("multi-select: two employees and two sources go in one call each (request body, not URL)", async ({ page, context }) => {
  await open(context, page);
  await expect(page.getByTestId("perf-tile-leads")).toContainText("600");
  const before = reportCalls();
  await page.getByTestId("perf-ms-employee").click();
  const opts = page.getByTestId("perf-ms-employee-opt");
  await opts.nth(0).check();
  await opts.nth(1).check();
  await expect(page.getByTestId("perf-ms-employee-panel")).toContainText("(inactive)");
  expect(reportCalls()).toBe(before); // nothing until Done
  await page.getByTestId("perf-ms-employee-done").click();
  await expect.poll(() => reportCalls()).toBe(before + 1);
  expect((calls.at(-1)!.body.p_filters as Row).employee_ids).toEqual([A, B]);
  await expect(page.getByTestId("perf-ms-employee")).toHaveText(/2 selected/);
  await expect(page.getByTestId("perf-tile-leads")).toContainText("650");
  await page.getByTestId("perf-ms-source").click();
  await page.getByTestId("perf-ms-source-opt").nth(0).check();
  await page.getByTestId("perf-ms-source-opt").nth(1).check();
  await page.getByTestId("perf-ms-source-done").click();
  await expect.poll(() => reportCalls()).toBe(before + 2);
  expect((calls.at(-1)!.body.p_filters as Row).sources).toEqual(["99acres", "Meta"]);
  expect(calls.every((c) => !JSON.stringify(c).includes("?employee_ids"))).toBe(true);
  await page.getByTestId("perf-clear").click();
  await expect.poll(() => reportCalls()).toBe(before + 3);
  expect(calls.at(-1)!.body.p_filters).toEqual({});
});

test("% view: came-as and results as %, a row with no leads shows –, new status / stage names, screenshot", async ({ page, context }, info) => {
  await open(context, page);
  await page.getByTestId("perf-view-pct").click();
  await expect(page.getByTestId("perf-src-cell-Meta-visit")).toHaveText("1.3%");
  await expect(page.getByTestId("perf-src-cell-Meta-came_data")).toHaveText("37.5%");
  await expect(page.getByTestId("perf-src-cell-Other: NewPortal-visit")).toHaveText("–");
  await expect(page.getByTestId("perf-mix-col-status_mix-CALLBACK_LATER")).toContainText("Callback later");
  await expect(page.getByTestId("perf-mix-col-stage_mix-NEGOTIATION")).toContainText("Negotiation");
  await expect(page.getByTestId(`perf-mix-cell-status_mix-${A}-NOT_CONNECTED`)).toHaveText("37.5%");
  await expect(page.getByTestId(`perf-mix-cell-status_mix-${C}-NOT_CONNECTED`)).toHaveText("–");
  await expect(page.getByTestId(`perf-es-cell-${A}-Meta-came_data`)).toHaveText("30.0%");
  if (desktop(info)) await expect(page.getByTestId(`perf-emp-cell-${A}-came_data`)).toHaveText("25.0%");
  else await expect(page.getByTestId(`perf-emp-card-came-${A}`)).toContainText("Data 25.0%");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/perf-report-percent-${info.project.name}.png`, fullPage: true });
});

test("employee table: Fresh / Recycled / Data / Given back / By admin side by side; desktop sorts + expands, phone cards", async ({ page, context }, info) => {
  await open(context, page);
  await expect(page.getByTestId("perf-tile-leads")).toContainText("600");
  if (desktop(info)) {
    for (const [k, v] of [["came_fresh", "50"], ["came_recycled", "230"], ["came_data", "100"], ["came_restored", "6"], ["came_admin_given", "4"]])
      await expect(page.getByTestId(`perf-emp-cell-${A}-${k}`)).toHaveText(v);
    await page.getByTestId("perf-sort-came_data").click();
    await expect(page.locator('[data-testid^="perf-emp-row-"]').first()).toHaveAttribute("data-testid", `perf-emp-row-${A}`);
    await page.getByTestId("perf-sort-name").click();
    await expect(page.locator('[data-testid^="perf-emp-row-"]').first()).toHaveAttribute("data-testid", `perf-emp-row-${A}`);
    await expect(page.getByTestId(`perf-emp-row-${B}`)).toContainText("(inactive)");
    await page.getByTestId(`perf-emp-expand-${A}`).click();
    await expect(page.getByTestId(`perf-emp-sub-${A}-DATA`)).toContainText("100");
  } else {
    await expect(page.getByTestId("perf-emp-cards")).toBeVisible();
    await expect(page.getByTestId("perf-emp-table")).toBeHidden();
    await expect(page.getByTestId(`perf-emp-card-came-${A}`)).toHaveText("Fresh 50 · Recycled 230 · Data 100 · Given back 6 · By admin 4 · Other 10");
  }
});

test("employee x source: sources under each person, subtotal = person, grand total = sum; a cell filters both", async ({ page, context }) => {
  await open(context, page);
  const t = page.getByTestId("perf-es-table");
  await expect(t).toBeVisible();
  await expect(page.getByTestId(`perf-es-sub-${A}`)).toContainText("400");
  await expect(page.getByTestId(`perf-es-cell-${A}-99acres-leads`)).toHaveText("300");
  await expect(page.getByTestId(`perf-es-cell-${A}-Meta-leads`)).toHaveText("100");
  await expect(page.getByTestId("perf-es-grand")).toContainText("650");
  const order = await t.locator('[data-testid^="perf-es-row-"], [data-testid^="perf-es-sub-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
  expect(order).toEqual([`perf-es-row-${A}-99acres`, `perf-es-row-${A}-Meta`, `perf-es-sub-${A}`, `perf-es-row-${B}-99acres`, `perf-es-sub-${B}`, `perf-es-sub-${C}`]);
  await page.getByTestId(`perf-es-cell-${A}-Meta-came_recycled`).click();
  await expect.poll(() => drillCalls().length).toBe(1);
  expect(drillCalls()[0].body).toMatchObject({ p_metric: "came:RECYCLED", p_filters: { employee_ids: [A], sources: ["Meta"] } });
  expect(drillCalls()[0].rpc).toBe("get_perf_report_leads_v2");
});

test("drill-down: 200 per page, Load more, CSV of every lead (paged), screenshot", async ({ page, context }, info) => {
  await open(context, page);
  await page.getByTestId("perf-tile-visit").click();
  const sheet = page.getByTestId("perf-drill");
  await expect(sheet.getByTestId("perf-drill-row")).toHaveCount(200);
  await expect(sheet).toContainText("450 leads");
  await page.screenshot({ path: `${SHOTS}/perf-report-drill-${info.project.name}.png` });
  await sheet.getByTestId("perf-drill-more").click();
  await expect(sheet.getByTestId("perf-drill-row")).toHaveCount(400);
  await expect(sheet.getByTestId("perf-drill-more")).toHaveText("Load 50 more");
  const before = drillCalls().length;
  const { name, text } = await readDownload(page, () => sheet.getByTestId("perf-drill-csv").click());
  expect(name).toMatch(/^performance-report-leads-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/);
  const lines = text.trim().split("\n");
  expect(lines[1]).toBe("Lead,Employee,Type,Source,Project,Given as,Given on (IST),Last result,Stage");
  expect(lines.length).toBe(2 + 450);
  expect(text).toContain("Lead 1449,Employee A,LEAD,99acres,P1,Recycled,2026-10-12,Connected,Visit");
  expect(drillCalls().slice(before).map((c) => [c.body.p_metric, c.body.p_offset, c.body.p_limit])).toEqual([["visit", 0, 200], ["visit", 200, 200], ["visit", 400, 200]]);
  await sheet.getByTestId("perf-drill-close").click();
  await expect(sheet).toHaveCount(0);
});

test("page CSV: employee, employee x source (subtotal, grand total), source, mixes; count and %", async ({ page, context }) => {
  await open(context, page);
  await expect(page.getByTestId("perf-tile-leads")).toContainText("600");
  const { name, text } = await readDownload(page, () => page.getByTestId("perf-csv").click());
  expect(name).toBe("performance-report-2026-10-01-to-2026-10-31.csv");
  expect(text).toContain("Employee,Leads received,Fresh,Fresh %,Recycled,Recycled %,Data,Data %");
  expect(text).toContain("Employee A,400,50,12.5%,230,57.5%,100,25.0%");
  expect(text).toContain("Employee C,0,0,–");
  expect(text).toContain("Employee,Source,Leads received");
  expect(text).toContain("Employee A,Meta,100,10,10.0%");
  expect(text).toContain("Employee A,All sources (subtotal),400,");
  expect(text).toContain("Grand total (sum of employees),All sources,650,");
  expect(text).toContain("Callback later,Callback later %");
});

test("range: over 800 days shows a clear message and asks nothing; future days say no data yet", async ({ page, context }) => {
  await open(context, page);
  await expect(page.getByTestId("perf-tile-leads")).toContainText("600");
  await page.getByTestId("perf-preset-custom").click();
  const from = page.getByTestId("perf-custom-from"), to = page.getByTestId("perf-custom-to");
  await from.fill("2026-11-01");
  await to.fill("2026-12-31");
  await expect(page.getByTestId("perf-range-note")).toHaveText(/No data yet after today/);
  await expect(to).toHaveAttribute("max", "2029-01-09");
  await page.waitForTimeout(1200); // let the last date change finish its one call
  const before = reportCalls();
  await from.fill("2024-01-01");
  await expect(page.getByTestId("perf-range-problem")).toContainText("Please choose a range of 800 days or less.");
  await page.waitForTimeout(800);
  expect(reportCalls()).toBe(before);
  await expect(page.getByTestId("perf-csv")).toBeDisabled();
  await from.fill("2027-01-01");
  await to.fill("2027-01-31");
  await expect(page.getByTestId("perf-range-note")).toContainText("No data yet: these dates are in the future.");
});

test("v2 not applied yet: falls back to v1 with a note, no came-as / employee x source", async ({ page, context }) => {
  await open(context, page, { v1only: true });
  await expect(page.getByTestId("perf-tile-leads")).toContainText("600");
  await expect(page.getByTestId("perf-v1-note")).toBeVisible();
  await expect(page.getByTestId("perf-es")).toHaveCount(0);
  await expect(page.getByTestId("perf-tile-recycled")).toBeVisible();
  expect(calls.some((c) => c.rpc === "get_perf_report")).toBe(true);
  await page.getByTestId("perf-tile-visit").click();
  await expect.poll(() => drillCalls().some((c) => c.rpc === "get_perf_report_leads")).toBe(true);
});

test("one card failing: error text + Retry, the error is reported, Retry loads", async ({ page, context }) => {
  await open(context, page, { fail: true });
  await expect(page.getByTestId("perf-retry")).toHaveText("Couldn't load the report. Tap to try again.");
  await expect.poll(() => state.anomalies.some((a) => String(a.message).startsWith("perf-report:load"))).toBe(true);
  await page.getByTestId("perf-retry").click();
  await expect(page.getByTestId("perf-tile-leads")).toContainText("600");
});

test("axe (contrast, target size), no horizontal scroll, definitions popup", async ({ page, context }) => {
  await open(context, page);
  await expect(page.getByTestId("perf-tile-leads")).toContainText("600");
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
  await page.getByTestId("perf-def-close").click();
  await expect(page.getByTestId("perf-status-mix-label")).toHaveText("Final status of each lead in this period (last result)");
  await page.getByRole("button", { name: "About Converted", exact: true }).click();
  await expect(page.getByTestId("perf-def-converted-note")).toHaveText("Tile counts leads ever marked Converted; the mix shows each lead's final status, so the two can differ.");
});
