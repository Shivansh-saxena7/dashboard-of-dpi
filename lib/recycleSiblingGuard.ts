// Recycle sibling guard (G1, 2026-10-17). Before recycle-stale-leads
// hands a lead to a new owner, it checks whether the same number is a
// POSITIVE lead (lib/positiveLead.ts) with someone else. If it is, the
// stale copy must not go to a third employee:
//   - same project  -> MERGE_INTO the holder's lead (one card; notes
//                      copied; call credit stays on lead_history)
//   - other project -> ASSIGN_TO_HOLDER (the person already talking to
//                      this client gets the other project's lead too)
//   - holder is the stale copy's own owner -> KEEP (no recycle)
//   - holder inactive or on leave -> HOLD (no recycle, logged)
// Mode comes from lead_engine_settings.recycle_sibling_guard_mode:
// "off" (or missing column) = old behavior, "shadow" = decide + log
// only, "enforce" = act.

export type SiblingGuardMode = "off" | "shadow" | "enforce";

export interface PositiveHolder {
  lead_id: string;
  mobile: string;
  project_key: string;
  owner_id: string;
  owner_active: boolean;
  rank: number; // 1 VISIT/visit pause, 2 BOOKING, 3 FOLLOW_UP, 4 CONNECTED/CONVERTED
}

export interface RecycleCandidate {
  id: string;
  mobile_normalized: string | null;
  project: string | null;
  current_owner_id: string | null;
  lead_type?: string | null;
}

export type SiblingDecision =
  | { action: "NONE" }
  | { action: "MERGE_INTO" | "ASSIGN_TO_HOLDER" | "KEEP"; holder: PositiveHolder }
  | { action: "HOLD"; holder: PositiveHolder; reason: "HOLDER_INACTIVE" | "HOLDER_ON_LEAVE" };

export function guardMode(value: unknown): SiblingGuardMode {
  return value === "shadow" || value === "enforce" ? value : "off";
}

export function projectKey(project: string | null | undefined): string {
  return (project ?? "").trim().toLowerCase();
}

export function buildHolderIndex(rows: PositiveHolder[]): Map<string, PositiveHolder[]> {
  const byMobile = new Map<string, PositiveHolder[]>();
  for (const row of rows) {
    if (!/^[0-9]{10}$/.test(row.mobile)) continue;
    const list = byMobile.get(row.mobile) ?? [];
    list.push(row);
    byMobile.set(row.mobile, list);
  }
  return byMobile;
}

export function decideSiblingGuard(
  lead: RecycleCandidate,
  holdersByMobile: Map<string, PositiveHolder[]>,
  onLeaveEmployeeIds: Set<string>,
  mode: SiblingGuardMode
): SiblingDecision {
  // DATA copies are left alone: the same number going to several
  // employees as DATA is Admin policy (2026-10-16), not a duplicate.
  if (mode === "off" || !lead.mobile_normalized || lead.lead_type === "DATA") return { action: "NONE" };
  const holders = (holdersByMobile.get(lead.mobile_normalized) ?? []).filter((h) => h.lead_id !== lead.id);
  if (holders.length === 0) return { action: "NONE" };

  // Same project first, then the strongest progress, then a stable order.
  const key = projectKey(lead.project);
  const holder = [...holders].sort((a, b) =>
    Number(b.project_key === key) - Number(a.project_key === key) || a.rank - b.rank || a.lead_id.localeCompare(b.lead_id)
  )[0];

  if (holder.owner_id === lead.current_owner_id) return { action: "KEEP", holder };
  if (!holder.owner_active) return { action: "HOLD", holder, reason: "HOLDER_INACTIVE" };
  if (onLeaveEmployeeIds.has(holder.owner_id)) return { action: "HOLD", holder, reason: "HOLDER_ON_LEAVE" };
  return { action: holder.project_key === key ? "MERGE_INTO" : "ASSIGN_TO_HOLDER", holder };
}
