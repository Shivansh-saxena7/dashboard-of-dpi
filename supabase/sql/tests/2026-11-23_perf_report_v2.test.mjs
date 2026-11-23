// SQL test for supabase/sql/2026-11-23_perf_report_v2.sql on top of v1 (2026-11-20_perf_report.sql), in-memory
// Postgres; no live DB. Not part of the build: PGlite is not a project dependency. Run from a folder that has it:
//   npm i @electric-sql/pglite@0.2.17
//   node <this file> <2026-11-20_perf_report.sql> <2026-11-23_perf_report_v2.sql> <2026-11-23_perf_report_v2_rollback.sql>
// Same fixture as the v1 test. Known answers: "came as" adds up to the leads in every row (incl. a by-admin case),
// recycled at least once, employee x source (rows add up to each employee), several employees / sources at once,
// drill-down for came:* / recycled_any and the v1 fallback, v1 unchanged, admin-only, rollback leaves v1 working.
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const [mig, v2, v2rb] = process.argv.slice(2).map((f) => fs.readFileSync(f, "utf8"));
for (const [n, s] of [["v1", mig], ["v2", v2], ["v2 rollback", v2rb]]) if (s.includes("\r")) throw new Error(n + " has CR");
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
const sorted = (o) => Object.fromEntries(Object.entries(o || {}).sort(([a], [b]) => a.localeCompare(b)));
const asUser = async (uid) => db.exec(`select set_config('test.uid', '${uid ?? ""}', false)`);
const one = async (sql) => (await db.query(sql)).rows[0];

await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table employees (id uuid primary key, auth_user_id uuid, name text, role text, is_active boolean, team_id uuid);
create table teams (id uuid primary key, name text);
create function is_admin() returns boolean language sql stable as $$
  select exists (select 1 from employees where auth_user_id = auth.uid() and is_active and role in ('admin', 'super_admin')) $$;
create table lead_engine_settings (id int primary key, auto_junk_enabled boolean);
insert into lead_engine_settings values (1, true);
create table leads (id uuid primary key, name text, lead_type text, source text, project text, merged_into_lead_id uuid);
create table lead_history (id uuid primary key, lead_id uuid, employee_id uuid, assigned_at timestamptz, is_active boolean,
  assigned_by_type text, recycle_reason text, outcome text, call_count int, created_at timestamptz default now());
create table lead_activity_log (id uuid primary key default gen_random_uuid(), lead_id uuid, lead_history_id uuid, employee_id uuid,
  activity_type text, detail text, created_at timestamptz);
create table lead_notes (id serial, lead_id uuid, lead_history_id uuid, reminder_at timestamptz, created_at timestamptz);
create table site_visits (id serial, lead_id uuid, employee_id uuid, event_type text, created_at timestamptz, verified_at timestamptz, denied_at timestamptz);
create table contact_click_log (id serial, lead_id uuid, lead_history_id uuid, click_type text, clicked_at timestamptz);
create table lead_restore_log (id uuid primary key default gen_random_uuid(), lead_id uuid, new_lead_history_id uuid, restored_at timestamptz);
insert into teams values ('${T1}', 'Team One');
insert into employees values ('${E1}', '${E1}', 'Emp One', 'employee', true, '${T1}'), ('${E2}', '${E2}', 'Emp Two', 'employee', true, null),
  ('${ADM}', '${ADM}', 'Admin', 'admin', true, null);
-- L1: fresh to E1 (5 Oct, Not connected), recycled to E2 (7 Oct: Follow-up move, visit (verified), Converted). E1 logs a
--     visit on 8 Oct, after his stint ended: it counts for nobody.
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
  ('${L(1)}', '${E2}', 'REVISIT', '2026-10-09T15:00:00+05:30', null, null),
  ('${L(1)}', '${E1}', 'VISIT', '2026-10-08T16:00:00+05:30', null, null);
-- L2: DATA, source "fb" (-> Meta), fresh to E1 at 1 Nov 00:10 IST (= 31 Oct UTC): November. Not interested.
insert into leads values ('${L(2)}', 'Lead 2', 'DATA', 'fb', null, null);
insert into lead_history values ('${H(3)}', '${L(2)}', '${E1}', '2026-11-01T00:10:00+05:30', false, 'SYSTEM', null, 'NOT_INTERESTED', 1);
insert into lead_activity_log (lead_id, lead_history_id, employee_id, activity_type, detail, created_at) values
  ('${L(2)}', '${H(3)}', '${E1}', 'STATUS_UPDATE', 'NOT_INTERESTED', '2026-11-01T10:00:00+05:30');
