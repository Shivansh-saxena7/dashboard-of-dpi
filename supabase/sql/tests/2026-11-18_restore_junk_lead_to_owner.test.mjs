// SQL test harness for supabase/sql/2026-11-18_restore_junk_lead_to_owner.sql (in-memory Postgres, no live DB).
// Not part of the build: PGlite is not a project dependency. Run from a folder that has it installed:
//   npm i @electric-sql/pglite@0.2.17
//   node <this file> <migration.sql> <rollback.sql> <is_admin_def.sql> <live_defs.sql>
// live_defs.sql: pg_get_functiondef of positive_junk_rows, restore_positive_junk_leads, restore_sibling_block,
// separated by lines of "=====" (restore_positive_junk_leads is not loaded).
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const [mig, rb, isAdminDef, live] = process.argv.slice(2).map((f) => fs.readFileSync(f, "utf8"));
for (const [n, s] of [["migration", mig], ["rollback", rb]]) if (s.includes("\r")) throw new Error(n + " has CR");
const defs = live.split("=====").map((d) => d.trim()).filter(Boolean);
const def = (name) => defs.find((d) => d.includes(`FUNCTION public.${name}(`));
const db = new PGlite();
const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const ymd = (offset) => new Date(Date.parse(today + "T00:00:00Z") + offset * 864e5).toISOString().slice(0, 10);
const dowToday = new Date(today + "T00:00:00Z").getUTCDay();
const offDay = (dowToday + 3) % 7; // a weekly off that is not today, yesterday or the day before
const A = "00000000-0000-0000-0000-0000000000a1", NA = "00000000-0000-0000-0000-0000000000a2";
const ADM = "00000000-0000-0000-0000-0000000000e9", EMP = "00000000-0000-0000-0000-0000000000e8";
const RASHMI = "00000000-0000-0000-0000-0000000000e1", TANU = "00000000-0000-0000-0000-0000000000e2";
const RAJA = "00000000-0000-0000-0000-0000000000e3", OPS = "00000000-0000-0000-0000-0000000000e4", BACK = "00000000-0000-0000-0000-0000000000e5";
const L = (i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`;
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table employees (id uuid primary key, auth_user_id uuid, name text, role text, is_active boolean, department text);
create table leads (id uuid primary key, name text, mobile_normalized text, status text, board_stage text, board_stage_changed_at timestamptz,
  lead_type text, current_owner_id uuid, merged_into_lead_id uuid, recycle_count int default 0, last_unjunked_at timestamptz,
  sla_deadline timestamptz, project text, updated_at timestamptz default now());
create table lead_history (id uuid primary key default gen_random_uuid(), lead_id uuid, employee_id uuid, assigned_at timestamptz, is_active boolean,
  call_count int, assigned_by_type text, assigned_by_employee_id uuid, reassign_note text, outcome text, outcome_at timestamptz,
  last_activity_at timestamptz, ended_reason text, recycle_reason text, recycled_from_status text, recycled_from_stage text, pause_reason text);
create table lead_activity_log (id uuid primary key default gen_random_uuid(), lead_id uuid, lead_history_id uuid, employee_id uuid,
  activity_type text, detail text, created_at timestamptz default now());
create table site_visits (id serial, lead_id uuid, event_type text, created_at timestamptz, employee_id uuid);
create table lead_notes (id serial, lead_id uuid, created_at timestamptz);
create table contact_click_log (id serial, lead_id uuid, clicked_at timestamptz);
create table lead_restore_log (id uuid primary key default gen_random_uuid(), lead_id uuid, restored_by uuid, to_employee_id uuid, reason text,
  highest_positive text, restored_status text, restored_stage text, protected_until timestamptz, sibling_bypassed boolean, sibling jsonb,
  prev_state jsonb, new_lead_history_id uuid, activity_id uuid, undone_at timestamptz);
create table lead_guard_events (id serial primary key, source text, action text, lead_id uuid, holder_lead_id8 text, lead_owner_id uuid,
  holder_owner_id uuid, project text, mode text, detail jsonb, created_at timestamptz default now());
create table notification (employee_id uuid, employee_name text, title text, message text, type text, is_read boolean, related_lead_id uuid);
create table employee_leave_periods (id serial, employee_id uuid, start_date date, end_date date);
create table lead_engine_settings (id int primary key, restore_protection_days int, sla_weekly_off_day int);
insert into lead_engine_settings values (1, 14, ${offDay});
create table non_working_periods (id serial, kind text, starts_at timestamptz, ends_at timestamptz, cancelled_at timestamptz);
create function current_employee_id() returns uuid language sql stable as $$ select id from employees where auth_user_id = auth.uid() and is_active $$;
create function current_employee_role() returns text language sql stable as $$ select role from employees where auth_user_id = auth.uid() and is_active $$;
insert into employees values ('${ADM}', '${A}', 'Admin', 'admin', true, 'admin'), ('${EMP}', '${NA}', 'Emp', 'employee', true, 'sales'),
  ('${RASHMI}', null, 'Rashmi', 'employee', true, 'sales'), ('${TANU}', null, 'Tanu', 'employee', true, 'sales'),
  ('${RAJA}', null, 'Raja', 'employee', true, 'sales'), ('${OPS}', null, 'Ops', 'employee', true, 'operations'),
  ('${BACK}', null, 'Back', 'employee', true, 'sales');
insert into employee_leave_periods (employee_id, start_date, end_date) values
  ('${RAJA}', '${ymd(-3)}', '${ymd(5)}'),
  ('${BACK}', '${ymd(-5)}', '${ymd(-1)}');
`);
await db.exec(isAdminDef);
await db.exec(def("restore_sibling_block"));
await db.exec(def("positive_junk_rows"));
// 1: junk LEAD, Connected before; 2: junk DATA like f6a6db10 (Connected, two Not Interested); 3: junk, never positive;
// 4: not junk; 5: junk LEAD whose number has a positive LEAD copy with Tanu (sibling guard).
await db.exec(`
insert into leads (id, name, mobile_normalized, status, board_stage, lead_type, current_owner_id, recycle_count) values
  ('${L(1)}', 'L1', '9000000001', 'JUNK', 'LEADS', 'LEAD', '${RASHMI}', 3),
  ('${L(2)}', 'L2', '9000000002', 'JUNK', 'LEADS', 'DATA', '${RASHMI}', 1),
  ('${L(3)}', 'L3', '9000000003', 'JUNK', 'LEADS', 'LEAD', '${RASHMI}', 2),
  ('${L(4)}', 'L4', '9000000004', 'NEW', 'LEADS', 'LEAD', '${RASHMI}', 0),
  ('${L(5)}', 'L5', '9000000005', 'JUNK', 'LEADS', 'LEAD', '${RASHMI}', 3),
  ('${L(6)}', 'L6', '9000000005', 'CONNECTED', 'FOLLOW_UP', 'LEAD', '${TANU}', 0);
insert into lead_history (lead_id, employee_id, assigned_at, is_active, call_count, assigned_by_type, outcome, outcome_at, ended_reason) values
  ('${L(1)}', '${TANU}', now() - interval '20 days', false, 1, 'SYSTEM', 'CONNECTED', now() - interval '19 days', 'RECYCLE_READY'),
  ('${L(1)}', '${RASHMI}', now() - interval '5 days', false, 2, 'SYSTEM', 'NOT_INTERESTED', now() - interval '4 days', 'JUNK'),
  ('${L(2)}', '${TANU}', now() - interval '20 days', false, 1, 'ADMIN', 'NOT_INTERESTED', now() - interval '19 days', 'RECYCLE_READY'),
  ('${L(2)}', '${RASHMI}', now() - interval '6 days', false, 4, 'SYSTEM', 'NOT_INTERESTED', now() - interval '3 days', 'JUNK'),
  ('${L(3)}', '${RASHMI}', now() - interval '6 days', false, 3, 'SYSTEM', 'NOT_INTERESTED', now() - interval '3 days', 'JUNK'),
  ('${L(4)}', '${RASHMI}', now() - interval '1 day', true, 0, 'SYSTEM', null, null, null),
  ('${L(5)}', '${RASHMI}', now() - interval '6 days', false, 2, 'SYSTEM', 'CONNECTED', now() - interval '5 days', 'JUNK'),
  ('${L(6)}', '${TANU}', now() - interval '2 days', true, 1, 'SYSTEM', 'CONNECTED', now() - interval '1 day', null);
insert into lead_activity_log (lead_id, employee_id, activity_type, detail, created_at) values
  ('${L(2)}', '${TANU}', 'STATUS_UPDATE', 'CONNECTED', now() - interval '90 days'),
  ('${L(2)}', '${TANU}', 'STATUS_UPDATE', 'NOT_INTERESTED', now() - interval '19 days'),
  ('${L(2)}', '${RASHMI}', 'STATUS_UPDATE', 'NOT_INTERESTED', now() - interval '3 days');
`);
await db.exec(mig);
const out = [];
const ok = (n, c, e = "") => out.push([c ? "PASS" : "FAIL", n, e]);
const call = async (uid, lead, emp, reason) => {
  await db.query(`select set_config('test.uid', $1, false)`, [uid]);
  try { return { data: (await db.query(`select restore_junk_lead_to_owner($1::uuid, $2::uuid, $3) j`, [lead, emp, reason])).rows[0].j }; }
  catch (e) { return { error: e.message }; }
};
const lead = async (id) => (await db.query(`select status, board_stage, current_owner_id::text o, recycle_count, last_unjunked_at is not null unjunked from leads where id = $1`, [id])).rows[0];

