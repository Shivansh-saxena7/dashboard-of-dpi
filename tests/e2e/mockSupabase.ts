import type { BrowserContext, Route } from "@playwright/test";

// Fake contact for a lead id (tests only): "Fake Lead <short id>" and a 10-digit number derived from the id.
export function fakeContact(id: string) {
  const n = parseInt(id.replace(/-/g, "").slice(-7), 16) % 1e9;
  return { lead_id: id, name: `Fake Lead ${id.slice(0, 8)}`, mobile: `9${String(n).padStart(9, "0")}` };
}

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
export const LEAD_ENGINE_SETTINGS = {
  id: 1, auto_junk_enabled: true, auto_recycle_enabled: true, call_quality_enforced: false, call_quality_share_line: true,
  call_quality_visible_to_employees: false, distribution_guard_mode: "shadow", first_half_min_end_time: "13:30:00",
  first_half_start_time: "10:30:00", first_half_start_window_end: "11:30:00", geofence_radius_meters: 100,
  given_lead_context_mode: "off", given_lead_context_pilot_ids: [], half_day_boundary_time: "13:00:00",
  office_lat: 0, office_lng: 0, positive_junk_guard_mode: "enforce", reminder_hold_mode: "shadow", reminder_hold_max_days: 30,
  restore_hold_mode: "enforce", second_half_min_end_time: "18:30:00", second_half_start_window_end: "15:00:00",
  shift_day_end_time: "18:30:00", sla_first_contact_minutes: 1440, sla_office_end_time: "18:30:00",
  sla_office_start_time: "11:00:00", sla_weekly_off_day: 2, start_shift_grace_minutes: 30, working_days_timers_enabled: true,
  // Card port (2026-11-26): CARD_MODE=on runs every list spec on the redesign card; unset = the column is missing (old card).
  ...(process.env.CARD_MODE ? { employee_card_mode: process.env.CARD_MODE } : {})
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
  // The lead_engine_settings row the app reads (tests add e.g. employee_home_mode); a copy of the default per test.
  settings: Record<string, unknown>;
  // get_employee_work_report answer; null = the generic empty answer.
  workReport: Record<string, unknown> | null;
  // Delay (ms) before lead_engine_settings answers: a slow settings read must not hold the page.
  settingsDelayMs: number;
  // lead_notes reminders the Home / ?filter=reminders-today read (Phase 2); remindersFail = answer 500.
  reminders: { lead_id: string; reminder_at: string }[];
  remindersFail: boolean;
  // The logged-in employee row (tests may set role / team_id) and leads reserved for the team (Phase 3).
  employee: Record<string, unknown>;
  teamPending: { id: string }[];
  // E6: own leave rows, get_given_lead_context answer, get_call_quality_summary answer (null = "not visible" error).
  leave: { employee_id: string; start_date: string; end_date: string | null }[];
  given: Record<string, unknown> | null;
  cq: Record<string, unknown> | null;
  // E7: own tracking rows (social posts summary).
  tracking: { ig_done: boolean; fb_done: boolean }[];
  // Admin Home A1: the settings row and the logged-in employee (tests may change role), the staff list returned to
  // list reads of employees, and the Admin Home tables. fail = tables that answer 500.
  staff: Record<string, unknown>[] | null;
  heartbeats: { function_name: string; max_silence_minutes: number; last_succeeded_at: string | null }[];
  backups: { run_at: string; status: string }[];
  anomalyRows: { source: string; severity: string }[];
  transfers: { id: string }[];
  empRequests: { id: string }[];
  attendanceRows: { employee_id: string; date: string }[] | null;
  joins: { employee_id: string; date_of_joining: string | null }[];
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
  guardRpcCalls: number;
  guardTableReads: number;
  restoreRpcCalls: number;
  restoreTableReads: number;
  contactCalls: { ids: string[]; url: string }[];
  // Admin Home A4: site visit events and LEAD_JUNKED notifications (per recipient) behind the count-only reads.
  visits: { created_at: string; event_type: string }[];
  junkNotes: { created_at: string; employee_id: string }[];
}

