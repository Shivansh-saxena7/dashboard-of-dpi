// SQL test for the simple Performance Report (2026-11-23_perf_report_v3.sql) and "give leads from the report"
// (2026-11-23_perf_report_reassign.sql + 2026-11-23_admin_report_reassign_mode.sql), in-memory Postgres; no live DB.
// Not part of the build: PGlite is not a project dependency. Run from a folder that has it:
//   npm i @electric-sql/pglite@0.2.17
//   node <this file> <v1.sql> <v3.sql> <v3_rollback.sql> <reassign.sql> <reassign_rollback.sql> <flag.sql> <flag_rollback.sql> <live_defs.sql>
// live_defs.sql: the live definitions (pg_get_functiondef) of admin_reassign_leads (both), force_reassign_lead_atomic,
// reassign_keep_state_atomic, is_admin, employee_in_return_grace, company_working_day, restore_sibling_block,
// log_guard_event, current_employee_id, current_employee_role, is_lead_terminal, separated by lines of "=====".
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const files = process.argv.slice(2).map((f) => fs.readFileSync(f, "utf8"));
const [v1, v3, v3rb, ra, rarb, flag, flagrb, live] = files;
for (const [i, s] of files.entries()) if (i < 7 && s.includes("\r")) throw new Error(`file ${i + 1} has CR`);
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
await db.exec(ra);
await db.exec(flag);

// October fixture (Part 1). L1: fresh to OLD 5 Oct, Not connected; recycled to SALES 7 Oct: Follow-up, Connected.
// L2: fresh to OLD 6 Oct, Not interested (reached). L3: DATA, fresh to SALES 8 Oct, no result; a visit (reached).
// L4: fresh to OLD 9 Oct, Not connected.
await db.exec(`
insert into leads (id, name, status, board_stage, lead_type, source, project, current_owner_id) values
  ('${L(1)}', 'Lead 1', 'CONNECTED', 'FOLLOW_UP', 'LEAD', '99acres', 'P1', '${SALES}'),
  ('${L(2)}', 'Lead 2', 'NOT_INTERESTED', 'LEADS', 'LEAD', 'fb', 'P1', '${OLD}'),
  ('${L(3)}', 'Lead 3', 'NEW', 'VISIT', 'DATA', '99acres', 'P2', '${SALES}'),
  ('${L(4)}', 'Lead 4', 'NOT_CONNECTED', 'LEADS', 'LEAD', '99acres', 'P1', '${OLD}');
insert into lead_history (id, lead_id, employee_id, assigned_at, is_active, assigned_by_type, recycle_reason, call_count) values
  ('${H(1)}', '${L(1)}', '${OLD}', '2026-10-05T10:00:00+05:30', false, 'SYSTEM', null, 2),
  ('${H(2)}', '${L(1)}', '${SALES}', '2026-10-07T10:00:00+05:30', true, 'SYSTEM', 'SLA_BREACHED', 1),
  ('${H(3)}', '${L(2)}', '${OLD}', '2026-10-06T10:00:00+05:30', true, 'SYSTEM', null, 1),
  ('${H(4)}', '${L(3)}', '${SALES}', '2026-10-08T10:00:00+05:30', true, 'SYSTEM', null, 0),
  ('${H(5)}', '${L(4)}', '${OLD}', '2026-10-09T10:00:00+05:30', true, 'SYSTEM', null, 3);
insert into lead_activity_log (lead_id, lead_history_id, employee_id, activity_type, detail, created_at) values
  ('${L(1)}', '${H(1)}', '${OLD}', 'STATUS_UPDATE', 'NOT_CONNECTED', '2026-10-05T12:00:00+05:30'),
  ('${L(1)}', '${H(2)}', '${SALES}', 'BOARD_STAGE_MOVE', 'FOLLOW_UP', '2026-10-07T12:00:00+05:30'),
  ('${L(1)}', '${H(2)}', '${SALES}', 'STATUS_UPDATE', 'CONNECTED', '2026-10-07T12:01:00+05:30'),
  ('${L(2)}', '${H(3)}', '${OLD}', 'STATUS_UPDATE', 'NOT_INTERESTED', '2026-10-06T12:00:00+05:30'),
  ('${L(4)}', '${H(5)}', '${OLD}', 'STATUS_UPDATE', 'NOT_CONNECTED', '2026-10-09T12:00:00+05:30');
insert into site_visits (lead_id, employee_id, event_type, created_at) values ('${L(3)}', '${SALES}', 'VISIT', '2026-10-09T15:00:00+05:30');
`);
await asUser(null);
await db.query("select perf_refresh()");
await asUser(ADMU);
const rep = async (from, to, f = {}) => (await one(`select get_perf_report_v3($1, $2, $3::jsonb) r`, [from, to, JSON.stringify(f)])).r;
const v1t = (await one(`select get_perf_report('2026-10-01', '2026-10-31', '{}'::jsonb) r`)).r.totals;
const oct = await rep("2026-10-01", "2026-10-31");
const K = ["leads", "fresh", "recycled", "followup", "visit", "converted", "not_connected", "not_interested", "no_result", "details_est"];
eq("v3 totals = v1 totals", K.map((k) => oct.totals[k]), K.map((k) => v1t[k]));
eq("connected: L1 (Connected), L2 (Not interested), L3 (visit) = 3 of 4 (75%)", [oct.totals.connected, oct.totals.pct.connected], [3, 75]);
const byE = Object.fromEntries(oct.by_employee.map((r) => [r.name, r]));
eq("connected per employee: OLD = L2 only (L1, L4 not connected); SALES = L1, L3", [byE.Old.connected, byE.Sales.connected], [1, 2]);
eq("several types at once", [(await rep("2026-10-01", "2026-10-31", { lead_types: ["LEAD", "DATA"] })).totals.leads, (await rep("2026-10-01", "2026-10-31", { lead_types: ["DATA"] })).totals.leads], [4, 1]);
eq("several Given as at once", (await rep("2026-10-01", "2026-10-31", { origins: ["FRESH", "RECYCLED"] })).totals.leads, 4);
const eo = oct.by_emp_origin.map((r) => `${r.employee_id === OLD ? "OLD" : "SALES"}|${r.origin}:${r.leads}`).sort();
eq("split by Given as", eo, ["OLD|FRESH:3", "SALES|FRESH:1", "SALES|RECYCLED:1"]);
eq("split rows add up to each employee", oct.by_employee.every((e) => oct.by_emp_origin.filter((r) => r.employee_id === e.employee_id).reduce((a, r) => a + r.leads, 0) === e.leads), true);
const drill = async (metric, f = {}) => (await one(`select get_perf_report_leads_v3('2026-10-01', '2026-10-31', $1::jsonb, $2) r`, [JSON.stringify(f), metric])).r;
const dc = await drill("connected");
eq("drill connected = L1, L2, L3", dc.rows.map((r) => r.lead_name).sort(), ["Lead 1", "Lead 2", "Lead 3"]);
const d4 = (await drill("leads", { employee_ids: [OLD] })).rows.find((r) => r.lead_name === "Lead 1");
eq("drill row carries the current owner and positive", [d4.employee_id, d4.current_owner_id, d4.positive, d4.available], [OLD, SALES, true, true]);

