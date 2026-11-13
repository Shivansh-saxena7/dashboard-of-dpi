#!/usr/bin/env node
// Call-return (2026-11-13): known answers + guards, run in prebuild. No DB, no network, no browser: storage is faked.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const problems = [];
require.extensions[".ts"] = (m, f) =>
  m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, f);

// Fake browser storage + window, enough for lib/activeCall.ts.
function fakeStorage() {
  const m = new Map();
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear()
  };
}
global.localStorage = fakeStorage();
global.sessionStorage = fakeStorage();
let changeEvents = 0;
global.window = { scrollY: 1234, dispatchEvent: () => { changeEvents += 1; } };
global.Event = class { constructor(type) { this.type = type; } };

const ac = require(path.join(root, "lib/activeCall.ts"));
const { osFamily } = require(path.join(root, "lib/clientIdentity.ts"));
const eq = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const H = 60 * 60 * 1000;
const T0 = Date.now(); // real now: attachActiveCallClickId reads the clock itself
const entry = (o = {}) => ({ v: 1, employeeId: "rashmi", leadId: "lead-56", leadName: "A", listType: "LEAD", list: { tab: "LEADS", statusFilter: "NEW", sortBy: "NEWEST" }, index: 55, scrollY: 9000, clickId: null, at: T0, ...o });

// 1) parseActiveCall
eq("expiry is 6 hours", ac.ACTIVE_CALL_MAX_AGE_MS, 6 * H);
eq("parse ok", ac.parseActiveCall(JSON.stringify(entry()), T0 + H, "rashmi")?.leadId, "lead-56");
eq("parse keeps index and scroll", [ac.parseActiveCall(JSON.stringify(entry()), T0, "rashmi").index, ac.parseActiveCall(JSON.stringify(entry()), T0, "rashmi").scrollY], [55, 9000]);
eq("5h59m still valid", ac.parseActiveCall(JSON.stringify(entry()), T0 + 6 * H - 60000, "rashmi") !== null, true);
eq("6h01m expired", ac.parseActiveCall(JSON.stringify(entry()), T0 + 6 * H + 60000, "rashmi"), null);
eq("other employee", ac.parseActiveCall(JSON.stringify(entry()), T0, "rama"), null);
eq("from the future", ac.parseActiveCall(JSON.stringify(entry({ at: T0 + 5 * 60000 })), T0, "rashmi"), null);
eq("bad list type", ac.parseActiveCall(JSON.stringify(entry({ listType: "X" })), T0, "rashmi"), null);
eq("broken json", ac.parseActiveCall("{oops", T0, "rashmi"), null);
eq("old version", ac.parseActiveCall(JSON.stringify(entry({ v: 0 })), T0, "rashmi"), null);
eq("missing list -> defaults", ac.parseActiveCall(JSON.stringify(entry({ list: null })), T0, "rashmi").list, { tab: "LEADS", statusFilter: "", sortBy: "NEWEST", searchQuery: "", sourceFilter: "", projectFilter: "" });
eq("bad index -> -1", ac.parseActiveCall(JSON.stringify(entry({ index: -3 })), T0, "rashmi").index, -1);

// 2) paths and kinds
eq("lead path", ac.resumePathFor({ listType: "LEAD", leadId: "ab-1" }), "/leads?openLead=ab-1");
eq("data path", ac.resumePathFor({ listType: "DATA", leadId: "cd-2" }), "/data?openLead=cd-2");
eq("call before boot = cold", ac.returnKind({ at: 100 }, 200), "cold");
eq("call after boot = resume", ac.returnKind({ at: 300 }, 200), "resume");

