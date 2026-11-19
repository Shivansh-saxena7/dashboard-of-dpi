// SQL test harness for supabase/sql/2026-11-19_lead_notes_realtime.sql (in-memory Postgres, no live DB).
// Not part of the build: PGlite is not a project dependency. Run from a folder that has it installed:
//   npm i @electric-sql/pglite@0.2.17 && node <this file> <migration.sql> <rollback.sql>
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const [apply, rollback] = process.argv.slice(2).map((f) => fs.readFileSync(f, "utf8"));
for (const [n, s] of [["apply", apply], ["rollback", rollback]]) if (s.includes("\r")) throw new Error(n + " has CR");
const db = new PGlite();
await db.exec("create table public.lead_notes (id int primary key); create table public.leads (id int primary key); create publication supabase_realtime for table public.leads;");
const pub = async () => (await db.query("select tablename from pg_publication_tables where pubname='supabase_realtime' order by 1")).rows.map((r) => r.tablename).join(",");
console.log("before", await pub());
await db.exec(apply); console.log("after apply", await pub());
await db.exec(apply); console.log("apply twice", await pub());
await db.exec(rollback); console.log("after rollback", await pub());
await db.exec(rollback); console.log("rollback twice", await pub());
