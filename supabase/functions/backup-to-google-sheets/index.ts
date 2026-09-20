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
// somewhere, none silently dropped from the backup. Plus three GLOBAL
// tabs (2026-09-20, part B) — "Lead History", "Lead Notes", "Site
// Visits" — covering the FULL audit trail (every lead_history/
// lead_notes/site_visits row ever, not just each lead's current
// derived summary column). Deliberately NOT per-employee: a
// reassignment away from someone, or a note from a past owner, doesn't
// cleanly belong to any one person's tab the way a current-state
// snapshot does.
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
//
// Coverage, confirmed precisely 2026-09-20 (verified against code and
// live data, not assumed):
// - The `leads` query below has NO lead_type filter anywhere — both
//   'LEAD' and 'DATA' rows (and legacy NULL, treated as 'LEAD') are
//   already included and already carry an explicit Type column in the
//   Sheet.
// - This design is genuinely future-proof for the `leads` table
//   itself: the query is unconditional on entry-method/source, so ANY
//   future feature that inserts a row into `leads` (e.g. a planned
//   Manual WhatsApp Lead Entry) is automatically picked up on the next
//   run with zero code changes here, purely because the query has no
//   opinion on how a row got there.
// - Confirmed gap, fixed by part B (2026-09-20): site_visits genuinely
//   allows multiple rows per lead — no unique constraint on lead_id,
//   and event_type's own CHECK constraint includes 'REVISIT' alongside
//   'VISIT'/'BOOKED' (3 real leads already had 2 rows each in
//   production at the time this was found). visitStatusByLead below
//   still collapses every row for a lead into one derived status
//   string for the per-employee snapshot tabs (a fine quick-glance
//   summary), but the new "Site Visits" global tab now carries every
//   individual row's own event/timestamp/who-logged-it detail, so a
//   revisit is no longer lost from the backup.

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const HEADER_ROW = [
  "Type", "Name", "Mobile", "Project", "Source", "Status", "Board Stage",
  "Last Contact Date", "Follow-up Notes", "Visit Status", "Booking Status"
];

// Part B (2026-09-20) global audit tabs — see their own build comments
// further down for what each row represents.
const HISTORY_HEADER_ROW = [
  "Lead Name", "Mobile", "Employee", "Assigned By Type", "Assigned By", "Is Active",
  "Call Count", "First Call At", "First WhatsApp At", "Outcome", "Outcome At",
  "Ended Reason", "Reassign Note", "Recycle Reason", "Paused Until", "Pause Reason", "Pause Note"
];
const NOTES_HEADER_ROW = ["Lead Name", "Mobile", "Employee", "Note", "Created At"];
const VISITS_HEADER_ROW = [
  "Lead Name", "Mobile", "Employee", "Event Type", "Created At",
  "Verified At", "Verified By", "Denied At", "Denied By", "Deny Reason"
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Root-caused 2026-08-18: the 2 AM IST run failed with a genuine Google
// Sheets API 503 ("The service is currently unavailable") on the very
// first Sheets call — our own OAuth exchange had already succeeded, so
// this was Google's side, not ours. The function correctly caught it
// and returned HTTP 500, but nothing ever surfaced that failure to a
// human — a disaster-recovery backup that fails silently defeats its
// own purpose. Fix is two-part: (1) retry transient failures here so a
// single Google-side blip doesn't cost us the whole night's backup,
// (2) notify Admins on any run that still fails after retrying (below).
//
// Only retries 429 (rate limit) and 5xx (server-side) — a 4xx like 401/
// 403 means a real auth/permission problem that retrying won't fix, so
// those fail fast instead of wasting the function's time budget.
async function fetchWithRetry(url: string, init: RequestInit, maxAttempts = 3): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok || (res.status < 500 && res.status !== 429)) return res;
      lastError = new Error(`HTTP ${res.status}: ${await res.text()}`);
    } catch (err) {
      lastError = err;
    }
    if (attempt < maxAttempts) await sleep(1000 * attempt); // 1s, 2s backoff
  }
  throw lastError;
}

