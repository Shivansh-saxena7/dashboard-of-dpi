// Saving a result without losing it on a bad network (2026-11-14). Used by LeadDetailModal and DataDetailModal.
//
// - A network failure (no answer from the server: iPhone "Load failed", "Failed to fetch") gets ONE automatic retry
//   after RETRY_DELAY_MS. A server answer (bad input, permission, expired login) is never retried.
// - No double save: log_lead_update_atomic is not idempotent, and a request can reach the database even though the
//   answer is lost. So before any retry we first ask whether the save already landed: for a result, the assignment's
//   outcome is the new status with an outcome_at after the attempt started; for a note only, the note exists. If that
//   check itself cannot be answered, we do not send again (the caller keeps a draft and the employee retries later,
//   which checks first again).
// - A saved result also ends the active call (lib/activeCall.ts), whichever way it was confirmed.
// The decision logic is pure and known-answer tested in scripts/check-result-save.js; the DB calls are injected.

import type { ContactMethod } from "@/lib/callQuality";
import type { LeadUpdateParams } from "@/lib/logLeadUpdate";

export const RETRY_DELAY_MS = 3000;
// Allowed clock difference between the phone and the database when deciding "it landed after we tried".
export const LANDED_SKEW_MS = 2 * 60 * 1000;

export interface RpcResultLike {
  error: { code?: string | null; message?: string | null } | null;
  status?: number;
}

export type Landed = "yes" | "no" | "unknown";

export type SaveOutcome =
  | { kind: "saved"; via: "first" | "retry" | "already" }
  | { kind: "server"; error: RpcResultLike["error"] }
  | { kind: "network"; checkUnknown: boolean };

export interface SaveDeps {
  send: (params: LeadUpdateParams, contactMethod: ContactMethod | null) => Promise<RpcResultLike>;
  checkLanded: (params: LeadUpdateParams, sinceMs: number) => Promise<Landed>;
  wait: (ms: number) => Promise<void>;
  now: () => number;
  onSaved?: (params: LeadUpdateParams) => void;
}

const NETWORK_MESSAGE = /failed to fetch|load failed|networkerror|network request failed|fetch failed|the internet connection appears to be offline|the network connection was lost/i;
const SESSION_EXPIRED_CODE = "SESSION_EXPIRED";

// postgrest-js answers a rejected fetch with status 0 and "TypeError: <message>"; any HTTP answer has a real status.
export function isNetworkFailure(result: RpcResultLike | null | undefined): boolean {
  if (!result || !result.error) return false;
  if (result.error.code === SESSION_EXPIRED_CODE) return false;
  if (typeof result.status === "number" && result.status > 0) return false;
  return result.status === 0 || NETWORK_MESSAGE.test(result.error.message || "");
}

export async function saveLeadUpdateResilient(
  params: LeadUpdateParams,
  contactMethod: ContactMethod | null,
  deps: SaveDeps,
  options: { checkFirstSince?: number | null } = {}
): Promise<SaveOutcome> {
  const saved = (via: "first" | "retry" | "already"): SaveOutcome => {
    deps.onSaved?.(params);
    return { kind: "saved", via };
  };

  // Retrying a kept draft: the earlier attempt may have landed after all.
  if (options.checkFirstSince) {
    const landed = await deps.checkLanded(params, options.checkFirstSince);
    if (landed === "yes") return saved("already");
    if (landed === "unknown") return { kind: "network", checkUnknown: true };
  }

  const startedAt = options.checkFirstSince ?? deps.now();
  const first = await deps.send(params, contactMethod);
  if (!first.error) return saved("first");
  if (!isNetworkFailure(first)) return { kind: "server", error: first.error };

  await deps.wait(RETRY_DELAY_MS);
  const landed = await deps.checkLanded(params, startedAt);
  if (landed === "yes") return saved("already");
  if (landed === "unknown") return { kind: "network", checkUnknown: true };

  const second = await deps.send(params, contactMethod);
  if (!second.error) return saved("retry");
  if (!isNetworkFailure(second)) return { kind: "server", error: second.error };
  return { kind: "network", checkUnknown: false };
}

// Pure: did the result / note land, given what the database shows now?
export function landedFromRows(
  params: Pick<LeadUpdateParams, "p_new_status" | "p_note">,
  sinceMs: number,
  history: { outcome: string | null; outcome_at: string | null } | null,
  noteFound: boolean
): Landed {
  if (params.p_new_status) {
    if (!history) return "no";
    const at = history.outcome_at ? Date.parse(history.outcome_at) : NaN;
    return history.outcome === params.p_new_status && Number.isFinite(at) && at >= sinceMs - LANDED_SKEW_MS ? "yes" : "no";
  }
  if (params.p_note) return noteFound ? "yes" : "no";
  return "no";
}
