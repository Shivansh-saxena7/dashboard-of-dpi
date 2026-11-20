// SQL test for supabase/sql/2026-11-20_perf_report.sql (+ the flag file) in in-memory Postgres; no live DB. Not part
// of the build: PGlite is not a project dependency. Run from a folder that has it installed:
//   npm i @electric-sql/pglite@0.2.17
//   node <this file> <perf_report.sql> <perf_report_rollback.sql> <admin_report_mode.sql> <admin_report_mode_rollback.sql>
// Known answers (definitions v1): origins (fresh / recycled / given back / by admin), a visit credited only inside its
// stint window, counts as distinct leads, % of leads, NC / NI from the lead's latest stint, status and stage mixes
// (a new status and a new stage show under their own names), DATA, merged lead, source spellings, IST day boundary,
// frozen old rows, admin-only, drill-down, rollback.
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const [mig, rb, flag, flagRb] = process.argv.slice(2).map((f) => fs.readFileSync(f, "utf8"));
for (const [n, s] of [["migration", mig], ["rollback", rb], ["flag", flag], ["flag rollback", flagRb]]) if (s.includes("\r")) throw new Error(n + " has CR");
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

// Admin-only.
await asUser(E1);
let err = null;
try { await db.query(`select get_perf_report('2026-10-01', '2026-10-31')`); } catch (e) { err = e.message; }
eq("non-admin is refused", err?.includes("admin only"), true);
err = null;
try { await db.query(`select perf_refresh()`); } catch (e) { err = e.message; }
eq("non-admin cannot refresh", err?.includes("admin only"), true);

// Build (as the hourly job would: no user).
await asUser(null);
eq("first build: 7 stints", (await one(`select perf_refresh() r`)).r.updated, 7);
await asUser(ADM);
const rep = async (from, to, f = {}) => (await one(`select get_perf_report('${from}', '${to}', '${JSON.stringify(f)}'::jsonb) r`)).r;
const oct = await rep("2026-10-01", "2026-10-31");
const t = oct.totals;
eq("October: 3 leads in 6 stints (the 1 Nov 00:10 IST lead is November)", [t.leads, t.stints], [3, 6]);
eq("October origins as leads: fresh 3, recycled 1, given back 1, by admin 1", [t.fresh, t.recycled, t.restored, t.admin_given], [3, 1, 1, 1]);
eq("October: follow-up = stage move only (the reminder lead is not counted)", t.followup, 1);
eq("October: visit / verified / booked / converted / details estimate", [t.visit, t.visit_verified, t.booked, t.converted, t.details_est], [1, 1, 0, 1, 1]);
eq("October: NC / NI / no result from each lead's latest stint (lead 1's early NC is not its latest)", [t.not_connected, t.not_interested, t.no_result], [0, 0, 1]);
eq("October % of leads", { fresh: t.pct.fresh, followup: t.pct.followup, visit: t.pct.visit, converted: t.pct.converted, no_result: t.pct.no_result },
  { fresh: 100, followup: 33.3, visit: 33.3, converted: 33.3, no_result: 33.3 });
eq("status mix: a new status shows under its own name", [sorted(t.status_mix), sorted(t.status_pct)],
  [{ CALLBACK_LATER: 1, CONVERTED: 1, NO_RESULT: 1 }, { CALLBACK_LATER: 33.3, CONVERTED: 33.3, NO_RESULT: 33.3 }]);
eq("stage mix: furthest stage; a new stage shows under its own name", [sorted(t.stage_mix), sorted(t.stage_pct)],
  [{ LEADS: 1, NEGOTIATION: 1, VISIT: 1 }, { LEADS: 33.3, NEGOTIATION: 33.3, VISIT: 33.3 }]);
const byEmp = Object.fromEntries(oct.by_employee.map((r) => [r.name, r]));
const e1 = byEmp["Emp One"], e2 = byEmp["Emp Two"];
eq("E1: 2 leads; his own latest results: NC 1 (50%), no result 1; no visit (his 8 Oct visit was after his stint)",
  [e1.leads, e1.not_connected, e1.pct.not_connected, e1.no_result, e1.visit, e1.details_est], [2, 1, 50, 1, 0, 1]);
eq("E2: 3 leads; recycled, given back, fresh (merged lead); visit + converted 1 each (33.3%)",
  [e2.leads, e2.recycled, e2.restored, e2.fresh, e2.visit, e2.converted, e2.pct.converted], [3, 1, 1, 1, 1, 1, 33.3]);
eq("E1 status mix", sorted(e1.status_mix), sorted({ NOT_CONNECTED: 1, NO_RESULT: 1 }));
eq("sources: spellings merged, new spelling shown as Other", oct.by_source.map((r) => `${r.source}:${r.leads}`).sort(), ["99acres:2", "Other: NewPortal:1"]);
eq("options: employees, team, sources, projects in the range", [oct.options.employees.length, oct.options.teams.map((x) => x.name), oct.options.sources.sort(), oct.options.projects.sort()],
  [2, ["Team One"], ["99acres", "Other: NewPortal"], ["P1", "P2"]]);
