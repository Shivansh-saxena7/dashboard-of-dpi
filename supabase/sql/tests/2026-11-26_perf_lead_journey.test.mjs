// SQL test for supabase/sql/2026-11-26_perf_lead_journey.sql (Lead Journey, definitions v3). In-memory Postgres, no live
// DB. Not part of the build: PGlite is not a project dependency. Run from a folder that has it:
//   npm i @electric-sql/pglite@0.2.17
//   node <this file> <2026-11-20_perf_report.sql> <2026-11-23_perf_report_v3.sql> <2026-11-25_perf_report_v4.sql> <2026-11-26_perf_lead_journey.sql> <..._rollback.sql> <live_defs.sql>
// Known answers (October unless noted): A fresh, no positive, sweep recycles to B, B positive => A missed, B won from
// others; A positive then B positive => assist (not won for B); admin give / give back / leave / inactive => not missed;
// under 3 days with no call or action => not missed; positive after 60 days => not missed; the same lead given to A twice
// => two assignments, missed once; Lead / Data and Fresh / Recycled filters; a later sweep does not change October.
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const files = process.argv.slice(2).map((f) => fs.readFileSync(f, "utf8"));
const [v1, v3, v4, lj, ljrb, live] = files;
for (const [i, s] of files.entries()) if (i < 5 && s.includes("\r")) throw new Error(`file ${i + 1} has CR`);
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
await db.exec(v4);
const A = OLD, B = SALES, C = OPS;
const T = (d) => `2026-${d}:00+05:30`;
// lead i: [type, [stints: employee, start, by ('F' fresh | 'R' recycle | 'A' admin | 'S' give back), calls]]
const leads = {
  1: ["LEAD", [[A, "10-01T10:00", "F", 2], [B, "10-10T10:00", "R", 1]]],
  2: ["LEAD", [[A, "10-02T10:00", "F", 1], [B, "10-15T10:00", "R", 1]]],
  3: ["LEAD", [[A, "10-03T10:00", "F", 1], [B, "10-08T10:00", "A", 1]]],
  4: ["LEAD", [[A, "10-04T10:00", "F", 0], [B, "10-05T10:00", "R", 1]]],
  5: ["LEAD", [[A, "08-01T10:00", "F", 1], [B, "08-05T10:00", "R", 0], [C, "08-20T10:00", "R", 1]]],
  6: ["LEAD", [[LEAVE, "10-06T10:00", "F", 1], [B, "10-12T10:00", "R", 1]]],
  7: ["LEAD", [[GONE, "10-06T10:00", "F", 1], [B, "10-20T10:00", "R", 1]]],
  8: ["LEAD", [[A, "10-07T10:00", "F", 1], [B, "10-09T10:00", "R", 1], [A, "10-13T10:00", "R", 1], [C, "10-17T10:00", "R", 1]]],
  9: ["DATA", [[A, "10-08T10:00", "F", 1], [B, "10-12T10:00", "R", 1]]],
  10: ["LEAD", [[A, "10-09T10:00", "F", 1], [B, "10-11T10:00", "S", 1]]],
  11: ["LEAD", [[A, "09-01T10:00", "F", 1], [B, "09-05T10:00", "R", 1], [A, "09-12T10:00", "R", 1]]],
};
let sql = "";
for (const [i, [type, st]] of Object.entries(leads)) {
  const last = st[st.length - 1][0];
  sql += `insert into leads (id, name, status, board_stage, lead_type, source, project, current_owner_id) values ('${L(i)}', 'Lead ${i}', 'NEW', 'LEADS', '${type}', '99acres', 'P1', '${last}');\n`;
  st.forEach(([emp, at, by, calls], k) => {
    const hid = H(Number(i) * 100 + k);
    sql += `insert into lead_history (id, lead_id, employee_id, assigned_at, is_active, assigned_by_type, recycle_reason, call_count) values ('${hid}', '${L(i)}', '${emp}', '${T(at)}', ${k === st.length - 1}, '${by === "A" || by === "S" ? "ADMIN" : "SYSTEM"}', ${by === "R" ? "'SLA_BREACHED'" : "null"}, ${calls});\n`;
    if (by === "S") sql += `insert into lead_restore_log (lead_id, new_lead_history_id) values ('${L(i)}', '${hid}');\n`;
  });
}
const ev = (lead, k, type, detail, at, emp) => `insert into lead_activity_log (lead_id, lead_history_id, employee_id, activity_type, detail, created_at) values ('${L(lead)}', '${H(lead * 100 + k)}', '${emp}', '${type}', '${detail}', '${T(at)}');\n`;
sql += ev(1, 0, "STATUS_UPDATE", "NOT_CONNECTED", "10-02T12:00", A) + ev(1, 1, "STATUS_UPDATE", "CONNECTED", "10-12T12:00", B);
sql += ev(2, 0, "STATUS_UPDATE", "CONNECTED", "10-03T12:00", A) + ev(2, 1, "BOARD_STAGE_MOVE", "FOLLOW_UP", "10-16T12:00", B);
sql += ev(3, 1, "STATUS_UPDATE", "CONNECTED", "10-09T12:00", B);
sql += ev(4, 1, "STATUS_UPDATE", "CONNECTED", "10-06T12:00", B);
sql += ev(5, 2, "STATUS_UPDATE", "CONNECTED", "10-25T12:00", C);
sql += ev(6, 1, "STATUS_UPDATE", "CONNECTED", "10-13T12:00", B);
sql += ev(7, 0, "STATUS_UPDATE", "NOT_CONNECTED", "10-07T12:00", GONE) + ev(7, 1, "STATUS_UPDATE", "CONNECTED", "10-21T12:00", B);
sql += ev(8, 3, "STATUS_UPDATE", "CONNECTED", "10-18T12:00", C);
sql += ev(9, 1, "STATUS_UPDATE", "CONVERTED", "10-14T12:00", B);
sql += ev(10, 1, "STATUS_UPDATE", "CONNECTED", "10-12T12:00", B);
sql += `insert into site_visits (lead_id, employee_id, event_type, created_at, verified_at, denied_at) values ('${L(11)}', '${A}', 'VISIT', '${T("09-15T12:00")}', null, null);\n`;
sql += `insert into employee_leave_periods (employee_id, start_date, end_date) values ('${LEAVE}', '2026-10-11', '2026-10-12');\n`;
await db.exec(sql);
const refresh = async () => { await asUser(null); await db.query("select perf_refresh()"); await asUser(ADMU); };
await refresh();
await db.exec(lj);
await asUser(ADMU);
const rep = async (from, to, f = {}) => (await one(`select get_perf_journey($1, $2, $3::jsonb) r`, [from, to, JSON.stringify(f)])).r;
const rows = async (from, to, f, view, emp) => (await one(`select get_perf_journey_rows($1, $2, $3::jsonb, $4, $5, 200, 0) r`, [from, to, JSON.stringify(f), view, emp])).r;
const K = ["leads", "assignments", "positive", "moved_no_pos", "missed", "not_counted", "won", "assist"];
const row = (r, e) => r.by_employee.find((x) => x.employee_id === e) ?? {};
const pick = (x) => K.map((k) => Number(x[k] ?? 0));
const leadNo = (r) => r.rows.map((x) => Number(x.lead_id.slice(-12))).sort((a, b) => a - b);

