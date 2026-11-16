// How loud the sweep's routine guard summaries are in System Health (2026-11-16). A guard doing its job (the sibling
// guard holding a lead, in shadow or enforce, or a lead going back to its longest-ago owner because nobody new was
// eligible) is recorded per decision in lead_guard_events already; its once-per-sweep summary is info, so it never
// adds up to the "5 warnings an hour" Admin notification. A guard that FAILED is still an error. Failures to load
// data ("could not be loaded") keep their own warnings. Pure: known-answer tested in scripts/check-return-grace.js.
export type SweepAnomalySeverity = "info" | "warning" | "error";

export function siblingGuardSummarySeverity(failedCount: number): SweepAnomalySeverity {
  return failedCount > 0 ? "error" : "info";
}

export function prevOwnerFallbackSeverity(): SweepAnomalySeverity {
  return "info";
}
