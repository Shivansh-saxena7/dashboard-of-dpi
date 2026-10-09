// Recycle previous-owner exclusion (2026-10-09). recycle-stale-leads used
// to exclude only the CURRENT owner when picking who gets a recycled lead,
// so a lead could go A -> B -> back to A (23 leads on 07-08 Oct). These
// pure helpers add "and nobody who owned this lead before" on top of
// whatever pool the caller already built (shift-started, active, team /
// project-rule scope, forced removals) — they never widen that pool.
// Shared by both runtimes like lib/calculateLeadAssignment.ts.

export interface LeadHistoryOwnerRow {
  lead_id: string;
  employee_id: string | null;
  assigned_at: string;
}

// leadId -> (employeeId -> when that employee's most recent ownership of
// the lead ended, ms). An ownership ends when the next history row
// starts; `inactiveRows` are the lead's ended rows and
// `activeAssignedAtByLead` gives the start of the current (active) row,
// which ends the last inactive one.
export function buildPreviousOwnerEndTimes(
  inactiveRows: LeadHistoryOwnerRow[],
  activeAssignedAtByLead: Map<string, string | null | undefined>
): Map<string, Map<string, number>> {
  const rowsByLead = new Map<string, LeadHistoryOwnerRow[]>();
  for (const row of inactiveRows) {
    if (!row.employee_id) continue;
    const list = rowsByLead.get(row.lead_id) || [];
    list.push(row);
    rowsByLead.set(row.lead_id, list);
  }

  const result = new Map<string, Map<string, number>>();
  for (const [leadId, rows] of rowsByLead) {
    rows.sort((a, b) => new Date(a.assigned_at).getTime() - new Date(b.assigned_at).getTime());
    const activeAt = activeAssignedAtByLead.get(leadId);
    const owners = new Map<string, number>();
    rows.forEach((row, i) => {
      const next = rows[i + 1]?.assigned_at ?? activeAt ?? row.assigned_at;
      const endedAt = new Date(next).getTime();
      const prev = owners.get(row.employee_id as string);
      if (prev === undefined || endedAt > prev) owners.set(row.employee_id as string, endedAt);
    });
    result.set(leadId, owners);
  }
  return result;
}

export interface RecycleOwnerPick {
  employeeId: string | null;
  // true when every eligible person had owned the lead before, so the one
  // whose ownership ended longest ago was used instead.
  usedFallback: boolean;
  // how many people were taken out of the pool for having owned it before
  excludedCount: number;
}

// `pool` is the caller's already-filtered candidate list (current owner
// already removed). `assign` is the caller's own picking rule (round robin,
// project-rule pointer...) applied to a pool; it returns null if nobody in
// that pool can take the lead. Order of attempts:
//   1. pool minus previous owners, through `assign`;
//   2. otherwise previous owners one at a time, longest-ago ownership first,
//      through `assign` (so its own exclusions/allowlists still apply).
export function pickRecycleOwner(
  pool: string[],
  previousOwnerEndedAt: Map<string, number> | undefined,
  assign: (pool: string[]) => string | null
): RecycleOwnerPick {
  const previous = previousOwnerEndedAt ?? new Map<string, number>();
  const fresh = pool.filter((id) => !previous.has(id));
  const excludedCount = pool.length - fresh.length;

  if (fresh.length > 0) {
    const picked = assign(fresh);
    if (picked || excludedCount === 0) return { employeeId: picked, usedFallback: false, excludedCount };
  } else if (excludedCount === 0) {
    return { employeeId: null, usedFallback: false, excludedCount };
  }

  const fallbackOrder = pool
    .filter((id) => previous.has(id))
    .sort((a, b) => (previous.get(a) as number) - (previous.get(b) as number));
  for (const id of fallbackOrder) {
    const picked = assign([id]);
    if (picked) return { employeeId: picked, usedFallback: true, excludedCount };
  }
  return { employeeId: null, usedFallback: false, excludedCount };
}
