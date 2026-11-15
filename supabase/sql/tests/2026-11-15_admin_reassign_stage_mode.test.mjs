// SQL test harness for supabase/sql/2026-11-15_admin_reassign_stage_mode.sql (in-memory Postgres, no live DB).
// Not part of the build: PGlite is not a project dependency. Run from a folder that has it installed:
//   npm i @electric-sql/pglite@0.2.17
//   node <this file> <stage_mode.sql> <stage_mode_rollback.sql> <admin_reassign_leads.sql> <live_defs.sql>
// live_defs.sql: the live definitions of force_reassign_lead_atomic, is_admin and reassign_keep_state_atomic
// (pg_get_functiondef), separated by lines of "=====".
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const [mig, rb, base, live] = process.argv.slice(2).map((f) => fs.readFileSync(f, "utf8"));
for (const [n, s] of [["migration", mig], ["rollback", rb]]) if (s.includes("\r")) throw new Error(n + " has CR");
const db = new PGlite();
const A = "00000000-0000-0000-0000-0000000000a1", NA = "00000000-0000-0000-0000-0000000000a2";
const ADM = "00000000-0000-0000-0000-0000000000e9", EMP = "00000000-0000-0000-0000-0000000000e8";
const OLD = "00000000-0000-0000-0000-0000000000e1", SALES = "00000000-0000-0000-0000-0000000000e2";
const OPS = "00000000-0000-0000-0000-0000000000e3", GONE = "00000000-0000-0000-0000-0000000000e4";
const L = (i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`;
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table employees (id uuid primary key, auth_user_id uuid, name text, role text, is_active boolean, department text);
create table leads (id uuid primary key, name text, status text, board_stage text, lead_type text, current_owner_id uuid,
  merged_into_lead_id uuid, board_stage_changed_at timestamptz, sla_deadline timestamptz, recycle_count int default 0, project text);
create table lead_history (id uuid primary key default gen_random_uuid(), lead_id uuid, employee_id uuid, assigned_at timestamptz,
  is_active boolean, call_count int, assigned_by_type text, assigned_by_employee_id uuid, reassign_note text, ended_reason text,
  last_activity_at timestamptz, paused_until timestamptz, pause_reason text, pause_note text, pause_verified_by uuid,
  pause_verified_at timestamptz, pause_expiry_warning_sent_at timestamptz, pause_expired_notified_at timestamptz);
create table lead_forced_removals (lead_id uuid, removed_employee_id uuid, removed_by uuid, reason text);
create table notification (employee_id uuid, employee_name text, title text, message text, type text, is_read boolean, related_lead_id uuid);
create table lead_engine_settings (id int primary key, sla_first_contact_minutes int, restore_protection_days int);
insert into lead_engine_settings values (1, 30, 14);
create table lead_guard_events (id serial primary key, source text, action text, lead_id uuid, lead_owner_id uuid, project text,
  mode text, detail jsonb, created_at timestamptz default now());
create table lead_activity_log (id uuid primary key default gen_random_uuid(), lead_id uuid, lead_history_id uuid, employee_id uuid,
  activity_type text, detail text);
create table lead_restore_log (id uuid primary key default gen_random_uuid(), lead_id uuid, restored_by uuid, to_employee_id uuid,
  reason text, highest_positive text, restored_status text, restored_stage text, protected_until timestamptz, sibling_bypassed boolean,
  sibling jsonb, prev_state jsonb, new_lead_history_id uuid, activity_id uuid);
create function log_guard_event(p_source text, p_action text, p_lead_id uuid, p_detail jsonb) returns void language sql as
  $$ insert into lead_guard_events (source, action, lead_id, detail) values (p_source, p_action, p_lead_id, p_detail) $$;
create function restore_sibling_block(p_lead uuid, p_emp uuid) returns jsonb language sql as $$ select null::jsonb $$;
create function current_employee_id() returns uuid language sql stable as $$ select id from employees where auth_user_id = auth.uid() and is_active $$;
create function current_employee_role() returns text language sql stable as $$ select role from employees where auth_user_id = auth.uid() and is_active $$;
create function is_lead_terminal(s text, b text) returns boolean language sql immutable as $$ select (s = 'CONVERTED' and b = 'BOOKING') or s = 'JUNK' $$;
create function compute_working_hours_sla_deadline(t timestamptz, m int) returns timestamptz language sql as $$ select t + make_interval(mins => m) $$;
insert into employees values ('${ADM}', '${A}', 'Admin', 'super_admin', true, 'admin'), ('${EMP}', '${NA}', 'Emp', 'employee', true, 'sales'),
  ('${OLD}', null, 'Old', 'employee', true, 'sales'), ('${SALES}', null, 'Sales', 'employee', true, 'sales'),
  ('${OPS}', null, 'Ops', 'employee', true, 'operations'), ('${GONE}', null, 'Gone', 'employee', false, 'sales');
`);
for (const def of live.split("=====")) if (def.trim()) await db.exec(def);
await db.exec(base);
// leads: 1 FOLLOW_UP, 2 VISIT/CONNECTED, 3 NEW/LEADS, 4 NOT_CONNECTED/LEADS, 5 CONNECTED/LEADS
const SEED = [[1, "NEW", "FOLLOW_UP"], [2, "CONNECTED", "VISIT"], [3, "NEW", "LEADS"], [4, "NOT_CONNECTED", "LEADS"], [5, "CONNECTED", "LEADS"]];
async function reseed() {
  await db.exec(`delete from lead_history; delete from leads; delete from lead_guard_events; delete from lead_restore_log; delete from lead_forced_removals;`);
  for (const [i, st, bs] of SEED) {
    await db.exec(`insert into leads (id, name, status, board_stage, lead_type, current_owner_id, recycle_count) values ('${L(i)}', 'L${i}', '${st}', '${bs}', 'LEAD', '${OLD}', 2);
      insert into lead_history (lead_id, employee_id, assigned_at, is_active, call_count, assigned_by_type) values ('${L(i)}', '${OLD}', now(), true, 3, 'SYSTEM');`);
  }
}
await db.exec(mig);
const out = [];
const ok = (n, c, e = "") => out.push([c ? "PASS" : "FAIL", n, e]);
const call = async (uid, ids, to, reason, mode) => {
  await db.query(`select set_config('test.uid', $1, false)`, [uid]);
  try {
    const sql = mode === undefined ? `select admin_reassign_leads($1::uuid[], $2::uuid, $3) j` : `select admin_reassign_leads($1::uuid[], $2::uuid, $3, $4) j`;
    const r = await db.query(sql, mode === undefined ? [ids, to, reason] : [ids, to, reason, mode]);
    return { data: r.rows[0].j };
  } catch (e) {
    return { error: e.message };
  }
};
const state = async () => Object.fromEntries((await db.query(`select right(id::text, 1) k, status || '/' || board_stage || '/' || (current_owner_id = '${SALES}' or current_owner_id = '${OPS}') v from leads`)).rows.map((r) => [r.k, r.v]));
const ALL = SEED.map(([i]) => L(i));

