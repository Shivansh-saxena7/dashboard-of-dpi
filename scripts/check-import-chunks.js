#!/usr/bin/env node
// import-leads-csv chunked updates (2026-11-23) known-answer check, run in prebuild. No network, no DB.
// 1) supabase/functions/_shared/updateInChunks.ts: 700 / 1500 / 3000 fake ids -> chunks of <= 200, every id exactly
//    once, no duplicates, each chunk's URL far below the ~25K-character gateway limit; a failing chunk returns its
//    error and stops; 0 ids -> no call.
// 2) The import function uses it for both big id lists (batch tag, team reserve) and no longer sends every id in one
//    .in() list.

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const crypto = require("crypto");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const problems = [];
const check = (name, ok) => { if (!ok) problems.push(name); };

const { outputText } = ts.transpileModule(read("supabase/functions/_shared/updateInChunks.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
});
const mod = { exports: {} };
new Function("module", "exports", "require", outputText)(mod, mod.exports, () => { throw new Error("unexpected import"); });
const { updateInChunks, ID_CHUNK } = mod.exports;

function fakeClient(failOnCall = -1) {
  const calls = [];
  return {
    calls,
    from(table) {
      return {
        update(values) {
          return {
            in(col, ids) {
              calls.push({ table, values, col, ids: [...ids] });
              return Promise.resolve({ error: calls.length - 1 === failOnCall ? { message: "Bad Request" } : null });
            }
          };
        }
      };
    }
  };
}
const uuids = (n) => Array.from({ length: n }, () => crypto.randomUUID());
const urlChars = (ids) => encodeURIComponent(`id=in.(${ids.join(",")})`).length + 120;

(async () => {
  check("chunk size is 200", ID_CHUNK === 200);
  for (const n of [700, 1500, 3000]) {
    const ids = uuids(n);
    const c = fakeClient();
    const err = await updateInChunks(c, "leads", { csv_import_batch_id: "b1" }, ids);
    const all = c.calls.flatMap((x) => x.ids);
    check(`${n}: no error`, err === null);
    check(`${n}: ${Math.ceil(n / 200)} chunks`, c.calls.length === Math.ceil(n / 200));
    check(`${n}: every chunk <= 200`, c.calls.every((x) => x.ids.length <= 200 && x.ids.length > 0));
    check(`${n}: every id tagged exactly once`, all.length === n && new Set(all).size === n && ids.every((id) => all.includes(id)));
    check(`${n}: table / column / values unchanged`, c.calls.every((x) => x.table === "leads" && x.col === "id" && x.values.csv_import_batch_id === "b1"));
    check(`${n}: every chunk URL far below the limit`, c.calls.every((x) => urlChars(x.ids) < 10000));
  }
  {
    const ids = uuids(1500);
    const c = fakeClient(2);
    const err = await updateInChunks(c, "leads", { x: 1 }, ids);
    check("a failing chunk returns its error", err && err.message === "Bad Request");
    check("a failing chunk stops the rest", c.calls.length === 3);
  }
  {
    const ids = uuids(450);
    const c = fakeClient();
    await updateInChunks(c, "leads", { x: 1 }, [...ids, ...ids.slice(0, 50)]);
    const all = c.calls.flatMap((x) => x.ids);
    check("duplicate ids are sent once", all.length === 450 && new Set(all).size === 450);
  }
  {
    const c = fakeClient();
    check("no ids -> no call", (await updateInChunks(c, "leads", { x: 1 }, [])) === null && c.calls.length === 0);
  }
  check("the 655-id request that failed would have been about 25.6K characters", Math.abs(urlChars(uuids(655)) - 25600) < 1500);

  const fn = read("supabase/functions/import-leads-csv/index.ts");
  check("import uses updateInChunks for the batch tag", fn.includes('const tagError = await updateInChunks(supabase, "leads", { csv_import_batch_id: batchRow.id }, insertedLeads.map((l) => l.id));'));
  check("import uses updateInChunks for the team reserve", fn.includes('const reserveError = await updateInChunks(supabase, "leads", { pending_team_id: target_team_id }, insertedLeads.map((l) => l.id));'));
  check("no single .in() list of every inserted id is left", !/\.in\("id",\s*insertedLeads\.map/.test(fn));
  check("the error steps are unchanged", fn.includes('step: "TAG_LEADS_WITH_BATCH", error: tagError.message') && fn.includes('step: "RESERVE_FOR_TEAM", error: reserveError.message'));

  if (problems.length) {
    console.error("check-import-chunks FAILED:\n  " + problems.join("\n  "));
    process.exit(1);
  }
  console.log("check-import-chunks: OK");
})();
