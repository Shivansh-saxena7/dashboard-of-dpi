// @ts-nocheck

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.0";
import { logAnomaly } from "../../../lib/logAnomaly.ts";
import { createReportingFetch } from "../../../lib/reportingFetch.ts";

// Edge Function failure visibility (2026-10-03) — the Edge-side half of
// the system-wide rule "every real failure reaches system_anomaly_log".
//
// createMonitoredClient: the service-role client every Edge Function
// uses, with lib/reportingFetch.ts plugged in — so any failed DB call
// is logged even where the calling code ignores `error` (98 such sites
// found in the 2026-10-03 audit). Does not change what callers receive.
export function createMonitoredClient(functionName: string) {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { global: { fetch: createReportingFetch({ layer: "EDGE", source: () => functionName }) } }
  );
}

// withMonitoring: wraps a function's serve() handler. Logs an uncaught
// exception or any 5xx response (both previously console-only or lost
// entirely for cron-invoked functions, whose response pg_net drops
// after 5s). With { heartbeat: true } (pg_cron-driven functions), a
// successful run also updates cron_heartbeats — check_cron_heartbeats()
// flags a function that stops succeeding, which is the only way to
// catch a crash/timeout that never gets far enough to log anything.
// The handler's own response/behavior is returned unchanged.
export function withMonitoring(
  functionName: string,
  handler: (req: Request) => Promise<Response>,
  options: { heartbeat?: boolean } = {}
) {
  return async (req: Request): Promise<Response> => {
    const supabase = createMonitoredClient(functionName);

    let response: Response;
    try {
      response = await handler(req);
    } catch (err) {
      await logAnomaly(supabase, {
        source: functionName,
        severity: "error",
        layer: "EDGE",
        message: `Unhandled exception: ${err?.message || String(err)}`.slice(0, 500),
        context: { stack: String(err?.stack || "").slice(0, 1500) }
      });
      throw err;
    }

    if (response.status >= 500) {
      let body = "";
      try {
        body = (await response.clone().text()).slice(0, 400);
      } catch {
        // unreadable body — status alone is still worth logging
      }
      await logAnomaly(supabase, {
        source: functionName,
        severity: "error",
        layer: "EDGE",
        message: `Returned HTTP ${response.status}: ${body}`.slice(0, 500),
        context: { status: response.status }
      });
    } else if (options.heartbeat && response.status < 400) {
      const { error } = await supabase
        .from("cron_heartbeats")
        .update({ last_succeeded_at: new Date().toISOString() })
        .eq("function_name", functionName);
      if (error) console.error(`heartbeat(${functionName}) failed:`, error.message);
    }

    return response;
  };
}
