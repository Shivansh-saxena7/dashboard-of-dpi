// SQL test harness for supabase/sql/2026-11-28_admin_guard_event_counts.sql (in-memory Postgres, no live DB).
// Not part of the build: PGlite is not a project dependency. Run from a folder that has it installed:
//   npm i @electric-sql/pglite@0.2.17 && node <this file> <migration.sql> <rollback.sql>
// is_admin() below is the live definition (pg_get_functiondef, 2026-11-27).
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const [apply, rollback] = process.argv.slice(2).map((f) => fs.readFileSync(f, "utf8"));
for (const [n, s] of [["migration", apply], ["rollback", rollback]]) if (s.includes("\r")) throw new Error(n + " has CR");
const db = new PGlite();
const U = (c) => `00000000-0000-4000-8000-0000000000${c}`;
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
create table lead_guard_events (id bigserial primary key, created_at timestamptz default now(), source text, action text, lead_id uuid);
grant usage on schema public to anon, authenticated;
`);
// 1200 events today (more than the old 500 limit), a few yesterday, some outside the window.
await db.exec(`
insert into lead_guard_events (created_at, source, action)
  select timestamptz '2026-11-27 06:00Z' + (i || ' seconds')::interval, case when i % 3 = 0 then 'admin_junk' else 'recycle_sibling_guard' end,
         case when i % 3 = 0 then 'JUNK' else 'SKIP' end from generate_series(1, 1200) i;
insert into lead_guard_events (created_at, source, action) values
  ('2026-11-26 10:00Z', 'owner_leave', 'OWNER_ON_LEAVE'), ('2026-11-26 11:00Z', 'owner_leave', 'OWNER_ON_LEAVE'),
  ('2026-11-20 10:00Z', 'owner_leave', 'OWNER_ON_LEAVE'), ('2026-11-28 10:00Z', 'admin_junk', 'JUNK');
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
    eq(n, code ? e.code : "refused", code ?? "refused");
    return;
  }
  throw new Error(n + ": not refused");
};
await db.exec(apply);
await db.exec(apply);
ok.push("apply twice is safe");
const as = async (role, uid, sql) => {
  await db.exec(`reset role; select set_config('test.uid', '${uid ?? ""}', false); set role ${role};`);
  try {
    return (await db.query(sql)).rows;
  } finally {
    await db.exec("reset role");
  }
};
const TODAY = "get_admin_guard_event_counts('2026-11-26 18:30Z', '2026-11-27 18:30Z')";
let rows = await as("authenticated", U("a1"), `select * from ${TODAY}`);
eq("admin: counts per source/action (no 500 cap)", rows.map((r) => [r.source, r.action, Number(r.n)]), [["admin_junk", "JUNK", 400], ["recycle_sibling_guard", "SKIP", 800]]);
rows = await as("authenticated", U("a2"), "select * from get_admin_guard_event_counts('2026-11-25 18:30Z', '2026-11-26 18:30Z')");
eq("super_admin: yesterday window only", rows.map((r) => [r.source, r.action, Number(r.n)]), [["owner_leave", "OWNER_ON_LEAVE", 2]]);
rows = await as("authenticated", U("a1"), "select * from get_admin_guard_event_counts('2026-11-29 00:00Z', '2026-11-29 10:00Z')");
eq("empty window: no rows", rows.length, 0);
for (const [who, uid] of [["team_leader", U("a3")], ["employee", U("a4")], ["sales_coordinator", U("a5")], ["inactive admin", U("a6")], ["no login", null]]) {
  await refused(`${who}: refused 42501`, `select set_config('test.uid', '${uid ?? ""}', false); set role authenticated; select * from ${TODAY}`, "42501");
  await db.exec("reset role");
}
await refused("anon: no execute", `set role anon; select * from ${TODAY}`, "42501");
await db.exec("reset role");
await refused("window over 3 days refused", `select set_config('test.uid', '${U("a1")}', false); set role authenticated; select * from get_admin_guard_event_counts('2026-11-20Z', '2026-11-27Z')`, "22023");
await db.exec("reset role");
await refused("null window refused", `select set_config('test.uid', '${U("a1")}', false); set role authenticated; select * from get_admin_guard_event_counts(null, now())`, "22023");
await db.exec("reset role");
await refused("authenticated still cannot read the table", `set role authenticated; select count(*) from lead_guard_events`, "42501");
await db.exec("reset role");
const def = (await db.query("select prosecdef, provolatile, proconfig from pg_proc where proname = 'get_admin_guard_event_counts'")).rows[0];
eq("security definer, stable, search_path pinned", [def.prosecdef, def.provolatile, def.proconfig], [true, "s", ["search_path=public"]]);
await db.exec(rollback);
eq("rollback drops the function", (await db.query("select count(*)::int n from pg_proc where proname = 'get_admin_guard_event_counts'")).rows[0].n, 0);
console.log("PASS", ok.length, ok.join("; "));
