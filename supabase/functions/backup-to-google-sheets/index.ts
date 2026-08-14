// @ts-nocheck

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.0";

// Free-tier disaster-recovery backup — Supabase's free plan has no
// automatic daily backups, so this mirrors every lead into a Google
// Sheet once a day (pg_cron, matching mark-missed-posts-daily/
// recycle-stale-leads-15min's exact pattern: no CORS, no caller-
// identity resolution, a system job never invoked from the browser).
//
// One tab per active employee (name = tab title), one synthetic
// "Unassigned - Reserved" tab for leads with no current_owner_id yet
// (reserved-to-a-team but not yet distributed) — every lead lands
// somewhere, none silently dropped from the backup.
//
// Design is a full snapshot (clear + rewrite each tab), not an
// incremental diff — deliberately: a daily disaster-recovery backup
// doesn't need real-time freshness, and a full rewrite is self-
// healing (a failed run just gets fully corrected by tomorrow's,
// no partial-state/drift bookkeeping to get wrong). Every sync does
// AT MOST 4 Google API calls total regardless of employee count
// (get tabs, add any missing tabs, batchClear, batchUpdate) — nowhere
// near the 300/min-per-project, 60/min-per-user quota even at 50x
// today's headcount.
//
// Auth: Google's service-account JWT-bearer flow, signed with Deno's
// native Web Crypto API (RS256) — no google-auth-library or other
// heavy SDK, matching this codebase's existing raw-fetch Edge
// Function style. Credentials come from Deno.env (supabase secrets
// set GOOGLE_SERVICE_ACCOUNT_KEY / GOOGLE_SHEET_ID), never committed
// to the repo.

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const HEADER_ROW = [
  "Type", "Name", "Mobile", "Project", "Source", "Status", "Board Stage",
  "Last Contact Date", "Follow-up Notes", "Visit Status", "Booking Status"
];