export async function mockSupabase(context: BrowserContext): Promise<MockState> {
  // CARD_MODE=on/off: the browser session already remembers the card choice (as after the first load), so list specs run
  // on that card from the first paint. The switch itself is tested in card-flag-swap.spec.ts.
  if (process.env.CARD_MODE) {
    const on = process.env.CARD_MODE === "on";
    await context.addInitScript(([key, on]) => {
      try { sessionStorage.setItem(key as string, JSON.stringify({ on, at: Date.now() })); } catch { /* ignore */ }
    }, [`employee-card-mode:v1:${EMP}`, on] as const);
  }
  const employee: Record<string, unknown> = { id: EMP, auth_user_id: UID, name: "Test Employee", role: "employee", department: "sales", is_active: true, team_id: null };
  const state: MockState = { leads: makeLeads("LEAD", 60), data: makeLeads("DATA", 40), anomalies: [], updates: [], failUpdates: 0, landThenLose: 0, settings: { ...LEAD_ENGINE_SETTINGS }, workReport: null, settingsDelayMs: 0, reminders: [], remindersFail: false, employee, teamPending: [], leave: [], given: null, cq: null, tracking: [],
    staff: null, heartbeats: [], backups: [], anomalyRows: [], transfers: [], empRequests: [], attendanceRows: null, joins: [], fail: new Set(),
    clicks: [], activities: [], bookings: [], attendanceByDate: null, cqAll: null, workloadLeads: [],
    recycles: [], guardEvents: [], restoreRows: [], positiveJunk: null, positiveJunkCalls: 0, guardRpcCalls: 0, guardTableReads: 0, restoreRpcCalls: 0, restoreTableReads: 0, contactCalls: [], visits: [], junkNotes: []
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
    // Live: lead_guard_events has no client grant, so a direct read is refused (42501), exactly like production.
    if (p === "/rest/v1/lead_guard_events") {
      state.guardTableReads += 1;
      return json(route, { code: "42501", message: "permission denied for table lead_guard_events", details: null, hint: null }, 403);
    }
    // 2026-11-28: admins read guard counts through get_admin_guard_event_counts(p_from, p_to) (is_admin() inside).
    if (p === "/rest/v1/rpc/get_admin_guard_event_counts") {
      state.guardRpcCalls += 1;
      if (state.fail.has("rpc/get_admin_guard_event_counts")) return json(route, { code: "42501", message: "not allowed", details: null, hint: null }, 403);
      const body = (req.postDataJSON() || {}) as { p_from?: string; p_to?: string };
      const from = Date.parse(String(body.p_from)), to = Date.parse(String(body.p_to));
      if (!(to > from) || to - from > 3 * 86400e3) return json(route, { code: "22023", message: "window must be set, start before end, at most 3 days" }, 400);
      const counts = new Map<string, { source: string; action: string; n: number }>();
      for (const g of state.guardEvents) {
        const t = Date.parse(g.created_at);
        if (t < from || t >= to) continue;
        const k = g.source + "/" + g.action;
        const c = counts.get(k) ?? { source: g.source, action: g.action, n: 0 };
        c.n += 1;
        counts.set(k, c);
      }
      return json(route, [...counts.values()]);
    }
    // Live: lead_restore_log has no client grant, so a direct read is refused (42501), exactly like production.
    if (p === "/rest/v1/lead_restore_log") {
      state.restoreTableReads += 1;
      return json(route, { code: "42501", message: "permission denied for table lead_restore_log", details: null, hint: null }, 403);
    }
    // 2026-11-29: admins read open restore protections through get_admin_restore_protection_counts(p_at).
    if (p === "/rest/v1/rpc/get_admin_restore_protection_counts") {
      state.restoreRpcCalls += 1;
      if (state.fail.has("rpc/get_admin_restore_protection_counts")) return json(route, { code: "42501", message: "not allowed", details: null, hint: null }, 403);
      const at = Date.parse(String(((req.postDataJSON() || {}) as { p_at?: string }).p_at));
      if (!Number.isFinite(at)) return json(route, { code: "22023", message: "p_at must be set and within the last 2 days" }, 400);
      const openAt = (t: number) =>
        state.restoreRows.filter((r) => Date.parse(r.protected_until) > t && (!r.restored_at || Date.parse(r.restored_at) <= t) && (!r.undone_at || Date.parse(r.undone_at) > t));
      const now = openAt(at);
      const earliest = now.map((r) => r.protected_until).sort()[0] ?? null;
      return json(route, [{ open_now: now.length, open_day_before: openAt(at - 86400e3).length, earliest_end: earliest }]);
    }
    // 2026-11-29: admin contact lookup (name + mobile for up to 200 lead ids in the body; admin roles only).
    if (p === "/rest/v1/rpc/get_admin_lead_contacts") {
      const ids = (((req.postDataJSON() || {}) as { p_lead_ids?: string[] }).p_lead_ids ?? []) as string[];
      state.contactCalls.push({ ids, url: url.toString() });
      if (state.fail.has("rpc/get_admin_lead_contacts")) return json(route, { code: "42501", message: "not allowed", details: null, hint: null }, 403);
      if (state.employee.role !== "admin" && state.employee.role !== "super_admin") return json(route, { code: "42501", message: "not allowed", details: null, hint: null }, 403);
      if (ids.length < 1 || ids.length > 200) return json(route, { code: "22023", message: "send 1 to 200 lead ids" }, 400);
      return json(route, ids.map(fakeContact));
    }
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
    // Admin Home workload read (admin login only): a team leader's Home also reads leads by current_owner_id=in.(team) and must reach the lead rows below.
    if (method === "GET" && p === "/rest/v1/leads" && ["admin", "super_admin"].includes(String(state.employee.role)) && (url.searchParams.get("current_owner_id") || "").startsWith("in.")) return json(route, state.workloadLeads);
    if (p === "/rest/v1/employees") {
      if (wantsObject || url.searchParams.get("auth_user_id") || !state.staff) return json(route, wantsObject ? state.employee : [state.employee]);
      return json(route, state.staff);
    }
    if (p === "/rest/v1/lead_engine_settings") {
      if (state.settingsDelayMs > 0) await new Promise((r) => setTimeout(r, state.settingsDelayMs));
      // The page may have moved on while the answer was held back.
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
      if (url.searchParams.get("pending_team_id")) return json(route, state.teamPending);
      const stage = url.searchParams.get("board_stage");
      if (type === "eq.LEAD" && stage) return json(route, state.leads.filter((l) => `eq.${l.board_stage}` === stage));
      if (type === "eq.LEAD") return json(route, state.leads);
      if (type === "eq.DATA") return json(route, state.data);
      return json(route, wantsObject ? {} : []);
    }
    if (p === "/rest/v1/lead_notes" && method === "GET" && (url.searchParams.get("select") || "").includes("reminder_at")) {
      if (state.remindersFail) return json(route, { message: "fake failure" }, 500);
      return json(route, state.reminders);
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
    if (p === "/rest/v1/rpc/get_employee_work_report" && state.workReport) return json(route, state.workReport);
    if (p === "/rest/v1/rpc/get_given_lead_context") return json(route, state.given ?? { enabled: false, leads: [] });
    if (p === "/rest/v1/rpc/get_call_quality_summary") {
      if (!state.cq) return json(route, { code: "P0001", message: "get_call_quality_summary: Call Quality is not visible to employees", details: null, hint: null }, 400);
      return json(route, state.cq);
    }
    if (p === "/rest/v1/employee_leave_periods" && method === "GET") return json(route, state.leave);
    if (p === "/rest/v1/tracking" && method === "GET") return json(route, state.tracking);
    if (p === "/rest/v1/leads" && method === "HEAD" && url.searchParams.get("lead_type") === "eq.DATA") {
      const n = state.data.length;
      return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-expose-headers": "content-range", "content-range": n ? `0-0/${n}` : "*/0" } });
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