const oct = await rep("2026-10-01", "2026-10-31");
eq("api journey1, definitions v3 (missed rule names 60 days), low sample", [oct.api, oct.def_version, oct.definitions.some((d) => d.key === "journey_missed" && /60 days/.test(d.rule)), row(oct, A).low_sample], ["journey1", 3, true, true]);
eq("A: 7 leads / 8 assignments (lead 8 twice); 1 positive; 6 moved on; missed 3 (leads 1, 8, 9); not counted 3 (admin, under 3 days, give back); assist 1 (lead 2)",
  pick(row(oct, A)), [7, 8, 1, 6, 3, 3, 0, 1]);
eq("B: 9 leads; 8 positive; won from others 7 (not lead 2: A had a positive); missed 1 (lead 8, C won it); assist 1 (lead 2, both sides)", pick(row(oct, B)), [9, 9, 8, 1, 1, 0, 7, 1]);
eq("C: lead 8 won from others", pick(row(oct, C)), [1, 1, 1, 0, 0, 0, 1, 0]);
eq("on leave when moved: not missed, not counted", pick(row(oct, LEAVE)), [1, 1, 0, 1, 0, 1, 0, 0]);
eq("inactive (moved after the last action): not missed, not counted", pick(row(oct, GONE)), [1, 1, 0, 1, 0, 1, 0, 0]);
eq("A %: missed 3 of 7 leads = 42.9; assist 14.3", [row(oct, A).pct.missed, row(oct, A).pct.assist], [42.9, 14.3]);
eq("team: missed 4, won 8, assist 2", [oct.team.missed, oct.team.won, oct.team.assist].map(Number), [4, 8, 2]);
eq("drill A missed = leads 1, 8, 9", leadNo(await rows("2026-10-01", "2026-10-31", {}, "missed", A)), [1, 8, 9]);
eq("drill A not counted = leads 3, 4, 10", leadNo(await rows("2026-10-01", "2026-10-31", {}, "not_counted", A)), [3, 4, 10]);
eq("drill A assist = lead 2", leadNo(await rows("2026-10-01", "2026-10-31", {}, "assist", A)), [2]);
const j8 = (await rows("2026-10-01", "2026-10-31", {}, "missed", A)).rows.find((x) => x.lead_id === L(8));
eq("lead 8 journey: A, B, A, C; C got it; moves by the system; no client name in the row",
  [j8.steps.map((s) => [s.employee_id === A ? "A" : s.employee_id === B ? "B" : "C", s.result, s.move]), j8.got_by === C, "name" in j8 || "lead_name" in j8],
  [[["A", "NO_RESULT", "system"], ["B", "NO_RESULT", "system"], ["A", "NO_RESULT", "system"], ["C", "CONNECTED", null]], true, false]);
