// SQL test harness for supabase/sql/2026-11-15_delete_blocker.sql (in-memory Postgres, no live DB).
// Not part of the build: PGlite is not a project dependency. Run from any folder that has it installed:
//   npm i @electric-sql/pglite@0.2.17 && node delete_blocker.test.mjs <delete_blocker.sql> <delete_blocker_rollback.sql>
// Read-only harness (no live DB): the delete-blocker DRAFT on an in-memory Postgres with stub tables and FKs.
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const [mig, rb] = process.argv.slice(2).map((f) => fs.readFileSync(f, "utf8"));
const db = new PGlite();
const SA = "00000000-0000-0000-0000-0000000000a1", AD = "00000000-0000-0000-0000-0000000000a2";
const E = (n) => `00000000-0000-0000-0000-0000000000e${n}`, L = (n) => `00000000-0000-0000-0000-00000000000${n}`;
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table employees (id uuid primary key, auth_user_id uuid, name text, role text, is_active boolean);
create table leads (id uuid primary key, current_owner_id uuid references employees(id), merged_into_lead_id uuid references leads(id), csv_import_batch_id uuid, board_stage text);
create table lead_history (id uuid primary key default gen_random_uuid(), lead_id uuid references leads(id) on delete cascade, employee_id uuid references employees(id), outcome_at timestamptz);
create table lead_notes (id serial, lead_id uuid references leads(id) on delete cascade);
create table site_visits (id serial, lead_id uuid references leads(id) on delete cascade);
create table tracking (id serial, employee_id uuid references employees(id) on delete cascade);
create table system_anomaly_log (id serial, source text, severity text, message text, context jsonb);
create function current_employee_id() returns uuid language sql stable as $$ select id from employees where auth_user_id = auth.uid() and is_active $$;
create function current_employee_role() returns text language sql stable as $$ select role from employees where auth_user_id = auth.uid() and is_active $$;
insert into employees values ('${E(9)}', '${SA}', 'Super', 'super_admin', true), ('${E(8)}', '${AD}', 'Admin', 'admin', true),
  ('${E(1)}', null, 'Empty', 'employee', true), ('${E(2)}', null, 'Gps', 'employee', true), ('${E(3)}', null, 'Owner', 'employee', true);
insert into tracking (employee_id) values ('${E(2)}'), ('${E(2)}');
insert into leads values ('${L(1)}', '${E(3)}', null, null, 'FOLLOW_UP'), ('${L(2)}', '${E(3)}', null, '${E(7)}', 'LEADS'), ('${L(3)}', '${E(3)}', null, null, 'LEADS');
insert into lead_history (lead_id, employee_id, outcome_at) values ('${L(1)}', '${E(3)}', now()), ('${L(2)}', '${E(3)}', null), ('${L(3)}', '${E(3)}', null);
insert into lead_notes (lead_id) values ('${L(1)}');
`);
await db.exec(mig);
const out = [];
const ok = (n, c, e = "") => out.push([c ? "PASS" : "FAIL", n, e]);
const run = async (uid, sql) => {
  await db.query(`select set_config('test.uid', $1, false)`, [uid]);
  try { const r = await db.query(sql); return { rows: r.rows }; } catch (e) { return { error: e.message, code: e.code, detail: e.detail }; }
};
const count = async (sql) => (await db.query(sql)).rows[0].n;

let r = await run("", `delete from employees where id = '${E(1)}'`);
ok("empty employee: delete allowed", !r.error, r.error);
r = await run("", `delete from employees where id = '${E(2)}'`);
ok("employee with GPS tracking (CASCADE): refused, 23503 names tracking, nothing deleted",
  r.code === "23503" && /on table "tracking"/.test(r.error) && (await count(`select count(*)::int n from tracking`)) === 2, `${r.code} ${r.error} | ${r.detail}`);
r = await run("", `delete from employees where id = '${E(3)}'`);
ok("employee owning leads: refused", r.code === "23503", r.detail);
r = await run("", `delete from leads where id = '${L(1)}'`);
ok("worked lead (history + note, CASCADE): refused, history kept",
  r.code === "23503" && (await count(`select count(*)::int n from lead_history where lead_id = '${L(1)}'`)) === 1, r.detail);
r = await run("", `delete from leads where id = '${L(2)}'`);
ok("untouched CSV-import lead: delete allowed (delete_csv_batch_atomic keeps working)", !r.error, r.error);
r = await run("", `delete from leads where id = '${L(3)}'`);
ok("non-CSV lead with one history row: refused", r.code === "23503", r.detail);
r = await run(AD, `select admin_force_delete('leads', '${L(1)}', 'mistake')`);
ok("force by an Admin (not Super Admin): refused", /only a Super Admin/.test(r.error || ""), r.error);
r = await run(SA, `select admin_force_delete('leads', '${L(1)}', '  ')`);
ok("force without a reason: refused", /reason is required/.test(r.error || ""), r.error);
await run(SA, `select set_config('app.force_delete_txid', '12345', false)`);
r = await run(SA, `delete from leads where id = '${L(1)}'`);
ok("a hand-set flag with the wrong transaction id does not bypass", r.code === "23503" && /delete_blocker/.test(r.error || ""), r.error);
await run(SA, `select set_config('app.force_delete_txid', '', false)`);
r = await run(SA, `select admin_force_delete('leads', '${L(1)}', 'duplicate test lead') j`);
ok("force by a Super Admin: deletes, logs the linked counts to system_anomaly_log",
  !r.error && (await count(`select count(*)::int n from leads where id = '${L(1)}'`)) === 0 &&
  (await count(`select count(*)::int n from system_anomaly_log where source = 'admin_force_delete:leads' and context->'linked'->>'lead_history.lead_id' = '1'`)) === 1,
  r.error || JSON.stringify(r.rows[0].j));
r = await run(SA, `select admin_force_delete('employees', '${E(3)}', 'test')`);
ok("force on an employee still refused by a NO ACTION FK (leads owned)", r.code === "23503" && !/delete_blocker/.test(r.error), r.error);
r = await run("", `delete from leads where id = '${L(3)}'`);
ok("flag does not leak to the next statement", r.code === "23503", r.error);
const g = (await db.query(`select has_function_privilege('anon','admin_force_delete(text,uuid,text)','EXECUTE') a, has_function_privilege('anon','delete_blocker_counts(regclass,uuid)','EXECUTE') b`)).rows[0];
ok("grants: anon cannot run either function", !g.a && !g.b, JSON.stringify(g));
await db.exec(rb);
r = await run("", `delete from leads where id = '${L(3)}'`);
ok("after rollback: delete behaves as before (cascades)", !r.error && (await count(`select count(*)::int n from lead_history where lead_id = '${L(3)}'`)) === 0, r.error);
for (const [s, n, e] of out) console.log(s, n, e ? "| " + String(e).slice(0, 160) : "");
console.log(out.every((x) => x[0] === "PASS") ? "ALL PASS" : "SOME FAILED");
