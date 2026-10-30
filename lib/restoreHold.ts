// Restore hold (2026-10-30). A lead an admin gave back (positive-junk restore) or reassigned
// keeping its state (reassign_keep_state_atomic) gets a protection window in lead_restore_log
// (protected_until = now + restore_protection_days, 14). The DB junk guard already honours it;
// this keeps the recycle sweep from taking the lead away inside the same window, so the G5
// 6-day Follow-up inactivity recycle cannot fire before the new owner had the full 14 days.
//
// Only recycle / junk-due decisions are held; the day-3 warning and every other status are
// unchanged. DATA leads are never held (they recycle only by call attempts). Pure, no DB access;
// the DB side is restore_protection_until() + the guard in recycle_lead_atomic.
//
// lead_engine_settings.restore_hold_mode: "off" | "shadow" (default: only logs what it would
// do) | "enforce". Only "enforce" changes any decision.

export type RestoreHoldMode = "off" | "shadow" | "enforce";

const HELD_STATUSES = new Set([
  "SLA_BREACHED",
  "RECYCLE_READY",
  "FOLLOWUP_INACTIVITY_RECYCLE_READY",
  "JUNK_ELIGIBLE"
]);

export function restoreHoldMode(value: unknown): RestoreHoldMode {
  return value === "shadow" || value === "enforce" ? value : "off";
}

// True when the sweep would recycle / junk this lead but its protection window is still open.
export function restoreHoldApplies(
  slaStatus: string,
  leadType: string | null | undefined,
  protectedUntil: string | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (leadType === "DATA" || !protectedUntil || !HELD_STATUSES.has(slaStatus)) return false;
  const until = Date.parse(protectedUntil);
  return Number.isFinite(until) && until > nowMs;
}
