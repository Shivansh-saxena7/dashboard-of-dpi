#!/usr/bin/env node
// Admin Performance Report (2026-11-20, v2 2026-11-23) known-answer + guard check, run in prebuild. No DB access.
// 1) lib/perfReport.ts: % of leads ("–" at 0), "came as" adds up, status / stage columns from the data, IST presets,
//    800-day range message, future / before-data notes, multi-select filters JSON, employee x source grand total,
//    CSV (page + drill-down) with count and % and no formula injection.
// 2) The page reads only: the report RPC (v2, falling back to v1) once per filter change, the drill-down RPC on tap,
//    the flag from one settings row; no polling, no realtime, no writes, no id list in a URL; English, no purple.
//    The admin menu shows the report only while the flag is on.
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
eq("came as columns", pr.CAME_KEYS, ["came_fresh", "came_recycled", "came_data", "came_restored", "came_admin_given", "came_other"]);
eq("table: leads, came as, then results", pr.TABLE_KEYS.slice(0, 8), ["leads", "came_fresh", "came_recycled", "came_data", "came_restored", "came_admin_given", "came_other", "followup"]);
eq("drill metric for came as", [pr.drillMetric("came_data"), pr.drillMetric("came_admin_given"), pr.drillMetric("visit"), pr.drillMetric("recycled_any")], ["came:DATA", "came:ADMIN_GIVEN", "visit", "recycled_any"]);
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
eq("IST presets just after midnight IST", pr.presetRange("today", Date.parse("2026-12-01T00:10:00+05:30")), { from: "2026-12-01", to: "2026-12-01" });
eq("last month in January is December", pr.presetRange("last_month", Date.parse("2027-01-05T10:00:00+05:30")), { from: "2026-12-01", to: "2026-12-31" });
eq("range: 800 days is fine, 801 is not, reversed is not", [pr.rangeProblem("2026-01-01", pr.addDays("2026-01-01", 800)), pr.rangeProblem("2026-01-01", pr.addDays("2026-01-01", 801)), pr.rangeProblem("2026-11-02", "2026-11-01")],
  [null, "Please choose a range of 800 days or less.", "The end date is before the start date."]);
eq("range notes: future, partly future, before data, fine", [
  pr.rangeNote("2027-01-01", "2027-01-31", "2026-11-23"), pr.rangeNote("2026-11-01", "2026-11-30", "2026-11-23"),
  pr.rangeNote("2026-07-01", "2026-07-31", "2026-11-23"), pr.rangeNote("2026-07-01", "2026-09-30", "2026-11-23"), pr.rangeNote("2026-10-01", "2026-10-31", "2026-11-23")],
  ["No data yet: these dates are in the future.", "No data yet after today (23 Nov); the numbers cover up to today.", "No data before 17 Aug.", "Data starts on 17 Aug.", null]);
eq("filters JSON (several employees / sources, de-duplicated)", [pr.filtersJson(pr.NO_FILTERS), pr.filtersJson({ ...pr.NO_FILTERS, employee: ["e1", "e2", "e1"], source: ["Meta", "99acres"], leadType: "DATA", origin: "OTHER" })],
  [{}, { employee_ids: ["e1", "e2"], sources: ["Meta", "99acres"], lead_type: "DATA", origins: ["SELF", "OTHER"] }]);
const row = (o) => ({ leads: 0, stints: 0, fresh: 0, recycled: 0, restored: 0, admin_given: 0, other: 0, came_fresh: 0, came_recycled: 0, came_data: 0, came_restored: 0, came_admin_given: 0, came_other: 0,
  followup: 0, visit: 0, visit_verified: 0, booked: 0, converted: 0, details_est: 0, not_connected: 0, not_interested: 0, no_result: 0, calls: 0, ...o });
