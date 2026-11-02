#!/usr/bin/env node
// Expired-login guard (2026-11-02) known-answer + guard check, run in prebuild. No DB access.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const load = (p) => {
  const { outputText } = ts.transpileModule(read(p), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const mod = { exports: {} };
  new Function("module", "exports", outputText)(mod, mod.exports);
  return mod.exports;
};
const { needsLogin, createSessionGuardFetch, safeNextPath, SESSION_EXPIRED_CODE, SESSION_EXPIRED_MESSAGE } = load("lib/sessionGuard.ts");
const draftLib = load("lib/leadUpdateDraft.ts");

const problems = [];
const check = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const ANON = "anon-key";
const RPC = "https://x.supabase.co/rest/v1/rpc/log_lead_update_atomic";
const n = (u, m, a, p = "/leads") => needsLogin(u, m, a, ANON, p);
check("rpc with the anon key", n(RPC, "POST", `Bearer ${ANON}`), true);
check("rpc with no token", n(RPC, "POST", null), true);
check("rpc with a user token", n(RPC, "POST", "Bearer user-token"), false);
check("update with the anon key", n("https://x.supabase.co/rest/v1/leads?id=eq.1", "PATCH", `Bearer ${ANON}`), true);
check("edge function with the anon key", n("https://x.supabase.co/functions/v1/start-shift", "POST", `Bearer ${ANON}`), true);
check("upload with the anon key", n("https://x.supabase.co/storage/v1/object/a/b", "POST", `Bearer ${ANON}`), true);
check("read with the anon key is left alone", n("https://x.supabase.co/rest/v1/leads", "GET", `Bearer ${ANON}`), false);
check("login call itself", n("https://x.supabase.co/auth/v1/token", "POST", `Bearer ${ANON}`), false);
check("anomaly log is left alone", n("https://x.supabase.co/rest/v1/system_anomaly_log", "POST", `Bearer ${ANON}`), false);
check("login page is left alone", n(RPC, "POST", `Bearer ${ANON}`, "/login"), false);
check("next: inside the app", safeNextPath("/leads?openLead=1"), "/leads?openLead=1");
check("next: other site", safeNextPath("https://evil.example"), null);
check("next: protocol-relative", safeNextPath("//evil.example"), null);
check("next: back to login", safeNextPath("/login"), null);
check("next: empty", safeNextPath(null), null);

const store = new Map();
global.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
const draft = { status: "CONNECTED", note: "call back", reminderValue: "2", reminderUnit: "days", contactMethod: "CRM_CALL" };
draftLib.saveLeadUpdateDraft("L1", draft, "/leads?openLead=L1", 1000);
check("draft comes back", draftLib.loadLeadUpdateDraft("L1", 2000), draft);
check("draft older than a day is dropped", draftLib.loadLeadUpdateDraft("L1", 1000 + 25 * 3600 * 1000), null);
check("return path once", [draftLib.consumeDraftReturnPath(), draftLib.consumeDraftReturnPath()], ["/leads?openLead=L1", null]);
check("return path only on the two lead pages", [draftLib.draftReturnPath("/leads", "L1"), draftLib.draftReturnPath("/data", "L1"), draftLib.draftReturnPath("/team", "L1")], ["/leads?openLead=L1", "/data?openLead=L1", null]);

(async () => {
  const run = async (token, method = "POST", auth = `Bearer ${ANON}`) => {
    const calls = [];
    let expired = 0;
    const f = createSessionGuardFetch(
      async (input, init) => {
        calls.push(new Headers(init && init.headers).get("Authorization"));
        return new Response("{}", { status: 200 });
      },
      { anonKey: ANON, getAccessToken: async () => { if (token === "throw") throw new Error("offline"); return token; }, getPathname: () => "/leads", onExpired: () => { expired++; } }
    );
    const res = await f(RPC, { method, headers: { Authorization: auth } });
    return { calls, expired, status: res.status, body: await res.json() };
  };
  const stopped = { calls: [], expired: 1, status: 401, body: { code: SESSION_EXPIRED_CODE, message: SESSION_EXPIRED_MESSAGE, details: null, hint: null } };
  check("expired: nothing sent, clear error, gate told", await run(null), stopped);
  check("session check throws: same", await run("throw"), stopped);
  check("session comes back: sent with the real token", await run("fresh"), { calls: ["Bearer fresh"], expired: 0, status: 200, body: {} });
  check("valid token: sent as it was", await run("x", "POST", "Bearer user-token"), { calls: ["Bearer user-token"], expired: 0, status: 200, body: {} });
  check("read: sent as it was", await run(null, "GET"), { calls: [`Bearer ${ANON}`], expired: 0, status: 200, body: {} });

  const sb = read("lib/supabase.ts");
  if (!sb.includes("createSessionGuardFetch(")) problems.push("lib/supabase.ts does not use the session guard");
  if (!read("app/layout.tsx").includes("<SessionExpiredGate />")) problems.push("app/layout.tsx does not render SessionExpiredGate");
  for (const m of ["components/LeadDetailModal.tsx", "components/DataDetailModal.tsx"]) {
    const src = read(m);
    if (!src.includes("error.code === SESSION_EXPIRED_CODE") || !src.includes("loadLeadUpdateDraft(lead.id)")) problems.push(`${m} does not keep the typed update`);
  }

  if (problems.length) {
    console.error("check-session-guard: FAILED\n  " + problems.join("\n  "));
    process.exit(1);
  }
  console.log("check-session-guard: all known answers and guards pass.");
})();
