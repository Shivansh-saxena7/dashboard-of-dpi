// System Health grouping (2026-11-13). One source + message (ids and numbers taken out) = one group, so the page
// shows a handful of cards instead of hundreds of rows. Guard / shadow records and info rows go to "Activity"; errors
// and failed writes come first. Pure, known-answer tested in scripts/check-system-health.js.

export interface AnomalyRow {
  id: string;
  source: string;
  severity: string;
  message: string;
  layer: string | null;
  occurrence_count: number;
  detected_at: string;
  last_seen_at: string;
  context?: Record<string, unknown> | null;
}

export interface AnomalyGroup {
  key: string;
  source: string;
  severity: string;
  layer: string | null;
  message: string; // latest message of the group
  context: Record<string, unknown> | null; // latest context
  rows: number;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  ids: string[];
  kind: "issue" | "activity";
  isError: boolean;
  isWriteFailure: boolean;
}

// Records the sweep and the database guards write on purpose (a guard did its job, a shadow check would have acted,
// a fallback was used). Kept for evidence, not problems to fix.
export const ACTIVITY_SOURCES: ReadonlySet<string> = new Set([
  "db_sibling_guard",
  "recycle_sibling_guard_shadow",
  "distribution_guard_shadow",
  "recycle_prev_owner_fallback",
  "personal_lead_block",
  "recycle_auto_junk_breaker",
  "session_expired"
]);
const ACTIVITY_PREFIXES = ["call_return:", "network:"];

export function normalizeAnomalyMessage(message: string): string {
  return (message || "")
    .replace(/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\b[0-9a-f]{8}\b/gi, "<id>")
    .replace(/[0-9]+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

export function anomalyGroupKey(row: Pick<AnomalyRow, "source" | "message">): string {
  return `${row.source}|${normalizeAnomalyMessage(row.message)}`;
}

export function isActivityRow(row: Pick<AnomalyRow, "source" | "severity">): boolean {
  if (row.severity === "info") return true;
  if (ACTIVITY_SOURCES.has(row.source)) return true;
  return ACTIVITY_PREFIXES.some((p) => row.source.startsWith(p));
}

// "POST rpc/log_lead_update_atomic failed (...)", "PATCH notification failed (...)": something the user saved did not
// reach the database. A POST to a read-only RPC (get_ / list_ / count_ / find_) is a read, not a write.
export function isWriteFailureMessage(message: string): boolean {
  const m = /^(POST|PATCH|PUT|DELETE) (\S+) failed/.exec(message || "");
  if (!m) return false;
  return !(m[1] === "POST" && /^rpc\/(get|list|count|find|search|check)_/.test(m[2]));
}

const RANK = (g: AnomalyGroup) => (g.isError ? 0 : g.isWriteFailure ? 1 : 2);

export function groupAnomalies(rows: AnomalyRow[]): AnomalyGroup[] {
  const map = new Map<string, AnomalyGroup>();
  for (const r of rows) {
    const key = anomalyGroupKey(r);
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        source: r.source,
        severity: r.severity,
        layer: r.layer,
        message: r.message,
        context: r.context ?? null,
        rows: 0,
        occurrences: 0,
        firstSeen: r.detected_at,
        lastSeen: r.last_seen_at,
        ids: [],
        kind: isActivityRow(r) ? "activity" : "issue",
        isError: false,
        isWriteFailure: false
      };
      map.set(key, g);
    }
    g.rows += 1;
    g.occurrences += Math.max(1, r.occurrence_count || 1);
    g.ids.push(r.id);
    if (r.detected_at < g.firstSeen) g.firstSeen = r.detected_at;
    if (r.last_seen_at >= g.lastSeen) {
      g.lastSeen = r.last_seen_at;
      g.message = r.message;
      g.context = r.context ?? null;
      g.layer = r.layer;
    }
    if (r.severity === "error" || r.severity === "critical") {
      g.isError = true;
      g.severity = r.severity;
    }
    if (isWriteFailureMessage(r.message)) g.isWriteFailure = true;
  }
  return [...map.values()].sort((a, b) => RANK(a) - RANK(b) || (a.lastSeen < b.lastSeen ? 1 : a.lastSeen > b.lastSeen ? -1 : 0));
}

export const STALE_DAYS = 14;

// Groups that have not happened for STALE_DAYS days: candidates for "mark reviewed" in one go.
export function staleGroups(groups: AnomalyGroup[], nowMs: number, days: number = STALE_DAYS): AnomalyGroup[] {
  const cutoff = nowMs - days * 24 * 60 * 60 * 1000;
  return groups.filter((g) => Date.parse(g.lastSeen) < cutoff);
}

// Ids in batches small enough for one PostgREST `in` filter in the URL.
export function chunkIds(ids: string[], size: number = 100): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

// Network failures (no HTTP status) and offline: shared by lib/reportingFetch.ts and lib/reportClientError.ts.
export function isNetworkErrorMessage(message: string): boolean {
  return /failed to fetch|load failed|networkerror|network request failed|fetch failed|the internet connection appears to be offline/i.test(message || "");
}
