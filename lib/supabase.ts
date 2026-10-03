import { createClient } from "@supabase/supabase-js";
import { createReportingFetch } from "./reportingFetch";

// Every failed PostgREST/RPC call made through this browser client is
// reported to system_anomaly_log (2026-10-03), tagged with the page it
// happened on — including the ~380 call sites that ignore `error` or
// only toast it. Responses reach the calling code unchanged.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    global: {
      fetch: createReportingFetch({
        layer: "FRONTEND",
        source: () => (typeof window !== "undefined" ? `page:${window.location.pathname}` : "frontend")
      })
    }
  }
);
