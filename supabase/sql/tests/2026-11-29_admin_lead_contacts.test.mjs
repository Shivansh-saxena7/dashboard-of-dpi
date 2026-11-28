// SQL test harness for supabase/sql/2026-11-29_admin_lead_contacts.sql (in-memory Postgres, no live DB). Fake names
// and numbers only. Not part of the build: PGlite is not a project dependency. Run from a folder that has it installed:
//   npm i @electric-sql/pglite@0.2.17 && node <this file> <migration.sql> <rollback.sql>
// is_admin() below is the live definition (pg_get_functiondef, 2026-11-27).
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const [apply, rollback] = process.argv.slice(2).map((f) => fs.readFileSync(f, "utf8"));
for (const [n, s] of [["migration", apply], ["rollback", rollback]]) if (s.includes("\r")) throw new Error(n + " has CR");
const db = new PGlite();
const U = (c) => `00000000-0000-4000-8000-0000000000${c}`;
const L = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
await db.exec(`
create role anon; create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table employees (id uuid primary key, auth_user_id uuid, role text, is_active boolean);
insert into employees values ('${U("e1")}', '${U("a1")}', 'admin', true), ('${U("e2")}', '${U("a2")}', 'super_admin', true),
  ('${U("e3")}', '${U("a3")}', 'team_leader', true), ('${U("e4")}', '${U("a4")}', 'employee', true),
  ('${U("e5")}', '${U("a5")}', 'sales_coordinator', true), ('${U("e6")}', '${U("a6")}', 'admin', false);
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from employees
    where auth_user_id = auth.uid() and is_active and role in ('admin','super_admin')
  );
$function$;
create table leads (id uuid primary key, name text, mobile text, status text, project text);
insert into leads select ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'Test Lead ' || i, '90000' || lpad(i::text, 5, '0'), 'JUNK', 'P'
  from generate_series(1, 300) i;
-- An existing reader, to show it is untouched by the migration.
create function public.lead_count_reader() returns bigint language sql stable as $$ select count(*) from leads $$;
grant usage on schema public to anon, authenticated;
`);
const ok = [];
const eq = (n, a, b) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${n}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  ok.push(n);
};
const refused = async (n, sql, code) => {
  try {
    await db.exec(sql);
  } catch (e) {
    eq(n, e.code, code);
    return;
  }
  throw new Error(n + ": not refused");
};
const before = (await db.query("select public.lead_count_reader() n, md5(string_agg(id::text || name || mobile, ',' order by id)) h from leads")).rows[0];
await db.exec(apply);
await db.exec(apply);
ok.push("apply twice is safe");
const as = async (uid, sql, params = []) => {
  await db.exec(`reset role; select set_config('test.uid', '${uid ?? ""}', false); set role authenticated;`);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec("reset role");
  }
};
const CALL = "select * from get_admin_lead_contacts($1::uuid[]) order by lead_id";
for (const [who, uid] of [["admin", U("a1")], ["super_admin", U("a2")]]) {
  const r = await as(uid, CALL, [[L(3), L(1), L(299)]]);
  eq(`${who}: name and mobile for exactly the asked leads`, r.map((x) => [x.lead_id, x.name, x.mobile]), [[L(1), "Test Lead 1", "9000000001"], [L(3), "Test Lead 3", "9000000003"], [L(299), "Test Lead 299", "9000000299"]]);
}
eq("only lead_id, name, mobile come back", Object.keys((await as(U("a1"), CALL, [[L(5)]]))[0]).sort(), ["lead_id", "mobile", "name"]);
eq("200 ids allowed", (await as(U("a1"), CALL, [Array.from({ length: 200 }, (_, i) => L(i + 1))])).length, 200);
eq("unknown id: no row", (await as(U("a1"), CALL, [[L(999)]])).length, 0);
for (const [who, uid] of [["team_leader", U("a3")], ["employee", U("a4")], ["sales_coordinator", U("a5")], ["inactive admin", U("a6")], ["no login", null]]) {
  await refused(`${who}: refused 42501`, `select set_config('test.uid', '${uid ?? ""}', false); set role authenticated; select * from get_admin_lead_contacts(array['${L(1)}']::uuid[])`, "42501");
  await db.exec("reset role");
}
await refused("anon: no execute", `set role anon; select * from get_admin_lead_contacts(array['${L(1)}']::uuid[])`, "42501");
await db.exec("reset role");
const many = `array[${Array.from({ length: 201 }, (_, i) => `'${L(i + 1)}'`).join(",")}]::uuid[]`;
for (const [n, arg] of [["201 ids refused", many], ["empty list refused", "array[]::uuid[]"], ["null refused", "null"]]) {
  await refused(n, `select set_config('test.uid', '${U("a1")}', false); set role authenticated; select * from get_admin_lead_contacts(${arg})`, "22023");
  await db.exec("reset role");
}
const def = (await db.query("select prosecdef, provolatile, proconfig from pg_proc where proname = 'get_admin_lead_contacts'")).rows[0];
eq("security definer, stable, search_path pinned", [def.prosecdef, def.provolatile, def.proconfig], [true, "s", ["search_path=public"]]);
const after = (await db.query("select public.lead_count_reader() n, md5(string_agg(id::text || name || mobile, ',' order by id)) h from leads")).rows[0];
eq("old results same (existing reader and lead data unchanged)", [Number(after.n), after.h], [Number(before.n), before.h]);
await db.exec(rollback);
eq("rollback drops the function", (await db.query("select count(*)::int n from pg_proc where proname = 'get_admin_lead_contacts'")).rows[0].n, 0);
console.log("PASS", ok.length, ok.join("; "));
