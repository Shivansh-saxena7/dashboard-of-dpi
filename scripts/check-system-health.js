#!/usr/bin/env node
// System Health cleanup (2026-11-13): known answers + guards, run in prebuild. No DB, no network (fetch is faked).
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const problems = [];
require.extensions[".ts"] = (m, f) =>
  m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, f);
const ag = require(path.join(root, "lib/anomalyGroups.ts"));
const { adminSearchTerm } = require(path.join(root, "lib/adminLeadsSelect.ts"));
const eq = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// 1) Grouping
eq("ids and numbers out", ag.normalizeAnomalyMessage("Recycle refused: lead 94d3a76b would go, 3 times"), "Recycle refused: lead <id> would go, # times");
eq("full uuid out", ag.normalizeAnomalyMessage("x 2cca86b2-55d5-4eff-a470-486d4a46599e y"), "x <id> y");
const row = (o) => ({ id: o.id, source: o.source || "page:/leads", severity: o.severity || "warning", message: o.message, layer: "FRONTEND", occurrence_count: o.occ || 1, detected_at: o.first || "2026-11-01T00:00:00Z", last_seen_at: o.last || "2026-11-01T00:00:00Z", context: o.ctx || null });
const rows = [
  row({ id: "1", message: "GET notification failed (network): Load failed", last: "2026-11-10T00:00:00Z", occ: 3 }),
  row({ id: "2", message: "GET notification failed (network): Load failed", last: "2026-11-12T00:00:00Z", occ: 2, ctx: { latest: true } }),
  row({ id: "3", message: "POST rpc/log_lead_update_atomic failed (network): Load failed", last: "2026-11-13T00:00:00Z" }),
  row({ id: "4", message: "GET employees failed (22P02): invalid input syntax", severity: "error", last: "2026-11-03T00:00:00Z" }),
  row({ id: "5", source: "db_sibling_guard", message: "Recycle refused: lead 94d3a76b would go", last: "2026-11-13T00:00:00Z" }),
  row({ id: "6", source: "db_sibling_guard", message: "Recycle refused: lead 11111111 would go", last: "2026-11-12T00:00:00Z" }),
  row({ id: "7", source: "network:page:/leads GET lead_notes", severity: "info", message: "GET lead_notes failed (network): Load failed" }),
  row({ id: "8", source: "call_return:2cca86b2", severity: "info", message: "Call returns 2026-11-16: 3" }),
  row({ id: "9", message: "POST rpc/get_lead_siblings failed (network): Failed to fetch", last: "2026-11-11T00:00:00Z" })
];
const g = ag.groupAnomalies(rows);
eq("9 rows -> 7 groups", g.length, 7);
const notif = g.find((x) => x.source === "page:/leads" && x.message.startsWith("GET notification"));
eq("same message -> one group", [notif.rows, notif.occurrences, notif.ids], [2, 5, ["1", "2"]]);
eq("group keeps latest context", notif.context, { latest: true });
eq("guard records with different ids -> one activity group", g.filter((x) => x.source === "db_sibling_guard").map((x) => [x.rows, x.kind]), [[2, "activity"]]);
eq("info and network:/call_return -> activity", g.filter((x) => x.kind === "activity").length, 3);
eq("issue order: error, failed write, then warnings by last seen", g.filter((x) => x.kind === "issue").map((x) => x.ids[0]), ["4", "3", "1", "9"]);
eq("write failure", [ag.isWriteFailureMessage("POST rpc/log_lead_update_atomic failed (network): x"), ag.isWriteFailureMessage("PATCH notification failed (network): x"), ag.isWriteFailureMessage("POST rpc/get_lead_siblings failed (network): x"), ag.isWriteFailureMessage("GET leads failed (x)")], [true, true, false, false]);
eq("stale: not seen 14 days", ag.staleGroups(g, Date.parse("2026-11-27T00:00:00Z")).map((x) => x.ids[0]).sort(), ["1", "4", "7", "8", "9"]);
eq("chunks of 100", ag.chunkIds(Array.from({ length: 250 }, (_, i) => String(i))).map((c) => c.length), [100, 100, 50]);
eq("network messages", [ag.isNetworkErrorMessage("Load failed"), ag.isNetworkErrorMessage("TypeError: Failed to fetch"), ag.isNetworkErrorMessage("invalid input syntax")], [true, true, false]);

