# Project conventions

## Unbounded-query rule (PostgREST 1000-row cap)

Supabase's PostgREST layer silently caps any single response at 1000 rows,
regardless of table size and regardless of which API key (anon or
service_role) calls it. There is no error — a query that should return 2,500
rows just returns 1,000, in whatever order Postgres happened to return them.
Confirmed live via direct `curl` reproduction, 2026-09-21.

This exact bug independently hid data in three unrelated places before being
caught: `app/admin/leads/page.tsx` (admin leads list silently missing 1,200+
rows), `supabase/functions/backup-to-google-sheets/index.ts` (nightly
disaster-recovery backup missing 50%+ of data every night), and
`supabase/functions/import-leads-csv/index.ts` (duplicate-lead detection
missing genuine duplicates for over a month, causing the same lead to be
sent to different employees).

**Rule: any `supabase.from(table).select(...)` without `.range()`,
`.limit()`, `.single()`, or `.maybeSingle()` on a table that can realistically
grow past 1000 rows (`leads`, `lead_history`, `lead_notes`, `site_visits`,
`tracking`, `csv_import_batches`, and any future table in the same category)
is a red flag.**

- If you need a genuinely bounded result (one lead, one employee's own
  scoped rows, a small reference table): a normal `.eq(...)` filter or
  `.limit()` is fine as-is.
- If you need "the whole table" or "every row matching this filter,
  whatever the count": use `lib/fetchAllRows.ts` — the one shared
  pagination-loop implementation, imported the same way from both
  Next.js app code and every Supabase Edge Function (Edge Functions import
  it with an explicit `.ts` extension, e.g.
  `import { fetchAllRows } from "../../../lib/fetchAllRows.ts";`, matching
  how `lib/normalizeMobile.ts` is already shared across both runtimes).
  Never write a second copy of the pagination loop — this bug recurred
  three times specifically because three different call sites each had
  their own reimplementation, none of which paginated.
- For genuinely interactive, human-scrolled large lists (e.g. the admin
  leads table), prefer true server-side pagination + filtering instead
  (see `app/admin/leads/page.tsx`) over fetching everything into the
  browser — `fetchAllRows` is for backend jobs, exports, and dedup/
  integrity checks that genuinely need the whole matching set in memory
  at once, not for building a page a person paginates through by hand.

Pass `queryBuilder().select(columns, { count: "exact" })` and an
`anomalyContext: { supabase, source }` to `fetchAllRows` where practical —
it then self-verifies the fetched row count against Postgres's true count
and logs a `system_anomaly_log` row (visible at `/admin/system-health`) on
any mismatch, rather than trusting the pagination loop's own termination
silently.

### Why a lint rule / CI check exists for this specifically

`scripts/check-unbounded-queries.js` (run in CI) greps the large-table
allowlist above for `.from("<table>")` call sites lacking one of
`.range(`, `.limit(`, `fetchAllRows(`, `.single(`, `.maybeSingle(` nearby,
and fails the build if it finds one. This is a narrow, hand-maintained
grep — not a general AST lint rule — deliberately: a full Supabase-aware
ESLint rule would be real ongoing complexity for a team this size, while a
targeted script catches exactly the one bug class that has already
recurred three times, cheaply.

## Silent bugs must never be silent

Any defensive check anywhere in the app that notices something looks
wrong — a count mismatch, an unexpected empty result, anything else worth
a human's attention — should call `logAnomaly()` from `lib/logAnomaly.ts`
rather than only `console.log`/`console.error`. It writes to
`system_anomaly_log`, visible to Admin at `/admin/system-health`. This
exists because the 1000-row-cap bug above hid real data for over a month
with zero visible symptom — the goal is that the next silent-by-default
bug gets surfaced automatically instead of waiting to be noticed by luck.

This is deliberately not a general error-tracking/APM replacement — it's
fed only by checks the app's own code explicitly runs, not a catch-all for
every exception.
