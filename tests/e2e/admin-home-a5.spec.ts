import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import path from "path";
import { mockSupabase, type MockState } from "./mockSupabase";

// Admin Home A5 (2026-11-20), polish: every card in one look; states (All clear, Needs action, errors, loading) for
// admin and super_admin; keyboard focus order + visible focus ring; aria-live on Needs action; axe on the whole Home;
// read load (how many reads, how many at once, no polling). Fixed clock: Fri 20 Nov 2026, 14:00 IST.

const SHOTS = "C:/work/reports/admin_a5";
const AXE = path.join(process.cwd(), "node_modules/axe-core/axe.min.js");
const NOW = Date.parse("2026-11-20T14:00:00+05:30");
const iso = (ms: number) => new Date(ms).toISOString();
const IST = (s: string) => iso(Date.parse(`${s}+05:30`));
const MIN = 60000;
const DAY = 86400e3;

let state: MockState;

async function setup(context: BrowserContext, page: Page, role: "admin" | "super_admin" = "admin") {
  await page.clock.setFixedTime(new Date(NOW));
  state = await mockSupabase(context);
  state.employee.role = role;
  state.employee.department = null;
  Object.assign(state.settings, {
    admin_home_mode: "on", auto_junk_enabled: true, auto_recycle_enabled: true, positive_junk_guard_mode: "enforce", restore_hold_mode: "enforce",
    reminder_hold_mode: "shadow", recycle_sibling_guard_mode: "shadow", given_lead_context_mode: "on", given_lead_context_pilot_ids: [], call_quality_enforced: false
  });
  state.heartbeats = [
    { function_name: "recycle-stale-leads", max_silence_minutes: 30, last_succeeded_at: iso(NOW - 5 * MIN) },
    { function_name: "check-lead-reminders", max_silence_minutes: 120, last_succeeded_at: iso(NOW - 40 * MIN) },
    { function_name: "db-backup", max_silence_minutes: 1560, last_succeeded_at: iso(NOW - 300 * MIN) },
    { function_name: "backup-to-google-sheets", max_silence_minutes: 1500, last_succeeded_at: iso(NOW - 500 * MIN) }
  ];
  state.backups = [{ run_at: iso(NOW - 500 * MIN), status: "SUCCESS" }];
  state.anomalyRows = [];
  state.staff = [
    { id: "e-on", name: "Olivia", is_active: true, role: "employee", department: "sales", created_at: "2026-09-01T05:00:00Z" },
    { id: "e-late", name: "Liam", is_active: true, role: "employee", department: "sales", created_at: "2026-09-01T05:00:00Z" },
    { id: "e-leave", name: "Leah", is_active: true, role: "employee", department: "sales", created_at: "2026-09-01T05:00:00Z" },
    { id: String(state.employee.id), name: "Admin", is_active: true, role, department: null, created_at: "2026-09-01T05:00:00Z" }
  ];
  state.attendanceByDate = [
    { employee_id: "e-on", date: "2026-11-20", shift_start_at: IST("2026-11-20T10:31:00"), shift_end_at: null, attendance_type: "FULL_DAY" },
    { employee_id: "e-late", date: "2026-11-20", shift_start_at: IST("2026-11-20T10:52:00"), shift_end_at: null, attendance_type: "FULL_DAY" },
    // Earlier working days (Tue 17 is the weekly off), so nobody trips the 3-working-day no-shift check.
    ...["2026-11-19", "2026-11-18", "2026-11-16"].flatMap((d) =>
      ["e-on", "e-late"].map((id) => ({ employee_id: id, date: d, shift_start_at: IST(`${d}T10:30:00`), shift_end_at: IST(`${d}T18:35:00`), attendance_type: "FULL_DAY" }))
    )
  ];
  state.attendanceRows = [
    { employee_id: "e-on", date: "2026-11-20", shift_start_at: IST("2026-11-20T10:31:00") },
    { employee_id: "e-late", date: "2026-11-20", shift_start_at: IST("2026-11-20T10:52:00") },
    ...["2026-11-19", "2026-11-18", "2026-11-16"].flatMap((d) => ["e-on", "e-late"].map((id) => ({ employee_id: id, date: d, shift_start_at: IST(`${d}T10:30:00`) })))
  ];
  state.leave = [{ employee_id: "e-leave", start_date: "2026-11-18", end_date: "2026-11-24" }];
  state.cqAll = { estimated: false, employees: [{ employee_id: "e-on", by_card_type: { LEAD: { dial_clicks: 40, genuine_score: 86 }, DATA: { dial_clicks: 0, genuine_score: null } } }] };
  state.clicks = [{ clicked_at: iso(NOW - 10 * MIN), click_type: "CALL" }, { clicked_at: iso(NOW - DAY - 10 * MIN), click_type: "CALL" }];
  state.activities = [{ created_at: iso(NOW - 12 * MIN), activity_type: "STATUS_UPDATE" }];
  state.recycles = [iso(NOW - 30 * MIN)];
  state.visits = [{ created_at: iso(NOW - 50 * MIN), event_type: "VISIT" }];
}