// 2) Admin search term
eq("comma", adminSearchTerm("Sharma, R"), "Sharma R");
eq("brackets", adminSearchTerm("(urgent) Raj"), "urgent Raj");
eq("wildcards", adminSearchTerm("50%*"), "50");
eq("only symbols -> empty", adminSearchTerm(", ()"), "");
eq("plain", adminSearchTerm("98765"), "98765");

// 3) reportingFetch network rules, with a fake fetch and fake storage
function fakeStorage() {
  const m = new Map();
  return { get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const rf = require(path.join(root, "lib/reportingFetch.ts"));
eq("write requests", [rf.isWriteRequest("POST", "rpc/log_lead_update_atomic"), rf.isWriteRequest("PATCH", "notification"), rf.isWriteRequest("POST", "rpc/get_lead_siblings"), rf.isWriteRequest("GET", "leads")], [true, true, false, false]);
(async () => {
  const posted = [];
  const baseFetch = async (url, init) => {
    if (String(url).includes("/rest/v1/system_anomaly_log")) {
      posted.push(JSON.parse(init.body));
      return new Response(null, { status: 201 });
    }
    throw new TypeError("Load failed");
  };
  const f = rf.createReportingFetch({ layer: "FRONTEND", source: () => "page:/leads" }, baseFetch);
  const call = async (method, endpoint) => {
    try {
      await f(`https://x.test/rest/v1/${endpoint}`, { method, headers: { apikey: "k" } });
    } catch {
      // the caller still gets the network error
    }
    await new Promise((r) => setTimeout(r, 0));
  };
  global.localStorage = fakeStorage();
  Object.defineProperty(global, "navigator", { value: { onLine: true }, configurable: true, writable: true });

  await call("GET", "lead_notes");
  eq("read fail -> info under network: source", posted.map((p) => [p.severity, p.source]), [["info", "network:page:/leads GET lead_notes"]]);
  await call("GET", "lead_notes");
  eq("same read again today -> no new row", posted.length, 1);
  await call("POST", "rpc/get_lead_siblings");
  eq("read-only RPC -> info", posted[1] && [posted[1].severity, posted[1].source], ["info", "network:page:/leads POST rpc/get_lead_siblings"]);
  await call("POST", "rpc/log_lead_update_atomic");
  eq("write fail -> warning, page source (unchanged)", posted[2] && [posted[2].severity, posted[2].source], ["warning", "page:/leads"]);
  global.navigator.onLine = false;
  await call("PATCH", "notification");
  await call("GET", "attendance");
  eq("offline -> nothing logged", posted.length, 3);
  global.navigator.onLine = true;
  const old = Object.keys(Object.fromEntries([...Array(localStorage.length)].map((_, i) => [localStorage.key(i), 1])));
  eq("one device key per failing read per day", old.filter((k) => k.startsWith("reportingFetch:net:")).length, 2);
  delete global.localStorage;
  eq("no localStorage (server / Edge) -> still reports", rf.firstTodayOnThisDevice("x"), true);

  // 4) Guards
  const header = read("components/Header.tsx");
  if (/\.eq\("auth_user_id", user\?\.id\)/.test(header)) problems.push("Header must not query employees without a logged-in user");
  if ((header.match(/if \(!user(\s*\|\|\s*cancelled)?\) return;/g) || []).length < 5) problems.push("Header: all 5 employees lookups need the no-user return");
  const admin = read("app/admin/leads/page.tsx");
  if (!admin.includes("const term = adminSearchTerm(debouncedSearchQuery);")) problems.push("Admin Leads search must clean the term before or()");
  const page = read("app/admin/system-health/page.tsx");
  if (!page.includes('.eq("reviewed", false)')) problems.push("System Health must load unreviewed rows only");
  if (!/\.eq\("reviewed", true\)[\s\S]{0,200}\.range\(/.test(page)) problems.push("reviewed rows must be paged with range()");
  if (!page.includes("groupAnomalies(rows)")) problems.push("System Health must group rows");
  if (!page.includes("Mark group reviewed")) problems.push("a group must be reviewable in one go");
  if (/^import /m.test(read("lib/reportingFetch.ts"))) problems.push("lib/reportingFetch.ts must stay import-free (Edge Functions load it)");
  const rce = read("lib/reportClientError.ts");
  if (!rce.includes("isNetworkErrorMessage(message)")) problems.push("reportClientError must treat network failures as info");

  if (problems.length) {
    console.error("check-system-health: FAILED");
    for (const p of problems) console.error("  " + p);
    process.exit(1);
  }
  console.log("check-system-health: all known answers and guards pass.");
})();
