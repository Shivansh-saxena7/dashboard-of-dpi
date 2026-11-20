// SQL test for supabase/sql/2026-11-20_perf_report.sql (in-memory Postgres, no live DB). Not part of the build:
// PGlite is not a project dependency. Run from a folder that has it installed:
//   npm i @electric-sql/pglite@0.2.17
//   node <this file> <migration.sql> <rollback.sql>
// Known answers: fresh vs recycled vs restored vs admin-given stints, a visit credited only inside its stint window,
// DATA, a merged lead, source spellings, the IST day boundary, frozen old rows, admin-only, drill-down, rollback.
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const [mig, rb] = process.argv.slice(2).map((f) => fs.readFileSync(f, "utf8"));
for (const [n, s] of [["migration", mig], ["rollback", rb]]) if (s.includes("\r")) throw new Error(n + " has CR");
const db = new PGlite();
const E1 = "00000000-0000-0000-0000-0000000000e1", E2 = "00000000-0000-0000-0000-0000000000e2", ADM = "00000000-0000-0000-0000-0000000000e9";
const T1 = "00000000-0000-0000-0000-0000000000f1";
const L = (i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`;
const H = (i) => `00000000-0000-0000-0000-1${String(i).padStart(11, "0")}`;
let failures = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { failures++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); } else console.log(`ok   ${name}`);
};
const asUser = async (uid) => db.exec(`select set_config('test.uid', '${uid ?? ""}', false)`);
const one = async (sql) => (await db.query(sql)).rows[0];

await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table employees (id uuid primary key, auth_user_id uuid, name text, role text, is_active boolean, team_id uuid);
create function is_admin() returns boolean language sql stable as $$
  select exists (select 1 from employees where auth_user_id = auth.uid() and is_active and role in ('admin', 'super_admin')) $$;
create table leads (id uuid primary key, name text, lead_type text, source text, project text, merged_into_lead_id uuid);
create table lead_history (id uuid primary key, lead_id uuid, employee_id uuid, assigned_at timestamptz, is_active boolean,
  assigned_by_type text, recycle_reason text, outcome text, call_count int, created_at timestamptz default now());
create table lead_activity_log (id uuid primary key default gen_random_uuid(), lead_id uuid, lead_history_id uuid, employee_id uuid,
  activity_type text, detail text, created_at timestamptz);
create table lead_notes (id serial, lead_id uuid, lead_history_id uuid, reminder_at timestamptz, created_at timestamptz);
create table site_visits (id serial, lead_id uuid, employee_id uuid, event_type text, created_at timestamptz, verified_at timestamptz, denied_at timestamptz);
create table contact_click_log (id serial, lead_id uuid, lead_history_id uuid, click_type text, clicked_at timestamptz);
create table lead_restore_log (id uuid primary key default gen_random_uuid(), lead_id uuid, new_lead_history_id uuid, restored_at timestamptz);
insert into employees values ('${E1}', '${E1}', 'Emp One', 'employee', true, '${T1}'), ('${E2}', '${E2}', 'Emp Two', 'employee', true, null),
  ('${ADM}', '${ADM}', 'Admin', 'admin', true, null);
-- L1: fresh to E1 (5 Oct, Not connected), recycled to E2 (7 Oct: follow-up move, visit, converted). E1 logs a visit on
--     8 Oct (after his stint ended): must NOT count for E1, and not for E2 either (another employee's visit).
insert into leads values ('${L(1)}', 'Lead 1', 'LEAD', '99 Acre', 'P1', null);
insert into lead_history values ('${H(1)}', '${L(1)}', '${E1}', '2026-10-05T10:00:00+05:30', false, 'SYSTEM', null, 'NOT_CONNECTED', 2),
  ('${H(2)}', '${L(1)}', '${E2}', '2026-10-07T11:00:00+05:30', true, 'SYSTEM', 'SLA_BREACHED', null, 1);
insert into lead_activity_log (lead_id, lead_history_id, employee_id, activity_type, detail, created_at) values
  ('${L(1)}', '${H(1)}', '${E1}', 'STATUS_UPDATE', 'NOT_CONNECTED', '2026-10-05T12:00:00+05:30'),
  ('${L(1)}', '${H(2)}', '${E2}', 'BOARD_STAGE_MOVE', 'FOLLOW_UP', '2026-10-07T12:00:00+05:30'),
  ('${L(1)}', '${H(2)}', '${E2}', 'STATUS_UPDATE', 'CONNECTED', '2026-10-07T12:01:00+05:30'),
  ('${L(1)}', '${H(2)}', '${E2}', 'STATUS_UPDATE', 'CONVERTED', '2026-10-09T12:00:00+05:30');
insert into site_visits (lead_id, employee_id, event_type, created_at, verified_at, denied_at) values
  ('${L(1)}', '${E2}', 'VISIT', '2026-10-08T15:00:00+05:30', '2026-10-08T18:00:00+05:30', null),
  ('${L(1)}', '${E1}', 'VISIT', '2026-10-08T16:00:00+05:30', null, null);
-- L2: DATA, source "fb" (-> Meta), fresh to E1 at 1 Nov 00:10 IST (= 31 Oct UTC): November, not October. Not interested.
insert into leads values ('${L(2)}', 'Lead 2', 'DATA', 'fb', null, null);
insert into lead_history values ('${H(3)}', '${L(2)}', '${E1}', '2026-11-01T00:10:00+05:30', false, 'SYSTEM', null, 'NOT_INTERESTED', 1);
insert into lead_activity_log (lead_id, lead_history_id, employee_id, activity_type, detail, created_at) values
  ('${L(2)}', '${H(3)}', '${E1}', 'STATUS_UPDATE', 'NOT_INTERESTED', '2026-11-01T10:00:00+05:30');
-- L3: fresh to E1 (10 Oct), given back to E2 by restore (20 Oct), then given to E1 by an admin (25 Oct): reminder +
--     WhatsApp, no visit (details estimate). New source spelling "NewPortal".
insert into leads values ('${L(3)}', 'Lead 3', 'LEAD', 'NewPortal', 'P2', null);
insert into lead_history values ('${H(4)}', '${L(3)}', '${E1}', '2026-10-10T10:00:00+05:30', false, 'SYSTEM', null, null, 0),
  ('${H(5)}', '${L(3)}', '${E2}', '2026-10-20T10:00:00+05:30', false, 'ADMIN', null, null, 0),
  ('${H(6)}', '${L(3)}', '${E1}', '2026-10-25T10:00:00+05:30', true, 'ADMIN', null, null, 3);
insert into lead_restore_log (lead_id, new_lead_history_id, restored_at) values ('${L(3)}', '${H(5)}', '2026-10-20T10:00:00+05:30');
insert into lead_notes (lead_id, lead_history_id, reminder_at, created_at) values ('${L(3)}', '${H(6)}', '2026-10-27T10:00:00+05:30', '2026-10-25T11:00:00+05:30');
insert into contact_click_log (lead_id, lead_history_id, click_type, clicked_at) values ('${L(3)}', '${H(6)}', 'WHATSAPP', '2026-10-25T11:05:00+05:30');
-- L4: merged into L1 later; its stint still counts (it happened), flagged lead_merged. Source " 99 Acres " -> 99acres.
insert into leads values ('${L(4)}', 'Lead 4', 'LEAD', ' 99 Acres ', 'P1', '${L(1)}');
insert into lead_history values ('${H(7)}', '${L(4)}', '${E2}', '2026-10-15T10:00:00+05:30', false, 'SYSTEM', null, null, 0);
`);
await db.exec(mig);