// Part 2: give from the report.
const items = (ids, owner) => JSON.stringify(ids.map((l) => ({ lead_id: l, expected_owner: owner })));
const count = async (t) => (await one(`select count(*)::int n from ${t}`)).n;
const before = [await count("lead_history"), await count("perf_reassign_batches"), await count("notification")];
const pv = (await one(`select admin_report_reassign_preview($1::jsonb, $2, 'give', false) r`, [items([L(2), L(4), L(1)], OLD), SALES])).r;
eq("preview: L2, L4 move; L1 skipped (owner is SALES, not OLD); nothing written",
  [pv.will_move, pv.positive_excluded, pv.skipped, before], [2, 0, { "owner changed since the list was opened": 1 }, [await count("lead_history"), await count("perf_reassign_batches"), await count("notification")]]);
const pvp = (await one(`select admin_report_reassign_preview($1::jsonb, $2, 'give', false) r`, [items([L(1)], SALES), OLD])).r;
eq("preview: a positive lead is excluded by default", [pvp.will_move, pvp.positive_excluded], [0, 1]);
const pvp2 = (await one(`select admin_report_reassign_preview($1::jsonb, $2, 'give', true) r`, [items([L(1)], SALES), OLD])).r;
eq("preview: included when asked, counted separately", [pvp2.will_move, pvp2.positive_included], [1, 1]);