// Root-caused 2026-08-27: the nightly run failed when all 5 of the
// initial Supabase reads below hit PGRST303 ("JWT issued at future")
// simultaneously -- a transient clock-skew mismatch between Supabase's
// Auth layer and the PostgREST instance serving this request (a known
// class of Supabase-infra issue -- this function's service_role key is
// static, read from a secret, never a JWT we mint or timestamp
// ourselves, so this isn't something our own code causes). fetchWithRetry
// above already covered this function's Google Sheets/OAuth half, but
// never this Supabase-read half -- that gap is exactly what let this
// run fail outright instead of quietly succeeding on a retry.
//
// Unconditional retry-on-any-error (no status-code distinction like
// fetchWithRetry's 4xx/5xx split above) is deliberately safe here: all
// 5 calls this wraps are plain reads with no side effects, so retrying
// blindly can never double-apply anything, unlike the Sheets writes
// further down which do need that distinction.
async function withRetry(fn: () => any, maxAttempts = 3) {
  let last: { data: any; error: any } = { data: null, error: null };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    last = await fn();
    if (!last.error) return last;
    if (attempt < maxAttempts) await sleep(1000 * attempt); // 1s, 2s backoff
  }
  return last;
}

// Root-caused 2026-09-20 — the exact same bug class just fixed in
// app/admin/leads/page.tsx: PostgREST enforces a default ~1000-row cap
// per request regardless of any .limit()/.range() call being present,
// applying equally to the service-role key this function uses. None of
// leads/lead_history/lead_notes below had a .range() call, so each was
// silently capped at 1000 rows out of 2,000+ actual rows — this
// disaster-recovery backup was backing up barely half the real data
// every single night while still reporting `status: "SUCCESS"`, since
// the existing discrepancy-detection (further down) only compares
// "rows intended to write" against "rows Google confirmed writing" —
// it has no visibility into the SOURCE read already being truncated
// before that comparison ever happens.
//
// queryBuilder must be a FRESH, unexecuted query on every call (a
// supabase-js query object is single-use), since a new .range() needs
// to be chained onto it for every page — same reason
// fetchAllMatching in app/admin/leads/page.tsx takes a builder
// function, not a built query. Each page goes through the existing
// withRetry above, so a transient failure on page 3 of 3 doesn't
// waste the two pages already fetched.
async function fetchAllRows(queryBuilder: () => any, pageSize = 1000): Promise<{ data: any[]; error: any }> {
  let all: any[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await withRetry(() => queryBuilder().range(from, from + pageSize - 1));
    if (error) return { data: all, error };
    if (!data || data.length === 0) break;

    all = all.concat(data);

    if (data.length < pageSize) break;
    from += pageSize;
  }

  return { data: all, error: null };
}

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

  const tokenRes = await fetchWithRetry("https://oauth2.googleapis.com/token", {
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
      { data: allEmployees, error: allEmployeesError },
      { data: leads, error: leadsError },
      { data: historyRows, error: historyError },
      { data: notes, error: notesError },
      { data: visits, error: visitsError }
    ] = await Promise.all([
      // .order("id") (2026-08-22): buildTabNames' name-collision
      // suffix depends on iteration order, and Postgres doesn't
      // guarantee row order without an explicit ORDER BY -- an
      // unordered fetch means which of two same-named employees gets
      // the plain tab name could flip between runs. Not implicated in
      // the 2026-08-22 incident itself (no name collision involved),
      // but a real latent risk found while root-causing that one.
      // withRetry (2026-08-27): all 5 of these wrapped after the
      // PGRST303 clock-skew incident -- see withRetry's own comment.
      //
      // leads/lead_history/lead_notes/site_visits (2026-09-20):
      // switched to fetchAllRows -- see its own comment for why. Each
      // now also carries an explicit .order("id") tiebreaker it didn't
      // have before, required for .range()-based pagination to be
      // stable (without one, Postgres doesn't guarantee the same row
      // order across the separate page-by-page requests, which could
      // skip or duplicate a row between pages). lead_notes keeps its
      // existing created_at-desc primary order (latestNoteByLead below
      // depends on it) with id appended only as a same-timestamp
      // tiebreaker. site_visits is nowhere near 1000 rows today (17),
      // but now backs a real audit tab (part B) rather than just a
      // derived per-lead status, so it gets the same safety margin as
      // the others rather than staying a one-off exception.
      //
      // lead_history (2026-09-20, part B): widened from "active rows
      // only, 3 columns" to every row ever, full column set -- the
      // active-only subset (still needed for lastContactByLead) is now
      // derived client-side from this same fetch instead of being a
      // second, separate query.
      //
      // employees (unchanged) stays active-only -- it drives which
      // tabs get CREATED, and only active employees should get one.
      // allEmployees (2026-09-20, part B) is a second, unfiltered read
      // used purely to resolve names for the new audit tabs, where a
      // past owner/assigner/note-author might since have been
      // deactivated -- using the active-only list there would silently
      // blank out their name instead of losing nothing.
      withRetry(() => supabase.from("employees").select("id, name").eq("is_active", true).order("id")),
      withRetry(() => supabase.from("employees").select("id, name").order("id")),
      fetchAllRows(() =>
        supabase
          .from("leads")
          .select("id, name, mobile, project, source, status, board_stage, current_owner_id, lead_type")
          .order("id")
      ),
      fetchAllRows(() =>
        supabase
          .from("lead_history")
          .select(
            "id, lead_id, employee_id, assigned_at, is_active, outcome, outcome_at, ended_reason, reassign_note, recycle_reason, call_count, first_call_at, first_whatsapp_at, assigned_by_type, assigned_by_employee_id, last_activity_at, paused_until, pause_reason, pause_note"
          )
          .order("id")
      ),
      fetchAllRows(() =>
        supabase.from("lead_notes").select("lead_id, employee_id, note, created_at").order("created_at", { ascending: false }).order("id")
      ),
      fetchAllRows(() =>
        supabase
          .from("site_visits")
          .select("lead_id, employee_id, event_type, created_at, verified_at, verified_by, denied_at, denied_by, deny_reason")
          .order("id")
      )
    ]);

    if (employeesError || allEmployeesError || leadsError || historyError || notesError || visitsError) {
      throw new Error(
        `Data fetch failed: ${JSON.stringify({ employeesError, allEmployeesError, leadsError, historyError, notesError, visitsError })}`
      );
    }

    // historyRows is now every row ever (see the fetch comment above),
    // so the active-only subset this map needs is filtered client-side
    // rather than being a second query.
    const lastContactByLead = new Map<string, string>();
    for (const h of historyRows || []) {
      if (h.is_active && h.last_activity_at) lastContactByLead.set(h.lead_id, h.last_activity_at);
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

    // Part B (2026-09-20) — lookups shared by the three new global
    // audit tabs below. employeeNameById deliberately comes from
    // allEmployees (active + inactive), not employees (active only,
    // used for tab creation) -- a past owner/assigner/note-author on
    // an audit row might since have left, and this is a disaster-
    // recovery backup, not a live UI; losing their name entirely would
    // defeat the point.
    const leadInfoById = new Map<string, { name: string; mobile: string }>();
    for (const l of leads || []) {
      leadInfoById.set(l.id, { name: l.name || "", mobile: l.mobile || "" });
    }
    const employeeNameById = new Map<string, string>();
    for (const e of allEmployees || []) {
      employeeNameById.set(e.id, e.name || "");
    }

    const HISTORY_TAB = "Lead History";
    const NOTES_TAB = "Lead Notes";
    const VISITS_TAB = "Site Visits";

    const historyTabRows: string[][] = (historyRows || []).map((h: any) => {
      const lead = leadInfoById.get(h.lead_id);
      return [
        lead?.name || "",
        lead?.mobile || "",
        employeeNameById.get(h.employee_id) || "",
        h.assigned_by_type || "",
        h.assigned_by_employee_id ? employeeNameById.get(h.assigned_by_employee_id) || "" : "",
        h.is_active ? "Yes" : "No",
        String(h.call_count ?? 0),
        formatDate(h.first_call_at),
        formatDate(h.first_whatsapp_at),
        h.outcome || "",
        formatDate(h.outcome_at),
        h.ended_reason || "",
        h.reassign_note || "",
        h.recycle_reason || "",
        formatDate(h.paused_until),
        h.pause_reason || "",
        h.pause_note || ""
      ];
    });

    const notesTabRows: string[][] = (notes || []).map((n: any) => {
      const lead = leadInfoById.get(n.lead_id);
      return [lead?.name || "", lead?.mobile || "", employeeNameById.get(n.employee_id) || "", n.note || "", formatDate(n.created_at)];
    });

    // Every VISIT/REVISIT/BOOKED row on its own line -- this is
    // exactly what fixes the revisit gap: visitStatusByLead above
    // still collapses these into one status for the per-employee
    // snapshot tabs, but nothing here does.
    const visitsTabRows: string[][] = (visits || []).map((v: any) => {
      const lead = leadInfoById.get(v.lead_id);
      return [
        lead?.name || "",
        lead?.mobile || "",
        employeeNameById.get(v.employee_id) || "",
        v.event_type || "",
        formatDate(v.created_at),
        formatDate(v.verified_at),
        v.verified_by ? employeeNameById.get(v.verified_by) || "" : "",
        formatDate(v.denied_at),
        v.denied_by ? employeeNameById.get(v.denied_by) || "" : "",
        v.deny_reason || ""
      ];
    });

    const tabNameByEmployeeId = buildTabNames(employees || []);
    const UNASSIGNED_TAB = "Unassigned - Reserved";

    const rowsByTab = new Map<string, string[][]>();
    for (const tabName of tabNameByEmployeeId.values()) rowsByTab.set(tabName, []);
    rowsByTab.set(UNASSIGNED_TAB, []);
    rowsByTab.set(HISTORY_TAB, historyTabRows);
    rowsByTab.set(NOTES_TAB, notesTabRows);
    rowsByTab.set(VISITS_TAB, visitsTabRows);

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
    const metaRes = await fetchWithRetry(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.title`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const metaJson = await metaRes.json();
    if (!metaRes.ok) throw new Error(`Sheet metadata fetch failed: ${JSON.stringify(metaJson)}`);
    const existingTabTitles = new Set((metaJson.sheets || []).map((s: any) => s.properties.title));

    // 2) Create any missing tabs (new employees since the last run).
    const missingTabs = allTabNames.filter((t) => !existingTabTitles.has(t));
    if (missingTabs.length > 0) {
      const addRes = await fetchWithRetry(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ requests: missingTabs.map((title) => ({ addSheet: { properties: { title } } })) })
      });
      const addJson = await addRes.json();
      if (!addRes.ok) throw new Error(`Adding tabs failed: ${JSON.stringify(addJson)}`);
    }

    // Z100000 (was Z1000, 2026-09-20 part B): the new global audit
    // tabs can genuinely exceed 1000 rows on their own (lead_history is
    // already at 2,502 today) -- a clear range that stopped at row
    // 1000 would leave stale rows from a previous run sitting below
    // it. 100,000 is a wide safety margin against near-term growth;
    // clearing empty cells beyond existing data costs nothing extra.
    const rangeFor = (tab: string) => `'${tab.replace(/'/g, "''")}'!A1:Z100000`;

    const headerRowFor = (tab: string): string[] => {
      if (tab === HISTORY_TAB) return HISTORY_HEADER_ROW;
      if (tab === NOTES_TAB) return NOTES_HEADER_ROW;
      if (tab === VISITS_TAB) return VISITS_HEADER_ROW;
      return HEADER_ROW;
    };

    // 3) Clear every tab's data range before rewriting (so a shrunk
    // list — e.g. leads recycled away from someone — doesn't leave
    // stale rows behind).
    const clearRes = await fetchWithRetry(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchClear`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ranges: allTabNames.map(rangeFor) })
    });
    const clearJson = await clearRes.json();
    if (!clearRes.ok) throw new Error(`Clearing tabs failed: ${JSON.stringify(clearJson)}`);

    // 4) Write the fresh snapshot — one API call for every tab.
    const writeRes = await fetchWithRetry(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        valueInputOption: "RAW",
        data: allTabNames.map((tab) => ({
          range: `'${tab.replace(/'/g, "''")}'!A1`,
          values: [headerRowFor(tab), ...(rowsByTab.get(tab) || [])]
        }))
      })
    });
    const writeJson = await writeRes.json();
    if (!writeRes.ok) throw new Error(`Writing snapshot failed: ${JSON.stringify(writeJson)}`);

    // Root-caused 2026-08-22: values:batchUpdate's outer HTTP 200 only
    // means the REQUEST was well-formed -- unlike spreadsheets.batchUpdate
    // (used for addSheet above, genuinely atomic), values:batchUpdate is
    // NOT documented as atomic across ranges. Google returns one
    // UpdateValuesResponse per range, in request order, each carrying
    // its own updatedRows -- so a single tab's write can come back
    // short (or missing from the array entirely) while every other
    // tab succeeds and the overall call still reports success. This is
    // exactly how one employee's tab went silently blank while
    // `success: true` was returned and nothing ever alerted anyone.
    // Compare each tab's actual updatedRows against what we intended
    // to write for it, rather than trusting the outer status alone.
    const responses = writeJson.responses || [];
    const discrepancies: { tab: string; expectedRows: number; actualRows: number }[] = [];
    allTabNames.forEach((tab, i) => {
      const expectedRows = 1 + (rowsByTab.get(tab) || []).length; // 1 = header row
      const actualRows = responses[i]?.updatedRows ?? 0;
      if (actualRows !== expectedRows) {
        discrepancies.push({ tab, expectedRows, actualRows });
      }
    });

    const runStatus = discrepancies.length > 0 ? "PARTIAL_FAILURE" : "SUCCESS";

    // Best-effort logging + alerting -- a backup_run_log/notification
    // failure here must never mask the real per-tab result being
    // returned below (same defensive shape as the catch block's own
    // notify-on-failure, and as Meta CAPI's nested try/catch blocks
    // elsewhere in this codebase).
    try {
      const supabaseLog = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      await supabaseLog.from("backup_run_log").insert({
        status: runStatus,
        tabs_written: allTabNames.length,
        tabs_created: missingTabs.length,
        total_leads_backed_up: (leads || []).length,
        discrepancies: discrepancies.length > 0 ? discrepancies : null
      });

      if (discrepancies.length > 0) {
        const { data: activeAdmins } = await supabaseLog
          .from("employees")
          .select("id, name")
          .eq("role", "admin")
          .eq("is_active", true);

        const tabList = discrepancies
          .map((d) => `${d.tab} (expected ${d.expectedRows} rows, got ${d.actualRows})`)
          .join(", ");

        for (const admin of activeAdmins || []) {
          await supabaseLog.from("notification").insert({
            employee_id: admin.id,
            employee_name: admin.name || "",
            title: "Google Sheets backup — discrepancy found",
            message: `Tonight's backup completed but ${discrepancies.length} tab(s) didn't get the rows they should have: ${tabList}`,
            type: "BACKUP_PARTIAL_FAILURE",
            is_read: false
          });
        }
      }
    } catch (logError: any) {
      console.error("backup-to-google-sheets: run-log/discrepancy-notify failed:", logError.message);
    }

    return new Response(
      JSON.stringify({
        success: discrepancies.length === 0,
        status: runStatus,
        tabsWritten: allTabNames.length,
        tabsCreated: missingTabs.length,
        totalLeadsBackedUp: (leads || []).length,
        discrepancies
      }),
      { headers: { "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error: any) {
    console.error("backup-to-google-sheets failed:", error.message);

    // A disaster-recovery backup that fails silently defeats its own
    // purpose — retrying (above) absorbs a transient blip, but if the
    // run still fails after retries, Admin needs to know today, not
    // whenever someone happens to check the Sheet. Best-effort: uses
    // its own client (a Supabase-connectivity failure would already
    // have been the thing that failed above), and never lets a
    // notification-insert error mask the real one being reported back.
    try {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      await supabase.from("backup_run_log").insert({
        status: "FAILED",
        error: error.message
      });

      const { data: activeAdmins } = await supabase
        .from("employees")
        .select("id, name")
        .eq("role", "admin")
        .eq("is_active", true);

      for (const admin of activeAdmins || []) {
        await supabase.from("notification").insert({
          employee_id: admin.id,
          employee_name: admin.name || "",
          title: "Google Sheets backup failed",
          message: `Tonight's disaster-recovery backup to Google Sheets did not complete: ${error.message}`,
          type: "BACKUP_FAILED",
          is_read: false
        });
      }
    } catch (notifyError: any) {
      console.error("backup-to-google-sheets: also failed to send failure notification:", notifyError.message);
    }

    return new Response(JSON.stringify({ success: false, message: error.message }), {
      headers: { "Content-Type": "application/json" },
      status: 500
    });
  }
});
