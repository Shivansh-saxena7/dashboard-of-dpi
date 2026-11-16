// SQL test harness for supabase/sql/2026-11-16_admin_edit_leave_end_date.sql (in-memory Postgres, no live DB).
// Not part of the build: PGlite is not a project dependency. Run from a folder that has it installed:
//   npm i @electric-sql/pglite@0.2.17 && node <this file> <migration.sql> <rollback.sql> <is_admin_def.sql>
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const [mig, rb, isAdminDef] = process.argv.slice(2).map((f) => fs.readFileSync(f, "utf8"));
for (const [n, s] of [["migration", mig], ["rollback", rb]]) if (s.includes("\r")) throw new Error(n + " has CR");
const db = new PGlite();
const A = "00000000-0000-0000-0000-0000000000a1", NA = "00000000-0000-0000-0000-0000000000a2";
const ADM = "00000000-0000-0000-0000-0000000000e9", EMP = "00000000-0000-0000-0000-0000000000e8";
const TANU = "00000000-0000-0000-0000-0000000000e1", RAJA = "00000000-0000-0000-0000-0000000000e2";
const L1 = "00000000-0000-0000-0000-00000000aa01", L2 = "00000000-0000-0000-0000-00000000aa02", L3 = "00000000-0000-0000-0000-00000000aa03";
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table employees (id uuid primary key, auth_user_id uuid, name text, role text, is_active boolean);
create table employee_leave_periods (id uuid primary key, employee_id uuid, start_date date, end_date date, reason text, marked_by_employee_id uuid, created_at timestamptz default now(), open_ended_nudge_sent_at timestamptz);
create table lead_guard_events (id serial primary key, source text, action text, lead_id uuid, lead_owner_id uuid, project text, mode text, detail jsonb, created_at timestamptz default now());
create function current_employee_id() returns uuid language sql stable as $$ select id from employees where auth_user_id = auth.uid() and is_active $$;
insert into employees values ('${ADM}', '${A}', 'Admin', 'admin', true), ('${EMP}', '${NA}', 'Emp', 'employee', true), ('${TANU}', null, 'Tanu', 'employee', true), ('${RAJA}', null, 'Raja', 'employee', true);
insert into employee_leave_periods (id, employee_id, start_date, end_date, reason) values
  ('${L1}', '${TANU}', '2026-11-12', '2026-11-15', 'Personal leave'),
  ('${L2}', '${RAJA}', '2026-11-12', '2026-11-22', 'Family'),
  ('${L3}', '${RAJA}', '2026-11-25', '2026-11-27', 'Later leave');
`);
await db.exec(isAdminDef);
await db.exec(mig);
const out = [];
const ok = (n, c, e = "") => out.push([c ? "PASS" : "FAIL", n, e]);
const call = async (uid, id, end, reason) => {
  await db.query(`select set_config('test.uid', $1, false)`, [uid]);
  try { return { data: (await db.query(`select admin_edit_leave_end_date($1::uuid, $2::date, $3) j`, [id, end, reason])).rows[0].j }; }
  catch (e) { return { error: e.message }; }
};
const end = async (id) => (await db.query(`select end_date::text e from employee_leave_periods where id = $1`, [id])).rows[0]?.e;

let r = await call(A, L1, "2026-11-14", "Came back to work on 15 Nov");
ok("admin ends Tanu's leave on 14 Nov", !r.error && (await end(L1)) === "2026-11-14" && r.data.old_end_date === "2026-11-15", r.error || JSON.stringify(r.data));
const ev = (await db.query(`select source, action, lead_id, lead_owner_id::text o, detail from lead_guard_events`)).rows;
ok("the change is recorded with old and new end date, reason and who", ev.length === 1 && ev[0].source === "leave_edit" && ev[0].action === "LEAVE_END_DATE_SET" && ev[0].lead_id === null && ev[0].o === TANU &&
  ev[0].detail.old_end_date === "2026-11-15" && ev[0].detail.new_end_date === "2026-11-14" && ev[0].detail.reason === "Came back to work on 15 Nov" && ev[0].detail.by_employee_id === ADM, JSON.stringify(ev));
r = await call(NA, L2, "2026-11-20", "early");
ok("non-admin refused", /caller is not an admin/.test(r.error || ""), r.error);
r = await call(A, L2, "2026-11-20", "  ");
ok("empty reason refused", /reason is required/.test(r.error || ""), r.error);
r = await call(A, L2, null, "x");
ok("no end date refused", /an end date is required/.test(r.error || ""), r.error);
r = await call(A, L2, "2026-11-10", "typo");
ok("end before start refused, leave NOT deleted", /cannot be before the start date/.test(r.error || "") && (await end(L2)) === "2026-11-22", r.error);
r = await call(A, L2, "2026-11-26", "extended");
ok("extending into another leave of the same employee refused", /overlap another leave/.test(r.error || "") && (await end(L2)) === "2026-11-22", r.error);
r = await call(A, L2, "2026-11-22", "same");
ok("same end date refused", /already ends on/.test(r.error || ""), r.error);
r = await call(A, "00000000-0000-0000-0000-00000000ffff", "2026-11-20", "x");
ok("unknown leave refused", /not found/.test(r.error || ""), r.error);
r = await call(A, L2, "2026-11-18", "Returned early");
ok("admin ends Raja's leave early (18 Nov)", !r.error && (await end(L2)) === "2026-11-18", r.error);
const g = (await db.query(`select has_function_privilege('anon','admin_edit_leave_end_date(uuid,date,text)','EXECUTE') a, has_function_privilege('public','admin_edit_leave_end_date(uuid,date,text)','EXECUTE') p, has_function_privilege('authenticated','admin_edit_leave_end_date(uuid,date,text)','EXECUTE') u`)).rows[0];
ok("grants: anon no, public no, authenticated yes", !g.a && !g.p && g.u, JSON.stringify(g));
await db.exec(rb);
ok("rollback removes the function", (await db.query(`select count(*)::int n from pg_proc where proname = 'admin_edit_leave_end_date'`)).rows[0].n === 0);
for (const [s, n, e] of out) console.log(s, n, e ? "| " + String(e).slice(0, 180) : "");
console.log(out.every((x) => x[0] === "PASS") ? "ALL PASS" : "SOME FAILED");
