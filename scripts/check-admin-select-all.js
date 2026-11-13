#!/usr/bin/env node
// Admin Leads "Select all matching" (2026-11-13): known answers + guards, run in prebuild. No DB or network access:
// the query is only built (postgrest-js), never sent.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const problems = [];
require.extensions[".ts"] = (m, f) =>
  m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, f);
const { ADMIN_SELECT_ALL_SELECT } = require(path.join(root, "lib/adminLeadsSelect.ts"));
const { PostgrestClient } = require("@supabase/postgrest-js");

const eq = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const page = read("app/admin/leads/page.tsx");

// 1) Every lead_history column the filters use is embedded, with !inner, in both the list and the Select-all query.
const fStart = page.indexOf("function applyLeadFilters(");
const fBody = page.slice(fStart, page.indexOf("\n  }\n", fStart));
const filterCols = [...new Set([...fBody.matchAll(/"lead_history\.([a-z_]+)"/g)].map((m) => m[1]))].sort();
eq("filters use these lead_history columns", filterCols, ["assigned_at", "is_active", "recycle_reason"]);
const embedCols = (select) => {
  const m = select.match(/lead_history!inner\s*\(([^)]*)\)/);
  return m ? m[1].split(",").map((c) => c.trim()).filter((c) => /^[a-z_]+$/.test(c)) : null;
};
const listSelect = page.slice(page.indexOf("const LEADS_SELECT = `"), page.indexOf("`;", page.indexOf("const LEADS_SELECT = `")));
for (const [name, select] of [["Select all", ADMIN_SELECT_ALL_SELECT], ["list", listSelect]]) {
  const cols = embedCols(select);
  if (!cols) problems.push(`${name} query must embed lead_history!inner`);
  else for (const c of filterCols) if (!cols.includes(c)) problems.push(`${name} query embed is missing lead_history.${c}`);
}
for (const c of ["id", "status", "board_stage"]) if (!ADMIN_SELECT_ALL_SELECT.split(",").map((x) => x.trim()).includes(c)) problems.push(`Select all must still read ${c}`);

// 2) fetchAllMatching is only called with a select that carries the embed.
const calls = [...page.matchAll(/fetchAllMatching\(([^)]*)\)/g)].map((m) => m[1].trim()).filter((a) => !a.startsWith("selectString"));
for (const a of calls) if (!["LEADS_SELECT", "ADMIN_SELECT_ALL_SELECT"].includes(a)) problems.push(`fetchAllMatching(${a}) must use LEADS_SELECT or ADMIN_SELECT_ALL_SELECT`);
if (!calls.includes("ADMIN_SELECT_ALL_SELECT")) problems.push("Select all must use ADMIN_SELECT_ALL_SELECT");

// 3) Query shape, built with postgrest-js exactly as the page builds it (never sent).
const db = new PostgrestClient("http://localhost.invalid/rest/v1");
const params = (q) => new URL(q.url.toString()).searchParams;
const withFilter = params(db.from("leads").select(ADMIN_SELECT_ALL_SELECT).eq("lead_history.is_active", true).not("lead_history.recycle_reason", "is", null).range(0, 999));
eq("with filter: select embeds lead_history!inner", /lead_history!inner\(is_active,recycle_reason,assigned_at\)/.test(withFilter.get("select")), true);
eq("with filter: is_active filter sent", withFilter.get("lead_history.is_active"), "eq.true");
eq("with filter: recycle_reason filter sent", withFilter.get("lead_history.recycle_reason"), "not.is.null");
const noFilter = params(db.from("leads").select(ADMIN_SELECT_ALL_SELECT).range(0, 999));
eq("no filter: same select", noFilter.get("select"), withFilter.get("select"));
eq("no filter: no lead_history filter", [...noFilter.keys()].filter((k) => k.startsWith("lead_history.")), []);
// The old shape (the bug): a lead_history filter with no lead_history in the select is what PostgREST rejects (PGRST108).
const old = params(db.from("leads").select("id, status, board_stage").eq("lead_history.is_active", true));
eq("old shape had no embed (the bug)", /lead_history/.test(old.get("select")), false);

if (problems.length) {
  console.error("check-admin-select-all: FAILED");
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}
console.log("check-admin-select-all: all known answers and guards pass.");
