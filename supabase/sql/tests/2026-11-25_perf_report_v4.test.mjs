// SQL test for supabase/sql/2026-11-25_perf_report_v4.sql (exact history, definitions v2). In-memory Postgres, no live
// DB. Not part of the build: PGlite is not a project dependency. Run from a folder that has it:
//   npm i @electric-sql/pglite@0.2.17
//   node <this file> <2026-11-20_perf_report.sql> <2026-11-23_perf_report_v3.sql> <2026-11-25_perf_report_v4.sql> <..._v4_rollback.sql> <live_defs.sql>
// live_defs.sql: the live is_admin and friends (pg_get_functiondef, "=====" separated), as for the reassign test.
// Known answers: a visit stays with the person who made it after the visit lock ends and the sweep recycles the lead, after
// its stage changes, and in any later range; a revisit is the same lead; a lock copied over by an admin reassign is not a
// visit; Not interested then follow-up (and the other way) count both; Not connected then Connected then Converted count
// each; results are dated by the event (a visit on a stint that started earlier still counts in the range).
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const files = process.argv.slice(2).map((f) => fs.readFileSync(f, "utf8"));
const [v1, v3, v4, v4rb, live] = files;
for (const [i, s] of files.entries()) if (i < 4 && s.includes("\r")) throw new Error(`file ${i + 1} has CR`);
const db = new PGlite();
const id = (p, i) => `00000000-0000-0000-0000-${p}${String(i).padStart(12 - p.length, "0")}`;
const ADM = id("a", 1), ADMU = id("aa", 1);
const OLD = id("e", 1), SALES = id("e", 2), OPS = id("e", 3), GONE = id("e", 4), LEAVE = id("e", 5), GRACE = id("e", 6), EMP_U = id("ee", 1);
const L = (i) => id("", i), H = (i) => id("1", i);
let failures = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { failures++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); } else console.log(`ok   ${name}`);
};
const asUser = (uid) => db.query(`select set_config('test.uid', $1, false)`, [uid ?? ""]);
const one = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const tryq = async (sql, p = []) => { try { return { r: (await db.query(sql, p)).rows[0] }; } catch (e) { return { err: e.message }; } };
const today = (await one(`select (now() at time zone 'Asia/Kolkata')::date::text d`)).d;

await db.exec(`
create role anon; create role authenticated; create role service_role;
-- Like live (default privileges, 29 Oct): every new function is executable by authenticated unless revoked.
alter default privileges in schema public grant execute on functions to authenticated;
create schema auth; grant usage on schema auth to anon, authenticated;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table teams (id uuid primary key, name text);
create table employees (id uuid primary key, auth_user_id uuid, name text, role text, is_active boolean, department text, team_id uuid);
create table lead_engine_settings (id int primary key, auto_junk_enabled boolean, sla_first_contact_minutes int, restore_protection_days int, sla_weekly_off_day int);
insert into lead_engine_settings values (1, true, 30, 14, null);
create table leads (id uuid primary key, name text, status text, board_stage text, lead_type text, source text, project text, current_owner_id uuid,
  merged_into_lead_id uuid, board_stage_changed_at timestamptz, sla_deadline timestamptz, recycle_count int default 0, mobile_normalized text);
create table lead_history (id uuid primary key default gen_random_uuid(), lead_id uuid, employee_id uuid, assigned_at timestamptz, is_active boolean,
  call_count int, assigned_by_type text, assigned_by_employee_id uuid, reassign_note text, ended_reason text, recycle_reason text, outcome text,
  last_activity_at timestamptz, paused_until timestamptz, pause_reason text, pause_note text, pause_verified_by uuid, pause_verified_at timestamptz,
  pause_expiry_warning_sent_at timestamptz, pause_expired_notified_at timestamptz, created_at timestamptz default now());
create table lead_activity_log (id uuid primary key default gen_random_uuid(), lead_id uuid, lead_history_id uuid, employee_id uuid,
  activity_type text, detail text, created_at timestamptz default now());
create table lead_notes (id serial, lead_id uuid, lead_history_id uuid, reminder_at timestamptz, created_at timestamptz);
create table site_visits (id serial, lead_id uuid, employee_id uuid, event_type text, created_at timestamptz, verified_at timestamptz, denied_at timestamptz);
create table contact_click_log (id serial, lead_id uuid, lead_history_id uuid, click_type text, clicked_at timestamptz);
create table lead_restore_log (id uuid primary key default gen_random_uuid(), lead_id uuid, restored_by uuid, to_employee_id uuid, reason text,
  highest_positive text, restored_status text, restored_stage text, protected_until timestamptz, sibling_bypassed boolean, sibling jsonb,
  prev_state jsonb, new_lead_history_id uuid, activity_id uuid, restored_at timestamptz default now());
create table lead_forced_removals (lead_id uuid, removed_employee_id uuid, removed_by uuid, reason text);
create table notification (employee_id uuid, employee_name text, title text, message text, type text, is_read boolean, related_lead_id uuid);
create table lead_guard_events (id serial primary key, source text, action text, lead_id uuid, holder_lead_id8 text, lead_owner_id uuid,
  holder_owner_id uuid, project text, mode text, detail jsonb, created_at timestamptz default now());
create table employee_leave_periods (id serial, employee_id uuid, start_date date, end_date date);
create table non_working_periods (id serial, kind text, cancelled_at timestamptz, starts_at timestamptz, ends_at timestamptz);
create function compute_working_hours_sla_deadline(t timestamptz, m int) returns timestamptz language sql as $$ select t + make_interval(mins => m) $$;
insert into employees values ('${ADM}', '${ADMU}', 'Admin', 'super_admin', true, 'admin', null), ('${OLD}', '${EMP_U}', 'Old', 'employee', true, 'sales', null),
  ('${SALES}', null, 'Sales', 'employee', true, 'sales', null), ('${OPS}', null, 'Ops', 'employee', true, 'operations', null),
  ('${GONE}', null, 'Gone', 'employee', false, 'sales', null), ('${LEAVE}', null, 'Leave', 'employee', true, 'sales', null),
  ('${GRACE}', null, 'Grace', 'employee', true, 'sales', null);
insert into employee_leave_periods (employee_id, start_date, end_date) values ('${LEAVE}', '${today}', '${today}'),
  ('${GRACE}', date '${today}' - 3, date '${today}' - 1);
`);

