// SQL test for supabase/sql/2026-11-23_reassigned_journey.sql: the employee's "Previously with" tag + Journey for leads
// given from the Performance Report. In-memory Postgres, no live DB. Not part of the build: PGlite is not a project
// dependency. Run from a folder that has it:
//   npm i @electric-sql/pglite@0.2.17
//   node <this file> <2026-11-20_perf_report.sql> <2026-11-23_perf_report_v3.sql> <2026-11-23_perf_report_reassign.sql>
//     <2026-11-23_admin_report_reassign_mode.sql> <2026-11-23_reassigned_journey.sql> <..._rollback.sql> <live_defs.sql>
// live_defs.sql: the live admin_reassign_leads (both), force_reassign_lead_atomic, reassign_keep_state_atomic, is_admin,
// employee_in_return_grace, company_working_day, restore_sibling_block, log_guard_event, current_employee_id,
// current_employee_role, is_lead_terminal (pg_get_functiondef), separated by lines of "=====". The fixture is the same as
// 2026-11-23_perf_report_reassign.test.mjs.
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const files = process.argv.slice(2).map((f) => fs.readFileSync(f, "utf8"));
const [v1, v3, ra, flag, rj, rjrb, live] = files;
for (const [i, s] of files.entries()) if (i < 6 && s.includes("\r")) throw new Error(`file ${i + 1} has CR`);
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
for (const s of [v1, v3, ra, flag, rj]) await db.exec(s);
const SALES_U = id("ee", 2), OPS_U = id("ee", 3);
await db.exec(`update employees set auth_user_id = '${SALES_U}' where id = '${SALES}'; update employees set auth_user_id = '${OPS_U}', department = 'sales' where id = '${OPS}';
insert into leads (id, name, status, board_stage, lead_type, source, project, current_owner_id) values
  ('${L(1)}', 'Lead 1', 'NOT_CONNECTED', 'LEADS', 'LEAD', '99acres', 'P1', '${OLD}'),
  ('${L(2)}', 'Lead 2', 'NEW', 'LEADS', 'LEAD', '99acres', 'P1', '${OLD}'),
  ('${L(3)}', 'Lead 3', 'NEW', 'LEADS', 'LEAD', '99acres', 'P1', '${SALES}');
insert into lead_history (id, lead_id, employee_id, assigned_at, is_active, assigned_by_type, call_count) values
  ('${H(1)}', '${L(1)}', '${OLD}', '2026-10-05T10:00:00+05:30', true, 'SYSTEM', 2),
  ('${H(2)}', '${L(2)}', '${OLD}', '2026-10-06T10:00:00+05:30', true, 'SYSTEM', 0),
  ('${H(3)}', '${L(3)}', '${SALES}', '2026-10-07T10:00:00+05:30', true, 'ADMIN', 0);
insert into lead_activity_log (lead_id, lead_history_id, employee_id, activity_type, detail, created_at) values
  ('${L(1)}', '${H(1)}', '${OLD}', 'STATUS_UPDATE', 'NOT_CONNECTED', '2026-10-05T12:00:00+05:30');
insert into lead_notes (lead_id, lead_history_id, reminder_at, created_at) values ('${L(1)}', '${H(1)}', null, '2026-10-05T12:05:00+05:30');
update lead_engine_settings set admin_report_reassign_mode = 'on' where id = 1;`);
const REASON = "Private admin reason xyz", LABEL = "Secret label abc";
await asUser(ADMU);
const g = (await one(`select admin_reassign_leads_from_report($1::jsonb, $2, 'give', $3, $4, false, 'rj-key-0001') r`,
  [JSON.stringify([{ lead_id: L(1), expected_owner: OLD }]), SALES, REASON, LABEL])).r;
eq("setup: the report gave lead 1 from OLD to SALES", [g.moved, (await one(`select current_owner_id o from leads where id = $1`, [L(1)])).o], [1, SALES]);
const my = async (uid) => { await asUser(uid); return (await one(`select get_my_reassigned_leads() r`)).r; };
const ctxOf = async (uid, lead) => { await asUser(uid); return (await one(`select get_reassigned_lead_context($1) r`, [lead])).r; };

eq("flag off (default): list disabled, context null", [(await my(SALES_U)).enabled, await ctxOf(SALES_U, L(1))], [false, null]);
await db.exec(`update lead_engine_settings set reassigned_journey_mode = 'admin_pilot', reassigned_journey_pilot_ids = '{${OPS}}' where id = 1`);
eq("admin_pilot without this employee: off", (await my(SALES_U)).enabled, false);
await db.exec(`update lead_engine_settings set reassigned_journey_pilot_ids = '{${SALES}}' where id = 1`);
eq("admin_pilot with this employee: on", (await my(SALES_U)).enabled, true);
await db.exec(`update lead_engine_settings set reassigned_journey_mode = 'on' where id = 1`);

const list = await my(SALES_U);
eq("owner's list: only the report-given lead (not the admin-assigned lead 3), with the previous person", list.leads.map((x) => [x.lead_id, x.previously_with]), [[L(1), "Old"]]);
const c = await ctxOf(SALES_U, L(1));
eq("context: previously with, previous result, journey rows in order", [c.previously_with, c.previous.result, c.journey.map((j) => [j.employee, j.origin, j.given_by_admin, j.current, j.result])],
  ["Old", "NOT_CONNECTED", [["Old", "FRESH", false, false, "NOT_CONNECTED"], ["You", "ADMIN_GIVEN", true, true, null]]]);