function needsAction() {
  state.heartbeats[0].last_succeeded_at = iso(NOW - 35 * MIN); // sweep late: red
  state.anomalyRows = [{ source: "page:/leads", severity: "warning" }];
  state.transfers = [{ id: "t1" }];
}

async function settled(page: Page) {
  await expect(page.getByTestId("admin-refresh")).toHaveText("Refresh");
  await expect(page.locator("[data-testid=admin-home-a1] [data-skeleton]")).toHaveCount(0);
  await page.waitForTimeout(300);
}

async function axe(page: Page) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async () => {
    const w = window as unknown as { axe: { run: (c: Element, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } };
    const res = await w.axe.run(document.querySelector('[data-testid="admin-home-a1"]') as Element, { runOnly: { type: "rule", values: ["color-contrast", "target-size"] } });
    return res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 4).join(", ")}`);
  });
}

for (const role of ["admin", "super_admin"] as const) {
  test(`All clear (${role}): calm sentence, every card loaded, axe clean`, async ({ page, context }, info) => {
    await setup(context, page, role);
    await page.goto("/admin");
    await settled(page);
    await expect(page.getByTestId("admin-all-clear")).toBeVisible();
    await expect(page.getByTestId("admin-needs-live")).toHaveAttribute("aria-live", "polite");
    expect(await axe(page)).toEqual([]);
    await page.screenshot({ path: `${SHOTS}/a5-all-clear-${role}-${info.project.name}.png`, fullPage: true });
  });

  test(`Needs action (${role}): worst first, announced, axe clean`, async ({ page, context }, info) => {
    await setup(context, page, role);
    needsAction();
    await page.goto("/admin");
    await settled(page);
    const rows = page.getByTestId("admin-needs-live").locator("li a");
    await expect(rows.first()).toHaveAttribute("data-severity", "critical");
    const sev = await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-severity")));
    const rank: Record<string, number> = { critical: 0, warning: 1, info: 2, ok: 3 };
    expect(sev.map((s) => rank[s ?? "ok"])).toEqual([...sev.map((s) => rank[s ?? "ok"])].sort((a, b) => a - b));
    expect(await axe(page)).toEqual([]);
    await page.screenshot({ path: `${SHOTS}/a5-needs-action-${role}-${info.project.name}.png`, fullPage: true });
  });
}

test("errors: each failed card says what failed + Retry; the rest still shows", async ({ page, context }, info) => {
  await setup(context, page);
  for (const t of ["cron_heartbeats", "contact_click_log", "lead_guard_events", "site_visits"]) state.fail.add(t);
  await page.goto("/admin");
  for (const id of ["admin-retry-system", "admin-retry-today", "admin-retry-engine", "admin-retry-sales"]) await expect(page.getByTestId(id)).toBeVisible();
  await expect(page.getByTestId("admin-partial")).toBeVisible();
  await expect(page.getByTestId("admin-team-state-e-late").locator("visible=true")).toBeVisible();
  await expect(page.getByTestId("admin-control-auto_junk_enabled")).toBeVisible();
  expect((await page.getByTestId("admin-retry-today").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await page.waitForTimeout(300);
  expect(await axe(page)).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/a5-errors-${info.project.name}.png`, fullPage: true });
});