-- L3: fresh to E1 (10 Oct), given back to E2 (20 Oct), given to E1 by an admin (25 Oct): reminder only (not a
--     follow-up), WhatsApp, no visit (details estimate). New source spelling "NewPortal".
insert into leads values ('${L(3)}', 'Lead 3', 'LEAD', 'NewPortal', 'P2', null);
insert into lead_history values ('${H(4)}', '${L(3)}', '${E1}', '2026-10-10T10:00:00+05:30', false, 'SYSTEM', null, null, 0),
  ('${H(5)}', '${L(3)}', '${E2}', '2026-10-20T10:00:00+05:30', false, 'ADMIN', null, null, 0),
  ('${H(6)}', '${L(3)}', '${E1}', '2026-10-25T10:00:00+05:30', true, 'ADMIN', null, null, 3);
insert into lead_restore_log (lead_id, new_lead_history_id, restored_at) values ('${L(3)}', '${H(5)}', '2026-10-20T10:00:00+05:30');
insert into lead_notes (lead_id, lead_history_id, reminder_at, created_at) values ('${L(3)}', '${H(6)}', '2026-10-27T10:00:00+05:30', '2026-10-25T11:00:00+05:30');
insert into contact_click_log (lead_id, lead_history_id, click_type, clicked_at) values ('${L(3)}', '${H(6)}', 'WHATSAPP', '2026-10-25T11:05:00+05:30');
-- L4: merged into L1 later; its stint still counts. Source " 99 Acres " -> 99acres. A status and a stage the report
--     has never seen (CALLBACK_LATER, NEGOTIATION): they must show under their own names.
insert into leads values ('${L(4)}', 'Lead 4', 'LEAD', ' 99 Acres ', 'P1', '${L(1)}');
insert into lead_history values ('${H(7)}', '${L(4)}', '${E2}', '2026-10-15T10:00:00+05:30', false, 'SYSTEM', null, null, 0);
insert into lead_activity_log (lead_id, lead_history_id, employee_id, activity_type, detail, created_at) values
  ('${L(4)}', '${H(7)}', '${E2}', 'STATUS_UPDATE', 'CALLBACK_LATER', '2026-10-15T12:00:00+05:30'),
  ('${L(4)}', '${H(7)}', '${E2}', 'BOARD_STAGE_MOVE', 'NEGOTIATION', '2026-10-15T12:05:00+05:30');
