import { supabase } from "@/lib/supabase";
import { logAnomaly } from "@/lib/logAnomaly";

const THROTTLE_MS = 10 * 60 * 1000;
const recentlyReported = new Map<string, number>();

// Browser-side, non-database failures (2026-10-03): uncaught exceptions,
// unhandled promise rejections, failed fetch()es to our own API routes.
// Failed Supabase calls are already reported by lib/reportingFetch.ts;
// this covers what never touches PostgREST. Best-effort, throttled per
// page+message, never throws.
export function reportClientError(where: string, err: unknown, severity: "warning" | "error" = "error") {
  try {
    const page = typeof window !== "undefined" ? window.location.pathname : "unknown";
    const message = err instanceof Error ? err.message : String(err);
    const key = `${page}|${where}|${message}`;
    const last = recentlyReported.get(key);
    if (last && Date.now() - last < THROTTLE_MS) return;
    recentlyReported.set(key, Date.now());

    void logAnomaly(supabase, {
      source: `page:${page}`,
      severity,
      layer: "FRONTEND",
      message: `${where}: ${message}`.slice(0, 500),
      context: { where, stack: err instanceof Error ? String(err.stack || "").slice(0, 1500) : null }
    });
  } catch {
    // reporting must never break the page
  }
}