await reseed();
let r = await call(A, ALL, SALES, "Rebalance team", "auto");
let s = await state();
ok("auto: positive leads (1 FOLLOW_UP, 2 VISIT, 5 CONNECTED) keep their stage, others reset to NEW/LEADS",
  r.data?.kept === 3 && r.data?.reset === 2 && s["1"] === "NEW/FOLLOW_UP/true" && s["2"] === "CONNECTED/VISIT/true" && s["5"] === "CONNECTED/LEADS/true" && s["3"] === "NEW/LEADS/true" && s["4"] === "NEW/LEADS/true",
  JSON.stringify({ kept: r.data?.kept, reset: r.data?.reset, s, err: r.error }));
const prot = (await db.query(`select count(*)::int n, bool_and(protected_until between now() + interval '14 days' - interval '1 minute' and now() + interval '14 days' + interval '1 minute') in14 from lead_restore_log`)).rows[0];
ok("auto: kept leads get a 14-day protection row", prot.n === 3 && prot.in14 === true, JSON.stringify(prot));
const ev = (await db.query(`select detail->>'path' p, detail->>'stage_mode' m, count(*)::int n from lead_guard_events where source = 'admin_reassign' group by 1, 2 order by 1`)).rows;
ok("auto: every move logged with its mode and path", JSON.stringify(ev) === JSON.stringify([{ p: "keep", m: "auto", n: 3 }, { p: "reset", m: "auto", n: 2 }]), JSON.stringify(ev));

