// Expired-login guard for the browser Supabase client (2026-11-02). When there is no usable session
// supabase-js silently sends the public anon key instead of the user's token, so a save reaches the
// database as "anon" and fails with "permission denied for function ..." (it cannot even be logged:
// the anomaly log needs a logged-in employee). This wrapper stops such a write before it is sent, tries
// the session once more (a phone coming back online), and otherwise answers like PostgREST would, so
// every call site gets a normal { error } with a clear message. Reads are left alone. No imports, so
// the check script can load it directly.

export const SESSION_EXPIRED_CODE = "SESSION_EXPIRED";
export const SESSION_EXPIRED_MESSAGE = "Your session has expired. Please log in again.";
export const SESSION_EXPIRED_EVENT = "dpi-session-expired";

const GUARDED_PATHS = ["/rest/v1/", "/functions/v1/", "/storage/v1/"];
const ANOMALY_PATH = "/rest/v1/system_anomaly_log";

export function needsLogin(url: string, method: string, authorization: string | null, anonKey: string, pathname: string): boolean {
  if (pathname.startsWith("/login")) return false;
  if (["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) return false;
  if (!GUARDED_PATHS.some((p) => url.includes(p)) || url.includes(ANOMALY_PATH)) return false;
  const token = authorization?.replace(/^Bearer\s+/i, "") ?? "";
  return !token || token === anonKey;
}

export interface SessionGuardOptions {
  anonKey: string;
  getAccessToken: () => Promise<string | null>;
  getPathname: () => string;
  onExpired: () => void;
}

export function createSessionGuardFetch(baseFetch: typeof fetch, options: SessionGuardOptions): typeof fetch {
  return async (input, init) => {
    const request = input instanceof Request ? input : null;
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    const method = init?.method ?? request?.method ?? "GET";
    const headers = new Headers(init?.headers ?? request?.headers);
    if (!needsLogin(url, method, headers.get("Authorization"), options.anonKey, options.getPathname())) {
      return baseFetch(input, init);
    }
    const token = await options.getAccessToken().catch(() => null);
    if (token && token !== options.anonKey) {
      headers.set("Authorization", `Bearer ${token}`);
      return baseFetch(input, { ...init, headers });
    }
    options.onExpired();
    return new Response(JSON.stringify({ code: SESSION_EXPIRED_CODE, message: SESSION_EXPIRED_MESSAGE, details: null, hint: null }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  };
}

// Where to go after logging in again: only a path inside this app.
export function safeNextPath(next: string | null | undefined): string | null {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : null;
}