// 3) OS family
eq("android", osFamily("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36"), "Android");
eq("iphone", osFamily("Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148"), "iOS");
eq("ipad as mac + touch", osFamily("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15", 5), "iOS");
eq("mac", osFamily("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0), "Mac");
eq("windows", osFamily("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "Windows");
eq("empty", osFamily(""), "Other");

// 4) Start / attach / read / clear through a registered list
localStorage.clear();
eq("no list on screen -> nothing recorded", ac.startActiveCall("lead-56", T0), null);
const ids = Array.from({ length: 80 }, (_, i) => `lead-${i + 1}`);
const unregister = ac.registerActiveCallContext({
  employeeId: "rashmi",
  listType: "LEAD",
  hasLead: (id) => ids.includes(id),
  leadName: (id) => `Name ${id}`,
  getListState: () => ({ tab: "LEADS", statusFilter: "NEW", sortBy: "OLDEST", searchQuery: "", sourceFilter: "", projectFilter: "" }),
  indexOf: (id) => ids.indexOf(id)
});
eq("lead not on this list -> nothing", ac.startActiveCall("someone-else", T0), null);
const started = ac.startActiveCall("lead-56", T0);
eq("started: index, scroll, state", [started.index, started.scrollY, started.list.statusFilter, started.list.sortBy, started.listType], [55, 1234, "NEW", "OLDEST", "LEAD"]);
eq("stored under activeCall:v1:<employee>", JSON.parse(localStorage.getItem("activeCall:v1:rashmi")).leadId, "lead-56");
eq("not in sessionStorage", sessionStorage.getItem("activeCall:v1:rashmi"), null);
ac.attachActiveCallClickId("lead-56", "click-9");
eq("click id attached", ac.readActiveCall("rashmi", T0 + 1000).clickId, "click-9");
ac.attachActiveCallClickId("lead-57", "click-x");
eq("click id for another lead ignored", ac.readActiveCall("rashmi", T0 + 1000).clickId, "click-9");
eq("expired entry is removed on read", [ac.readActiveCall("rashmi", T0 + 7 * H), localStorage.getItem("activeCall:v1:rashmi")], [null, null]);
ac.startActiveCall("lead-56", T0);
ac.clearActiveCall(null, "lead-12");
eq("clear for another lead keeps it", ac.readActiveCall("rashmi", T0)?.leadId, "lead-56");
const before = changeEvents;
ac.clearActiveCall(null, "lead-56");
eq("result saved -> cleared (any employee key)", ac.readActiveCall("rashmi", T0), null);
eq("clear tells the page", changeEvents > before, true);
ac.startActiveCall("lead-56", T0);
ac.clearActiveCall("rashmi");
eq("skip -> cleared", ac.readActiveCall("rashmi", T0), null);
unregister();
eq("after unregister nothing recorded", ac.startActiveCall("lead-56", T0), null);

// 5) Cold start resume: once per app session
localStorage.clear();
sessionStorage.clear();
localStorage.setItem("activeCall:v1:rashmi", JSON.stringify(entry({ listType: "DATA", leadId: "data-7" })));
eq("first page of a new session resumes", ac.takeColdStartResume("rashmi", T0 + H), "/data?openLead=data-7");
eq("second time in the same session does not", ac.takeColdStartResume("rashmi", T0 + H), null);
sessionStorage.clear();
eq("app killed and started again -> resumes again", ac.takeColdStartResume("rashmi", T0 + H), "/data?openLead=data-7");
sessionStorage.clear();
eq("no entry -> no redirect", ac.takeColdStartResume("rama", T0 + H), null);
sessionStorage.clear();
eq("expired -> no redirect", ac.takeColdStartResume("rashmi", T0 + 7 * H), null);
eq("no employee -> no redirect", ac.takeColdStartResume(null, T0), null);
sessionStorage.clear();
ac.markColdStartHandled(T0);
eq("list already shown this session -> Home does not redirect", ac.takeColdStartResume("rashmi", T0 + H), null);

// 6) Keep the called lead in the list
const all = [{ id: "a", tab: "LEADS" }, { id: "b", tab: "LEADS" }, { id: "c", tab: "FOLLOW_UP" }];
const sameTab = (l) => l.tab === "LEADS";
eq("dropped by filter -> kept", ac.keepActiveLeadInList([all[0]], all, "b", sameTab).map((l) => l.id), ["a", "b"]);
eq("already there -> same", ac.keepActiveLeadInList([all[0], all[1]], all, "b", sameTab).map((l) => l.id), ["a", "b"]);
eq("other tab -> not added", ac.keepActiveLeadInList([all[0]], all, "c", sameTab).map((l) => l.id), ["a"]);
eq("not owned any more -> not added", ac.keepActiveLeadInList([all[0]], all, "zz", sameTab).map((l) => l.id), ["a"]);
eq("no active call -> same", ac.keepActiveLeadInList([all[0]], all, null, sameTab).map((l) => l.id), ["a"]);

// 7) Return records: day totals, sent at most every 2 hours
eq("flush gap 2h", ac.CALL_RETURN_FLUSH_MS, 2 * H);
eq("IST day", ac.istDay(Date.parse("2026-11-16T19:00:00Z")), "2026-11-17");
let s = ac.addCallReturn(null, "2026-11-16", { restored: true, kind: "cold", awayMs: 120000 });
s = ac.addCallReturn(s, "2026-11-16", { restored: false, kind: "resume", awayMs: 60000 });
eq("totals", [s.total, s.restored, s.notRestored, s.cold, s.resume, s.awayMsTotal, s.awayMsMax], [2, 1, 1, 1, 1, 180000, 120000]);
eq("new day starts over", ac.addCallReturn(s, "2026-11-17", { restored: true, kind: "resume", awayMs: 1 }).total, 1);
eq("first return flushes", ac.shouldFlushCallReturns({ ...s, lastFlushAt: 0 }, T0), true);
eq("1h later no flush", ac.shouldFlushCallReturns({ ...s, lastFlushAt: T0 }, T0 + H), false);
eq("2h later flush", ac.shouldFlushCallReturns({ ...s, lastFlushAt: T0 }, T0 + 2 * H), true);
localStorage.clear();
const r1 = ac.recordCallReturn("rashmi", { restored: true, kind: "cold", awayMs: 1000 }, T0);
const r2 = ac.recordCallReturn("rashmi", { restored: true, kind: "cold", awayMs: 1000 }, T0 + 10 * 60000);
const r3 = ac.recordCallReturn("rashmi", { restored: false, kind: "resume", awayMs: 1000 }, T0 + 2 * H + 60000);
eq("record: send, hold, send", [r1 && r1.total, r2, r3 && r3.total], [1, null, 3]);
// 30 calls in one hour -> at most 1 row, so the "5 in an hour" Admin alert never fires.
localStorage.clear();
let sent = 0;
for (let i = 0; i < 30; i++) if (ac.recordCallReturn("rama", { restored: true, kind: "resume", awayMs: 1 }, T0 + i * 2 * 60000)) sent += 1;
eq("30 returns in an hour -> 1 row", sent, 1);

// 8) Guards on the pages
const lib = read("lib/activeCall.ts");
if (/sessionStorage\.setItem\(activeCallKey/.test(lib)) problems.push("the active call must live in localStorage, not sessionStorage");
const logCall = read("lib/logCallClick.ts");
if (logCall.indexOf("startActiveCall(leadId)") < 0 || logCall.indexOf("startActiveCall(leadId)") > logCall.indexOf(".rpc(")) problems.push("logCallClick must record the active call before the RPC (the dialer may open at once)");
if (!read("lib/logLeadUpdate.ts").includes("if (!result.error && params.p_new_status) clearActiveCall(null, params.p_lead_id);")) problems.push("a saved result must clear the active call");
for (const f of ["components/LeadList.tsx", "components/DataList.tsx"]) {
  const src = read(f);
  if (!src.includes("useActiveCallRestore({")) problems.push(`${f} must use useActiveCallRestore`);
  if (!src.includes("keepActiveLeadInList(")) problems.push(`${f} must keep the called lead in the list`);
  if (!src.includes("if (!loadedOnceRef.current) setLoading(true);")) problems.push(`${f}: "Loading..." only on the first load`);
  if (/async function loadLeads\(\) \{\s*setLoading\(true\);/.test(src)) problems.push(`${f}: a background reload must not show "Loading..."`);
  if (!src.includes("<ResumeCallStrip ")) problems.push(`${f} must show the Resume your call strip`);
}
for (const f of ["app/login/page.tsx", "app/page.tsx"]) if (!read(f).includes("takeColdStartResume(")) problems.push(`${f} must send a restarted app back to the call`);
if (!read("app/page.tsx").includes("<ResumeCallStrip ")) problems.push("Home must show the Resume your call strip");
if (/^import /m.test(read("lib/reportingFetch.ts"))) problems.push("lib/reportingFetch.ts must stay import-free (Edge Functions load it)");
if (!read("lib/supabase.ts").includes("clientIdentityContext()")) problems.push("browser Supabase failures must carry employee id + OS family");
if (!read("lib/reportClientError.ts").includes("...clientIdentityContext()")) problems.push("client errors must carry employee id + OS family");
for (const f of ["components/LeadCard.tsx", "components/DataCard.tsx"]) if (/activeCall|ResumeCallStrip/.test(read(f))) problems.push(`${f} must not need any call-return change`);

if (problems.length) {
  console.error("check-active-call: FAILED");
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}
console.log("check-active-call: all known answers and guards pass.");
