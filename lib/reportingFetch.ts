// Failure-reporting fetch for Supabase clients (2026-10-03). Passed as
// `global.fetch` to createClient in BOTH runtimes — the Next.js browser
// client (lib/supabase.ts) and every Edge Function — so any failed
// PostgREST/RPC response lands in system_anomaly_log automatically,
// including the many call sites that ignore `error` or only toast it.
// One implementation for both, same sharing pattern as
// lib/normalizeMobile.ts (no imports, so Deno and Next can both load it;
// Edge Functions import it with the explicit .ts extension).
//
// This never changes what the caller sees: the original Response is
// returned untouched (the body is read from a clone), and reporting
// failures are swallowed — reporting must never break the real call.
//
// Classification (approved 2026-10-03):
//   skipped  — PGRST116 (.single() found no row: expected control
//              flow) and expired/missing-JWT 401s (normal session end)
//   warning  — P0001 (deliberate `raise exception` validation, e.g.
//              DUPLICATE_LEAD) and 23505 unique violations; Admin is
//              only notified if one repeats 5x/hour (DB trigger)
//   error    — everything else: constraint violations, "function does
//              not exist", permission denied, 5xx
//   network  — fetch itself rejected: skipped when aborted or the page is
//              unloading, otherwise a warning (connectivity, not an app bug)

type FetchLike = typeof fetch;

export interface ReportingFetchOptions {
  // system_anomaly_log.layer — "FRONTEND" | "EDGE" | "API"
  layer: "FRONTEND" | "EDGE" | "API";
  // Stable name for where this client lives, e.g. "recycle-stale-leads".
  // Called per failure so the browser can include the current page.
  source: () => string;
}

const ANOMALY_PATH = "/rest/v1/system_anomaly_log";
const THROTTLE_MS = 10 * 60 * 1000;
const recentlyReported = new Map<string, number>();

// Requests cut off because the page itself is going away (reload, hard
// navigation, closing the tab) reject with a generic network error that
// is indistinguishable from a real outage — they are not failures.
let pageUnloading = false;
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("pagehide", () => { pageUnloading = true; });
  window.addEventListener("beforeunload", () => { pageUnloading = true; });
  window.addEventListener("pageshow", () => { pageUnloading = false; });
}

function headerValue(init: RequestInit | undefined, input: RequestInfo | URL, name: string): string | null {
  const fromInit = init?.headers ? new Headers(init.headers).get(name) : null;
  if (fromInit) return fromInit;
  return input instanceof Request ? input.headers.get(name) : null;
}

export function createReportingFetch(options: ReportingFetchOptions, baseFetch: FetchLike = fetch): FetchLike {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const isRest = url.includes("/rest/v1/");

    // Never report on the report itself (no recursion), and leave
    // Storage/Auth/Functions traffic alone — this covers PostgREST.
    if (!isRest || url.includes(ANOMALY_PATH)) {
      return baseFetch(input, init);
    }

    let response: Response;
    try {
      response = await baseFetch(input, init);
    } catch (networkError) {
      // Aborted on purpose, or killed by the page unloading: not a failure.
      // A genuine network failure (flaky mobile data, offline) is logged as
      // a warning, so Admin is only notified if it keeps happening.
      const aborted = networkError instanceof Error && networkError.name === "AbortError";
      if (aborted || pageUnloading) throw networkError;
      // System Health cleanup (2026-11-13): a phone that is offline tells us nothing, so nothing is logged. A failed
      // write (POST/PATCH/PUT/DELETE, except read-only RPCs) stays a warning: something the user saved did not arrive.
      // A failed read is "info", once a day per page + endpoint on this device, under its own network:* source.
      if (isOffline()) throw networkError;
      const failure = { message: networkError instanceof Error ? networkError.message : String(networkError) };
      const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
      const endpoint = endpointOf(url);
      if (isWriteRequest(method, endpoint)) {
        void report(options, baseFetch, url, init, input, "warning", "network", failure);
      } else {
        const source = `network:${options.source()} ${method} ${endpoint}`;
        if (firstTodayOnThisDevice(source)) void report(options, baseFetch, url, init, input, "info", "network", failure, undefined, source);
      }
      throw networkError;
    }

    if (response.status < 400) return response;

    let body: { code?: string; message?: string; details?: string; hint?: string } = {};
    try {
      body = await response.clone().json();
    } catch {
      // non-JSON error body — classify on status alone
    }

    const code = body.code || String(response.status);
    if (code === "PGRST116") return response;
    // The "Given by admin" feature hides itself when its function is missing or not allowed yet: expected, not an error.
    if (url.includes("/rpc/get_given_lead_context") && ["PGRST202", "42501", "42883"].includes(code)) return response;
    // Same for the guard-held card on System Health: hidden until its function is applied.
    if (url.includes("/rpc/get_guard_held_leads") && ["PGRST202", "42501", "42883"].includes(code)) return response;
    // Same for the employee "Needs your call" filter.
    if (url.includes("/rpc/get_my_guard_held_leads") && ["PGRST202", "42501", "42883"].includes(code)) return response;
    // Same for the Data page "Previously connected" box.
    if (url.includes("/rpc/get_data_previous_positive") && ["PGRST202", "42501", "42883"].includes(code)) return response;
    if (response.status === 401 && /JWT|PGRST30/i.test(`${code} ${body.message || ""}`)) return response;

    const severity = code === "P0001" || code === "23505" ? "warning" : "error";
    void report(options, baseFetch, url, init, input, severity, code, body, response.status);

    return response;
  };
}