// Admin-only.
await asUser(E1);
let err = null;
try { await db.query(`select get_perf_report('2026-10-01', '2026-10-31')`); } catch (e) { err = e.message; }
eq("non-admin is refused", err?.includes("admin only"), true);
err = null;
try { await db.query(`select perf_refresh()`); } catch (e) { err = e.message; }
eq("non-admin cannot refresh", err?.includes("admin only"), true);

// Build (as the cron would: no user).
await asUser(null);
eq("first build: 7 stints", (await one(`select perf_refresh() r`)).r.updated, 7);
await asUser(ADM);
const rep = async (from, to, f = {}) => (await one(`select get_perf_report('${from}', '${to}', '${JSON.stringify(f)}'::jsonb) r`)).r;
const oct = await rep("2026-10-01", "2026-10-31");
const t = oct.totals;
eq("October: 6 stints on 3 leads (lead 1 twice, lead 3 three times, lead 4; the 1 Nov 00:10 IST stint is November)", [t.stints, t.leads], [6, 3]);
eq("October origins: fresh 3, recycled 1, restored 1, admin-given 1", [t.fresh, t.recycled, t.restored, t.admin_given], [3, 1, 1, 1]);
eq("October results", { fu: t.followup, fum: t.followup_move, v: t.visit, vv: t.visit_verified, conv: t.converted, det: t.details_est, nc: t.not_connected, ni: t.not_interested, nr: t.no_result },
  { fu: 2, fum: 1, v: 1, vv: 1, conv: 1, det: 1, nc: 1, ni: 0, nr: 4 });