for (const def of live.split("=====")) if (def.trim()) await db.exec(def);
await db.exec(v1);
await db.exec(v3);
const E1 = OLD, E2 = SALES, E3 = OPS;
const T = (d) => `2026-${d}:00+05:30`;
await db.exec(`
insert into leads (id, name, status, board_stage, lead_type, source, project, current_owner_id) values
  ('${L(1)}', 'Lead 1', 'CONNECTED', 'LEADS', 'LEAD', '99acres', 'P1', '${E1}'),
  ('${L(2)}', 'Lead 2', 'NEW', 'FOLLOW_UP', 'LEAD', '99acres', 'P1', '${E1}'),
  ('${L(3)}', 'Lead 3', 'NOT_INTERESTED', 'LEADS', 'LEAD', '99acres', 'P1', '${E1}'),
  ('${L(4)}', 'Lead 4', 'CONVERTED', 'LEADS', 'DATA', 'fb', 'P2', '${E2}'),
  ('${L(5)}', 'Lead 5', 'CONNECTED', 'VISIT', 'LEAD', '99acres', 'P1', '${E3}');
insert into lead_history (id, lead_id, employee_id, assigned_at, is_active, assigned_by_type, recycle_reason, call_count, pause_reason, paused_until) values
  ('${H(1)}', '${L(1)}', '${E1}', '${T("09-28T10:00")}', true, 'SYSTEM', null, 2, 'VISIT_LOCK', '${T("11-03T12:00")}'),
  ('${H(3)}', '${L(2)}', '${E1}', '${T("10-02T10:00")}', true, 'SYSTEM', null, 1, null, null),
  ('${H(4)}', '${L(3)}', '${E1}', '${T("10-02T10:00")}', true, 'SYSTEM', null, 1, null, null),
  ('${H(5)}', '${L(4)}', '${E2}', '${T("10-02T10:00")}', true, 'SYSTEM', null, 3, null, null),
  ('${H(6)}', '${L(5)}', '${E1}', '${T("10-01T10:00")}', false, 'SYSTEM', null, 1, 'VISIT_LOCK', '${T("11-08T12:00")}'),
  ('${H(7)}', '${L(5)}', '${E3}', '${T("10-10T10:00")}', true, 'ADMIN', null, 0, 'VISIT_LOCK', '${T("11-08T12:00")}');
insert into site_visits (lead_id, employee_id, event_type, created_at, verified_at, denied_at) values
  ('${L(1)}', '${E1}', 'VISIT', '${T("10-03T12:00")}', '${T("10-03T18:00")}', null),
  ('${L(1)}', '${E1}', 'REVISIT', '${T("10-20T12:00")}', null, null),
  ('${L(5)}', '${E1}', 'VISIT', '${T("10-08T12:00")}', '${T("10-08T18:00")}', null);
insert into lead_activity_log (lead_id, lead_history_id, employee_id, activity_type, detail, created_at) values
  ('${L(2)}', '${H(3)}', '${E1}', 'STATUS_UPDATE', 'NOT_INTERESTED', '${T("10-03T12:00")}'),
  ('${L(2)}', '${H(3)}', '${E1}', 'BOARD_STAGE_MOVE', 'FOLLOW_UP', '${T("10-05T12:00")}'),
  ('${L(3)}', '${H(4)}', '${E1}', 'BOARD_STAGE_MOVE', 'FOLLOW_UP', '${T("10-03T12:00")}'),
  ('${L(3)}', '${H(4)}', '${E1}', 'STATUS_UPDATE', 'NOT_INTERESTED', '${T("10-04T12:00")}'),
  ('${L(4)}', '${H(5)}', '${E2}', 'STATUS_UPDATE', 'NOT_CONNECTED', '${T("10-03T12:00")}'),
  ('${L(4)}', '${H(5)}', '${E2}', 'STATUS_UPDATE', 'CONNECTED', '${T("10-04T12:00")}'),
  ('${L(4)}', '${H(5)}', '${E2}', 'STATUS_UPDATE', 'CONVERTED', '${T("10-06T12:00")}');
`);
const refresh = async () => { await asUser(null); await db.query("select perf_refresh()"); await asUser(ADMU); };
await refresh();
await db.exec(v4);
const rep = async (from, to, f = {}) => (await one(`select get_perf_report_v4($1, $2, $3::jsonb) r`, [from, to, JSON.stringify(f)])).r;
const row = (r, emp) => r.by_employee.find((e) => e.employee_id === emp) ?? {};
const K = ["leads", "visit", "followup", "not_interested", "not_connected", "connected", "converted"];
const pick = (x) => K.map((k) => x[k] ?? 0);