let r = await call(A, L(1), RASHMI, "Customer called back, interested");
let s = await lead(L(1));
ok("junk LEAD with Connected history: back to Rashmi as CONNECTED / LEADS, recycle_count 0, last_unjunked_at set",
  r.data?.result === "RESTORED" && s.status === "CONNECTED" && s.board_stage === "LEADS" && s.o === RASHMI && s.recycle_count === 0 && s.unjunked, JSON.stringify([r, s]));
const prot = (await db.query(`select count(*)::int n, bool_and(protected_until between now() + interval '14 days' - interval '1 minute' and now() + interval '14 days' + interval '1 minute') d14, bool_and(restored_status = 'CONNECTED') st from lead_restore_log where lead_id = $1`, [L(1)])).rows[0];
ok("protection row: lead_restore_log with 14 days", prot.n === 1 && prot.d14 && prot.st, JSON.stringify(prot));
const act = (await db.query(`select (select count(*)::int from lead_history where lead_id = $1 and is_active) a, (select count(*)::int from lead_guard_events where lead_id = $1 and source = 'admin_restore' and action = 'ADMIN_RESTORE_ONE') g, (select count(*)::int from notification where related_lead_id = $1) n`, [L(1)])).rows[0];
ok("one active assignment, an audit event and a notification", act.a === 1 && act.g === 1 && act.n === 1, JSON.stringify(act));