const byEmp = Object.fromEntries(oct.by_employee.map((r) => [r.name, r]));
eq("E1 October: 3 stints (fresh 2, admin-given 1), no visit (his 8 Oct visit was after his stint)", [byEmp["Emp One"].stints, byEmp["Emp One"].fresh, byEmp["Emp One"].admin_given, byEmp["Emp One"].visit], [3, 2, 1, 0]);
eq("E2 October: recycled + restored + fresh(merged lead); visit 1, converted 1", [byEmp["Emp Two"].stints, byEmp["Emp Two"].recycled, byEmp["Emp Two"].restored, byEmp["Emp Two"].visit, byEmp["Emp Two"].converted], [3, 1, 1, 1, 1]);
eq("sources: spellings merged, new spelling shown as Other", oct.by_source.map((r) => `${r.source}:${r.stints}`).sort(), ["99acres:3", "Other: NewPortal:3"]);
const nov = await rep("2026-11-01", "2026-11-30");
eq("November: the 00:10 IST DATA stint from fb = Meta, not interested", [nov.totals.stints, nov.by_source[0].source, nov.totals.not_interested, nov.by_employee_type[0].lead_type], [1, "Meta", 1, "DATA"]);
eq("filter: LEAD only + employee E2", (await rep("2026-10-01", "2026-10-31", { lead_type: "LEAD", employee_ids: [E2] })).totals.stints, 3);
eq("filter: source Meta in October = all zero", (await rep("2026-10-01", "2026-10-31", { sources: ["Meta"] })).totals.stints, 0);
const drill = (await one(`select get_perf_report_leads('2026-10-01', '2026-10-31', '{}'::jsonb, 'visit') r`)).r;
eq("drill-down: the visit is lead 1 with E2", drill.rows.map((r) => [r.lead_name, r.employee_name]), [["Lead 1", "Emp Two"]]);
eq("drill-down page size is capped at 200", (await one(`select jsonb_array_length((get_perf_report_leads('2026-10-01', '2026-10-31', '{}'::jsonb, 'stints', 5000) -> 'rows')) n`)).n, 6);
err = null;
try { await db.query(`select get_perf_report('2026-10-31', '2026-10-01')`); } catch (e) { err = e.message; }
eq("bad range is refused", err?.includes("bad date range"), true);

// Stable history: an old, ended stint is frozen; a fact added later does not change it. Active stints keep updating.
await db.exec(`update perf_stints set refreshed_at = now() - interval '10 days' where stint_id = '${H(1)}';
  insert into lead_activity_log (lead_id, lead_history_id, employee_id, activity_type, detail, created_at)
    values ('${L(1)}', '${H(1)}', '${E1}', 'STATUS_UPDATE', 'NOT_INTERESTED', '2026-10-06T10:00:00+05:30');
  insert into lead_activity_log (lead_id, lead_history_id, employee_id, activity_type, detail, created_at)
    values ('${L(3)}', '${H(6)}', '${E1}', 'STATUS_UPDATE', 'NOT_CONNECTED', '2026-10-26T10:00:00+05:30');`);
await asUser(null);
const r2 = (await one(`select perf_refresh() r`)).r;
eq("second refresh skips frozen rows", r2.updated < 7, true);
eq("frozen old stint keeps its result", (await one(`select last_result from perf_stints where stint_id = '${H(1)}'`)).last_result, "NOT_CONNECTED");
eq("active stint picks up the new result", (await one(`select last_result from perf_stints where stint_id = '${H(6)}'`)).last_result, "NOT_CONNECTED");
eq("a full rebuild (new definitions) recomputes the frozen row", ((await one(`select perf_refresh(true) r`)).r.updated, (await one(`select last_result from perf_stints where stint_id = '${H(1)}'`)).last_result), "NOT_INTERESTED");

// Rollback leaves nothing behind.
await db.exec(rb);
eq("rollback removes tables and functions", (await one(`select (select count(*) from pg_class where relname like 'perf\\_%') + (select count(*) from pg_proc where proname like 'perf\\_%' or proname like 'get_perf_report%') n`)).n, 0);
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
