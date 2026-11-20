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
  // Admin Home A1: the settings row and the logged-in employee (tests may change role), the staff list returned to
  // list reads of employees, and the Admin Home tables. fail = tables that answer 500.
  settings: Record<string, unknown>;
  employee: Record<string, unknown>;
  staff: Record<string, unknown>[] | null;
  heartbeats: { function_name: string; max_silence_minutes: number; last_succeeded_at: string | null }[];
  backups: { run_at: string; status: string }[];
  anomalyRows: { source: string; severity: string }[];
  transfers: { id: string }[];
  empRequests: { id: string }[];
  attendanceRows: { employee_id: string; date: string }[] | null;
  joins: { employee_id: string; date_of_joining: string | null }[];
  leave: { employee_id: string; start_date: string; end_date: string | null }[];
  settingsDelayMs: number;
  fail: Set<string>;
  // Admin Home A2: rows behind the count-only reads, today's attendance by date, the all-employee Call Quality summary
  // and the workload rows (leads of the team with their assignments).
  clicks: { clicked_at: string; click_type: string }[];
  activities: { created_at: string; activity_type: string }[];
  bookings: { board_stage_changed_at: string }[];
  attendanceByDate: { employee_id: string; date: string; shift_start_at: string | null; shift_end_at: string | null; attendance_type: string | null }[] | null;
  cqAll: Record<string, unknown> | null;
  workloadLeads: Record<string, unknown>[];
  // Admin Home A3: system recycles (assigned_at), guard events, restore log rows, the positive-junk RPC answer.
  recycles: string[];
  guardEvents: { created_at: string; source: string; action: string }[];
  restoreRows: { protected_until: string; restored_at: string | null; undone_at: string | null }[];
  positiveJunk: { rows: unknown[] } | null;
  positiveJunkCalls: number;
  // Admin Home A4: site visit events and LEAD_JUNKED notifications (per recipient) behind the count-only reads.
  visits: { created_at: string; event_type: string }[];
  junkNotes: { created_at: string; employee_id: string }[];
}