eq("definitions are returned (version 1)", [oct.def_version, oct.definitions.some((d) => d.key === "followup" && d.rule.includes("Reminders alone do not count"))], [1, true]);
const nov = await rep("2026-11-01", "2026-11-30");
eq("November: the 00:10 IST DATA lead from fb = Meta, not interested 100%", [nov.totals.leads, nov.by_source[0].source, nov.totals.not_interested, nov.totals.pct.not_interested, nov.by_employee_type[0].lead_type], [1, "Meta", 1, 100, "DATA"]);
eq("filter: LEAD + E2", (await rep("2026-10-01", "2026-10-31", { lead_type: "LEAD", employee_ids: [E2] })).totals.leads, 3);
eq("filter: team (E1's team)", (await rep("2026-10-01", "2026-10-31", { team_ids: [T1] })).totals.leads, 2);
const empty = await rep("2026-10-01", "2026-10-31", { sources: ["Meta"] });
eq("no leads: zero totals, no % (the page shows –), empty tables", [empty.totals.leads, empty.totals.pct ?? null, empty.by_employee.length], [0, null, 0]);
const drill = async (metric, f = {}) => (await one(`select get_perf_report_leads('2026-10-01', '2026-10-31', '${JSON.stringify(f)}'::jsonb, '${metric}') r`)).r;
eq("drill-down visit: lead 1 with E2", (await drill("visit")).rows.map((r) => [r.lead_name, r.employee_name]), [["Lead 1", "Emp Two"]]);
eq("drill-down by status / stage name", [(await drill("status:CALLBACK_LATER")).rows.map((r) => r.lead_name), (await drill("stage:VISIT")).rows.map((r) => r.lead_name)], [["Lead 4"], ["Lead 1"]]);
eq("drill-down NC for E1 = lead 1 (his latest result)", (await drill("not_connected", { employee_ids: [E1] })).rows.map((r) => r.lead_name), ["Lead 1"]);
eq("drill-down one row per lead; total and 200 cap", [(await drill("leads")).total, (await one(`select jsonb_array_length((get_perf_report_leads('2026-10-01', '2026-10-31', '{}'::jsonb, 'leads', 5000) -> 'rows')) n`)).n], [3, 3]);
err = null;
try { await db.query(`select get_perf_report('2026-10-31', '2026-10-01')`); } catch (e) { err = e.message; }
eq("bad range is refused", err?.includes("bad date range"), true);

// Stable history: an old, ended stint is frozen; a later fact does not change it. Active stints keep updating.
await db.exec(`update perf_stints set refreshed_at = now() - interval '10 days' where stint_id = '${H(1)}';
  insert into lead_activity_log (lead_id, lead_history_id, employee_id, activity_type, detail, created_at)
    values ('${L(1)}', '${H(1)}', '${E1}', 'STATUS_UPDATE', 'NOT_INTERESTED', '2026-10-06T10:00:00+05:30');
  insert into lead_activity_log (lead_id, lead_history_id, employee_id, activity_type, detail, created_at)
    values ('${L(3)}', '${H(6)}', '${E1}', 'STATUS_UPDATE', 'NOT_CONNECTED', '2026-10-26T10:00:00+05:30');`);
await asUser(null);
eq("second refresh skips frozen rows", (await one(`select perf_refresh() r`)).r.updated < 7, true);
eq("frozen old stint keeps its result", (await one(`select last_result from perf_stints where stint_id = '${H(1)}'`)).last_result, "NOT_CONNECTED");
eq("active stint picks up the new result", (await one(`select last_result from perf_stints where stint_id = '${H(6)}'`)).last_result, "NOT_CONNECTED");
await db.query(`select perf_refresh(true)`);
eq("a full rebuild recomputes the frozen row", (await one(`select last_result from perf_stints where stint_id = '${H(1)}'`)).last_result, "NOT_INTERESTED");

// The page flag: additive column, default off; rollback removes it.
await db.exec(flag);
eq("flag column added, default off", (await one(`select admin_report_mode from lead_engine_settings where id = 1`)).admin_report_mode, "off");
err = null;
try { await db.exec(`update lead_engine_settings set admin_report_mode = 'maybe' where id = 1`); } catch (e) { err = e.message; }
eq("flag accepts only off / on", err?.includes("admin_report_mode_check"), true);
await db.exec(flagRb);
eq("flag rollback removes the column", (await one(`select count(*)::int n from information_schema.columns where table_name = 'lead_engine_settings' and column_name = 'admin_report_mode'`)).n, 0);

// Rollback leaves nothing behind.
await db.exec(rb);
eq("rollback removes tables and functions", (await one(`select (select count(*) from pg_class where relname like 'perf\\_%') + (select count(*) from pg_proc where proname like 'perf\\_%' or proname like 'get_perf_report%') n`)).n, 0);
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
