// SQL test harness for supabase/sql/2026-11-29_admin_restore_protection_counts.sql (in-memory Postgres, no live DB).
// Not part of the build: PGlite is not a project dependency. Run from a folder that has it installed:
//   npm i @electric-sql/pglite@0.2.17 && node <this file> <migration.sql> <rollback.sql>
// is_admin() below is the live definition (pg_get_functiondef, 2026-11-27). The expected counts are computed with the
// Home's own rule (lib/adminHome.ts openProtections), copied here, over the same random rows.
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
create table lead_restore_log (id uuid primary key default gen_random_uuid(), lead_id uuid, protected_until timestamptz,
  restored_at timestamptz, undone_at timestamptz);
grant usage on schema public to anon, authenticated;
`);
// Random rows around now (past and future protections, some undone, some restored later), plus the edge cases.
const NOW = new Date((await db.query("select now() t")).rows[0].t).getTime();
const H = 3600e3;
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const rows = [];
for (let i = 0; i < 400; i++) {
  const restored = NOW - (rnd() * 20 * 24 - 2) * H;
  const until = restored + rnd() * 16 * 24 * H;
  const undone = rnd() < 0.3 ? restored + rnd() * 3 * 24 * H : null;
  rows.push({ protected_until: Math.round(until), restored_at: rnd() < 0.05 ? null : Math.round(restored), undone_at: undone == null ? null : Math.round(undone) });
}
rows.push({ protected_until: NOW, restored_at: NOW - H, undone_at: null }); // ends exactly now: not open
rows.push({ protected_until: NOW + H, restored_at: NOW, undone_at: null }); // restored exactly now: open
rows.push({ protected_until: NOW + H, restored_at: NOW - H, undone_at: NOW }); // undone exactly now: not open
const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
for (const r of rows) await db.query("insert into lead_restore_log (protected_until, restored_at, undone_at) values ($1, $2, $3)", [iso(r.protected_until), iso(r.restored_at), iso(r.undone_at)]);
// The Home's rule (lib/adminHome.ts openProtections).
const openAt = (at) => rows.filter((r) => r.protected_until > at && (!r.restored_at || r.restored_at <= at) && (!r.undone_at || r.undone_at > at));
const expNow = openAt(NOW);
const expDay = openAt(NOW - 24 * H);
const expEarliest = expNow.map((r) => r.protected_until).sort((a, b) => a - b)[0] ?? null;

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
const CALL = "select * from get_admin_restore_protection_counts($1)";
for (const [who, uid] of [["admin", U("a1")], ["super_admin", U("a2")]]) {
  const r = (await as(uid, CALL, [iso(NOW)]))[0];
  eq(`${who}: open now = Home rule`, Number(r.open_now), expNow.length);
  eq(`${who}: open 24 h ago = Home rule`, Number(r.open_day_before), expDay.length);
  eq(`${who}: earliest end = Home rule`, r.earliest_end ? new Date(r.earliest_end).getTime() : null, expEarliest);
}
eq("one row, three counts only (no lead id)", Object.keys((await as(U("a1"), CALL, [iso(NOW)]))[0]).sort(), ["earliest_end", "open_day_before", "open_now"]);
eq("counts are non-trivial", expNow.length > 0 && expDay.length > 0 && expNow.length !== expDay.length, true);
for (const [who, uid] of [["team_leader", U("a3")], ["employee", U("a4")], ["sales_coordinator", U("a5")], ["inactive admin", U("a6")], ["no login", null]]) {
  await refused(`${who}: refused 42501`, `select set_config('test.uid', '${uid ?? ""}', false); set role authenticated; select * from get_admin_restore_protection_counts(now())`, "42501");
  await db.exec("reset role");
}
await refused("anon: no execute", "set role anon; select * from get_admin_restore_protection_counts(now())", "42501");
await db.exec("reset role");
for (const [n, at] of [["null time refused", "null"], ["3 days ago refused", "now() - interval '3 days'"], ["2 hours ahead refused", "now() + interval '2 hours'"]]) {
  await refused(n, `select set_config('test.uid', '${U("a1")}', false); set role authenticated; select * from get_admin_restore_protection_counts(${at})`, "22023");
  await db.exec("reset role");
}
await refused("authenticated still cannot read the table", "set role authenticated; select count(*) from lead_restore_log", "42501");
await db.exec("reset role");
const def = (await db.query("select prosecdef, provolatile, proconfig from pg_proc where proname = 'get_admin_restore_protection_counts'")).rows[0];
eq("security definer, stable, search_path pinned", [def.prosecdef, def.provolatile, def.proconfig], [true, "s", ["search_path=public"]]);
await db.exec(rollback);
eq("rollback drops the function", (await db.query("select count(*)::int n from pg_proc where proname = 'get_admin_restore_protection_counts'")).rows[0].n, 0);
console.log("PASS", ok.length, ok.join("; "));
