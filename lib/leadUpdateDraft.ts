// Keeps what an employee typed in the outcome sheet when saving failed because the login expired
// (2026-11-02), so it can be put back after they log in again. Browser only; a missing or blocked
// localStorage just means no draft.
// Network failures (2026-11-14): the same draft, with pendingSince = when the first save attempt started, so the
// next try first checks whether that attempt landed (lib/resilientLeadUpdate.ts). Such a draft stays until it is
// saved or the employee discards it (NETWORK_DRAFT_MAX_AGE_MS as a last resort), across an app restart.

const KEY_PREFIX = "lead_update_draft:";
const RETURN_KEY = "lead_update_draft_return";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const NETWORK_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface LeadUpdateDraft {
  status: string | null;
  note: string;
  reminderValue: string;
  reminderUnit: string;
  contactMethod: string | null;
  // Set when the save failed for network reasons: when that attempt started (ms).
  pendingSince?: number | null;
}

export function saveLeadUpdateDraft(leadId: string, draft: LeadUpdateDraft, returnPath: string | null, now: number = Date.now()): void {
  try {
    localStorage.setItem(KEY_PREFIX + leadId, JSON.stringify({ ...draft, savedAt: now }));
    if (returnPath) localStorage.setItem(RETURN_KEY, returnPath);
  } catch {
    // no storage, nothing to keep
  }
}

export function loadLeadUpdateDraft(leadId: string, now: number = Date.now()): LeadUpdateDraft | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + leadId);
    if (!raw) return null;
    const { savedAt, ...draft } = JSON.parse(raw);
    const maxAge = typeof draft.pendingSince === "number" ? NETWORK_DRAFT_MAX_AGE_MS : MAX_AGE_MS;
    if (typeof savedAt !== "number" || now - savedAt > maxAge) {
      localStorage.removeItem(KEY_PREFIX + leadId);
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

export function clearLeadUpdateDraft(leadId: string): void {
  try {
    localStorage.removeItem(KEY_PREFIX + leadId);
  } catch {
    // no storage, nothing to clear
  }
}

// The lead to reopen after the next login, once.
export function consumeDraftReturnPath(): string | null {
  try {
    const path = localStorage.getItem(RETURN_KEY);
    localStorage.removeItem(RETURN_KEY);
    return path;
  } catch {
    return null;
  }
}

// Only these two pages reopen a lead from the URL.
export function draftReturnPath(pathname: string, leadId: string): string | null {
  return pathname === "/leads" || pathname === "/data" ? `${pathname}?openLead=${leadId}` : null;
}