const oct = await rep("2026-10-01", "2026-10-31");
eq("v4 answers with definitions v2", [oct.api, oct.def_version, oct.definitions.some((d) => d.key === "visit" && /stays theirs/.test(d.rule))], [4, 2, true]);
eq("Oct E1: leads given 3 (lead 1 was given in Sep); visits 2 (lead 1 from a Sep assignment + lead 5); follow-up 2; not interested 2 (NI then FU, FU then NI); connected 4",
  pick(row(oct, E1)), [3, 2, 2, 2, 0, 4, 0]);
eq("Oct E2: NC then Connected then Converted all count", pick(row(oct, E2)), [1, 0, 0, 0, 1, 1, 1]);
eq("Oct E3: a visit lock copied by an admin reassign is not a visit", row(oct, E3).visit ?? 0, 0);
const v3oct = (await one(`select get_perf_report_v3('2026-10-01', '2026-10-31', '{}'::jsonb) r`)).r;
eq("the old cohort report missed lead 1's visit (assignment started in Sep)", (v3oct.by_employee.find((e) => e.employee_id === E1) ?? {}).visit, 1);
eq("revisit of the same lead: still one lead", (await one(`select get_perf_report_leads_v4('2026-10-01', '2026-10-31', $1::jsonb, 'visit') r`, [JSON.stringify({ employee_ids: [E1] })])).r.rows.map((x) => x.lead_name).sort(), ["Lead 1", "Lead 5"]);

// The visit lock ends, the sweep recycles lead 1 to E2 (Nov 5), E2 moves it to Follow-up (Nov 6); the stage of lead 5 changes.
await db.exec(`update lead_history set is_active = false where id = '${H(1)}';
insert into lead_history (id, lead_id, employee_id, assigned_at, is_active, assigned_by_type, recycle_reason, call_count) values
  ('${H(2)}', '${L(1)}', '${E2}', '${T("11-05T10:00")}', true, 'SYSTEM', 'VISIT_LOCK_EXPIRED', 0);
update leads set current_owner_id = '${E2}', board_stage = 'FOLLOW_UP' where id = '${L(1)}';
update leads set board_stage = 'LEADS', status = 'NOT_INTERESTED' where id = '${L(5)}';
insert into lead_activity_log (lead_id, lead_history_id, employee_id, activity_type, detail, created_at) values
  ('${L(1)}', '${H(2)}', '${E2}', 'BOARD_STAGE_MOVE', 'FOLLOW_UP', '${T("11-06T12:00")}');`);
