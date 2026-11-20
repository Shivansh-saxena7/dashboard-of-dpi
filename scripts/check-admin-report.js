#!/usr/bin/env node
// Admin Performance Report (2026-11-20) known-answer + guard check, run in prebuild. No DB access.
// 1) lib/perfReport.ts: % of leads ("–" at 0), status / stage columns from the data (new names kept), IST presets,
//    filters JSON, CSV with count and % (and no formula injection).
// 2) The page reads only: one RPC per filter change (get_perf_report), drill-down on tap (get_perf_report_leads), the
//    flag from one settings row; no polling, no realtime channel, no writes; English, no purple / violet.
// 3) The SQL keeps its safety pieces: admin check, range cap, 200 drill-down cap, IST days, rollback for every file.

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const problems = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) problems.push(`${name}: got ${g}, want ${w}`);
};
const check = (name, ok) => { if (!ok) problems.push(name); };

const { outputText } = ts.transpileModule(read("lib/perfReport.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
const mod = { exports: {} };
new Function("module", "exports", "require", outputText)(mod, mod.exports, () => { throw new Error("unexpected import"); });
const pr = mod.exports;

// 1) Known answers.
eq("pct: one decimal", [pr.pctText(1, 3), pr.pctText(2, 3), pr.pctText(3, 3), pr.pctText(0, 7)], ["33.3%", "66.7%", "100.0%", "0.0%"]);
eq("pct: no leads -> –, never divides by zero", [pr.pctText(0, 0), pr.pctText(5, 0), pr.pctText(1, null), pr.metricPct({ leads: 0, visit: 0 }, "visit"), pr.metricPct({ leads: 0 }, "leads")], ["–", "–", "–", "–", "–"]);
eq("pct: leads column is 100% of itself", pr.metricPct({ leads: 4 }, "leads"), "100.0%");
eq("status columns: known order, then new names alphabetically",
  pr.mixKeys([{ status_mix: { NO_RESULT: 1, CONVERTED: 2, ZETA_NEW: 1 } }, { status_mix: { NOT_CONNECTED: 3, CALLBACK_LATER: 1 } }, null], "status_mix"),
  ["CONVERTED", "NOT_CONNECTED", "NO_RESULT", "CALLBACK_LATER", "ZETA_NEW"]);
eq("stage columns: known order, then new names", pr.mixKeys([{ stage_mix: { VISIT: 1, NEGOTIATION: 2, LEADS: 5 } }], "stage_mix"), ["LEADS", "VISIT", "NEGOTIATION"]);
eq("words: known and new", [pr.statusWord("NOT_CONNECTED"), pr.statusWord("CALLBACK_LATER"), pr.stageWord("FOLLOW_UP"), pr.stageWord("NEGOTIATION"), pr.stageWord("LEADS")],
  ["Not connected", "Callback later", "Follow-up", "Negotiation", "Leads (no move)"]);
eq("status tone: icon + colour", ["NOT_CONNECTED", "NOT_INTERESTED", "CONVERTED", "NO_RESULT", "CALLBACK_LATER"].map((k) => pr.statusTone(k).tone), ["red", "amber", "green", "mute", "blue"]);
eq("mix %", [pr.mixPct({ leads: 3, status_mix: { CONVERTED: 1 } }, "status_mix", "CONVERTED"), pr.mixPct({ leads: 0, status_mix: {} }, "status_mix", "CONVERTED")], ["33.3%", "–"]);
const NOW = Date.parse("2026-11-20T23:45:00+05:30");
eq("IST presets on 20 Nov 23:45 IST", ["today", "last7", "this_month", "last_month"].map((p) => pr.presetRange(p, NOW)),
  [{ from: "2026-11-20", to: "2026-11-20" }, { from: "2026-11-14", to: "2026-11-20" }, { from: "2026-11-01", to: "2026-11-20" }, { from: "2026-10-01", to: "2026-10-31" }]);
eq("IST presets just after midnight IST (still the previous UTC day)", pr.presetRange("today", Date.parse("2026-12-01T00:10:00+05:30")), { from: "2026-12-01", to: "2026-12-01" });
eq("last month in January is December", pr.presetRange("last_month", Date.parse("2027-01-05T10:00:00+05:30")), { from: "2026-12-01", to: "2026-12-31" });
eq("filters JSON", [pr.filtersJson(pr.NO_FILTERS), pr.filtersJson({ ...pr.NO_FILTERS, employee: "e1", source: "Meta", leadType: "DATA", origin: "OTHER" })],
  [{}, { employee_ids: ["e1"], sources: ["Meta"], lead_type: "DATA", origins: ["SELF", "OTHER"] }]);
const rep = {
  def_version: 1, as_of: "2026-11-20T09:37:00Z", from: "2026-10-01", to: "2026-10-31",
  totals: { leads: 3, stints: 6, fresh: 3, visit: 1, converted: 1, status_mix: { CONVERTED: 1, NO_RESULT: 2 } },
  by_employee: [{ employee_id: "e1", name: "=cmd|x", leads: 2, fresh: 2, visit: 0, status_mix: { NO_RESULT: 2 } }],
  by_source: [{ source: "99acres", leads: 3, fresh: 3 }], by_employee_type: [], options: null, definitions: []
};
const csv = pr.buildCsv(rep, (id) => id);
check("CSV: count and % columns", csv.includes("Fresh,Fresh %") && csv.includes(",3,100.0%,") && csv.includes("Converted,Converted %"));
check("CSV: status mix with count and %", /Status mix: employee,Leads,Converted,Converted %,No result,No result %/.test(csv) && csv.includes("Total,3,1,33.3%,2,66.7%"));
check("CSV: a cell starting with = is neutralised", csv.includes(`"'=cmd|x"`) && !csv.includes("\n=cmd"));
eq("as-of text", [pr.asOfText(null), pr.asOfText("2026-11-20T09:37:00Z")], ["Not built yet", "As of 15:07, 20 Nov"]);

// 2) Guards on the page code.
const files = ["components/PerfReport.tsx", "lib/usePerfReport.ts", "app/admin/performance-report/page.tsx"];
const all = files.map(read).join("\n");
const rpcs = [...all.matchAll(/\.rpc\("([a-z_]+)"/g)].map((m) => m[1]).sort();
eq("only the two report RPCs", rpcs, ["get_perf_report", "get_perf_report_leads"]);
const froms = [...all.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
eq("only the flag row is read directly", froms, ["lead_engine_settings"]);
check("flag read is one row", all.includes('.from("lead_engine_settings").select("*").eq("id", 1).maybeSingle()'));
check("flag: anything but 'on' (missing column, error) = hidden", all.includes('row.admin_report_mode === "on" ? "on" : "off"'));
check("no polling, no realtime, no writes", !/setInterval\(|\.channel\(|\.from\([^)]*\)[^;]*?\.(insert|update|upsert|delete)\(/.test(all));
check("one RPC per filter change (keyed effect, stale answers dropped)", /useEffect\(\(\) => \{\s*if \(enabled\) void load\(\);\s*\}, \[enabled, load\]\)/.test(all) && all.includes("if (my !== seq.current) return;"));
check("drill-down pages of 200", read("lib/usePerfReport.ts").includes("export const DRILL_PAGE = 200;"));
check("no purple / violet / fuchsia, no dark mode", !/purple|violet|fuchsia|dark:/i.test(all));
check("errors are reported", (all.match(/reportClientError\(/g) || []).length >= 3);
check("estimate label on details", read("components/PerfReport.tsx").includes(">Estimate</Pill>"));
check("LeadCard / DataCard / Homes untouched by this page", !/LeadCard|DataCard|AdminHome|EmployeeHome/.test(all));

// 3) SQL safety pieces.
const sql = read("supabase/sql/2026-11-20_perf_report.sql");
for (const f of ["2026-11-20_perf_report", "2026-11-20_perf_report_cron", "2026-11-20_admin_report_mode"]) {
  check(`${f}: rollback exists`, fs.existsSync(path.join(root, `supabase/sql/${f}_rollback.sql`)));
  check(`${f}: LF only`, !read(`supabase/sql/${f}.sql`).includes("\r"));
}
check("SQL: admin check", sql.includes("raise exception 'perf report: admin only'") && sql.includes("raise exception 'perf_refresh: admin only'"));
check("SQL: range cap and IST days", sql.includes("p_to - p_from > 800") && sql.includes("at time zone 'Asia/Kolkata'"));
check("SQL: drill-down cap 200", sql.includes("least(greatest(coalesce(p_limit, 200), 1), 200)"));
check("SQL: % never divides by zero", sql.includes("case when c.leads = 0 then null") && sql.includes("nullif(c.leads, 0)"));
check("SQL: follow-up = stage move only", /count\(distinct lead_id\) filter \(where followup_move\) as followup/.test(sql));
check("SQL: draft header", sql.startsWith("-- 2026-11-20 Admin Performance Report") && sql.includes("DRAFT, NOT APPLIED"));
check("flag SQL: default off", read("supabase/sql/2026-11-20_admin_report_mode.sql").includes("default 'off'"));

if (problems.length) {
  console.error("check-admin-report FAILED:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log("check-admin-report: OK");
