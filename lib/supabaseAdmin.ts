import { createClient } from "@supabase/supabase-js";
import { createReportingFetch } from "@/lib/reportingFetch";

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    // Failed DB calls from API routes reach system_anomaly_log (2026-10-03).
    global: { fetch: createReportingFetch({ layer: "API", source: () => "api:supabaseAdmin" }) },
  }
);