const giveOff = await tryq(`select admin_reassign_leads_from_report($1::jsonb, $2, 'give', 'Flag is off test', null, false, 'key-flag-off') r`, [items([L(2)], OLD), SALES]);
eq("flag off: give refused, nothing moved", [/turned off/.test(giveOff.err || ""), await count("perf_reassign_batches")], [true, 0]);
await db.exec(`update lead_engine_settings set admin_report_reassign_mode = 'on' where id = 1`);
const give = (its, to, mode, inc, key, reason = "No result in 3 weeks, try again") =>
  tryq(`select admin_reassign_leads_from_report($1::jsonb, $2, $3, $4, 'Oct test', $5, $6) r`, [its, to, mode, reason, inc, key]);
let g = await give(items([L(2), L(4), L(1)], OLD), SALES, "give", false, "key-give-1");
eq("give: 2 moved, 1 skipped (owner changed)", [g.r?.r.moved, g.r?.r.skipped, g.r?.r.skipped_breakdown, g.err], [2, 1, { "owner changed since the list was opened": 1 }, undefined]);
const batch1 = g.r.r.batch_id;
const own = async (l) => (await one(`select current_owner_id o, status || '/' || board_stage s from leads where id = $1`, [l]));
eq("give: L2, L4 now with SALES (non-positive reset to NEW/LEADS)", [(await own(L(2))).o, (await own(L(4))).o, (await own(L(4))).s], [SALES, SALES, "NEW/LEADS"]);
const notes = (await db.query(`select message from notification where related_lead_id in ($1, $2)`, [L(2), L(4)])).rows.map((r) => r.message);
eq("employee sees only \"Given by admin\": notification and lead_history note carry no admin reason",
  [notes.length, notes.every((m) => m.includes("Given by admin") && !m.includes("3 weeks")),
   (await one(`select bool_and(reassign_note = 'Given by admin') b from lead_history where lead_id in ($1, $2) and assigned_by_type = 'ADMIN'`, [L(2), L(4)])).b],
  [2, true, true]);
eq("batch tag keeps the real reason (admin only)", (await one(`select reason, label, moved, skipped from perf_reassign_batches where id = $1`, [batch1])), { reason: "No result in 3 weeks, try again", label: "Oct test", moved: 2, skipped: 1 });
const g2 = await give(items([L(2), L(4), L(1)], OLD), SALES, "give", false, "key-give-1");
eq("idempotent retry: same key returns the first result, moves nothing", [g2.r?.r.repeat, g2.r?.r.batch_id, await count("perf_reassign_batches")], [true, batch1, 1]);
g = await give(items([L(1)], SALES), OLD, "give", false, "key-give-2");
eq("positive excluded by default", [g.r?.r.moved, g.r?.r.skipped_breakdown], [0, { "positive lead (excluded)": 1 }]);
g = await give(items([L(1)], SALES), OLD, "give", true, "key-give-3");
const l1 = await own(L(1));
eq("positive included: moves with its stage kept (keep path)", [g.r?.r.moved, g.r?.r.results[0].path, l1.o, l1.s], [1, "keep", OLD, "CONNECTED/FOLLOW_UP"]);
g = await give(items([L(1)], OLD), SALES, "give_back", true, "key-back-1");
eq("give back to someone who had it: L1 back to SALES", [g.r?.r.moved, (await own(L(1))).o], [1, SALES]);
g = await give(items([L(3)], SALES), OPS, "give_back", false, "key-back-2");
eq("give back refused for a non-Sales receiver (whole call)", /not in Sales/.test(g.err || ""), true);
await db.exec(`update employees set department = 'sales' where id = '${OPS}'`);
g = await give(items([L(3)], SALES), OPS, "give_back", true, "key-back-3");
eq("give back to someone who never had the lead: skipped", g.r?.r.skipped_breakdown, { "this employee never had the lead": 1 });
await db.exec(`update employees set department = 'operations' where id = '${OPS}'`);
for (const [who, re, name] of [[LEAVE, /on leave today/, "on leave"], [GRACE, /return grace/, "in return grace"], [GONE, /not active/, "inactive"]]) {
  g = await give(items([L(3)], SALES), who, "give", true, "key-guard-" + name);
  eq(`receiver ${name}: refused, nothing moved`, [re.test(g.err || ""), (await own(L(3))).o], [true, SALES]);
}
g = await give(JSON.stringify(Array.from({ length: 201 }, (_, i) => ({ lead_id: L(1000 + i), expected_owner: OLD }))), SALES, "give", false, "key-0201");
eq("201 leads refused", /between 1 and 200/.test(g.err || ""), true);
g = await give(JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ lead_id: L(1000 + i), expected_owner: OLD }))), SALES, "give", false, "key-0200");
eq("200 (one chunk) accepted; missing leads skipped", [g.r?.r.requested, g.r?.r.skipped], [200, 200]);
g = await give(JSON.stringify([{ lead_id: L(3), expected_owner: SALES }, { lead_id: L(3), expected_owner: SALES }]), OLD, "give", true, "key-dup-1");
eq("a lead twice in one call: refused (preview too)", [/twice/.test(g.err || ""), /twice/.test((await tryq(`select admin_report_reassign_preview($1::jsonb, $2, 'give', true) r`, [JSON.stringify([{ lead_id: L(3) }, { lead_id: L(3) }]), OLD])).err || "")], [true, true]);
g = await give(JSON.stringify([{ expected_owner: SALES }]), OLD, "give", true, "key-noid-1");
eq("an item without a lead_id: refused with a clear message", /needs a lead_id/.test(g.err || ""), true);
g = await give(items([L(3)], SALES), OLD, "give", true, "key-short", "no");
eq("reason under 5 characters refused", /at least 5 characters/.test(g.err || ""), true);

