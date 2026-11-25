#!/usr/bin/env node
// Admin Performance Report (2026-11-20, v2 2026-11-23, simple view v3 + give leads 2026-11-23) known-answer + guard
// check, run in prebuild. No DB access.
// 1) lib/perfReport.ts: % of leads ("–" at 0), "came as" adds up, status / stage columns from the data, IST presets,
//    800-day range message, future / before-data notes, multi-select filters JSON, employee x source grand total,
//    CSV (page + drill-down) with count and % and no formula injection.
// 2) The page reads only: the report RPC (v2, falling back to v1) once per filter change, the drill-down RPC on tap,
//    the flag from one settings row; no polling, no realtime, no writes, no id list in a URL; English, no purple.
//    The admin menu shows the report only while the flag is on.
// 3) The SQL keeps its safety pieces: admin check, range cap, 200 drill-down cap, IST days, rollback for every file.
// 4) Simple view (v3): main columns in order with every % at the end, one-employee line, flat CSV, Connected.
// 5) Give leads from the report: behind its own flag, 200 a call in the request body, an idempotency key per page,
//    only the fixed "Given by admin" reaches employees, batch tables admin-only (RLS), nothing on LeadCard / DataCard.

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
// LF everywhere, so the checks pass the same on a Windows (CRLF) checkout and on Linux.
const read = (p) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
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
eq("v4: results over leads handled, never over 100%; v3 rows unchanged", [pr.metricPct({ leads: 3, leads_handled: 4, visit: 2 }, "visit"), pr.metricPct({ leads: 0, leads_handled: 2, visit: 3 }, "visit"), pr.metricPct({ leads: 3, visit: 2 }, "visit"), pr.metricPct({ leads: 0, leads_handled: 0, visit: 0 }, "visit")], ["50.0%", "100.0%", "66.7%", "–"]);
eq("v4 main columns and labels", [pr.mainKeys({ api: 4 }).slice(0, 3), pr.pctBaseText({ api: 4 }), pr.pctBaseText({ api: 3 }), pr.mainPctLabel("visit", true)], [["leads", "leads_handled", "followup"], "% of leads handled", "% of leads given", "Visits done (% of leads handled)"]);
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
eq("filters JSON (several employees / sources / Given as, de-duplicated)", [pr.filtersJson(pr.NO_FILTERS), pr.filtersJson({ ...pr.NO_FILTERS, employee: ["e1", "e2", "e1"], source: ["Meta", "99acres"], leadTypes: ["DATA"], origins: ["FRESH", "ADMIN_GIVEN", "FRESH"] })],
  [{}, { employee_ids: ["e1", "e2"], sources: ["Meta", "99acres"], lead_types: ["DATA"], origins: ["FRESH", "ADMIN_GIVEN"] }]);
eq("filters JSON: one type for the older report; both types = no type filter", [pr.filtersJson({ ...pr.NO_FILTERS, leadTypes: ["LEAD"] }, 2), pr.filtersJson({ ...pr.NO_FILTERS, leadTypes: ["LEAD", "DATA"] }, 3), pr.filtersJson({ ...pr.NO_FILTERS, leadTypes: ["LEAD", "DATA"] }, 1)],
  [{ lead_type: "LEAD" }, {}, {}]);
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
const dcsv = pr.buildDrillCsv([{ lead_name: "+91 lead", employee_name: "A", lead_type: "LEAD", source: "Meta", project: "P1", origin: "RECYCLED", assigned_at: "2026-10-31T19:00:00Z", last_result: null, last_stage: "VISIT" }]);
check("drill CSV: header row first (no title), then rows", dcsv.startsWith("Lead,Employee,Type,Source,Project,Given as,Given on (IST),Last result,Stage\n") && dcsv.trim().split("\n").length === 2);
check("drill CSV: header, IST date, words, neutralised cell", dcsv.includes("Lead,Employee,Type,Source,Project,Given as,Given on (IST),Last result,Stage") && dcsv.includes(`"'+91 lead",A,LEAD,Meta,P1,Recycled,2026-11-01,No result,Visit`));
eq("as-of text", [pr.asOfText(null), pr.asOfText("2026-11-20T09:37:00Z")], ["Not built yet", "As of 15:07, 20 Nov"]);

