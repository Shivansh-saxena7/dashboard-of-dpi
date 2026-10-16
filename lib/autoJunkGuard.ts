// Auto-junk / auto-recycle kill switches and the per-sweep junk circuit
// breaker (2026-10-16). Read from lead_engine_settings by
// recycle-stale-leads; every column is optional so the function keeps
// its current behavior until the migration adding them is applied
// (supabase/sql/2026-10-16_p4_safety_layers.sql).
//
// Breaker default: 20 junks per sweep. Over the last 30 days a sweep
// junked p50 2, p95 8, p99 15 leads; the 3rd-recycle trap pushed single
// sweeps to 30. A sweep that reaches the cap stops junking for the rest
// of that sweep and raises one critical anomaly.

export const DEFAULT_MAX_AUTO_JUNK_PER_SWEEP = 20;

export interface SweepSafetySettings {
  auto_junk_enabled?: boolean | null;
  auto_recycle_enabled?: boolean | null;
  max_auto_junk_per_sweep?: number | null;
}

export type AutoJunkDecision = "JUNK" | "SKIP_DISABLED" | "SKIP_BREAKER";

export function autoJunkDecision(settings: SweepSafetySettings | null | undefined, junkedSoFar: number): AutoJunkDecision {
  if (settings?.auto_junk_enabled === false) return "SKIP_DISABLED";
  const cap = settings?.max_auto_junk_per_sweep ?? DEFAULT_MAX_AUTO_JUNK_PER_SWEEP;
  if (cap >= 0 && junkedSoFar >= cap) return "SKIP_BREAKER";
  return "JUNK";
}

export function autoRecycleEnabled(settings: SweepSafetySettings | null | undefined): boolean {
  return settings?.auto_recycle_enabled !== false;
}
