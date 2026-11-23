import { expect, type BrowserContext, type Page } from "@playwright/test";
import { EMP, FAKE_SUPABASE, UID, mockSupabase, type MockState } from "./mockSupabase";

// Shared fake data for the Performance Report specs (admin-perf-report, admin-perf-reassign). Fake Supabase answers the
// report RPCs (v3, v2, v1) with a fixed report (counts already per definitions v1; the SQL itself is tested in PGlite)
// and the "give leads" RPCs with simple known answers. Nothing reaches a real database.

export const SHOTS = "C:/work/reports/perf_report_simple/build";
export const A = "00000000-0000-4000-8000-0000000000a1", B = "00000000-0000-4000-8000-0000000000a2", C = "00000000-0000-4000-8000-0000000000a3";
export const D = "00000000-0000-4000-8000-0000000000a4";
export type Row = Record<string, unknown>;
export const row = (o: Row): Row => ({
  leads: 0, stints: 0, fresh: 0, recycled: 0, restored: 0, admin_given: 0, other: 0, came_fresh: 0, came_recycled: 0, came_data: 0, came_restored: 0,
  came_admin_given: 0, came_other: 0, recycled_any: 0, followup: 0, visit: 0, visit_verified: 0, booked: 0, converted: 0, details_est: 0,
  not_connected: 0, not_interested: 0, no_result: 0, calls: 0, connected: 0, status_mix: {}, stage_mix: {}, ...o
});
const EMPS: Row[] = [
  { employee_id: A, name: "Employee A", active: true, ...row({ leads: 400, stints: 420, fresh: 60, recycled: 330, restored: 6, admin_given: 4, came_fresh: 50, came_recycled: 230, came_data: 100, came_restored: 6, came_admin_given: 4, came_other: 10,
    recycled_any: 300, followup: 30, visit: 6, visit_verified: 4, booked: 1, converted: 3, details_est: 5, not_connected: 160, not_interested: 70, no_result: 120, connected: 120,
    status_mix: { NOT_CONNECTED: 150, SWITCHED_OFF: 10, NOT_INTERESTED: 70, CONNECTED: 35, CONVERTED: 3, NO_RESULT: 120, CALLBACK_LATER: 12 },
    stage_mix: { LEADS: 360, FOLLOW_UP: 30, VISIT: 5, BOOKING: 1, NEGOTIATION: 4 } }) },
  { employee_id: B, name: "Employee B", active: false, ...row({ leads: 250, stints: 260, fresh: 40, recycled: 200, restored: 2, admin_given: 8, came_fresh: 40, came_recycled: 150, came_data: 50, came_restored: 2, came_admin_given: 8,
    recycled_any: 180, followup: 12, visit: 2, visit_verified: 2, converted: 1, details_est: 2, not_connected: 90, not_interested: 40, no_result: 100, connected: 70,
    status_mix: { NOT_CONNECTED: 90, NOT_INTERESTED: 40, CONNECTED: 19, CONVERTED: 1, NO_RESULT: 100 }, stage_mix: { LEADS: 236, FOLLOW_UP: 12, VISIT: 2 } }) },
  { employee_id: C, name: "Employee C", active: true, ...row({}) }
];
const ES: Row[] = [
  { employee_id: A, source: "99acres", ...row({ leads: 300, came_fresh: 40, came_recycled: 180, came_data: 70, came_restored: 4, came_admin_given: 2, came_other: 4, followup: 25, visit: 5, converted: 2, details_est: 4, not_connected: 120, not_interested: 50, connected: 90 }) },
  { employee_id: A, source: "Meta", ...row({ leads: 100, came_fresh: 10, came_recycled: 50, came_data: 30, came_restored: 2, came_admin_given: 2, came_other: 6, followup: 5, visit: 1, converted: 1, details_est: 1, not_connected: 40, not_interested: 20, connected: 30 }) },
  { employee_id: B, source: "99acres", ...row({ leads: 250, came_fresh: 40, came_recycled: 150, came_data: 50, came_restored: 2, came_admin_given: 8, followup: 12, visit: 2, converted: 1, details_est: 2, not_connected: 90, not_interested: 40, connected: 70 }) }
];
const EO: Row[] = [
  { employee_id: A, origin: "FRESH", ...row({ leads: 50, followup: 5, visit: 2, connected: 20, not_connected: 20 }) },
  { employee_id: A, origin: "RECYCLED", ...row({ leads: 230, followup: 20, visit: 3, connected: 80, converted: 2, not_connected: 100 }) },
  { employee_id: A, origin: "OTHER", ...row({ leads: 120, followup: 5, visit: 1, connected: 20, converted: 1, not_connected: 40 }) },
  { employee_id: B, origin: "RECYCLED", ...row({ leads: 250, followup: 12, visit: 2, connected: 70, converted: 1, not_connected: 90 }) }
];
export function report(filters: Row, api: 1 | 2 | 3) {
  const pick = filters.employee_ids as string[] | undefined;
  const by_employee = pick ? EMPS.filter((e) => pick.includes(String(e.employee_id))) : EMPS;
  const sum = (k: string) => by_employee.reduce((a, e) => a + Number(e[k] ?? 0), 0);
  const mix = (f: string) => by_employee.reduce((a: Record<string, number>, e) => { for (const [k, v] of Object.entries(e[f] as Record<string, number>)) a[k] = (a[k] ?? 0) + v; return a; }, {});
  const totals = row({ ...Object.fromEntries(Object.keys(row({})).filter((k) => !k.endsWith("_mix")).map((k) => [k, sum(k)])), leads: pick ? sum("leads") : 600, status_mix: mix("status_mix"), stage_mix: mix("stage_mix") });
  if (api < 3) delete totals.connected;
  const out: Row = {
    def_version: 1, as_of: "2026-11-20T09:37:00Z", from: "2026-10-01", to: "2026-10-31", totals, by_employee: by_employee.map((e) => ({ ...e, ...(api < 3 ? { connected: undefined } : {}) })),
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
      { key: "status_mix", label: "Status mix", rule: "The last result of each lead’s latest assignment in the range." },
      { key: "connected", label: "Connected", rule: "The client was reached during the assignment: a result Connected, Converted or Not interested was saved, or the lead moved to Follow-up, or had a visit. Based on saved results." }
    ]
  };
  if (api >= 2) Object.assign(out, { api, today: "2026-11-23", data_since: "2026-08-17", max_days: 800, by_emp_source: pick ? ES.filter((x) => pick.includes(String(x.employee_id))) : ES });
  if (api >= 3) {
    out.by_emp_origin = pick ? EO.filter((x) => pick.includes(String(x.employee_id))) : EO;
    delete out.by_employee_type; // like the real v3 answer (2026-11-23 production error: More details crashed on it)
  }
  return out;
}