// 4) Simple view known answers.
eq("main columns: counts in order (Connected needs v3)", [pr.mainKeys({ api: 3 }), pr.mainKeys({ api: 2 })],
  [["leads", "followup", "visit", "connected", "converted", "not_interested", "not_connected", "details_est"], ["leads", "followup", "visit", "converted", "not_interested", "not_connected", "details_est"]]);
eq("main labels", pr.mainKeys({ api: 3 }).map(pr.mainLabel), ["Leads given", "Follow-ups", "Visits done", "Connected", "Converted", "Not interested", "Not connected", "Details shared (estimate)"]);
const r3 = { ...rep, api: 3, totals: { ...rep.totals, connected: 2 },
  by_employee: [{ ...rep.by_employee[0], connected: 1 }, { ...rep.by_employee[1], connected: 1 }],
  by_emp_origin: [{ employee_id: "e1", origin: "FRESH", ...row({ leads: 1, visit: 1 }) }, { employee_id: "e1", origin: "RECYCLED", ...row({ leads: 1 }) }] };
const scsv = pr.buildSimpleCsv(r3, r3.by_employee, "none", (id) => id).trim().split("\n");
eq("flat CSV: header = screen columns, % at the end", scsv[0], "Employee,Leads given,Follow-ups,Visits done,Connected,Converted,Not interested,Not connected,Details shared (estimate),Follow-ups %,Visits done %,Connected %,Converted %,Not interested %,Not connected %,Details shared %");
eq("flat CSV: one row per employee + total, nothing else", [scsv.length, scsv[2], scsv[3]], [4, "B,2,0,0,1,0,0,0,0,0.0%,0.0%,50.0%,0.0%,0.0%,0.0%,0.0%", "Total,3,0,1,2,1,0,0,0,0.0%,33.3%,66.7%,33.3%,0.0%,0.0%,0.0%"]);
const ocsv = pr.buildSimpleCsv(r3, r3.by_employee, "origin", (id) => id).trim().split("\n");
eq("flat CSV split by Given as: sub-rows then the employee's All row", [ocsv[0].split(",").slice(0, 3), ocsv.slice(1, 4).map((l) => l.split(",").slice(0, 3).join(","))],
  [["Employee", "Given as", "Leads given"], ["\"'=cmd|x\",Fresh,1", "\"'=cmd|x\",Recycled,1", "\"'=cmd|x\",All,2"]]);
eq("one-employee line", pr.summaryLine("A", row({ leads: 4, came_fresh: 1, came_recycled: 2, followup: 1, visit: 1, connected: 2, converted: 0, not_interested: 1, not_connected: 1, details_est: 1 }), "1–31 Oct", true),
  "A was given 4 leads (1 fresh, 2 recycled, 1 other) in 1–31 Oct: 1 follow-ups (25.0%), 1 visits (25.0%), 2 connected (50.0%), 0 converted (0.0%), 1 not interested (25.0%), 1 not connected (25.0%); details shared to about 1 (estimate).");
eq("one-employee line: no leads", pr.summaryLine("A", row({}), "Today", true), "A was given no leads in Today.");
eq("Given as words", ["FRESH", "RECYCLED", "RESTORED", "ADMIN_GIVEN"].map(pr.originWord), ["Fresh", "Recycled", "Given back", "Given by admin"]);
eq("owner rules: warn above 100 to one receiver, undo for 7 days", [pr.MANY_LEADS_WARN, pr.UNDO_DAYS, pr.undoOpen("2026-11-16T10:00:00Z", Date.parse("2026-11-23T09:59:00Z")), pr.undoOpen("2026-11-16T10:00:00Z", Date.parse("2026-11-23T10:01:00Z"))], [100, 7, true, false]);
eq("chunks of 200 (450 -> 200, 200, 50)", pr.chunks(Array.from({ length: 450 }, (_, i) => i)).map((c) => c.length), [200, 200, 50]);
eq("reassign items: one per lead, with the owner the admin saw", pr.reassignItems([{ lead_id: "l1", current_owner_id: "e1" }, { lead_id: "l1", current_owner_id: "e1" }, { lead_id: "l2", current_owner_id: null }, { lead_id: "" }]),
  [{ lead_id: "l1", expected_owner: "e1" }, { lead_id: "l2", expected_owner: null }]);
