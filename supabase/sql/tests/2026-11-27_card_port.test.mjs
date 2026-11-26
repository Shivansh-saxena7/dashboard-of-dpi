// SQL test for the card port drafts: 2026-11-27_get_last_notes.sql, 2026-11-27_employee_card_mode.sql and the testing
// pilot script. In-memory Postgres, no live DB. Not part of the build: PGlite is not a project dependency. Run:
//   npm i @electric-sql/pglite@0.2.17
//   node <this file> <get_last_notes.sql> <its rollback> <employee_card_mode.sql> <its rollback> <pilot_testing.sql> <its rollback> <live_defs.sql>
// Known answers: latest note per assignment (ties by id), only 200 ids read, row-level security decides (an employee
// sees only their own notes, exactly as the old direct read), anon cannot run it; the flag defaults to off, rejects
// other values; the pilot sets 'admin_pilot' + one id only when exactly one active "testing" employee exists and the
// mode is still off; every rollback removes what it added.
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const files = process.argv.slice(2).map((f) => fs.readFileSync(f, "utf8"));
const [notes, notesRb, mode, modeRb, pilot, pilotRb, live] = files;
for (const [i, s] of files.entries()) if (i < 6 && s.includes("\r")) throw new Error(`file ${i + 1} has CR`);
const db = new PGlite();
let failures = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { failures++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); } else console.log(`ok   ${name}`);
};
const one = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const tryq = async (sql, p = []) => { try { return { r: (await db.query(sql, p)).rows }; } catch (e) { return { err: e.message }; } };
const id = (p, i) => `00000000-0000-0000-0000-${p}${String(i).padStart(12 - p.length, "0")}`;
const E1 = id("e", 1), E2 = id("e", 2), U1 = id("ee", 1), U2 = id("ee", 2), ADMU = id("aa", 1), ADM = id("a", 1);