export interface Ctx { state: MockState; calls: { rpc: string; body: Row; url: string }[] }
export interface OpenOpts {
  flag?: "on" | "off" | "missing"; reassign?: "on" | "off"; role?: "admin" | "super_admin"; fail?: boolean; api?: 1 | 2 | 3; goto?: string;
  receiverProblem?: string | null; oldBatch?: boolean;
}
const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });

export async function openReport(context: BrowserContext, page: Page, opts: OpenOpts = {}): Promise<Ctx> {
  const ctx: Ctx = { state: await mockSupabase(context), calls: [] };
  const admin = { id: EMP, auth_user_id: UID, name: "Test Admin", role: opts.role ?? "admin", department: null, is_active: true, team_id: null };
  const sales = [{ id: A, name: "Employee A" }, { id: C, name: "Employee C" }, { id: D, name: "Employee D" }];
  const settings: Row = { id: 1, auto_junk_enabled: true };
  if ((opts.flag ?? "on") !== "missing") settings.admin_report_mode = opts.flag ?? "on";
  if (opts.reassign) settings.admin_report_reassign_mode = opts.reassign;
  const api = opts.api ?? 3;
  await context.route(`${FAKE_SUPABASE}/rest/v1/employees**`, (r) => {
    const url = r.request().url();
    if (url.includes("department=eq.sales")) return r.fulfill(json(sales));
    return r.fulfill(json((r.request().headers()["accept"] || "").includes("object") ? admin : [admin]));
  });
  await context.route(`${FAKE_SUPABASE}/rest/v1/lead_engine_settings**`, (r) => r.fulfill(json((r.request().headers()["accept"] || "").includes("object") ? settings : [settings])));
  let failLeft = opts.fail ? 2 : 0; // the first load (twice under React dev StrictMode) fails
  const version = (rpc: string) => (rpc.endsWith("_v3") ? 3 : rpc.endsWith("_v2") ? 2 : 1);
  let batchSeq = 0;
  await context.route(`${FAKE_SUPABASE}/rest/v1/rpc/*`, async (r) => {
    const url = r.request().url();
    const rpc = new URL(url).pathname.split("/").pop() as string;
    const body = JSON.parse(r.request().postData() || "{}");
    ctx.calls.push({ rpc, body, url });
    if (rpc.startsWith("get_perf_report")) {
      if (version(rpc) > api) return r.fulfill(json({ code: "PGRST202", message: `Could not find the function public.${rpc}` }, 404));
      if (rpc.startsWith("get_perf_report_leads")) {
        const total = body.p_metric === "visit" ? 450 : 3;
        const rows = Array.from({ length: Math.max(0, Math.min(body.p_limit, total - body.p_offset)) }, (_, i) => {
          const k = body.p_offset + i;
          return {
            stint_id: `s${k}`, lead_id: `00000000-0000-4000-9000-${String(k).padStart(12, "0")}`, lead_name: `Lead ${1000 + k}`, employee_id: A, employee_name: "Employee A",
            source: "99acres", project: "P1", lead_type: "LEAD", origin: i % 2 ? "RECYCLED" : "FRESH", assigned_at: "2026-10-12T05:00:00Z",
            last_result: ["NOT_CONNECTED", "CONNECTED", "CALLBACK_LATER"][i % 3], last_stage: i % 2 ? "VISIT" : "LEADS",
            ...(version(rpc) >= 3 ? { current_owner_id: k % 5 === 4 ? B : A, current_owner_name: k % 5 === 4 ? "Employee B" : "Employee A", positive: k % 3 === 1, available: true } : {})
          };
        });
        return r.fulfill(json({ metric: body.p_metric, total, rows }));
      }
      if (failLeft > 0) { failLeft--; return r.fulfill(json({ message: "fake failure" }, 500)); }
      return r.fulfill(json(report(body.p_filters ?? {}, version(rpc) as 1 | 2 | 3)));
    }
    if (rpc === "get_lead_journey")
      return r.fulfill(json({ lead_id: body.p_lead_id, stints: [
        { stint_id: "h1", employee_id: B, employee_name: "Employee B", assigned_at: "2026-10-03T05:00:00Z", ended_at: "2026-10-09T05:00:00Z", active: false, origin: "FRESH", followup: false, visit: false, converted: false, connected: false, result: "NOT_CONNECTED" },
        { stint_id: "h2", employee_id: A, employee_name: "Employee A", assigned_at: "2026-10-09T05:00:00Z", ended_at: "2026-10-24T05:00:00Z", active: false, origin: "RECYCLED", followup: true, visit: false, converted: false, connected: true, result: "NOT_INTERESTED" },
        { stint_id: "h3", employee_id: D, employee_name: "Employee D", assigned_at: "2026-10-24T05:00:00Z", ended_at: null, active: true, origin: "ADMIN_GIVEN", followup: true, visit: true, converted: false, connected: true, result: "CONNECTED" }
      ] }));
    if (rpc === "get_lead_report_batches")
      return r.fulfill(json({ lead_id: body.p_lead_id, batches: [{ batch_id: "b0000001-0000-4000-8000-000000000001", at: "2026-10-24T05:00:00Z", mode: "give", label: "Oct visits to D", reason: "No visits in 3 weeks", from_name: "Employee A", to_name: "Employee D", status: "moved", skip_reason: null, new_stint_id: "h3" }] }));
    if (rpc === "admin_report_reassign_preview") {
      const items = body.p_items as { lead_id: string; expected_owner: string }[];
      // Same order as the SQL: owner changed first, then positive (lead number k: positive when k % 3 === 1).
      const k = (x: { lead_id: string }) => Number(x.lead_id.slice(-12));
      const stale = items.filter((x) => x.expected_owner === B).length;
      const pos = items.filter((x) => x.expected_owner !== B && k(x) % 3 === 1).length;
      const from: Record<string, number> = {};
      for (const x of items) from[x.expected_owner] = (from[x.expected_owner] ?? 0) + 1;
      return r.fulfill(json({ requested: items.length, will_move: opts.receiverProblem ? 0 : items.length - (body.p_include_positive ? 0 : pos) - stale,
        positive_included: body.p_include_positive ? pos : 0, positive_excluded: body.p_include_positive ? 0 : pos,
        skipped: { ...(stale ? { "owner changed since the list was opened": stale } : {}), ...(!body.p_include_positive && pos ? { "positive lead (excluded)": pos } : {}) },
        from, receiver_problem: opts.receiverProblem ?? null }));
    }
    if (rpc === "admin_reassign_leads_from_report") {
      const items = body.p_items as unknown[];
      batchSeq++;
      return r.fulfill(json({ batch_id: `b${String(batchSeq).padStart(7, "0")}-0000-4000-8000-000000000000`, requested: items.length, moved: items.length - 1, skipped: 1,
        skipped_breakdown: { "owner changed since the list was opened": 1 }, results: [] }));
    }
    if (rpc === "get_report_batches")
      return r.fulfill(json([{ batch_id: "b0000001-0000-4000-8000-000000000001", created_at: "2026-10-24T05:00:00Z", mode: "give", label: "Oct visits to D", reason: "No visits in 3 weeks",
        to_employee_id: D, to_name: "Employee D", from_employee_ids: [A], moved: 9, skipped: 2, undo_of: null, undone_by: null, by_name: "Test Admin" }]));
    if (rpc === "get_report_batch_outcome")
      return r.fulfill(json({ batch: { batch_id: body.p_batch_id, created_at: new Date(Date.now() - (opts.oldBatch ? 8 : 1) * 86400e3).toISOString(), mode: "give", label: "Oct visits to D", reason: "No visits in 3 weeks", to_employee_id: D, to_name: "Employee D",
        from_employee_ids: [A], from_names: ["Employee A"], moved: 9, skipped: 2, skipped_breakdown: { "positive lead (excluded)": 2 }, undo_of: null, undone_by: null },
        before: { leads: 9, followup: 0, visit: 0, connected: 1, converted: 0, no_result: 8 }, after: { leads: 9, followup: 3, visit: 2, connected: 6, converted: 1, no_result: 2 }, leads: [] }));
    if (rpc === "admin_undo_report_batch")
      return r.fulfill(json({ batch_id: "u0000001-0000-4000-8000-000000000000", undo_of: body.p_batch_id, requested: 9, moved: 4, skipped: 5, skipped_breakdown: { "the new owner already worked on it": 5 } }));
    return r.fulfill(json({ message: `unexpected rpc ${rpc}` }, 500));
  });
  // The Next.js dev overlay badge (dev server only, never in production) can sit over the sticky action bar on a phone.
  await page.addInitScript(() => {
    const st = document.createElement("style");
    st.textContent = "nextjs-portal { display: none !important; }";
    document.documentElement.appendChild(st);
  });
  await page.goto(opts.goto ?? "/admin/performance-report");
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; pointer-events: none !important; }" });
  return ctx;
}
export const reportCalls = (c: Ctx) => c.calls.filter((x) => /^get_perf_report(_v\d)?$/.test(x.rpc)).length;
export const drillCalls = (c: Ctx) => c.calls.filter((x) => x.rpc.startsWith("get_perf_report_leads"));
export const desktop = (info: { project: { name: string } }) => info.project.name === "desktop-chromium";
export async function readDownload(page: Page, click: () => Promise<void>) {
  const [dl] = await Promise.all([page.waitForEvent("download"), click()]);
  const s = await dl.createReadStream();
  const text = await new Promise<string>((resolve) => { let out = ""; s.on("data", (c) => (out += c)); s.on("end", () => resolve(out)); });
  return { name: dl.suggestedFilename(), text };
}
export async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}
export const total = (page: Page, info: { project: { name: string } }) =>
  desktop(info) ? page.getByTestId("perf-main-total") : page.getByTestId("perf-main-card-total");