r = await call(A, L(2), RASHMI, "Customer called back, interested");
s = await lead(L(2));
ok("junk DATA lead (like f6a6db10, two Not Interested): restored CONNECTED / LEADS to Rashmi", r.data?.result === "RESTORED" && s.status === "CONNECTED" && s.board_stage === "LEADS" && s.o === RASHMI, JSON.stringify([r, s]));

r = await call(A, L(3), RASHMI, "Customer called back");
ok("junk lead with no positive history: refused, stays junk", /no positive history/.test(r.error || "") && (await lead(L(3))).status === "JUNK", r.error);
r = await call(NA, L(5), RASHMI, "Customer called back");
ok("non-admin: refused", /admin only/.test(r.error || ""), r.error);
r = await call(A, L(5), RAJA, "Customer called back");
ok("receiver on leave today: refused", /on leave today/.test(r.error || ""), r.error);
r = await call(A, L(5), BACK, "Customer called back");
ok("receiver in return grace (leave ended yesterday): refused", /return grace/.test(r.error || ""), r.error);
r = await call(A, L(5), OPS, "Customer called back");
ok("receiver not in sales: refused", /not an active sales employee/.test(r.error || ""), r.error);
r = await call(A, L(4), RASHMI, "Customer called back");
ok("lead not junk: refused", /is not junk/.test(r.error || ""), r.error);
r = await call(A, L(5), RASHMI, "ok");
ok("reason shorter than 5 characters: refused", /at least 5 characters/.test(r.error || ""), r.error);
r = await call(A, L(5), RASHMI, "Customer called back");
s = await lead(L(5));
const held = (await db.query(`select count(*)::int n from lead_guard_events where lead_id = $1 and action = 'ADMIN_RESTORE_HELD'`, [L(5)])).rows[0].n;
ok("positive copy of the number with another employee: HELD, lead stays junk, held event recorded", r.data?.result === "HELD" && s.status === "JUNK" && held === 1, JSON.stringify(r));

// Same answers as scripts/check-return-grace.js (lib/ownerLeaveCalendar.ts): Tanu 12 - 15 Nov, weekly off Tuesday.
await db.exec(`update lead_engine_settings set sla_weekly_off_day = 2 where id = 1; insert into employee_leave_periods (employee_id, start_date, end_date) values ('${TANU}', '2026-11-12', '2026-11-15');`);
const grace = {};
for (const d of ["2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19"]) grace[d] = (await db.query("select employee_in_return_grace($1::uuid, $2::date) g", [TANU, d])).rows[0].g;
ok("return grace matches the TS rule: Mon 16 and Wed 18 (Tue off), not 15 (on leave), 17 or 19", JSON.stringify(grace) === JSON.stringify({ "2026-11-15": false, "2026-11-16": true, "2026-11-17": false, "2026-11-18": true, "2026-11-19": false }), JSON.stringify(grace));
const g = (await db.query(`select has_function_privilege('anon','restore_junk_lead_to_owner(uuid,uuid,text)','EXECUTE') a,
  has_function_privilege('public','restore_junk_lead_to_owner(uuid,uuid,text)','EXECUTE') p,
  has_function_privilege('authenticated','restore_junk_lead_to_owner(uuid,uuid,text)','EXECUTE') u,
  has_function_privilege('authenticated','employee_in_return_grace(uuid,date)','EXECUTE') h1,
  has_function_privilege('authenticated','company_working_day(date)','EXECUTE') h2`)).rows[0];
ok("grants: anon / public no, authenticated yes, helpers internal", !g.a && !g.p && g.u && !g.h1 && !g.h2, JSON.stringify(g));
await db.exec(rb);
ok("rollback removes all three functions", (await db.query(`select count(*)::int n from pg_proc where proname in ('restore_junk_lead_to_owner','employee_in_return_grace','company_working_day')`)).rows[0].n === 0);
for (const [st, n, e] of out) console.log(st, n, e ? "| " + String(e).slice(0, 200) : "");
console.log(out.every((x) => x[0] === "PASS") ? "ALL PASS" : "SOME FAILED");