eq("journeys: first page in the main answer, one row per lead (9 leads given in October)", [oct.journeys.total, oct.journeys.rows.length], [9, 9]);

const sep = await rows("2026-09-01", "2026-09-30", {}, "all", null);
const j11 = sep.rows.find((x) => x.lead_id === L(11));
eq("A, B, A on lead 11, visit in A's second assignment: credited there only (not to the first); B missed it (A won it back)", j11.steps.map((s) => [s.positive, s.missed, s.won]), [[false, false, false], [false, true, false], [true, false, true]]);
const aug = await rep("2026-08-01", "2026-08-31");
eq("August: positive 81 days after it left A (66 after B) => nobody missed; C won it", [pick(row(aug, A)), pick(row(aug, B)), Number(row(aug, C).won)], [[1, 1, 0, 1, 0, 0, 0, 0], [1, 1, 0, 1, 0, 0, 0, 0], 1]);

eq("Data only: A lead 9 missed", pick(row(await rep("2026-10-01", "2026-10-31", { lead_types: ["DATA"] }), A)), [1, 1, 0, 1, 1, 0, 0, 0]);
eq("Lead only: A 6 leads, missed 2", pick(row(await rep("2026-10-01", "2026-10-31", { lead_types: ["LEAD"] }), A)).slice(0, 5), [6, 7, 1, 5, 2]);
eq("Fresh only: A 7 leads, 7 assignments", pick(row(await rep("2026-10-01", "2026-10-31", { origins: ["FRESH"] }), A)).slice(0, 2), [7, 7]);
const rec = await rep("2026-10-01", "2026-10-31", { origins: ["RECYCLED"] });
eq("Recycled only: A lead 8 again (missed); B 7 recycled assignments", [pick(row(rec, A)), Number(row(rec, B).leads)], [[1, 1, 0, 1, 1, 0, 0, 0], 7]);
eq("employee filter: only A's row", (await rep("2026-10-01", "2026-10-31", { employee_ids: [A] })).by_employee.map((x) => x.employee_id), [A]);