await reseed();
r = await call(A, ALL, SALES, "Rebalance team", "keep");
s = await state();
ok("keep: every lead keeps status and stage", r.data?.kept === 5 && s["4"] === "NOT_CONNECTED/LEADS/true" && s["1"] === "NEW/FOLLOW_UP/true", JSON.stringify({ r: r.data?.kept, s }));

await reseed();
r = await call(A, ALL, SALES, "Rebalance team", "reset");
s = await state();
ok("reset: every lead to NEW/LEADS (old behaviour)", r.data?.reset === 5 && Object.values(s).every((v) => v === "NEW/LEADS/true"), JSON.stringify(s));

await reseed();
r = await call(A, ALL, OPS, "Rebalance team", "auto");
const fails = (r.data?.results || []).filter((x) => !x.success).map((x) => x.lead_id.slice(-1)).sort().join(",");
ok("non-sales receiver in auto: the 3 positive leads fail with a clear message, the other 2 move",
  r.data?.reassigned === 2 && fails === "1,2,5" && /keeps its stage only with a sales employee/.test(JSON.stringify(r.data)), JSON.stringify({ reassigned: r.data?.reassigned, fails }));

await reseed();
r = await call(A, [L(1)], SALES, "move", "keep");
ok("keep path: reason shorter than 5 characters fails that lead with the keep-state message",
  r.data?.reassigned === 0 && /at least 5 characters/.test(JSON.stringify(r.data)), JSON.stringify(r.data?.results));

r = await call(A, Array.from({ length: 501 }, (_, i) => L(1000 + i)), SALES, "Rebalance team", "auto");
ok("501 leads refused", /at most 500 leads/.test(r.error || ""), r.error);
r = await call(NA, [L(3)], SALES, "Rebalance team", "auto");
ok("non-admin refused", /caller is not an admin/.test(r.error || ""), r.error);
r = await call(A, [L(3)], GONE, "Rebalance team", "auto");
ok("inactive receiver refused", /receiving employee is not active/.test(r.error || ""), r.error);
r = await call(A, [L(3)], SALES, "Rebalance team", "maybe");
ok("unknown mode refused", /stage mode must be auto, keep or reset/.test(r.error || ""), r.error);
r = await call(A, [L(3)], SALES, "  ", "auto");
ok("empty reason refused", /reason is required/.test(r.error || ""), r.error);

await reseed();
r = await call(A, [L(1)], SALES, "Rebalance team");
s = await state();
ok("3-argument call still works and still resets (old function, not ambiguous)", !r.error && r.data?.reassigned === 1 && s["1"] === "NEW/LEADS/true", r.error || JSON.stringify(s));

const g = (await db.query(`select has_function_privilege('anon','admin_reassign_leads(uuid[],uuid,text,text)','EXECUTE') a,
  has_function_privilege('public','admin_reassign_leads(uuid[],uuid,text,text)','EXECUTE') p,
  has_function_privilege('authenticated','admin_reassign_leads(uuid[],uuid,text,text)','EXECUTE') u`)).rows[0];
ok("grants: anon no, public no, authenticated yes", !g.a && !g.p && g.u, JSON.stringify(g));
await db.exec(rb);
const left = (await db.query(`select pronargs from pg_proc where proname = 'admin_reassign_leads' order by 1`)).rows.map((x) => x.pronargs);
ok("rollback removes only the 4-parameter overload", JSON.stringify(left) === "[3]", JSON.stringify(left));
for (const [st, n, e] of out) console.log(st, n, e ? "| " + String(e).slice(0, 200) : "");
console.log(out.every((x) => x[0] === "PASS") ? "ALL PASS" : "SOME FAILED");