// Stint attribution: OLD keeps his own results for L2 / L4; SALES gets them as Given by admin (incl. the keep-path L1).
await asUser(null);
await db.query("select perf_refresh()");
await asUser(ADMU);
const all = await rep("2026-10-01", today);
const ae = Object.fromEntries(all.by_employee.map((r) => [r.name, r]));
eq("old owner's row keeps his results: L2 Not interested, L4 Not connected (L1's latest OLD assignment is the later by-admin one)", [ae.Old.not_interested, ae.Old.not_connected, ae.Old.connected], [1, 1, 1]);
eq("old stints frozen with the old owner: L1 / OLD = Not connected, L4 / OLD = Not connected", (await db.query(`select last_result r from perf_stints where stint_id in ($1, $2) and employee_id = $3 order by stint_id`, [H(1), H(5), OLD])).rows.map((r) => r.r), ["NOT_CONNECTED", "NOT_CONNECTED"]);
const so = all.by_emp_origin.filter((r) => r.employee_id === SALES).map((r) => `${r.origin}:${r.leads}`).sort();
eq("receiver: given by admin incl. the kept positive lead (not 'Given back')", so, ["ADMIN_GIVEN:3", "FRESH:1", "RECYCLED:1"]);

// Journey and batch outcome.
const j = { ...(await one(`select get_lead_journey($1) r`, [L(1)])).r, ...(await one(`select get_lead_report_batches($1) r`, [L(1)])).r };
eq("journey L1: OLD fresh -> SALES recycled -> OLD by admin -> SALES by admin, two batches with reasons",
  [j.stints.map((s) => `${s.employee_name}:${s.origin}`), j.batches.map((b) => `${b.mode}:${b.status}`), j.batches[0].reason],
  [["Old:FRESH", "Sales:RECYCLED", "Old:ADMIN_GIVEN", "Sales:ADMIN_GIVEN"], ["give:skipped", "give:skipped", "give:moved", "give_back:moved"], "No result in 3 weeks, try again"]);
await db.exec(`insert into lead_activity_log (lead_id, lead_history_id, employee_id, activity_type, detail)
  select lead_id, id, employee_id, 'STATUS_UPDATE', 'CONNECTED' from lead_history where lead_id = '${L(2)}' and is_active`);
const out = (await one(`select get_report_batch_outcome($1) r`, [batch1])).r;
eq("batch outcome: before (OLD) 1 connected of 2; after (SALES) 1 connected", [out.before.leads, out.before.connected, out.after.connected, out.leads.length], [2, 1, 1, 3]);
eq("batches list", (await one(`select jsonb_array_length(get_report_batches('2026-10-01', $1::date)) n`, [today])).n >= 5, true);

// Undo: L4 untouched since the batch goes back to OLD; L2 has a new result, so it stays.
const u = await tryq(`select admin_undo_report_batch($1, 'Undo the test batch', 'key-undo-1') r`, [batch1]);
eq("undo: L4 back to OLD, L2 skipped (new owner worked on it)", [u.r?.r.moved, u.r?.r.skipped_breakdown, (await own(L(4))).o, (await own(L(2))).o],
  [1, { "the new owner already worked on it": 1 }, OLD, SALES]);