// Later system moves: the sweep recycles lead 2 from B to C (Nov 20), lead 1's stage changes; October stays the same.
await db.exec(`update lead_history set is_active = false where id = '${H(201)}';
insert into lead_history (id, lead_id, employee_id, assigned_at, is_active, assigned_by_type, recycle_reason, call_count) values ('${H(202)}', '${L(2)}', '${C}', '${T("11-20T10:00")}', true, 'SYSTEM', 'FOLLOWUP_INACTIVITY_RECYCLE_READY', 0);
update leads set board_stage = 'FOLLOW_UP' where id = '${L(1)}';`);
await refresh();
const oct2 = await rep("2026-10-01", "2026-10-31");
eq("after a later sweep and a stage change: October A / B / C the same", [pick(row(oct2, A)), pick(row(oct2, B)), pick(row(oct2, C))], [pick(row(oct, A)), pick(row(oct, B)), pick(row(oct, C))]);
const allRows = (r) => [r.team, ...r.by_employee];
eq("no % over 100; every count within leads", [oct, oct2, aug, rec].every((r) => allRows(r).every((x) => Object.values(x.pct).every((v) => v === null || v <= 100)
  && ["positive", "missed", "won", "assist", "not_counted", "moved_no_pos"].every((k) => Number(x[k]) <= Number(x.leads)))), true);

await asUser(EMP_U);
eq("admin only", [/admin only/.test((await tryq(`select get_perf_journey('2026-10-01', '2026-10-31')`)).err || ""), /admin only/.test((await tryq(`select get_perf_journey_rows('2026-10-01', '2026-10-31', '{}'::jsonb)`)).err || "")], [true, true]);
await asUser(ADMU);
eq("bad view / bad range refused", [/bad view/.test((await tryq(`select get_perf_journey_rows('2026-10-01', '2026-10-31', '{}'::jsonb, 'x')`)).err || ""), /bad date range/.test((await tryq(`select get_perf_journey('2026-10-31', '2026-10-01')`)).err || "")], [true, true]);
const g = await one(`select has_function_privilege('anon', 'get_perf_journey(date,date,jsonb)', 'EXECUTE') a, has_function_privilege('anon', 'get_perf_journey_rows(date,date,jsonb,text,uuid,int,int)', 'EXECUTE') a2,
  has_function_privilege('authenticated', 'perf_journey_stints_v1(date,date,jsonb)', 'EXECUTE') h, has_function_privilege('authenticated', 'perf_journey_json(date,date,jsonb,text,uuid,int,int,boolean)', 'EXECUTE') h2,
  has_function_privilege('authenticated', 'get_perf_journey(date,date,jsonb)', 'EXECUTE') ok`);
eq("grants: anon no; helpers not for employees; the RPC for signed-in users (it checks admin)", [g.a, g.a2, g.h, g.h2, g.ok], [false, false, false, false, true]);
eq("v4 report unchanged next to it", (await one(`select get_perf_report_v4('2026-10-01', '2026-10-31') ->> 'api' a`)).a, "4");
await db.exec(ljrb);
eq("rollback: journey functions gone, definitions v3 gone, v4 still answers", [(await one(`select count(*)::int n from pg_proc where proname in ('get_perf_journey', 'get_perf_journey_rows', 'perf_journey_json', 'perf_journey_pct', 'perf_journey_stints_v1')`)).n, (await one(`select count(*)::int n from perf_definitions where version = 3`)).n, (await one(`select get_perf_report_v4('2026-10-01', '2026-10-31') ->> 'def_version' a`)).a], [0, 0, "2"]);
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
