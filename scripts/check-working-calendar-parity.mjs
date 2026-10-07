#!/usr/bin/env node
// Live parity check: lib/workingCalendar.ts vs the DB functions
// working_add / working_elapsed, on random inputs, using the live
// calendar from get_working_calendar. Read-only (only calls the three
// read functions). Needs NEXT_PUBLIC_SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY, e.g.:
//   node --env-file=.env.local scripts/check-working-calendar-parity.mjs
// Not part of prebuild (no DB access on Vercel builds) — run it after any
// change to either implementation.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(new URL("../lib/workingCalendar.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
});
const mod = { exports: {} };
new Function("module", "exports", outputText)(mod, mod.exports);
const { fetchWorkingCalendar, workingAdd, workingElapsedMs, DAY_MS } = mod.exports;

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const CASES = Number(process.argv[2] || 100);
const now = Date.now();
const cal = await fetchWorkingCalendar(supabase, now - 60 * DAY_MS, now + 400 * DAY_MS);

const intervalSeconds = (iv) => {
  // Postgres interval text from make_interval(secs => ...), e.g. "72:00:00" or "144:00:00.123".
  const [h, m, s] = iv.split(":");
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
};

let failures = 0;
for (let i = 0; i < CASES; i++) {
  const from = now - 30 * DAY_MS + Math.floor(Math.random() * 90 * DAY_MS);
  const amountMs = Math.floor(Math.random() * 10 * DAY_MS / 1000) * 1000;
  const fromIso = new Date(from).toISOString();

  const { data: dbAdd, error: addError } = await supabase.rpc("working_add", {
    p_from: fromIso,
    p_amount: `${amountMs / 1000} seconds`
  });
  if (addError) throw new Error(`working_add: ${addError.message}`);
  const tsAdd = workingAdd(cal, from, amountMs).getTime();
  if (Date.parse(dbAdd) !== tsAdd) {
    failures++;
    console.error(`ADD MISMATCH from=${fromIso} amount=${amountMs}ms db=${dbAdd} ts=${new Date(tsAdd).toISOString()}`);
  }

  const to = from + Math.floor(Math.random() * 12 * DAY_MS);
  const { data: dbElapsed, error: elapsedError } = await supabase.rpc("working_elapsed", {
    p_from: fromIso,
    p_to: new Date(to).toISOString()
  });
  if (elapsedError) throw new Error(`working_elapsed: ${elapsedError.message}`);
  const tsElapsed = workingElapsedMs(cal, from, to);
  if (Math.abs(intervalSeconds(dbElapsed) * 1000 - tsElapsed) > 1) {
    failures++;
    console.error(`ELAPSED MISMATCH from=${fromIso} to=${new Date(to).toISOString()} db=${dbElapsed} ts=${tsElapsed}ms`);
  }
}

console.log(`parity: ${CASES * 2 - failures}/${CASES * 2} match (weekly off ${cal.weeklyOffDay}, ${cal.ranges.length} active ranges)`);
process.exit(failures ? 1 : 0);