function base64url(input: string | ArrayBuffer): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getGoogleAccessToken(serviceAccountKey: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: serviceAccountKey.client_email,
    scope: SHEETS_SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  };

  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;

  const pemContents = serviceAccountKey.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsigned)
  );

  const jwt = `${unsigned}.${base64url(signature)}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    })
  });

  const tokenJson = await tokenRes.json();
  if (!tokenRes.ok) {
    throw new Error(`Google token exchange failed: ${JSON.stringify(tokenJson)}`);
  }
  return tokenJson.access_token;
}

// Sheets tab names can't contain / \ ? * [ ] : and max out at 100
// chars. Collisions (two employees with the same display name) get a
// short suffix from their employee id so no tab is ever silently
// overwritten by another employee's data.
function buildTabNames(employees: { id: string; name: string }[]): Map<string, string> {
  const used = new Set<string>();
  const result = new Map<string, string>();
  for (const e of employees) {
    let base = (e.name || "Unnamed").replace(/[\/\\?*\[\]:]/g, "").trim().slice(0, 90) || "Unnamed";
    let candidate = base;
    if (used.has(candidate)) {
      candidate = `${base} (${e.id.slice(0, 4)})`;
    }
    used.add(candidate);
    result.set(e.id, candidate);
  }
  return result;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-IN", {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
  });
}

serve(async () => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const serviceAccountKey = JSON.parse(Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY")!);
    const sheetId = Deno.env.get("GOOGLE_SHEET_ID")!;

    const [
      { data: employees, error: employeesError },
      { data: leads, error: leadsError },
      { data: historyRows, error: historyError },
      { data: notes, error: notesError },
      { data: visits, error: visitsError }
    ] = await Promise.all([
      supabase.from("employees").select("id, name").eq("is_active", true),
      supabase.from("leads").select("id, name, mobile, project, source, status, board_stage, current_owner_id, lead_type"),
      supabase.from("lead_history").select("lead_id, employee_id, last_activity_at").eq("is_active", true),
      supabase.from("lead_notes").select("lead_id, note, created_at").order("created_at", { ascending: false }),
      supabase.from("site_visits").select("lead_id, verified_at, denied_at")
    ]);

    if (employeesError || leadsError || historyError || notesError || visitsError) {
      throw new Error(
        `Data fetch failed: ${JSON.stringify({ employeesError, leadsError, historyError, notesError, visitsError })}`
      );
    }

    const lastContactByLead = new Map<string, string>();
    for (const h of historyRows || []) {
      if (h.last_activity_at) lastContactByLead.set(h.lead_id, h.last_activity_at);
    }

    const latestNoteByLead = new Map<string, string>();
    for (const n of notes || []) {
      if (!latestNoteByLead.has(n.lead_id)) latestNoteByLead.set(n.lead_id, n.note);
    }

    const visitStatusByLead = new Map<string, string>();
    for (const v of visits || []) {
      const existing = visitStatusByLead.get(v.lead_id);
      let status = "Visited (Pending Verification)";
      if (v.denied_at) status = "Visit Denied";
      else if (v.verified_at) status = "Visit Verified";
      // A later-verified/denied row should win over an earlier pending one.
      if (!existing || status !== "Visited (Pending Verification)") {
        visitStatusByLead.set(v.lead_id, status);
      }
    }

    const tabNameByEmployeeId = buildTabNames(employees || []);
    const UNASSIGNED_TAB = "Unassigned - Reserved";

    const rowsByTab = new Map<string, string[][]>();
    for (const tabName of tabNameByEmployeeId.values()) rowsByTab.set(tabName, []);
    rowsByTab.set(UNASSIGNED_TAB, []);

    for (const lead of leads || []) {
      const tabName = lead.current_owner_id
        ? tabNameByEmployeeId.get(lead.current_owner_id)
        : UNASSIGNED_TAB;
      // An owner_id pointing at a since-deactivated employee has no
      // tab in this run's map — falls back to the Unassigned tab
      // rather than being silently dropped from the backup.
      const targetTab = tabName || UNASSIGNED_TAB;

      rowsByTab.get(targetTab)!.push([
        // lead_type is nullable — legacy rows predating this column
        // are LEAD by convention (matches how the rest of the app
        // already treats null lead_type, e.g. the DATA-vs-LEAD
        // dashboard split), so only an explicit 'DATA' flips this.
        lead.lead_type === "DATA" ? "Data" : "Lead",
        lead.name || "",
        lead.mobile || "",
        lead.project || "",
        lead.source || "",
        lead.status || "",
        lead.board_stage || "",
        formatDate(lastContactByLead.get(lead.id) || null),
        latestNoteByLead.get(lead.id) || "",
        visitStatusByLead.get(lead.id) || "No Visit",
        lead.board_stage === "BOOKING" ? "Booked" : "Not Booked"
      ]);
    }

    const accessToken = await getGoogleAccessToken(serviceAccountKey);
    const allTabNames = Array.from(rowsByTab.keys());

    // 1) Which tabs already exist?
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.title`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const metaJson = await metaRes.json();
    if (!metaRes.ok) throw new Error(`Sheet metadata fetch failed: ${JSON.stringify(metaJson)}`);
    const existingTabTitles = new Set((metaJson.sheets || []).map((s: any) => s.properties.title));

    // 2) Create any missing tabs (new employees since the last run).
    const missingTabs = allTabNames.filter((t) => !existingTabTitles.has(t));
    if (missingTabs.length > 0) {
      const addRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ requests: missingTabs.map((title) => ({ addSheet: { properties: { title } } })) })
      });
      const addJson = await addRes.json();
      if (!addRes.ok) throw new Error(`Adding tabs failed: ${JSON.stringify(addJson)}`);
    }

    const rangeFor = (tab: string) => `'${tab.replace(/'/g, "''")}'!A1:Z1000`;

    // 3) Clear every tab's data range before rewriting (so a shrunk
    // list — e.g. leads recycled away from someone — doesn't leave
    // stale rows behind).
    const clearRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchClear`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ranges: allTabNames.map(rangeFor) })
    });
    const clearJson = await clearRes.json();
    if (!clearRes.ok) throw new Error(`Clearing tabs failed: ${JSON.stringify(clearJson)}`);

    // 4) Write the fresh snapshot — one API call for every tab.
    const writeRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        valueInputOption: "RAW",
        data: allTabNames.map((tab) => ({
          range: `'${tab.replace(/'/g, "''")}'!A1`,
          values: [HEADER_ROW, ...(rowsByTab.get(tab) || [])]
        }))
      })
    });
    const writeJson = await writeRes.json();
    if (!writeRes.ok) throw new Error(`Writing snapshot failed: ${JSON.stringify(writeJson)}`);

    return new Response(
      JSON.stringify({
        success: true,
        tabsWritten: allTabNames.length,
        tabsCreated: missingTabs.length,
        totalLeadsBackedUp: (leads || []).length
      }),
      { headers: { "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error: any) {
    console.error("backup-to-google-sheets failed:", error.message);
    return new Response(JSON.stringify({ success: false, message: error.message }), {
      headers: { "Content-Type": "application/json" },
      status: 500
    });
  }
});
