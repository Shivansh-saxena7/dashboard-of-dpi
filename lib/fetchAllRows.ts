import { logAnomaly } from "./logAnomaly.ts";

// The one shared implementation of the pagination-loop pattern that
// independently fixed the exact same silent-truncation bug three
// times in one session (app/admin/leads/page.tsx,
// backup-to-google-sheets/index.ts, import-leads-csv/index.ts) before
// being consolidated here (2026-09-21) — PostgREST caps any single
// response at 1000 rows regardless of table size or which API key
// calls it (confirmed live via direct curl reproduction), silently,
// with no error. Import this from anywhere in the app or an Edge
// Function that genuinely needs "the whole table/whole matching set"
// rather than the app's usual single-employee/single-lead scoped
// reads — never write a bare unbounded `.select()` on leads,
// lead_history, lead_notes, site_visits, tracking, or
// csv_import_batches again (see CLAUDE.md's "unbounded query" rule).
//
// queryBuilder must be a FRESH, unexecuted query on every call (a
// supabase-js query object is single-use, since a new .range() is
// chained onto it per page) — pass a function that builds the query,
// not a built query. A deterministic .order() (usually "id" as a
// tiebreaker) is required on it for pagination to be correct across
// pages, same as every migrated call site here.
//
// The page-until-short-page loop is what makes this correct at any
// scale on its own — it never assumes 1000 IS the true row count, it
// just keeps requesting pageSize-sized windows until one comes back
// with fewer rows than requested. That holds whether the table has
// 2,000 rows or 200,000.
//
// The one gap that loop alone can't see: if the server silently
// honors a smaller max-rows-per-request than the pageSize asked for
// (a PostgREST config change, a proxy in front of it, anything
// outside this code's control), a page could come back short NOT
// because it's the last page, but because the server itself
// truncated it — the same failure mode one layer deeper. verifyCount
// (on by default) catches that: when queryBuilder's own .select()
// opts into `{ count: "exact" }`, every page response carries
// Postgres's true total matching-row count independent of .range();
// this compares that total against what was actually fetched and
// logs an anomaly (via logAnomaly, never throws) on any mismatch,
// rather than silently returning a short list. Skipped gracefully — no
// verification, no anomaly — when the caller's queryBuilder didn't
// request an exact count; this is a bonus fetchAllRows can give a
// caller, not something it can force onto one.
export interface FetchAllRowsOptions {
  pageSize?: number;
  verifyCount?: boolean;
  // Supplies both what's needed to write an anomaly row (the caller's
  // own supabase client — browser or service-role) and a short label
  // identifying which query this was, so a System Health reader can
  // tell where a mismatch came from without guessing.
  anomalyContext?: {
    supabase: any;
    source: string;
  };
}

export async function fetchAllRows(
  queryBuilder: () => any,
  options: FetchAllRowsOptions = {}
): Promise<{ data: any[]; error: any }> {
  const { pageSize = 1000, verifyCount = true, anomalyContext } = options;

  let all: any[] = [];
  let from = 0;
  let reportedTotal: number | null = null;

  while (true) {
    const { data, error, count } = await queryBuilder().range(from, from + pageSize - 1);
    if (error) return { data: all, error };
    if (!data || data.length === 0) break;

    if (reportedTotal === null && typeof count === "number") {
      reportedTotal = count;
    }

    all = all.concat(data);

    if (data.length < pageSize) break;
    from += pageSize;
  }

  if (verifyCount && reportedTotal !== null && reportedTotal !== all.length && anomalyContext) {
    await logAnomaly(anomalyContext.supabase, {
      source: anomalyContext.source,
      severity: "error",
      message: `fetchAllRows count mismatch: fetched ${all.length} rows but Postgres reports ${reportedTotal} matching rows`,
      context: { fetchedCount: all.length, reportedTotal, pageSize }
    });
  }

  return { data: all, error: null };
}