`);
await db.exec(mig);

await db.exec(v2);
await asUser(null);
await db.query("select perf_refresh()");
await asUser(ADM);
const v1rep = async () => (await one(`select get_perf_report('2026-10-01', '2026-10-31', '{}'::jsonb) r`)).r;
const rep = async (from, to, f = {}) => (await one(`select get_perf_report_v2('${from}', '${to}', '${JSON.stringify(f)}'::jsonb) r`)).r;
const came = (r) => [r.came_fresh, r.came_recycled, r.came_data, r.came_restored, r.came_admin_given, r.came_other];
const sum = (a) => a.reduce((x, y) => x + y, 0);
const KEYS = ["leads", "fresh", "recycled", "followup", "visit", "converted", "not_connected", "no_result"];
const oct = await rep("2026-10-01", "2026-10-31");
const v1t = (await v1rep()).totals;
eq("v2 keeps every v1 total", KEYS.map((k) => oct.totals[k]), KEYS.map((k) => v1t[k]));
eq("v2 keeps v1 status / stage mixes", [JSON.stringify(sorted(oct.totals.status_mix)), JSON.stringify(sorted(oct.totals.stage_mix))], [JSON.stringify(sorted(v1t.status_mix)), JSON.stringify(sorted(v1t.stage_mix))]);
eq("October came as (whole report): every lead first came fresh; one was recycled at least once", [came(oct.totals), oct.totals.recycled_any, oct.totals.recycled_stints], [[3, 0, 0, 0, 0, 0], 1, 1]);
const byEmp = Object.fromEntries(oct.by_employee.map((r) => [r.name, r]));
eq("E1 came as: fresh 2 (lead 3's first E1 assignment was fresh)", [came(byEmp["Emp One"]), byEmp["Emp One"].recycled_any], [[2, 0, 0, 0, 0, 0], 0]);
eq("E2 came as: recycled 1, given back 1, fresh 1 (33.3% each)", [came(byEmp["Emp Two"]), byEmp["Emp Two"].pct.came_recycled, byEmp["Emp Two"].recycled_any], [[1, 1, 0, 1, 0, 0], 33.3, 1]);
eq("came as adds up to leads in every row", [oct.totals, ...oct.by_employee, ...oct.by_source, ...oct.by_employee_type, ...oct.by_emp_source].every((r) => sum(came(r)) === r.leads), true);
const late = await rep("2026-10-21", "2026-10-31", { employee_ids: [E1] });
eq("a by-admin assignment as the first in the row = came by admin", [late.totals.leads, late.totals.came_admin_given], [1, 1]);
const nov = await rep("2026-11-01", "2026-11-30");
eq("a Data lead comes as Data", [nov.totals.came_data, nov.totals.came_fresh], [1, 0]);
const es = oct.by_emp_source.map((r) => `${r.employee_id === E1 ? "E1" : "E2"}|${r.source}:${r.leads}`).sort();
eq("employee x source rows", es, ["E1|99acres:1", "E1|Other: NewPortal:1", "E2|99acres:2", "E2|Other: NewPortal:1"]);
eq("employee x source rows add up to each employee (leads and every count)", oct.by_employee.every((e) => {
  const rows = oct.by_emp_source.filter((r) => r.employee_id === e.employee_id);
  return ["leads", "came_fresh", "came_recycled", "came_restored", "followup", "visit", "converted", "not_connected", "no_result"].every((k) => sum(rows.map((r) => r[k])) === e[k]);
}), true);
const e2a = oct.by_emp_source.find((x) => x.employee_id === E2 && x.source === "99acres");
eq("E2 x 99acres: recycled 1 + fresh 1, visit 1, converted 1", [e2a.came_recycled, e2a.came_fresh, e2a.visit, e2a.converted], [1, 1, 1, 1]);
eq("several employees at once", (await rep("2026-10-01", "2026-10-31", { employee_ids: [E1, E2] })).totals.leads, 3);
eq("several sources at once", [(await rep("2026-10-01", "2026-10-31", { sources: ["99acres", "Other: NewPortal"] })).totals.leads, (await rep("2026-10-01", "2026-10-31", { sources: ["99acres"] })).totals.leads, (await rep("2026-10-01", "2026-10-31", { sources: ["Meta"] })).totals.leads], [3, 2, 0]);
eq("dates for the page: today, data since, 800-day cap, api 2", [typeof oct.today, oct.data_since, oct.max_days, oct.api], ["string", "2026-10-05", 800, 2]);
eq("extra definitions", ["came_as", "recycled_any", "emp_source"].every((k) => oct.definitions.some((d) => d.key === k)), true);
const drill = async (metric, f = {}, from = "2026-10-01", to = "2026-10-31") => (await one(`select get_perf_report_leads_v2('${from}', '${to}', '${JSON.stringify(f)}'::jsonb, '${metric}') r`)).r;
eq("drill came:RECYCLED for E2 = lead 1", (await drill("came:RECYCLED", { employee_ids: [E2] })).rows.map((r) => r.lead_name), ["Lead 1"]);
eq("drill came:RESTORED for E2 = lead 3", (await drill("came:RESTORED", { employee_ids: [E2] })).rows.map((r) => r.lead_name), ["Lead 3"]);
eq("drill recycled_any = lead 1 (shown with its latest assignment)", (await drill("recycled_any")).rows.map((r) => [r.lead_name, r.employee_name]), [["Lead 1", "Emp Two"]]);
eq("drill came:DATA in November = lead 2", (await drill("came:DATA", {}, "2026-11-01", "2026-11-30")).rows.map((r) => r.lead_name), ["Lead 2"]);
eq("drill falls back to v1 for other metrics", [(await drill("visit")).rows.map((r) => r.lead_name), (await drill("status:CALLBACK_LATER")).rows.map((r) => r.lead_name)], [["Lead 1"], ["Lead 4"]]);
eq("drill totals match the counts", [(await drill("came:FRESH")).total, oct.totals.came_fresh], [3, 3]);
eq("drill page cap 200", (await one(`select jsonb_array_length((get_perf_report_leads_v2('2026-10-01', '2026-10-31', '{}'::jsonb, 'came:FRESH', 5000) -> 'rows')) n`)).n, 3);
await asUser(E1);
let err = null;
try { await db.query(`select get_perf_report_v2('2026-10-01', '2026-10-31')`); } catch (e) { err = e.message; }
eq("v2 is admin only", err?.includes("admin only"), true);
err = null;
try { await db.query(`select get_perf_report_leads_v2('2026-10-01', '2026-10-31', '{}'::jsonb, 'came:FRESH')`); } catch (e) { err = e.message; }
eq("v2 drill-down is admin only", err?.includes("admin only"), true);
err = null;
try { await db.query(`select get_perf_report_v2('2024-01-01', '2026-10-31')`); } catch (e) { err = e.message; }
eq("v2 refuses more than 800 days", err?.includes("bad date range") || err?.includes("admin only"), true);
await asUser(ADM);
err = null;
try { await db.query(`select get_perf_report_v2('2024-01-01', '2026-10-31')`); } catch (e) { err = e.message; }
eq("v2 refuses more than 800 days (as admin)", err?.includes("bad date range"), true);
await db.exec(v2rb);
eq("v2 rollback drops only the 3 v2 functions", (await one(`select (select count(*) from pg_proc where proname in ('perf_group_v2', 'get_perf_report_v2', 'get_perf_report_leads_v2'))::int a, (select count(*) from pg_proc where proname in ('perf_group', 'get_perf_report', 'get_perf_report_leads', 'perf_refresh'))::int b`)), { a: 0, b: 4 });
eq("v1 still answers after the v2 rollback", (await v1rep()).totals.leads, 3);
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