const rep = {
  def_version: 1, api: 2, as_of: "2026-11-20T09:37:00Z", from: "2026-10-01", to: "2026-10-31",
  totals: row({ leads: 3, stints: 6, came_fresh: 2, came_data: 1, visit: 1, converted: 1, status_mix: { CONVERTED: 1, NO_RESULT: 2 } }),
  by_employee: [{ employee_id: "e1", name: "=cmd|x", ...row({ leads: 2, came_fresh: 1, came_recycled: 1, visit: 1, status_mix: { NO_RESULT: 2 } }) },
    { employee_id: "e2", name: "B", ...row({ leads: 2, came_data: 1, came_fresh: 1 }) }],
  by_source: [{ source: "99acres", ...row({ leads: 3, came_fresh: 2, came_data: 1 }) }], by_employee_type: [],
  by_emp_source: [{ employee_id: "e1", source: "99acres", ...row({ leads: 2, came_fresh: 1, came_recycled: 1, visit: 1 }) },
    { employee_id: "e2", source: "99acres", ...row({ leads: 1, came_data: 1 }) }, { employee_id: "e2", source: "Meta", ...row({ leads: 1, came_fresh: 1 }) }],
  options: null, definitions: []
};
const g = pr.empSourceGroups(rep);
eq("employee x source: employees by leads, sources by leads, grand = sum of employees", [g.groups.map((x) => [x.employee.employee_id, x.sources.map((s) => s.source)]), g.grand.leads, g.grand.came_fresh],
  [[["e1", ["99acres"]], ["e2", ["99acres", "Meta"]]], 4, 2]);
const csv = pr.buildCsv(rep, (id) => id);
check("CSV: count and % columns", csv.includes("Data,Data %") && csv.includes("Fresh,Fresh %"));
check("CSV: employee x source with subtotal and grand total", csv.includes("Employee,Source,Leads received") && csv.includes("B,All sources (subtotal),2,") && csv.includes("Grand total (sum of employees),All sources,4,"));
check("CSV: status mix with count and %", /Status mix: employee,Leads,Converted,Converted %,No result,No result %/.test(csv) && csv.includes("Total,3,1,33.3%,2,66.7%"));
check("CSV: a cell starting with = is neutralised", csv.includes(`"'=cmd|x"`) && !csv.includes("\n=cmd"));
check("CSV v1 fallback: no came-as / employee x source", (() => { const c = pr.buildCsv({ ...rep, api: 1 }, (id) => id); return !c.includes("Employee,Source") && c.includes("Recycled,Recycled %"); })());
const dcsv = pr.buildDrillCsv("Visits · All", [{ lead_name: "+91 lead", employee_name: "A", lead_type: "LEAD", source: "Meta", project: "P1", origin: "RECYCLED", assigned_at: "2026-10-31T19:00:00Z", last_result: null, last_stage: "VISIT" }]);
check("drill CSV: header, IST date, words, neutralised cell", dcsv.includes("Lead,Employee,Type,Source,Project,Given as,Given on (IST),Last result,Stage") && dcsv.includes(`"'+91 lead",A,LEAD,Meta,P1,Recycled,2026-11-01,No result,Visit`));
eq("as-of text", [pr.asOfText(null), pr.asOfText("2026-11-20T09:37:00Z")], ["Not built yet", "As of 15:07, 20 Nov"]);