export async function mockSupabase(context: BrowserContext): Promise<MockState> {
  const employee: Record<string, unknown> = { id: EMP, auth_user_id: UID, name: "Test Employee", role: "employee", department: "sales", is_active: true, team_id: null };
  const state: MockState = {
    leads: makeLeads("LEAD", 60), data: makeLeads("DATA", 40), anomalies: [], updates: [], failUpdates: 0, landThenLose: 0,
    settings: { ...LEAD_ENGINE_SETTINGS }, employee, staff: null, heartbeats: [], backups: [], anomalyRows: [], transfers: [], empRequests: [],
    attendanceRows: null, joins: [], leave: [], settingsDelayMs: 0, fail: new Set(),
    clicks: [], activities: [], bookings: [], attendanceByDate: null, cqAll: null, workloadLeads: [],
    recycles: [], guardEvents: [], restoreRows: [], positiveJunk: null, positiveJunkCalls: 0,
    visits: [], junkNotes: []
  };

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

    const table = p.startsWith("/rest/v1/") ? p.slice("/rest/v1/".length) : "";
    if ((method === "GET" || method === "HEAD") && state.fail.has(table)) return json(route, { message: "fake failure" }, 500);
    // A2 count-only reads: count the rows whose time column is in [gte, lt).
    const between = (col: string) => {
      const vals = url.searchParams.getAll(col);
      const gte = vals.find((v) => v.startsWith("gte."))?.slice(4);
      const lt = vals.find((v) => v.startsWith("lt."))?.slice(3);
      return (t: string) => (!gte || Date.parse(t) >= Date.parse(gte)) && (!lt || Date.parse(t) < Date.parse(lt));
    };
    const headCount = (n: number) =>
      route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-expose-headers": "content-range", "content-range": n ? `0-0/${n}` : "*/0" } });
    if (method === "HEAD" && p === "/rest/v1/lead_history" && url.searchParams.get("assigned_by_type") === "eq.SYSTEM") {
      const inWin = between("assigned_at");
      return headCount(state.recycles.filter((t) => inWin(t)).length);
    }
    if (method === "HEAD" && p === "/rest/v1/site_visits") {
      const inWin = between("created_at");
      const type = (url.searchParams.get("event_type") || "").replace(/^eq./, "");
      return headCount(state.visits.filter((v) => v.event_type === type && inWin(v.created_at)).length);
    }
    if (method === "HEAD" && p === "/rest/v1/notification" && url.searchParams.get("type") === "eq.LEAD_JUNKED") {
      const inWin = between("created_at");
      const me = (url.searchParams.get("employee_id") || "").replace(/^eq./, "");
      return headCount(state.junkNotes.filter((n) => n.employee_id === me && inWin(n.created_at)).length);
    }
    if (method === "HEAD" && p === "/rest/v1/lead_guard_events") {
      const inWin = between("created_at");
      const src = (url.searchParams.get("source") || "").replace(/^eq./, "");
      return headCount(state.guardEvents.filter((g) => g.source === src && inWin(g.created_at)).length);
    }
    if (method === "GET" && p === "/rest/v1/lead_guard_events") {
      const inWin = between("created_at");
      return json(route, state.guardEvents.filter((g) => inWin(g.created_at)).map((g) => ({ source: g.source, action: g.action })));
    }
    if (method === "GET" && p === "/rest/v1/lead_restore_log") return json(route, state.restoreRows);
    if (p === "/rest/v1/rpc/get_positive_junk_leads") {
      state.positiveJunkCalls += 1;
      if (state.fail.has("rpc/get_positive_junk_leads")) return json(route, { message: "fake failure" }, 500);
      return json(route, state.positiveJunk ?? { rows: [], employees: [], max_batch: 25, protection_days: 14 });
    }
    if (method === "HEAD" && p === "/rest/v1/contact_click_log") {
      const inWin = between("clicked_at");
      return headCount(state.clicks.filter((c) => c.click_type === "CALL" && inWin(c.clicked_at)).length);
    }
    if (method === "HEAD" && p === "/rest/v1/lead_activity_log") {
      const inWin = between("created_at");
      return headCount(state.activities.filter((a) => a.activity_type === "STATUS_UPDATE" && inWin(a.created_at)).length);
    }
    if (method === "HEAD" && p === "/rest/v1/leads" && url.searchParams.get("board_stage") === "eq.BOOKING") {
      const inWin = between("board_stage_changed_at");
      return headCount(state.bookings.filter((b) => inWin(b.board_stage_changed_at)).length);
    }
    if (method === "GET" && p === "/rest/v1/attendance" && state.attendanceByDate && !wantsObject) {
      const d = url.searchParams.get("date") || "";
      const dates = d.startsWith("in.(") ? d.slice(4, -1).split(",") : d.startsWith("eq.") ? [d.slice(3)] : null;
      let rows = state.attendanceByDate.filter((r) => !dates || dates.includes(r.date));
      if (url.searchParams.get("shift_start_at") === "not.is.null") rows = rows.filter((r) => r.shift_start_at);
      return json(route, rows);
    }
    if (p === "/rest/v1/rpc/get_call_quality_summary" && state.cqAll) return json(route, state.cqAll);
    if (method === "GET" && p === "/rest/v1/leads" && (url.searchParams.get("current_owner_id") || "").startsWith("in.")) return json(route, state.workloadLeads);
    if (p === "/rest/v1/employees") {
      if (wantsObject || url.searchParams.get("auth_user_id") || !state.staff) return json(route, wantsObject ? state.employee : [state.employee]);
      return json(route, state.staff);
    }
    if (p === "/rest/v1/lead_engine_settings") {
      if (state.settingsDelayMs > 0) await new Promise((r) => setTimeout(r, state.settingsDelayMs));
      return json(route, wantsObject ? state.settings : [state.settings]).catch(() => {});
    }
    if (method === "GET" && p === "/rest/v1/cron_heartbeats") return json(route, state.heartbeats);
    if (method === "GET" && p === "/rest/v1/backup_run_log") return json(route, state.backups);
    if (method === "GET" && p === "/rest/v1/system_anomaly_log") return json(route, state.anomalyRows);
    if (method === "GET" && p === "/rest/v1/lead_transfer_requests") return json(route, state.transfers);
    if (method === "GET" && p === "/rest/v1/employee_creation_requests") return json(route, state.empRequests);
    if (method === "GET" && p === "/rest/v1/employee_payroll_details") return json(route, state.joins);
    if (method === "GET" && p === "/rest/v1/employee_leave_periods" && !wantsObject) return json(route, state.leave);
    if (method === "GET" && p === "/rest/v1/attendance" && state.attendanceRows && !wantsObject) return json(route, state.attendanceRows);
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
