// SQL test harness for supabase/sql/2026-11-28_admin_card_mode.sql (in-memory Postgres, no live DB).
// Not part of the build: PGlite is not a project dependency. Run from a folder that has it installed:
//   npm i @electric-sql/pglite@0.2.17 && node <this file> <migration.sql> <rollback.sql>
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const [apply, rollback] = process.argv.slice(2).map((f) => fs.readFileSync(f, "utf8"));
for (const [n, s] of [["migration", apply], ["rollback", rollback]]) if (s.includes("\r")) throw new Error(n + " has CR");
const db = new PGlite();
await db.exec("create table public.lead_engine_settings (id int primary key, auto_junk_enabled boolean); insert into lead_engine_settings values (1, true);");
const ok = [];
const eq = (n, a, b) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${n}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  ok.push(n);
};
await db.exec(apply);
let r = (await db.query("select admin_card_mode, admin_card_pilot_ids, auto_junk_enabled from lead_engine_settings")).rows[0];
eq("default off", r.admin_card_mode, "off");
eq("pilots empty", r.admin_card_pilot_ids, []);
eq("old column kept", r.auto_junk_enabled, true);
await db.exec(apply);
ok.push("apply twice is safe");
let refused = false;
try { await db.exec("update lead_engine_settings set admin_card_mode = 'ON'"); } catch { refused = true; }
eq("check refuses unknown mode", refused, true);
await db.exec("update lead_engine_settings set admin_card_mode = 'admin_pilot', admin_card_pilot_ids = array['00000000-0000-4000-8000-0000000000e1']::uuid[]");
refused = false;
try { await db.exec("update lead_engine_settings set admin_card_pilot_ids = null"); } catch { refused = true; }
eq("pilots not null", refused, true);
await db.exec(rollback);
r = (await db.query("select * from lead_engine_settings")).rows[0];
eq("rollback removes columns", Object.keys(r).sort(), ["auto_junk_enabled", "id"]);
console.log("PASS", ok.length, ok.join("; "));
