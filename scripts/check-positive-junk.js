#!/usr/bin/env node
// Positive-history junk (2026-10-29) known-answer + guard check, run in prebuild. No DB access.
// 1) lib/positiveJunk.ts filters / sorts / default employee give their known answers.
// 2) The app never calls the service-only writer RPCs (closed to authenticated by Security Phase 1).
// 3) The SQL keeps its safety pieces: admin check, 25 limit, DATA-copy refusal, protection in the junk guard.

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const problems = [];
const check = (name, ok) => {
  if (!ok) problems.push(name);
};

const { outputText } = ts.transpileModule(read("lib/positiveJunk.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
});
const mod = { exports: {} };
new Function("module", "exports", "require", outputText)(mod, mod.exports, () => {
  throw new Error("unexpected import");
});
const pj = mod.exports;

const NOW = Date.UTC(2026, 9, 29, 6, 30); // 29 Oct 2026 12:00 IST
const ago = (d) => new Date(NOW - d * 86400000).toISOString();
const row = (o) => ({
  lead_id: "aaaaaaaa-0000-0000-0000-000000000000", lead_id8: "aaaaaaaa", card_type: "LEAD", project: "P1", stage_at_junk: "LEADS",
  highest_positive: "CONNECTED", restore_status: "CONNECTED", restore_stage: "LEADS", first_positive: "CONNECTED", first_positive_at: ago(40),
  first_positive_by: "E1", first_positive_by_name: "One", last_owner_id: "E2", last_owner_name: "Two", recycle_count: 3,
  junked_at: "2026-10-28T10:00:00Z", junked_by: "SYSTEM", junk_reason: "Max recycles reached", last_activity_at: ago(10),
  not_interested_count: 0, is_data_copy: false, sibling: null, restored_before: 0, ...o
});
const rows = [
  row({ lead_id: "11111111-a", lead_id8: "11111111", highest_positive: "CONVERTED", last_activity_at: ago(3), project: "P1" }),
  row({ lead_id: "22222222-b", lead_id8: "22222222", highest_positive: "FOLLOW_UP", card_type: "DATA", last_activity_at: ago(20), project: "P2", sibling: { holder_id8: "x", holder_owner_id: "E3", owner_name: "Three", stage: "CONNECTED" } }),
  row({ lead_id: "33333333-c", lead_id8: "33333333", highest_positive: "VISIT", last_activity_at: null, junked_at: "2026-10-20T10:00:00Z", recycle_count: 2, first_positive_by: "E9" }),
  row({ lead_id: "44444444-d", lead_id8: "44444444", is_data_copy: true, card_type: "DATA", last_activity_at: ago(45) })
];
const F = (o) => ({ ...pj.EMPTY_FILTERS, ...o });
const ids = (xs) => xs.map((r) => r.lead_id8).join(",");

check("no filter -> all 4", pj.filterRows(rows, F({}), NOW).length === 4);
check("search by short id prefix", ids(pj.filterRows(rows, F({ search: "2222" }), NOW)) === "22222222");
check("card type DATA", ids(pj.filterRows(rows, F({ cardType: "DATA" }), NOW)) === "22222222,44444444");
check("highest positive VISIT", ids(pj.filterRows(rows, F({ highest: "VISIT" }), NOW)) === "33333333");
check("last activity under 7 days", ids(pj.filterRows(rows, F({ activityAge: "LT7" }), NOW)) === "11111111");
check("last activity 14-30", ids(pj.filterRows(rows, F({ activityAge: "14TO30" }), NOW)) === "22222222");
check("last activity 30+ includes none recorded", ids(pj.filterRows(rows, F({ activityAge: "30PLUS" }), NOW)) === "33333333,44444444");
check("junk date range (IST days)", ids(pj.filterRows(rows, F({ junkFrom: "2026-10-28", junkTo: "2026-10-28" }), NOW)) === "11111111,22222222,44444444");
check("has sibling", ids(pj.filterRows(rows, F({ sibling: "YES" }), NOW)) === "22222222");
check("recycle count", ids(pj.filterRows(rows, F({ recycleCount: "2" }), NOW)) === "33333333");
check("project", ids(pj.filterRows(rows, F({ project: "P2" }), NOW)) === "22222222");
check("first positive by", ids(pj.filterRows(rows, F({ firstBy: "E9" }), NOW)) === "33333333");
check("sort: highest positive first", ids(pj.sortRows(rows, "positive")).startsWith("33333333,11111111,22222222"));
check("sort: oldest junk first", pj.sortRows(rows, "junked_asc")[0].lead_id8 === "33333333");
check("sort does not mutate input", rows[0].lead_id8 === "11111111");
check("suggested employee = first positive, only if active", pj.suggestedEmployee(rows[0], new Set(["E1"])) === "E1" && pj.suggestedEmployee(rows[0], new Set(["E2"])) === "");
check("DATA copy not selectable", !pj.selectable(rows[3]) && pj.selectable(rows[1]));
check("restore target wording", pj.restoreTarget("CONVERTED", "FOLLOW_UP") === "Converted · Follow-up" && pj.restoreTarget("CONNECTED", "LEADS") === "Connected");

// 2) service-only writer RPCs are never called from the app
const offenders = [];
const walk = (d) => {
  for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
    const rel = path.join(d, e.name);
    if (e.isDirectory()) walk(rel);
    else if (/\.(tsx?|jsx?)$/.test(e.name) && /rpc\(\s*["'](assign_lead_atomic|recycle_lead_atomic|send_birthday_celebration_atomic)["']/.test(read(rel))) offenders.push(rel);
  }
};
["app", "components", "lib"].forEach(walk);
check(`app code calls a service-only RPC: ${offenders.join(", ")}`, offenders.length === 0);

// 3) SQL safety pieces stay in place
const sql = read("supabase/sql/2026-10-29_positive_junk_restore.sql");
check("restore RPC checks is_admin()", /restore_positive_junk_leads[\s\S]*?if not coalesce\(\(select is_admin\(\)\), false\)/.test(sql));
check("25 limit in SQL matches the page", /> 25 then/.test(sql) && /'max_batch', 25/.test(sql));
check("DATA copies refused", /DATA copy of a lead/.test(sql));
check("protection lives in auto_junk_window_check", /restored by an admin, protected until/.test(sql));
check("no call to assign_lead_atomic / recycle_lead_atomic in the restore SQL", !/(assign|recycle)_lead_atomic\s*\(/.test(sql));
check("PUBLIC/anon revoked on the restore RPCs", /revoke all on function public\.restore_positive_junk_leads\(jsonb, text, boolean, boolean\) from public, anon;/.test(sql));

if (problems.length) {
  console.error("check-positive-junk FAILED:\n - " + problems.join("\n - "));
  process.exit(1);
}
console.log("check-positive-junk: all checks pass.");
