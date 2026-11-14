import type { BrowserContext, Route } from "@playwright/test";

// A fake Supabase for the call-return tests. Answers every request to https://fake-supabase.test (the URL the test
// server is started with), so the real database is never touched. Keeps a little state: the call tap marks the lead
// as called (so the "New" filter would drop it) and saved results / anomaly rows are recorded for the asserts.

export const FAKE_SUPABASE = "https://fake-supabase.test";
export const UID = "00000000-0000-4000-8000-0000000000a1";
export const EMP = "00000000-0000-4000-8000-0000000000e1";

function fakeJwt(): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: UID, role: "authenticated", exp: 4102444800 })}.sig`;
}

export const SESSION = {
  access_token: fakeJwt(),
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 4102444800,
  refresh_token: "fake-refresh",
  user: { id: UID, aud: "authenticated", role: "authenticated", email: "tester@example.test", app_metadata: {}, user_metadata: {} }
};

const pad = (n: number) => String(n).padStart(2, "0");

function makeLeads(type: "LEAD" | "DATA", count: number) {
  const base = Date.parse("2026-11-10T05:00:00Z");
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    const assigned = new Date(base - n * 60_000).toISOString();
    const prefix = type === "LEAD" ? "lead" : "data";
    return {
      id: `${prefix}-${pad(n)}`,
      name: `${type === "LEAD" ? "Test Lead" : "Test Data"} ${pad(n)}`,
      mobile: `90000000${pad(n)}`,
      project: "Test Project",
      source: "Test Source",
      catcher_name: null,
      status: "NEW" as string,
      priority: "warm",
      board_stage: "LEADS",
      sla_deadline: null,
      recycle_count: 0,
      created_at: assigned,
      is_personal_lead: false,
      lead_type: type,
      lead_history: [
        {
          id: `h-${prefix}-${pad(n)}`,
          call_count: 0,
          outcome_at: null,
          assigned_at: assigned,
          first_call_at: null as string | null,
          first_whatsapp_at: null,
          assigned_by_type: "SYSTEM",
          reassign_note: null,
          recycle_reason: null,
          recycled_from_status: null,
          recycled_from_stage: null,
          last_activity_at: assigned,
          last_call_click_at: null as string | null,
          paused_until: null,
          pause_reason: null,
          pause_note: null,
          pause_verified_at: null,
          assigned_by: null,
          pause_verified_by: null
        }
      ]
    };
  });
}

// Settings rows the pages read on load (times and switches only; no real ids or locations).
const LEAD_ENGINE_SETTINGS = {
  id: 1, auto_junk_enabled: true, auto_recycle_enabled: true, call_quality_enforced: false, call_quality_share_line: true,
  call_quality_visible_to_employees: false, distribution_guard_mode: "shadow", first_half_min_end_time: "13:30:00",
  first_half_start_time: "10:30:00", first_half_start_window_end: "11:30:00", geofence_radius_meters: 100,
  given_lead_context_mode: "off", given_lead_context_pilot_ids: [], half_day_boundary_time: "13:00:00",
  office_lat: 0, office_lng: 0, positive_junk_guard_mode: "enforce", reminder_hold_mode: "shadow", reminder_hold_max_days: 30,
  restore_hold_mode: "enforce", second_half_min_end_time: "18:30:00", second_half_start_window_end: "15:00:00",
  shift_day_end_time: "18:30:00", sla_first_contact_minutes: 1440, sla_office_end_time: "18:30:00",
  sla_office_start_time: "11:00:00", sla_weekly_off_day: 2, start_shift_grace_minutes: 30, working_days_timers_enabled: true
};
const HRMS_SETTINGS = { id: 1, first_half_ontime_cutoff: "10:35:00", second_half_ontime_cutoff: "13:30:00" };

export interface MockState {
  leads: ReturnType<typeof makeLeads>;
  data: ReturnType<typeof makeLeads>;
  anomalies: { source: string; severity: string; message: string; context: Record<string, unknown> | null }[];
  updates: { p_lead_id: string; p_new_status: string | null }[];
  // Network failure switches (result-save tests): abort the next N saves; or save, then lose the answer.
  failUpdates: number;
  landThenLose: number;
}

export async function mockSupabase(context: BrowserContext): Promise<MockState> {
  const state: MockState = { leads: makeLeads("LEAD", 60), data: makeLeads("DATA", 40), anomalies: [], updates: [], failUpdates: 0, landThenLose: 0 };
  const employee = { id: EMP, auth_user_id: UID, name: "Test Employee", role: "employee", department: "sales", is_active: true, team_id: null };

  const json = (route: Route, body: unknown, status = 200, headers: Record<string, string> = {}) =>
    route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "content-range": "0-0/0", ...headers }, body: JSON.stringify(body) });

  await context.route(`${FAKE_SUPABASE}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const method = req.method();
    const wantsObject = (req.headers()["accept"] || "").includes("vnd.pgrst.object");

    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (p.startsWith("/auth/v1/user")) return json(route, SESSION.user);
    if (p.startsWith("/auth/v1/token")) return json(route, SESSION);
    if (p.startsWith("/auth/v1/logout")) return json(route, {});
    if (p.startsWith("/auth/v1")) return json(route, {});

    if (p === "/rest/v1/employees") return json(route, wantsObject ? employee : [employee]);
    if (p === "/rest/v1/lead_engine_settings") return json(route, wantsObject ? LEAD_ENGINE_SETTINGS : [LEAD_ENGINE_SETTINGS]);
    if (p === "/rest/v1/hrms_settings") return json(route, wantsObject ? HRMS_SETTINGS : [HRMS_SETTINGS]);
    if (p === "/rest/v1/leads" && method === "GET") {
      const type = url.searchParams.get("lead_type");
      if (type === "eq.LEAD") return json(route, state.leads);
      if (type === "eq.DATA") return json(route, state.data);
      return json(route, wantsObject ? {} : []);
    }
    if (p === "/rest/v1/system_anomaly_log" && method === "POST") {
      try {
        const body = JSON.parse(req.postData() || "{}");
        for (const row of Array.isArray(body) ? body : [body]) state.anomalies.push(row);
      } catch {
        // ignore
      }
      return route.fulfill({ status: 201, headers: { "access-control-allow-origin": "*" }, body: "" });
    }
    if (p === "/rest/v1/rpc/log_call_click_atomic") {
      const { p_lead_history_id } = JSON.parse(req.postData() || "{}");
      for (const lead of [...state.leads, ...state.data]) {
        const h = lead.lead_history[0];
        if (h.id === p_lead_history_id) {
          const now = new Date().toISOString();
          h.call_count += 1;
          h.first_call_at = h.first_call_at || now;
          h.last_call_click_at = now;
          h.last_activity_at = now;
        }
      }
      return json(route, "00000000-0000-4000-8000-00000000c111");
    }
    if (p === "/rest/v1/rpc/log_lead_update_atomic") {
      const body = JSON.parse(req.postData() || "{}");
      if (state.failUpdates > 0) {
        state.failUpdates -= 1;
        return route.abort("failed");
      }
      state.updates.push({ p_lead_id: body.p_lead_id, p_new_status: body.p_new_status ?? null });
      for (const lead of [...state.leads, ...state.data]) {
        if (lead.id === body.p_lead_id && body.p_new_status) {
          lead.status = body.p_new_status;
          const h = lead.lead_history[0] as { outcome?: string | null; outcome_at?: string | null };
          h.outcome = body.p_new_status;
          h.outcome_at = new Date().toISOString();
        }
      }
      if (state.landThenLose > 0) {
        state.landThenLose -= 1;
        return route.abort("failed");
      }
      return json(route, null);
    }
    if (p === "/rest/v1/rpc/get_working_calendar") return json(route, { timezone: "Asia/Kolkata", weekly_off_day: 2, ranges: [], timers_enabled: true });
    if (p.startsWith("/rest/v1/rpc/")) return json(route, wantsObject ? {} : []);
    if (p === "/rest/v1/lead_history" && method === "GET") {
      const id = (url.searchParams.get("id") || "").replace(/^eq\./, "");
      const h = [...state.leads, ...state.data].map((l) => l.lead_history[0] as { id: string; outcome?: string | null; outcome_at?: string | null }).find((x) => x.id === id);
      const row = h ? { outcome: h.outcome ?? null, outcome_at: h.outcome_at ?? null } : null;
      return json(route, wantsObject ? row : row ? [row] : []);
    }
    if (p.startsWith("/rest/v1/")) {
      if (method === "HEAD") return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-range": "0-0/0" } });
      if (method !== "GET") return route.fulfill({ status: 201, headers: { "access-control-allow-origin": "*" }, body: "" });
      return json(route, wantsObject ? {} : []);
    }
    if (p.startsWith("/realtime/")) return route.abort();
    return json(route, {});
  });

  // The app's own API routes would reach the real database through the server: never call them in this test.
  await context.route("**/api/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));

  // Logged in, page visibility under the test's control, and a tap on a tel: link does not leave the page.
  await context.addInitScript(
    ({ key, session }) => {
      try {
        localStorage.setItem(key, JSON.stringify(session));
      } catch {
        // ignore
      }
      const w = window as unknown as { __vis?: string };
      Object.defineProperty(Document.prototype, "visibilityState", { configurable: true, get: () => w.__vis || "visible" });
      Object.defineProperty(Document.prototype, "hidden", { configurable: true, get: () => (w.__vis || "visible") === "hidden" });
      document.addEventListener(
        "click",
        (e) => {
          const a = (e.target as Element | null)?.closest?.('a[href^="tel:"]');
          if (a) e.preventDefault();
        },
        true
      );
    },
    { key: "sb-fake-supabase-auth-token", session: SESSION }
  );

  return state;
}
