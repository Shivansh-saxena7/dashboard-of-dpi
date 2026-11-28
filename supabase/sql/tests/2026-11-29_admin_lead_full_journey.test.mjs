// SQL test harness for supabase/sql/2026-11-29_admin_lead_full_journey.sql (in-memory Postgres, no live DB).
// Not part of the build: PGlite is not a project dependency. Run from a folder that has it installed:
//   npm i @electric-sql/pglite@0.2.17
//   node <this file> <migration.sql> <rollback.sql> <tests/...live_defs.sql>
// The data is a FAKE copy of two real junk leads (2026-11-28 owner report "the History modal has no row for the first
// owner"): same owners, assignments, status / stage moves, calls and notes at the same times; ids replaced, no name,
// number or note text. live_defs.sql holds the live is_admin / get_lead_journey / perf_stint_facts /
// get_lead_report_batches.
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
import { FIX } from "./2026-11-29_admin_lead_full_journey.fixture.mjs";
const [apply, rollback, live] = process.argv.slice(2).map((f) => fs.readFileSync(f, "utf8"));
for (const [n, s] of [["migration", apply], ["rollback", rollback]]) if (s.includes("\r")) throw new Error(n + " has CR");
const db = new PGlite();
const ADM = "00000000-0000-4000-8000-0000000000a1", SADM = "00000000-0000-4000-8000-0000000000a2";
await db.exec(`
create role anon; create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table employees (id uuid primary key, auth_user_id uuid, name text, role text, is_active boolean);
create table teams (id uuid primary key, name text);
create table csv_import_batches (id uuid primary key, filename text);
create table leads (id uuid primary key, name text, mobile text, project text, source text, status text, board_stage text, lead_type text,
  catcher_name text, is_personal_lead boolean default false, created_at timestamptz, updated_at timestamptz, recycle_count int default 0,
  last_unjunked_at timestamptz, board_stage_changed_at timestamptz, current_owner_id uuid, pending_team_id uuid, merged_into_lead_id uuid,
  merged_at timestamptz, csv_import_batch_id uuid);
create table lead_history (id uuid primary key, lead_id uuid, employee_id uuid, assigned_at timestamptz, outcome text, outcome_at timestamptz,
  recycle_reason text, is_active boolean, call_count int default 0, ended_reason text, first_call_at timestamptz, assigned_by_type text,
  assigned_by_employee_id uuid, reassign_note text, first_whatsapp_at timestamptz, last_activity_at timestamptz, paused_until timestamptz,
  pause_reason text, pause_note text, recycled_from_status text, recycled_from_stage text);
create table lead_activity_log (id uuid primary key default gen_random_uuid(), lead_id uuid, lead_history_id uuid, employee_id uuid, activity_type text, detail text, created_at timestamptz);
create table contact_click_log (id uuid primary key default gen_random_uuid(), lead_id uuid, lead_history_id uuid, employee_id uuid, click_type text, clicked_at timestamptz, outcome text, gap_seconds int);
create table lead_notes (id uuid primary key default gen_random_uuid(), lead_id uuid, lead_history_id uuid, employee_id uuid, note text, created_at timestamptz, reminder_at timestamptz);
create table site_visits (id uuid primary key default gen_random_uuid(), lead_id uuid, employee_id uuid, event_type text, created_at timestamptz,
  verified_at timestamptz, verified_by uuid, denied_at timestamptz, denied_by uuid, deny_reason text, note text);
create table lead_snooze_log (id uuid primary key default gen_random_uuid(), lead_id uuid, lead_history_id uuid, employee_id uuid, snoozed_at timestamptz,
  duration_months int, snoozed_until timestamptz, reason text, cancelled_at timestamptz, cancelled_by uuid);
create table lead_restore_log (id uuid primary key default gen_random_uuid(), lead_id uuid, restored_at timestamptz, restored_by uuid, to_employee_id uuid,
  reason text, highest_positive text, restored_status text, restored_stage text, protected_until timestamptz, new_lead_history_id uuid,
  activity_id uuid, undone_at timestamptz, undone_note text);
create table lead_guard_events (id bigserial primary key, created_at timestamptz, source text, action text, lead_id uuid, holder_lead_id8 text,
  lead_owner_id uuid, holder_owner_id uuid, mode text, detail jsonb);
create table lead_transfer_requests (id uuid primary key default gen_random_uuid(), lead_id uuid, requested_by_employee_id uuid, reason text, status text,
  transferred_to_employee_id uuid, reviewed_by_admin_id uuid, reviewed_at timestamptz, created_at timestamptz);
create table lead_team_reservations (id uuid primary key default gen_random_uuid(), lead_id uuid, team_id uuid, reserved_by_employee_id uuid, reserved_at timestamptz);
create table employee_leave_periods (id uuid primary key default gen_random_uuid(), employee_id uuid, start_date date, end_date date, reason text);
create table perf_reassign_batches (id uuid primary key, created_at timestamptz, mode text, label text, reason text);
create table perf_reassign_batch_leads (batch_id uuid, lead_id uuid, from_employee_id uuid, to_employee_id uuid, status text, skip_reason text, new_stint_id uuid);
grant usage on schema public to anon, authenticated;
`);
await db.exec(live);
// People: two admins, four other roles, and the five fake employees who owned the two leads (the first is "K").
const people = [[ADM, "admin"], [SADM, "super_admin"], ["00000000-0000-4000-8000-0000000000b1", "team_leader"], ["00000000-0000-4000-8000-0000000000b2", "employee"],
  ["00000000-0000-4000-8000-0000000000b3", "sales_coordinator"], ["00000000-0000-4000-8000-0000000000b4", "admin", false]];