const text = JSON.stringify([list, c]);
eq("never leaks the admin's reason, label, batch id, notes or who the admin was", [text.includes(REASON), text.includes(LABEL), /batch/i.test(text), /note/i.test(text), text.includes("Admin")], [false, false, false, false, false]);
const batchId = (await one(`select id from perf_reassign_batches limit 1`)).id;
eq("batch id nowhere in the answer", text.includes(batchId), false);
eq("previous owner (OLD) gets nothing for lead 1, list empty", [await ctxOf(EMP_U, L(1)), (await my(EMP_U)).leads], [null, []]);
eq("owner of a lead not given by the report (lead 3): null; not the owner (lead 2): null", [await ctxOf(SALES_U, L(3)), await ctxOf(SALES_U, L(2))], [null, null]);
eq("another employee (OPS) asking about lead 1: null", await ctxOf(OPS_U, L(1)), null);
eq("unknown lead / null id: null", [await ctxOf(SALES_U, id("9", 9)), (await one(`select get_reassigned_lead_context(null) r`)).r], [null, null]);

// An undo gives the lead back to its first owner: no tag for them (it would say who it was given to).
await asUser(ADMU);
const u = (await one(`select admin_undo_report_batch($1, 'Undo for the test', 'rj-undo-0001') r`, [(await one(`select id from perf_reassign_batches where mode = 'give' limit 1`)).id])).r;
eq("setup: undo gave lead 1 back to OLD", [u.moved, (await one(`select current_owner_id o from leads where id = $1`, [L(1)])).o], [1, OLD]);
eq("after an undo: no tag / journey for the first owner, none for SALES", [(await my(EMP_U)).leads, await ctxOf(EMP_U, L(1)), await ctxOf(SALES_U, L(1))], [[], null, null]);
await asUser(ADMU);
const g2 = (await one(`select admin_reassign_leads_from_report($1::jsonb, $2, 'give', $3, null, false, 'rj-key-0002') r`, [JSON.stringify([{ lead_id: L(1), expected_owner: OLD }]), SALES, REASON])).r;
eq("setup: given again to SALES", g2.moved, 1);
// A second, newer active assignment that is not the report's: only the latest counts.
await db.exec(`insert into lead_history (lead_id, employee_id, assigned_at, is_active, assigned_by_type, call_count) values ('${L(1)}', '${SALES}', now() + interval '1 minute', true, 'SYSTEM', 0)`);
eq("two active assignments, the newer one not from the report: no tag", [(await my(SALES_U)).leads, await ctxOf(SALES_U, L(1))], [[], null]);
await db.exec(`delete from lead_history where lead_id = '${L(1)}' and is_active and assigned_by_type = 'SYSTEM'`);
eq("back to one active (the report's): tag again", (await my(SALES_U)).leads.map((x) => x.lead_id), [L(1)]);

// The tag lasts only while the current assignment is the report's.
await db.exec(`update lead_history set is_active = false where lead_id = '${L(1)}' and is_active;
insert into lead_history (lead_id, employee_id, assigned_at, is_active, assigned_by_type, recycle_reason, call_count) values ('${L(1)}', '${OPS}', now(), true, 'SYSTEM', 'SLA_BREACHED', 0);
update leads set current_owner_id = '${OPS}' where id = '${L(1)}';`);
eq("after the sweep recycles it on: no tag for SALES, none for the new owner", [await ctxOf(SALES_U, L(1)), (await my(SALES_U)).leads, (await my(OPS_U)).leads, await ctxOf(OPS_U, L(1))], [null, [], [], null]);

// Who may call.
await asUser(null);
await db.exec(`set role anon`);
eq("anon cannot call either function", [/permission denied/.test((await tryq(`select get_my_reassigned_leads()`)).err || ""), /permission denied/.test((await tryq(`select get_reassigned_lead_context($1)`, [L(1)])).err || "")], [true, true]);
await db.exec(`reset role; set role authenticated`);
eq("authenticated cannot call the internal helpers", [/permission denied/.test((await tryq(`select reassigned_journey_allowed($1)`, [SALES])).err || ""), /permission denied/.test((await tryq(`select reassigned_stint_origin($1)`, [H(1)])).err || "")], [true, true]);
await db.exec(`reset role`);
eq("flag columns default off / empty", (await db.query(`select column_name c, column_default d from information_schema.columns where table_name = 'lead_engine_settings' and column_name like 'reassigned_journey%' order by 1`)).rows.map((r) => [r.c, r.d]),
  [["reassigned_journey_mode", "'off'::text"], ["reassigned_journey_pilot_ids", "'{}'::uuid[]"]]);

const keep = [(await one(`select count(*)::int n from lead_history`)).n, (await one(`select count(*)::int n from perf_reassign_batches`)).n];
await db.exec(rjrb);
const left = (await one(`select count(*)::int n from pg_proc where proname in ('get_my_reassigned_leads', 'get_reassigned_lead_context', 'reassigned_journey_allowed', 'reassigned_stint_origin')`)).n;
const cols = (await one(`select count(*)::int n from information_schema.columns where table_name = 'lead_engine_settings' and column_name like 'reassigned_journey%'`)).n;
eq("rollback: functions and columns gone; history and batches kept", [left, cols, [(await one(`select count(*)::int n from lead_history`)).n, (await one(`select count(*)::int n from perf_reassign_batches`)).n]], [0, 0, keep]);
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