eq("undo twice refused", /already undone/.test((await tryq(`select admin_undo_report_batch($1, 'Undo again please', 'key-undo-2') r`, [batch1])).err || ""), true);
eq("undo retry with the same key returns the first result", (await one(`select admin_undo_report_batch($1, 'Undo the test batch', 'key-undo-1') r`, [batch1])).r.repeat, true);

// Who can do what.
await asUser(EMP_U);
for (const [n, q, p] of [["preview", `select admin_report_reassign_preview($1::jsonb, $2, 'give', false)`, [items([L(3)], SALES), OLD]],
  ["give", `select admin_reassign_leads_from_report($1::jsonb, $2, 'give', 'some reason', null, false, 'key-emp-1')`, [items([L(3)], SALES), OLD]],
  ["undo", `select admin_undo_report_batch($1, 'some reason', 'key-emp-2')`, [batch1]], ["journey", `select get_lead_journey($1)`, [L(1)]], ["lead batches", `select get_lead_report_batches($1)`, [L(1)]],
  ["batches", `select get_report_batches('2026-10-01', '2026-12-31')`, []], ["outcome", `select get_report_batch_outcome($1)`, [batch1]],
  ["report v3", `select get_perf_report_v3('2026-10-01', '2026-10-31')`, []]]) {
  eq(`employee refused: ${n}`, /admin only/.test((await tryq(q, p)).err || ""), true);
}
await db.exec(`set role authenticated`);
eq("RLS: an employee reads no batch rows (tables exist, rows hidden)", [await count("perf_reassign_batches"), await count("perf_reassign_batch_leads")], [0, 0]);
await asUser(ADMU);
eq("RLS: an admin reads them", (await count("perf_reassign_batches")) > 0, true);
await db.exec(`reset role; set role anon`);
eq("anon cannot read the batch table", /permission denied/.test((await tryq(`select count(*) from perf_reassign_batches`)).err || ""), true);
await db.exec(`reset role`);
const gr = await one(`select has_function_privilege('anon', 'admin_reassign_leads_from_report(jsonb,uuid,text,text,text,boolean,text)', 'EXECUTE') a,
  has_function_privilege('authenticated', 'admin_reassign_leads_from_report(jsonb,uuid,text,text,text,boolean,text)', 'EXECUTE') u,
  has_function_privilege('anon', 'get_perf_report_v3(date,date,jsonb)', 'EXECUTE') a3`);
eq("grants: anon no, authenticated yes", [gr.a, gr.u, gr.a3], [false, true, false]);
const helpers = await one(`select bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE')) x from pg_proc p
  where p.proname in ('perf_stint_facts', 'perf_lead_is_positive', 'perf_reassign_receiver_problem', 'perf_reassign_verdict', 'perf_reassign_check_items', 'perf_reassign_enabled')`);
eq("internal helpers (no admin check of their own) not callable by employees", helpers.x, false);
eq("flag column added with default off (turned on above for the test)", (await one(`select column_default d from information_schema.columns where table_name = 'lead_engine_settings' and column_name = 'admin_report_reassign_mode'`)).d, "'off'::text");

// Rollback: everything new is gone; leads and their history stay; v1 still works.
const keep = [await count("lead_history"), await count("leads")];
await db.exec(flagrb); await db.exec(rarb); await db.exec(v3rb);
const left = (await one(`select count(*)::int n from pg_proc where proname in ('get_perf_report_v3', 'perf_group_v3', 'perf_stints_in_v3', 'get_perf_report_leads_v3',
  'admin_report_reassign_preview', 'admin_reassign_leads_from_report', 'admin_undo_report_batch', 'get_lead_journey', 'get_lead_report_batches', 'get_report_batches', 'get_report_batch_outcome',
  'perf_reassign_verdict', 'perf_stint_facts', 'perf_reassign_receiver_problem', 'perf_lead_is_positive')`)).n;
const tabs = (await one(`select count(*)::int n from pg_tables where tablename like 'perf_reassign%'`)).n;
const col = (await one(`select count(*)::int n from information_schema.columns where table_name = 'lead_engine_settings' and column_name = 'admin_report_reassign_mode'`)).n;
await asUser(ADMU);
eq("rollback: no new functions, tables or flag left; leads and history kept; v1 works",
  [left, tabs, col, [await count("lead_history"), await count("leads")], (await one(`select get_perf_report('2026-10-01', '2026-10-31', '{}'::jsonb) r`)).r.totals.leads], [0, 0, 0, keep, 4]);
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