test("loading: the shell (date, Updated, Refresh) shows at once, cards show skeletons, Refresh says Refreshing…", async ({ page, context }, info) => {
  await setup(context, page);
  await page.route("**/rest/v1/**", async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (!/\/(employees|lead_engine_settings)$/.test(p)) await new Promise((r) => setTimeout(r, 4000));
    await route.fallback();
  });
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Today at a glance" })).toBeVisible();
  await expect(page.getByTestId("admin-refresh")).toHaveText("Refreshing…");
  await expect(page.locator("[data-testid=admin-home-a1] [data-skeleton]").first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/a5-loading-${info.project.name}.png`, fullPage: true });
  await expect(page.getByTestId("admin-refresh")).toHaveText("Refresh", { timeout: 15000 });
});

test("keyboard: Refresh -> Needs action rows (worst first) -> System health; the focus ring shows", async ({ page, context, browserName }) => {
  // Playwright's WebKit on Windows moves Tab between form controls only and ignores Option+Tab, so there the order is
  // read from the page (links and buttons in document order = the order Safari's "highlight each item" Tab follows).
  await setup(context, page);
  needsAction();
  await page.goto("/admin");
  await settled(page);
  await page.getByTestId("admin-refresh").focus();
  const order: string[] = [];
  const rowCount = await page.getByTestId("admin-needs-live").locator("li a").count();
  if (browserName === "webkit") {
    const all = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="admin-home-a1"] a[href], [data-testid="admin-home-a1"] button')].map((el) => el.getAttribute("data-testid") || el.textContent?.trim() || "")
    );
    order.push(...all.slice(all.indexOf("admin-refresh") + 1, all.indexOf("admin-refresh") + 2 + rowCount));
    await page.getByTestId(order[rowCount] === "System health ›" ? "admin-system" : "admin-refresh").getByRole("link").first().focus();
  } else {
    for (let i = 0; i < rowCount + 1; i++) {
      await page.keyboard.press("Tab");
      order.push(await page.evaluate(() => {
        const el = document.activeElement;
        return el?.getAttribute("data-testid") || el?.textContent?.trim() || "";
      }));
    }
  }
  expect(order[0]).toBe("admin-row-hb:recycle-stale-leads");
  expect(order.slice(0, rowCount)).toEqual(await page.getByTestId("admin-needs-live").locator("li a").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid") || "")));
  expect(order[rowCount]).toBe("System health ›");
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement as Element).outlineStyle);
  expect(outline).not.toBe("none");
});

test("read load: count every read on open, how many at once, none repeating on a timer", async ({ page, context }, info) => {
  await setup(context, page);
  const reads: { path: string; at: number; done?: number }[] = [];
  const open = new Map<string, { path: string; at: number; done?: number }>();
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith("/rest/v1/")) return;
    const rec = { path: `${r.method()} ${u.pathname.replace("/rest/v1/", "")}`, at: Date.now() };
    reads.push(rec);
    open.set(r.url() + r.method() + reads.length, rec);
    (r as unknown as { _rec: typeof rec })._rec = rec;
  });
  page.on("requestfinished", (r) => {
    const rec = (r as unknown as { _rec?: { done?: number } })._rec;
    if (rec) rec.done = Date.now();
  });
  const t0 = Date.now();
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Today at a glance" })).toBeVisible();
  const shellMs = Date.now() - t0;
  await settled(page);
  const onOpen = reads.length;
  // React dev StrictMode runs effects twice in development; production reads once. Count distinct reads too.
  const distinct = new Set(reads.map((r) => r.path)).size;
  let peak = 0;
  for (const r of reads) peak = Math.max(peak, reads.filter((x) => x.at <= r.at && (x.done ?? Infinity) > r.at).length);
  await page.waitForTimeout(7000);
  const later = reads.length - onOpen;
  const byTable: Record<string, number> = {};
  for (const r of reads) byTable[r.path] = (byTable[r.path] ?? 0) + 1;
  console.log(`A5 read load [${info.project.name}]: shell ${shellMs} ms; ${onOpen} reads on open (${distinct} distinct method+table), peak ${peak} at once; ${later} in the next 7 s`);
  console.log(`A5 reads by table: ${JSON.stringify(byTable)}`);
  expect(later).toBe(0);
  expect(reads.some((r) => r.path.includes("rpc/get_positive_junk_leads"))).toBe(false);
  expect(reads.some((r) => r.path.includes("current_owner_id"))).toBe(false);
});