// 2) Guards on the page code.
const files = ["components/PerfReport.tsx", "lib/usePerfReport.ts", "app/admin/performance-report/page.tsx"];
const all = files.map(read).join("\n");
const rpcs = [...new Set([...all.matchAll(/\.rpc\((?:"([a-z0-9_]+)"|usedV2 \? "([a-z0-9_]+)" : "([a-z0-9_]+)")/g)].flatMap((m) => [m[1], m[2], m[3]]).filter(Boolean))].sort();
check("v1 fallback decided per request (two loads can be in flight)", (all.match(/if \(usedV2 && missingFn\(res\.error\)\)/g) || []).length === 2);
eq("only the report RPCs (v2 with v1 fallback)", rpcs, ["get_perf_report", "get_perf_report_leads", "get_perf_report_leads_v2", "get_perf_report_v2"]);
const froms = [...all.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
eq("only the flag row is read directly", froms, ["lead_engine_settings"]);
check("no id list in a URL (.in()) anywhere in the page", !/\.in\(/.test(all));
check("flag read is one row", all.includes('.from("lead_engine_settings").select("*").eq("id", 1).maybeSingle()'));
check("flag: anything but 'on' (missing column, error) = hidden", all.includes('row.admin_report_mode === "on" ? "on" : "off"'));
check("no polling, no realtime, no writes", !/setInterval\(|\.channel\(|\.from\([^)]*\)[^;]*?\.(insert|update|upsert|delete)\(/.test(all));
check("one RPC per filter change (keyed effect, stale answers dropped)", /useEffect\(\(\) => \{\s*if \(enabled\) void load\(\);\s*\}, \[enabled, load\]\)/.test(all) && all.includes("if (my !== seq.current) return;"));
check("an invalid range is never sent", read("lib/usePerfReport.ts").includes("if (rangeProblem(f, t)) return;"));
check("drill-down pages of 200", read("lib/usePerfReport.ts").includes("export const DRILL_PAGE = 200;"));
check("no purple / violet / fuchsia, no dark mode", !/purple|violet|fuchsia|dark:/i.test(all));
check("errors are reported", (all.match(/reportClientError\(/g) || []).length >= 4);
check("status mix label and the Converted note", read("lib/perfReport.ts").includes("Final status of each lead in this period (last result)") && read("lib/perfReport.ts").includes("Tile counts leads ever marked Converted; the mix shows each lead's final status, so the two can differ.") && read("components/PerfReport.tsx").includes("{STATUS_MIX_LABEL}") && read("components/PerfReport.tsx").includes("{CONVERTED_NOTE}"));
check("estimate label on details", read("components/PerfReport.tsx").includes(">Estimate</Pill>"));
check("800-day message and date limits", read("lib/perfReport.ts").includes("Please choose a range of ${maxDays} days or less.") && read("components/PerfReport.tsx").includes("max={addDays(custom.from, MAX_DAYS)}"));
check("LeadCard / DataCard / Homes untouched by this page", !/LeadCard|DataCard|AdminHome|EmployeeHome/.test(all));
const layout = read("app/admin/layout.tsx");
check("menu: Performance Report item, flag-gated", layout.includes('{ name:"Performance Report", href:"/admin/performance-report", icon:"📋", flag:"admin_report_mode" }') && layout.includes('.filter((item)=>!("flag" in item) || reportOn)'));
check("menu: flag read only after the admin check", layout.indexOf("setAccessChecked(true);") < layout.indexOf('admin_report_mode === "on"'));
check("menu: the new item is 44px tall, others unchanged", layout.includes('tall={"flag" in item}') && read("components/SidebarNavLink.tsx").includes('${tall ? "min-h-11 " : ""}'));

// 3) SQL safety pieces.
const sql = read("supabase/sql/2026-11-20_perf_report.sql");
const v2 = read("supabase/sql/2026-11-23_perf_report_v2.sql");
for (const f of ["2026-11-20_perf_report", "2026-11-20_perf_report_cron", "2026-11-20_admin_report_mode", "2026-11-23_perf_report_v2"]) {
  check(`${f}: rollback exists`, fs.existsSync(path.join(root, `supabase/sql/${f}_rollback.sql`)));
}
check("SQL: admin check", sql.includes("raise exception 'perf report: admin only'") && sql.includes("raise exception 'perf_refresh: admin only'"));
check("SQL: range cap and IST days", sql.includes("p_to - p_from > 800") && sql.includes("at time zone 'Asia/Kolkata'"));
check("SQL: drill-down cap 200", sql.includes("least(greatest(coalesce(p_limit, 200), 1), 200)") && v2.includes("least(greatest(coalesce(p_limit, 200), 1), 200)"));
check("SQL: % never divides by zero", sql.includes("case when c.leads = 0 then null") && v2.includes("case when j.leads = 0 then null"));
check("SQL: follow-up = stage move only", /count\(distinct lead_id\) filter \(where followup_move\) as followup/.test(sql) && /count\(distinct lead_id\) filter \(where followup_move\) as followup/.test(v2));
check("SQL v1 files recorded as applied", sql.startsWith("-- APPLIED 2026-11-20") && read("supabase/sql/2026-11-20_perf_report_cron.sql").startsWith("-- APPLIED") && read("supabase/sql/2026-11-20_admin_report_mode.sql").startsWith("-- APPLIED"));
check("SQL cron comment says :37 IST", read("supabase/sql/2026-11-20_perf_report_cron.sql").includes(":37 India time"));
const v2code = v2.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
check("SQL v2: draft, additive, every read through the admin-checked perf_stints_in", v2.includes("DRAFT, NOT APPLIED") && !/alter table|drop |create table|delete from|update public/i.test(v2code) && (v2code.match(/perf_stints_in\(/g) || []).length >= 3);
check("SQL v2: came as adds up (one segment per lead)", v2.includes("(array_agg(case when lead_type = 'DATA' then 'DATA' when origin in ('SELF', 'OTHER') then 'OTHER' else origin end"));
check("flag SQL: default off", read("supabase/sql/2026-11-20_admin_report_mode.sql").includes("default 'off'"));

if (problems.length) {
  console.error("check-admin-report FAILED:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log("check-admin-report: OK");