await refresh();
const oct2 = await rep("2026-10-01", "2026-10-31");
eq("after the sweep and the stage changes: October is exactly the same", [pick(row(oct2, E1)), pick(row(oct2, E2)), row(oct2, E3).visit ?? 0], [pick(row(oct, E1)), pick(row(oct, E2)), 0]);
const nov = await rep("2026-11-01", "2026-11-30");
eq("November: E2 got lead 1 recycled, 1 follow-up, 0 visits; E1 has no November visit", [row(nov, E2).leads, row(nov, E2).followup, row(nov, E2).visit ?? 0, row(nov, E1).visit ?? 0], [1, 1, 0, 0]);
const both = await rep("2026-10-01", "2026-11-30");
eq("Oct-Nov: lead 1's visit stays E1's (1 of E1's 2), E2 has 0 visits", [row(both, E1).visit, row(both, E2).visit ?? 0, row(both, E2).followup], [2, 0, 1]);
eq("split by how the assignment came: E2's follow-up is on a Recycled assignment", (nov.by_emp_origin.find((x) => x.employee_id === E2 && x.origin === "RECYCLED") ?? {}).followup, 1);
eq("drill follow-up in November = lead 1 by E2, dated by the event", (await one(`select get_perf_report_leads_v4('2026-11-01', '2026-11-30', '{}'::jsonb, 'followup') r`)).r.rows.map((x) => [x.lead_name, x.employee_id === E2, x.event_at.slice(0, 10)]), [["Lead 1", true, "2026-11-06"]]);
eq("leads handled: E1 had 4 leads in October (lead 1 from a September assignment, leads 2, 3, 5); % over handled (2 visits / 4 = 50%)", [row(oct, E1).leads_handled, row(oct, E1).pct.visit, row(oct, E1).pct.leads_handled], [4, 50, 100]);
const allRows = (r) => [r.totals, ...r.by_employee, ...r.by_source, ...(r.by_emp_source ?? []), ...(r.by_emp_origin ?? [])];
eq("no % is ever over 100, and every result is within leads handled", [oct, nov, both].every((r) => allRows(r).every((x) =>
  Object.entries(x.pct ?? {}).every(([k, v]) => v === null || v <= 100) && ["visit", "followup", "connected", "converted", "not_interested", "not_connected", "details_est"].every((k) => (x[k] ?? 0) <= (x.leads_handled ?? 0)))), true);
eq("an employee with events but no leads given in the range still has a row, with leads handled", (await rep("2026-10-20", "2026-10-31")).by_employee.some((e) => e.employee_id === E1 && e.leads === 0 && e.visit === 1 && e.leads_handled >= 1 && e.pct.visit <= 100), true);
eq("definitions v2: % of leads handled; NC / NI as history", [(oct.definitions.find((d) => d.key === "percent") ?? {}).label, /also as Connected/.test((oct.definitions.find((d) => d.key === "not_connected") ?? {}).rule)], ["% of leads handled", true]);
eq("filters still apply (Data only: lead 4)", pick((await rep("2026-10-01", "2026-10-31", { lead_types: ["DATA"] })).totals), [1, 0, 0, 0, 1, 1, 1]);

await asUser(EMP_U);
eq("v4 is admin only", [/admin only/.test((await tryq(`select get_perf_report_v4('2026-10-01', '2026-10-31')`)).err || ""), /admin only/.test((await tryq(`select get_perf_report_leads_v4('2026-10-01', '2026-10-31', '{}'::jsonb, 'visit')`)).err || "")], [true, true]);
await asUser(ADMU);
const g = await one(`select has_function_privilege('anon', 'get_perf_report_v4(date,date,jsonb)', 'EXECUTE') a, has_function_privilege('authenticated', 'perf_event_rows_v4(date,date,jsonb)', 'EXECUTE') h`);
eq("grants: anon no; helpers not for employees", [g.a, g.h], [false, false]);
await db.exec(v4rb);
eq("rollback: v4 gone, definitions v2 gone, v3 still answers", [(await one(`select count(*)::int n from pg_proc where proname like '%\\_v4'`)).n, (await one(`select count(*)::int n from perf_definitions where version = 2`)).n, (await one(`select get_perf_report_v3('2026-10-01', '2026-10-31', '{}'::jsonb) ->> 'api' a`)).a], [0, 0, "3"]);
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