// --- Network failures (2026-11-13). Kept here, import-free, because Edge Functions load this file too. ---
export function isWriteRequest(method: string, endpoint: string): boolean {
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD") return false;
  return !(m === "POST" && /^rpc\/(get|list|count|find|search|check)_/.test(endpoint));
}

function endpointOf(url: string): string {
  try {
    return new URL(url).pathname.replace("/rest/v1/", "");
  } catch {
    return "unknown";
  }
}

function isOffline(): boolean {
  try {
    return typeof navigator !== "undefined" && (navigator as { onLine?: boolean }).onLine === false;
  } catch {
    return false;
  }
}

const NET_KEY_PREFIX = "reportingFetch:net:";

// True the first time this device sees this read fail today (IST); false after. Without localStorage (server, Edge)
// it is always true and the 10-minute throttle in report() still applies.
export function firstTodayOnThisDevice(source: string, nowMs: number = Date.now()): boolean {
  try {
    if (typeof localStorage === "undefined") return true;
    const day = new Date(nowMs + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const key = `${NET_KEY_PREFIX}${day}:${source}`;
    if (localStorage.getItem(key)) return false;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(NET_KEY_PREFIX) && !k.startsWith(`${NET_KEY_PREFIX}${day}:`)) localStorage.removeItem(k);
    }
    localStorage.setItem(key, "1");
    return true;
  } catch {
    return true;
  }
}

async function report(
  options: ReportingFetchOptions,
  baseFetch: FetchLike,
  url: string,
  init: RequestInit | undefined,
  input: RequestInfo | URL,
  severity: "info" | "warning" | "error",
  code: string,
  body: { message?: string; details?: string; hint?: string },
  status?: number,
  sourceOverride?: string
) {
  try {
    const parsed = new URL(url);
    const endpoint = parsed.pathname.replace("/rest/v1/", "");
    const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    const source = sourceOverride ?? options.source();

    const key = `${source}|${method} ${endpoint}|${code}`;
    const last = recentlyReported.get(key);
    if (last && Date.now() - last < THROTTLE_MS) return;
    recentlyReported.set(key, Date.now());

    const apikey = headerValue(init, input, "apikey");
    const authorization = headerValue(init, input, "Authorization");
    if (!apikey) return;

    await baseFetch(`${parsed.origin}${ANOMALY_PATH}`, {
      method: "POST",
      headers: {
        apikey,
        Authorization: authorization || `Bearer ${apikey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        source,
        severity,
        layer: options.layer,
        message: `${method} ${endpoint} failed (${code}): ${body.message || "no message"}`.slice(0, 500),
        context: { endpoint, method, status: status ?? null, code, details: body.details ?? null, hint: body.hint ?? null }
      })
    });
  } catch {
    // Reporting is best-effort by design; the real call already returned.
  }
}