eq("active filter tags", pr.filterTags({ ...pr.NO_FILTERS, employee: ["e1", "e2", "e3"], origins: ["FRESH"], leadTypes: ["DATA"] }, (id) => id.toUpperCase(), (id) => id).map((t) => t.label), ["E1, E2 +1", "Fresh", "Data"]);

// 2) Guards on the page code.
const files = ["components/PerfReport.tsx", "components/perfUi.tsx", "lib/usePerfReport.ts", "app/admin/performance-report/page.tsx"];
const all = files.map(read).join("\n");
const giveFiles = ["components/PerfReassign.tsx", "lib/usePerfReassign.ts"];
const give = giveFiles.map(read).join("\n");
const rpcNames = (src) => [...new Set([...src.matchAll(/\.rpc\("([a-z0-9_]+)"/g)].map((m) => m[1]).concat([...src.matchAll(/\d: "(get_perf_report[a-z0-9_]*)"/g)].map((m) => m[1])))].sort();
check("older-report fallback decided per request, stepping v3 -> v2 -> v1", read("lib/usePerfReport.ts").includes("while (v > 1 && missingFn(res.error))") && read("lib/usePerfReport.ts").includes("let v: Api = api.current;"));
eq("report page: only the report RPCs (v4, v3, v2, v1) and the journey", rpcNames(all), ["get_lead_journey", "get_perf_report", "get_perf_report_leads", "get_perf_report_leads_v2", "get_perf_report_leads_v3", "get_perf_report_leads_v4", "get_perf_report_v2", "get_perf_report_v3", "get_perf_report_v4"]);
check("SQL v4: draft, additive, events dated by themselves, a copied visit lock is not a visit, definitions v2", (() => {
  const v4 = read("supabase/sql/2026-11-25_perf_report_v4.sql");
  const c = v4.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  return v4.includes("DRAFT, NOT APPLIED") && !/alter table|drop |create table|delete from|update public/i.test(c) && c.includes("o.paused_until = h.paused_until")
    && c.includes("a.created_at >= t0 and a.created_at < t1") && c.includes("v.created_at >= t0 and v.created_at < t1") && c.includes("'def_version', 2")
    && fs.existsSync(path.join(root, "supabase/sql/2026-11-25_perf_report_v4_rollback.sql"));
})());
eq("give controls: only their own RPCs", rpcNames(give), ["admin_reassign_leads_from_report", "admin_report_reassign_preview", "admin_undo_report_batch", "get_lead_report_batches", "get_report_batch_outcome", "get_report_batches"]);
const froms = [...all.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
eq("only the flag row is read directly", froms, ["lead_engine_settings"]);
eq("give controls read only the sales employee list directly (bounded)", [...give.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]), ["employees"]);
check("employee list is bounded", read("lib/usePerfReassign.ts").includes('.eq("is_active", true).eq("department", "sales").order("name").limit(500)'));
check("give controls: no writes to tables, no id list in a URL, no polling", !/\.in\(|setInterval\(|\.channel\(|\.(insert|update|upsert|delete)\(/.test(give));
check("give: 200 leads a call, one idempotency key per page", read("lib/perfReport.ts").includes("export const REASSIGN_CHUNK = 200;") && read("lib/usePerfReassign.ts").includes("p_idempotency_key: `${runKey}-${i}`") && read("lib/usePerfReassign.ts").includes("chunks(items, REASSIGN_CHUNK)"));
check("give: the run key is made once per confirm sheet (a double tap repeats, never doubles)", read("components/PerfReassign.tsx").includes("const runKey = useRef(newKey());") && read("components/PerfReassign.tsx").includes("const undoKey = useRef(newKey());"));
check("give controls only behind their own flag (and the report flag)", read("lib/usePerfReport.ts").includes('reassign: mode === "on" && !!row && row.admin_report_reassign_mode === "on"') && read("app/admin/performance-report/page.tsx").includes("<PerfReport reassign={reassign} />") && read("components/PerfReport.tsx").includes("reassign={reassign && v3}"));
check("give: preview first, confirm needs a reason, deliberate-action warning shown", give.includes("previewGive(items, to, mode, incPos)") && give.includes("reason.trim().length >= MIN_REASON") && give.includes("This is a deliberate admin decision."));
check("give: positive leads left out unless ticked", give.includes("useState(false);") && give.includes("Include positive leads"));
check("give files: English, no purple, no dark mode, no lead cards", !/purple|violet|fuchsia|dark:|LeadCard|DataCard/i.test(give));
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
check("main table: counts then every % at the end; More details closed by default", read("components/PerfReport.tsx").includes("{keys.map((k) => sortHead(k, mainLabel(k)))}\n                      {pctKeys.map((k) => sortHead(k, PCT_SHORT[k] ?? mainLabel(k), true))}") && read("components/PerfReport.tsx").includes("const [more, setMore] = useState(false);"));
check("CSV button exports exactly the screen table", read("components/PerfReport.tsx").includes("buildSimpleCsv(r, employees, splitOk ? split : \"none\", nameOf)"));
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

// 5) SQL for v3 and give leads (drafts until applied).
const v3 = read("supabase/sql/2026-11-23_perf_report_v3.sql");
const ra = read("supabase/sql/2026-11-23_perf_report_reassign.sql");
const fl = read("supabase/sql/2026-11-23_admin_report_reassign_mode.sql");
const code = (t) => t.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
for (const f of ["2026-11-23_perf_report_v3", "2026-11-23_perf_report_reassign", "2026-11-23_admin_report_reassign_mode"]) check(`${f}: rollback exists`, fs.existsSync(path.join(root, `supabase/sql/${f}_rollback.sql`)));
check("SQL v3: additive (functions only), admin check, range cap, 200 cap", !/alter table|drop |create table|delete from|update public/i.test(code(v3)) && v3.includes("raise exception 'perf report: admin only'") && v3.includes("p_to - p_from > 800") && v3.includes("least(greatest(coalesce(p_limit, 200), 1), 200)"));
check("SQL v3: Connected = Connected / Converted / Not interested saved, or follow-up, or visit", v3.includes("(x.followup_move or x.visit or exists (select 1 from lead_activity_log a where a.lead_id = x.lead_id and a.lead_history_id = x.stint_id\n         and a.activity_type = 'STATUS_UPDATE' and a.detail in ('CONNECTED', 'CONVERTED', 'NOT_INTERESTED'))) as reached"));
check("SQL give: admin only, 200 a call, idempotency key unique", (ra.match(/raise exception 'report reassign: admin only'/g) || []).length >= 6 && ra.includes("not between 1 and 200") && ra.includes("idempotency_key text not null unique"));
check("SQL give: every move through admin_reassign_leads with the fixed text only", (code(ra).match(/admin_reassign_leads\(/g) || []).length === 2 && (code(ra).match(/admin_reassign_leads\(array\[[a-z_.]+\], [a-z_.]+, 'Given by admin', 'auto'\)/g) || []).length === 2);
check("SQL give: stale owner and positive checks, lead row locked", ra.includes("'owner changed since the list was opened'") && ra.includes("'positive lead (excluded)'") && ra.includes("for update;  -- the sweep cannot move it"));
check("SQL give: receiver leave / return grace / Sales checks", ra.includes("employee_in_return_grace(p_employee, today)") && ra.includes("'receiver is on leave today'") && ra.includes("'receiver is not in Sales'"));
check("SQL give: batch tables admin-only (RLS, no anon)", (ra.match(/enable row level security/g) || []).length === 2 && (ra.match(/using \(coalesce\(\(select is_admin\(\)\), false\)\)/g) || []).length === 2 && ra.includes("from public, anon, authenticated;"));
check("SQL give: helpers without an admin check are revoked from authenticated too", ra.includes("public.perf_reassign_check_items(jsonb), public.perf_reassign_enabled()\n  from public, anon, authenticated;") && v3.includes("revoke all on function public.perf_stint_facts(uuid) from public, anon, authenticated;"));
check("SQL give: items checked up front (uuid, no duplicates), fixed lock order, flag enforced in the database", ra.includes("perform perf_reassign_check_items(p_items);") && ra.includes("order by (value ->> 'lead_id')::uuid loop  -- fixed lock order") && (ra.match(/if not perf_reassign_enabled\(\) then raise exception/g) || []).length === 2);
check("SQL undo: only within 7 days (also in the database)", ra.includes("if b.created_at < now() - interval '7 days' then raise exception") && read("components/PerfReassign.tsx").includes("undoOpen(b.created_at, Date.now())"));
check("SQL: a reused idempotency key must belong to the same action (give vs undo)", (ra.match(/idempotency key already used for another action/g) || []).length === 3);
check("confirm sheet warns above 100 leads to one receiver", read("components/PerfReassign.tsx").includes("p.will_move > MANY_LEADS_WARN"));
check("SQL give and v3: drafts, flag default off", v3.includes("DRAFT, NOT APPLIED") && ra.includes("DRAFT, NOT APPLIED") && fl.includes("default 'off'"));

// 6) Lead Journey tab (2026-11-26, definitions v3): known answers for lib/perfJourney.ts and guards on its files / SQL.
{
  const jt = ts.transpileModule(read("lib/perfJourney.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const jm = { exports: {} };
  new Function("module", "exports", "require", jt)(jm, jm.exports, () => { throw new Error("perfJourney.ts must not import"); });
  const pj = jm.exports;
  eq("journey %: of leads given, one decimal, never over 100, – at 0", [pj.jPct(3, 7), pj.jPct(9, 7), pj.jPct(0, 0), pj.jPct(2, null), pj.jPct(1, 3)], ["42.9%", "100.0%", "–", "–", "33.3%"]);
  eq("journey: low sample under 20 leads given", [pj.lowSample({ leads: 19 }), pj.lowSample({ leads: 20 }), pj.JOURNEY_LOW_SAMPLE], [true, false, 20]);
  eq("journey: team average from the team row", [pj.teamAvg({ leads: 200, missed: 50 }), pj.teamAvg({ leads: 200, won: 30 }, "won"), pj.teamAvg(null)], ["25.0%", "15.0%", "–"]);
  eq("journey words", [pj.resultWord("FOLLOWUP"), pj.resultWord("NO_RESULT"), pj.resultWord("CALLBACK_LATER"), pj.moveWord("system"), pj.moveWord("admin"), pj.moveWord(null), pj.excusedWord("leave"), pj.originWordJ("RESTORED")],
    ["Follow-up", "No result", "Callback Later", "Recycled", "Given by admin", "Still with them", "On leave", "Given back"]);
  const step = (o) => ({ seq: 1, employee_id: "e1", name: "A", origin: "FRESH", assigned_at: "2026-10-01T04:30:00Z", ended_at: "2026-10-10T04:30:00Z", days: 9, calls: 2, worked: true, positive: false, result: "NOT_CONNECTED", move: "system", excused: null, in_range: true, missed: true, won: false, assist: false, ...o });
  const jr = { lead_id: "11111111-2222", lead_short: "11111111", first_at: "2026-10-01T04:30:00Z", lead_type: "DATA", source: "=cmd", project: "P", status: "CONNECTED", stage: "FOLLOW_UP", available: true, positive_now: true,
    got_by: "e2", got_by_name: "B", owners: 6, steps: [step({}), step({ seq: 2, employee_id: "e2", name: "B", origin: "RECYCLED", ended_at: null, positive: true, result: "CONNECTED", move: null, missed: false, won: true })] };
  const flat = pj.flatJourney(jr);
  eq("journey flat row: head and row line up; owners in order; formula-safe; who missed / won", [flat.length === pj.FLAT_HEAD.length, flat[0], flat[1], flat[2], flat[4], flat[6], flat[9], flat[10], flat[15], flat.slice(-6)],
    [true, "11111111", "'=cmd", "Data", "A", "Not connected", "Recycled", "B", "Still with them", [2, "Follow-up", "B", "A", "B", ""]]);
  const sr = pj.summaryRow("A", { leads: 10, assignments: 11, positive: 2, moved_no_pos: 6, missed: 3, not_counted: 1, won: 0, assist: 1, calls_avg: 1.5, first_action_h: 30 }, { leads: 100, missed: 20 });
  eq("journey summary: counts first, every % at the end (team average included)", [sr.length === pj.SUMMARY_HEAD.length, pj.SUMMARY_HEAD.slice(-4), sr.slice(-4), sr[10], sr[11]], [true, ["Missed %", "Team avg missed %", "Won %", "Assist %"], ["30.0%", "20.0%", "0.0%", "10.0%"], "1.3 d", "Low sample"]);
  eq("journey: one employee's sheet = journeys where they had an assignment in the range", [pj.rowsOf([jr], "e1").length, pj.rowsOf([jr], "e9").length], [1, 0]);
  const used = new Set(["summary"]);
  eq("journey: Excel sheet names safe and unique", [pj.sheetName("Summary", used), pj.sheetName("A/B: [x]", used), pj.sheetName("A/B: [x]", used)], ["Summary 2", "A B   x", "A B   x 2"]);

  const jf = ["components/PerfJourney.tsx", "lib/usePerfJourney.ts", "lib/perfJourneyExcel.ts", "lib/perfJourney.ts"].map(read).join("\n");
  eq("journey files: only the two journey RPCs", rpcNames(jf), ["get_perf_journey", "get_perf_journey_rows"]);
  check("journey files: no direct table reads, no polling, no realtime, no writes, no id list in a URL", !/\.from\("|setInterval\(|\.channel\(|\.(insert|update|upsert|delete)\(|\.in\(/.test(jf));
  check("journey files: English, no purple / violet / fuchsia, no dark mode, no lead cards", !/purple|violet|fuchsia|dark:|LeadCard|DataCard/i.test(jf));
  check("journey: one RPC per filter change, only while its tab is open; the report reads only on its own tab",
    jf.includes("if (enabled) void load();") && jf.includes("if (my !== seq.current) return;") && read("lib/usePerfJourney.ts").includes("if (rangeProblem(f, t)) return;")
    && read("components/PerfReport.tsx").includes('usePerfReport(range.from, range.to, filters, tab === "report")') && read("components/PerfReport.tsx").includes('usePerfJourney(range.from, range.to, filters, tab === "journey")'));
  check("journey: fairness note, approx label, low sample label, % of leads given", jf.includes('FAIR_NOTE = "A signal, not a verdict."') && jf.includes("{FAIR_NOTE}") && jf.includes("(approx)") && jf.includes(">Low sample</Pill>") && jf.includes("% of leads given"));
  check("journey: no client name or number on the page or in Excel (lead short id only)", !/lead_name|mobile|phone/i.test(jf) && jf.includes("r.lead_short"));
  check("journey Excel: landscape, fit to width, header repeats, Page X of N, definitions sheet", jf.includes('orientation: "landscape"') && jf.includes("fitToWidth: 1") && jf.includes("printTitlesRow") && jf.includes("Page &P of &N") && jf.includes('addWorksheet("Definitions")'));
  check("journey errors are reported", (jf.match(/reportClientError\(/g) || []).length >= 3);
  const lj = read("supabase/sql/2026-11-26_perf_lead_journey.sql");
  const ljc = code(lj);
  check("SQL journey: draft, additive (functions + definitions v3 rows), rollback exists", lj.includes("DRAFT, NOT APPLIED") && !/alter table|drop |create table|delete from|update public/i.test(ljc)
    && fs.existsSync(path.join(root, "supabase/sql/2026-11-26_perf_lead_journey_rollback.sql")) && read("supabase/sql/2026-11-26_perf_lead_journey_rollback.sql").includes("delete from public.perf_definitions where version = 3;"));
  check("SQL journey: admin check in both RPCs, range cap, page cap 500, view list", (ljc.match(/raise exception 'perf report: admin only'/g) || []).length === 2 && (ljc.match(/p_to - p_from > 800/g) || []).length === 2
    && ljc.includes("least(greatest(coalesce(p_limit, 50), 1), 500)") && ljc.includes("raise exception 'perf report: bad view'"));
  check("SQL journey: helpers revoked from every API role", ljc.includes("public.perf_journey_json(date, date, jsonb, text, uuid, int, int, boolean) from public, anon, authenticated;") && ljc.includes("revoke all on function public.perf_journey_stints_v1(date, date, jsonb)"));
  check("SQL journey: owner rules (60 days, 3 days or 1 call, system recycle only, leave / inactive, % capped)", ljc.includes("interval '60 days'") && ljc.includes("(j.held >= 3 or j.calls >= 1 or j.work_at is not null) as eff")
    && ljc.includes("not k.is_pos and k.mv = 'system' and k.exc is null and k.eff") && ljc.includes("then 'leave'") && ljc.includes("then 'inactive'") && ljc.includes("least(100, round(100.0 *"));
  check("SQL journey: merged leads included (Leads given = the main report)", !/where not s\.lead_merged/.test(ljc));
}

if (problems.length) {
  console.error("check-admin-report FAILED:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log("check-admin-report: OK");