await db.exec(`
create role anon; create role authenticated; create role service_role;
alter default privileges in schema public grant execute on functions to authenticated;
create schema auth; grant usage on schema auth to anon, authenticated;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table employees (id uuid primary key, auth_user_id uuid, name text, role text, is_active boolean, department text, team_id uuid);
create table lead_engine_settings (id int primary key, auto_junk_enabled boolean);
insert into lead_engine_settings values (1, true);
insert into employees values ('${ADM}', '${ADMU}', 'Admin', 'super_admin', true, 'admin', null), ('${E1}', '${U1}', 'Emp One', 'employee', true, 'sales', null),
  ('${E2}', '${U2}', 'Emp Two', 'employee', true, 'sales', null);
create table lead_notes (id serial primary key, lead_id uuid, lead_history_id uuid, employee_id uuid, note text, created_at timestamptz, reminder_at timestamptz);
`);
for (const def of live.split("=====")) if (/FUNCTION public\.(is_admin|current_employee_id|current_employee_role)\(/.test(def)) await db.exec(def);
await db.exec(`
alter table lead_notes enable row level security;
create policy lead_notes_admin_all on lead_notes using ((select is_admin()));
create policy lead_notes_employee_select_own on lead_notes for select using (employee_id = (select current_employee_id()));
grant select on lead_notes, employees, lead_engine_settings to authenticated;
grant usage on schema public to authenticated, anon;
`);
const H = (i) => id("1", i);
let ins = "";
for (let i = 1; i <= 205; i++) ins += `('${id("", i)}', '${H(i)}', '${E1}', 'note ${i} old', '2026-11-01 10:00+05:30'), ('${id("", i)}', '${H(i)}', '${E1}', 'note ${i} new', '2026-11-02 10:00+05:30'),`;
ins += `('${id("", 900)}', '${H(900)}', '${E2}', 'other person', '2026-11-02 10:00+05:30')`;
await db.exec(`insert into lead_notes (lead_id, lead_history_id, employee_id, note, created_at) values ${ins};
insert into lead_notes (lead_id, lead_history_id, employee_id, note, created_at) values ('${id("", 1)}', '${H(1)}', '${E1}', 'same time, later id', '2026-11-02 10:00+05:30');`);
await db.exec(notes);

const asEmp = async (uid, sql, p) => {
  await db.exec(`set role authenticated; select set_config('test.uid', '${uid}', false);`);
  const r = await tryq(sql, p);
  await db.exec(`reset role;`);
  return r;
};
const ids = (n, extra = []) => `{${[...Array.from({ length: n }, (_, i) => H(i + 1)), ...extra].join(",")}}`;
const r1 = await asEmp(U1, `select * from get_last_notes($1::uuid[]) order by lead_history_id`, [ids(3)]);
eq("latest note per assignment; a tie on time goes to the later id", r1.r.map((x) => x.note), ["same time, later id", "note 2 new", "note 3 new"]);
const r2 = await asEmp(U1, `select count(*)::int n from get_last_notes($1::uuid[])`, [ids(205)]);
eq("at most 200 ids are read", r2.r[0].n, 200);
const r3 = await asEmp(U1, `select count(*)::int n from get_last_notes($1::uuid[])`, [ids(1, [H(900)])]);
eq("row-level security: another employee's note is not returned", r3.r[0].n, 1);
const r4 = await asEmp(U2, `select note from get_last_notes($1::uuid[])`, [ids(2, [H(900)])]);
eq("row-level security: the other employee sees only their own", r4.r.map((x) => x.note), ["other person"]);
const r5 = await asEmp(U1, `select count(*)::int n from get_last_notes(null)`);
eq("null / empty list: no rows, no error", [r5.err ?? null, r5.r?.[0].n], [null, 0]);
const g = await one(`select has_function_privilege('anon', 'get_last_notes(uuid[])', 'EXECUTE') a, has_function_privilege('authenticated', 'get_last_notes(uuid[])', 'EXECUTE') b,
  (select prosecdef from pg_proc where proname = 'get_last_notes') d`);
eq("grants: anon no, signed-in yes; security invoker", [g.a, g.b, g.d], [false, true, false]);
await db.exec(notesRb);
eq("get_last_notes rollback: gone", (await one(`select count(*)::int n from pg_proc where proname = 'get_last_notes'`)).n, 0);

await db.exec(mode);
eq("employee_card_mode: default off, no pilots", Object.values(await one(`select employee_card_mode, cardinality(employee_card_pilot_ids) n from lead_engine_settings`)), ["off", 0]);
eq("employee_card_mode: other values refused", /check constraint/.test((await tryq(`update lead_engine_settings set employee_card_mode = 'yes'`)).err || ""), true);
await db.exec(pilot);
eq("pilot: no 'testing' employee -> nothing changes", Object.values(await one(`select employee_card_mode, cardinality(employee_card_pilot_ids) n from lead_engine_settings`)), ["off", 0]);
await db.exec(`insert into employees values ('${id("e", 7)}', null, 'Testing A', 'employee', true, 'sales', null), ('${id("e", 8)}', null, 'testing b', 'employee', true, 'sales', null);`);
await db.exec(pilot);
eq("pilot: two matches -> nothing changes", Object.values(await one(`select employee_card_mode, cardinality(employee_card_pilot_ids) n from lead_engine_settings`)), ["off", 0]);
await db.exec(`update employees set is_active = false where id = '${id("e", 8)}';`);
await db.exec(pilot);
eq("pilot: exactly one active match -> admin_pilot with that id", Object.values(await one(`select employee_card_mode, employee_card_pilot_ids[1]::text p from lead_engine_settings`)), ["admin_pilot", id("e", 7)]);
await db.exec(pilotRb);
eq("pilot rollback: off, no pilots", Object.values(await one(`select employee_card_mode, cardinality(employee_card_pilot_ids) n from lead_engine_settings`)), ["off", 0]);
await db.exec(modeRb);
eq("employee_card_mode rollback: columns gone", (await one(`select count(*)::int n from information_schema.columns where table_name = 'lead_engine_settings' and column_name like 'employee_card%'`)).n, 0);
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
