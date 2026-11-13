// Per-owner recycle cap (2026-11-13). One sweep gives any one employee at most RECYCLE_PER_OWNER_CAP_PER_SWEEP recycled
// leads, so a morning backlog is dealt out a few at a time instead of dumping dozens on whoever started a shift. Applies to
// every round-robin and project-rule recycle (cooldown, inactivity, Data max attempts, SLA breach). A lead that finds every
// receiver full simply stays with its current owner until the next sweep: nothing is junked or moved because of the cap.
// Pure, no DB access. Known answers in scripts/check-recycle-per-owner-cap.js.
import { pickRecycleOwner, type RecycleOwnerPick } from "./pickRecycleOwner.ts";

export const RECYCLE_PER_OWNER_CAP_PER_SWEEP = 3;

export interface CappedRecycleOwnerPick extends RecycleOwnerPick {
  // True when the lead waits only because the receivers it may go to are full this sweep.
  capped: boolean;
}

export function hasRecycleRoom(given: ReadonlyMap<string, number>, employeeId: string, cap: number = RECYCLE_PER_OWNER_CAP_PER_SWEEP): boolean {
  return (given.get(employeeId) ?? 0) < cap;
}

export function recordRecycleGiven(given: Map<string, number>, employeeId: string): void {
  given.set(employeeId, (given.get(employeeId) ?? 0) + 1);
}

// Same pick as pickRecycleOwner, on the receivers that still have room. When every receiver who never owned the lead is
// full, the lead waits for the next sweep instead of falling back to a previous owner, so the cap never changes who may
// get a lead, only when.
export function pickRecycleOwnerCapped(
  pool: string[],
  previousOwnerEndedAt: Map<string, number> | undefined,
  given: ReadonlyMap<string, number>,
  assign: (pool: string[]) => string | null,
  cap: number = RECYCLE_PER_OWNER_CAP_PER_SWEEP
): CappedRecycleOwnerPick {
  const previous = previousOwnerEndedAt ?? new Map<string, number>();
  const fresh = pool.filter((id) => !previous.has(id));
  const excludedCount = pool.length - fresh.length;
  const room = (id: string) => hasRecycleRoom(given, id, cap);

  if (fresh.length > 0 && !fresh.some(room)) return { employeeId: null, usedFallback: false, excludedCount, capped: true };
  const open = pool.filter(room);
  if (open.length === 0) return { employeeId: null, usedFallback: false, excludedCount, capped: pool.length > 0 };
  const pick = pickRecycleOwner(open, previousOwnerEndedAt, assign);
  // A fallback to a previous owner only because a full fresh receiver was left out would change who gets the lead: wait.
  const fullFresh = fresh.some((id) => !room(id));
  if ((pick.usedFallback || !pick.employeeId) && fullFresh) return { employeeId: null, usedFallback: false, excludedCount, capped: true };
  return { ...pick, excludedCount, capped: false };
}
