// Shared write-path for system_anomaly_log — the "silent bugs must
// never happen again" mechanism (2026-09-21), born directly from the
// 1000-row-cap bug hiding real duplicate leads for over a month with
// zero visible symptom. Any defensive check anywhere in the app that
// notices "this looks wrong" (a count mismatch, an unexpected empty
// result, anything else worth a human's attention) calls this instead
// of just a console.log that nobody will ever read.
//
// Deliberately fire-and-forget and failure-swallowing: a logging call
// must never become a new way for a real business operation to fail.
// Both failure modes (insert returns an `error`, or the client itself
// throws) are caught and only reach the server/browser console — this
// function's own contract is "never rejects."
//
// Client-agnostic by design, same reasoning as fetchAllRows's own
// queryBuilder parameter: takes an already-configured supabase client
// rather than importing/instantiating its own, so the exact same
// implementation works from a browser session (@/lib/supabase, RLS via
// system_anomaly_log_employee_insert — current_employee_id() IS NOT
// NULL) and from an Edge Function's service-role client alike.
export interface AnomalyLogInput {
  source: string;
  severity?: "warning" | "error";
  message: string;
  context?: Record<string, unknown>;
}

export async function logAnomaly(supabase: any, input: AnomalyLogInput): Promise<void> {
  try {
    const { error } = await supabase.from("system_anomaly_log").insert({
      source: input.source,
      severity: input.severity || "warning",
      message: input.message,
      context: input.context ?? null
    });

    if (error) {
      console.error(`logAnomaly: insert failed for source="${input.source}":`, error.message);
    }
  } catch (err) {
    console.error(`logAnomaly: threw for source="${input.source}" (swallowed):`, err);
  }
}