for (const [id, role, active = true] of people) await db.query("insert into employees values ($1, $1, $2, $3, $4)", [id, `Fake ${role}`, role, active]);
for (const [i, id] of FIX.emps.entries()) await db.query("insert into employees values ($1, null, $2, 'employee', true) on conflict do nothing", [id, `Fake Owner ${i + 1}`]);
for (const l of FIX.leads)
  await db.query("insert into leads (id, name, mobile, project, source, status, board_stage, lead_type, created_at, updated_at, recycle_count) values ($1, 'Fake Lead', '9000000000', 'P', 'Meta', $2, $3, $4, $5, $5, $6)",
    [l.id, l.status, l.board, l.type, l.created, l.recycles]);
for (const h of FIX.hist)
  await db.query("insert into lead_history (id, lead_id, employee_id, assigned_at, is_active, assigned_by_type, outcome, outcome_at, ended_reason, recycle_reason, recycled_from_status, recycled_from_stage, call_count) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
    [h.id, h.lead, h.emp, h.at, h.active, h.by, h.outcome, h.outcome_at, h.ended, h.rr, h.rfs, h.rfg, h.calls ?? 0]);
for (const a of FIX.act) await db.query("insert into lead_activity_log (lead_id, lead_history_id, employee_id, activity_type, detail, created_at) values ($1,$2,$3,$4,$5,$6)", [a.lead, a.hid, a.emp, a.t, a.d, a.at]);
for (const c of FIX.calls) await db.query("insert into contact_click_log (lead_id, lead_history_id, employee_id, click_type, clicked_at) values ($1,$2,$3,$4,$5)", [c.lead, c.hid, c.emp, c.t, c.at]);
for (const [i, n] of FIX.notes.entries()) await db.query("insert into lead_notes (lead_id, lead_history_id, employee_id, note, created_at) values ($1,$2,$3,$4,$5)", [n.lead, n.hid, n.emp, `Fake note ${i + 1}`, n.at]);
// Extra kinds the two real leads did not have, on the first lead, so every event type is covered.
const L1 = FIX.leads[0].id, firstStint = FIX.hist.filter((h) => h.lead === L1)[0], K = firstStint.emp;
await db.query("insert into site_visits (lead_id, employee_id, event_type, created_at, denied_at, deny_reason) values ($1,$2,'VISIT',$3,$3,'Fake deny')", [L1, K, firstStint.at]);
await db.query("insert into lead_snooze_log (lead_id, lead_history_id, employee_id, snoozed_at, duration_months, reason) values ($1,$2,$3,$4,1,'Fake snooze')", [L1, firstStint.id, K, firstStint.at]);
await db.query("insert into lead_guard_events (created_at, source, action, lead_id, lead_owner_id) values (now(), 'db_sibling_guard', 'RECYCLE_REFUSED', $1, $2)", [L1, K]);
await db.query("insert into employee_leave_periods (employee_id, start_date, end_date, reason) values ($1, ($2::timestamptz)::date, ($2::timestamptz)::date + 1, 'Fake leave')", [K, firstStint.at]);
await db.query("insert into lead_transfer_requests (lead_id, requested_by_employee_id, reason, status, created_at) values ($1,$2,'Fake transfer','REJECTED',$3)", [L1, K, firstStint.at]);
const before = (await db.query("select md5(string_agg(t, ',' order by t)) h from (select (to_jsonb(x))::text t from lead_history x union all select (to_jsonb(y))::text from lead_activity_log y) z")).rows[0].h;

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
const as = async (uid, lead) => {
  await db.exec(`reset role; select set_config('test.uid', '${uid}', false); set role authenticated;`);
  try {
    return (await db.query("select get_admin_lead_full_journey($1) j", [lead])).rows[0].j;
  } finally {
    await db.exec("reset role");
  }
};
for (const [who, uid] of [["admin", ADM], ["super_admin", SADM]]) {
  for (const l of FIX.leads) {
    const j = await as(uid, l.id);
    const short = l.id.slice(-4);
    const hist = FIX.hist.filter((h) => h.lead === l.id);
    eq(`${who} ${short}: every assignment, in order`, j.stints.map((s) => s.stint_id), hist.map((h) => h.id));
    eq(`${who} ${short}: first owner K is there`, j.stints.some((s) => s.employee_id === K), FIX.hist.some((h) => h.lead === l.id && h.emp === K));
    eq(`${who} ${short}: origin from the perf engine`, j.stints[0].origin, "FRESH");
    eq(`${who} ${short}: how each ended`, j.stints.map((s) => s.ended_reason), hist.map((h) => h.ended));
    const kinds = (k) => j.events.filter((e) => e.kind === k).length;
    eq(`${who} ${short}: every status / stage move`, kinds("STATUS") + kinds("STAGE"), FIX.act.filter((a) => a.lead === l.id).length);
    eq(`${who} ${short}: every call / WhatsApp`, kinds("CALL") + kinds("WHATSAPP"), FIX.calls.filter((c) => c.lead === l.id).length);
    eq(`${who} ${short}: every note`, kinds("NOTE"), FIX.notes.filter((n) => n.lead === l.id).length);
    eq(`${who} ${short}: events in time order`, j.events.map((e) => e.at), [...j.events.map((e) => e.at)].sort((a, b) => Date.parse(a) - Date.parse(b)));
    eq(`${who} ${short}: no name / mobile in the answer`, JSON.stringify(j).includes("9000000000") || JSON.stringify(j).includes("Fake Lead"), false);
  }
}
const j1 = await as(ADM, L1);
eq("visit (denied) shown", j1.events.filter((e) => e.kind === "VISIT").map((e) => e.extra.deny_reason), ["Fake deny"]);
eq("snooze shown", j1.events.filter((e) => e.kind === "SNOOZE").length, 1);
eq("guard event shown", j1.events.filter((e) => e.kind === "GUARD").map((e) => e.detail), ["db_sibling_guard/RECYCLE_REFUSED"]);
eq("owner leave during their assignment shown", j1.events.filter((e) => e.kind === "LEAVE").length, 1);
eq("transfer request shown", j1.events.filter((e) => e.kind === "TRANSFER_REQUEST").length, 1);
eq("lead is junk, state returned", [j1.lead.status, j1.found], ["JUNK", true]);
eq("unknown lead: found false", (await as(ADM, "00000000-0000-4000-8000-00000000ffff")).found, false);
for (const [who, uid] of [["team_leader", "b1"], ["employee", "b2"], ["sales_coordinator", "b3"], ["inactive admin", "b4"]]) {
  await refused(`${who}: refused 42501`, `select set_config('test.uid', '00000000-0000-4000-8000-0000000000${uid}', false); set role authenticated; select get_admin_lead_full_journey('${L1}')`, "42501");
  await db.exec("reset role");
}
await refused("no login: refused 42501", `select set_config('test.uid', '', false); set role authenticated; select get_admin_lead_full_journey('${L1}')`, "42501");
await db.exec("reset role");
await refused("anon: no execute", `set role anon; select get_admin_lead_full_journey('${L1}')`, "42501");
await db.exec("reset role");
await refused("null lead refused", `select set_config('test.uid', '${ADM}', false); set role authenticated; select get_admin_lead_full_journey(null)`, "22023");
await db.exec("reset role");
const def = (await db.query("select prosecdef, provolatile, proconfig from pg_proc where proname = 'get_admin_lead_full_journey'")).rows[0];
eq("security definer, stable, search_path pinned", [def.prosecdef, def.provolatile, def.proconfig], [true, "s", ["search_path=public"]]);
const after = (await db.query("select md5(string_agg(t, ',' order by t)) h from (select (to_jsonb(x))::text t from lead_history x union all select (to_jsonb(y))::text from lead_activity_log y) z")).rows[0].h;
eq("read-only: lead data unchanged", after, before);
await db.exec(rollback);
eq("rollback drops the function", (await db.query("select count(*)::int n from pg_proc where proname = 'get_admin_lead_full_journey'")).rows[0].n, 0);
console.log("PASS", ok.length);
