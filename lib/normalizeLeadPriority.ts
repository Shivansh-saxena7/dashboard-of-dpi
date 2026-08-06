import { LeadPriority } from "./leadPriorityDisplay.ts";

// CSV-supplied priority text -> the exact enum value leads.priority
// accepts, or null if it doesn't recognize the value. Never guesses
// wrong on ambiguous input — an unrecognized value is the caller's
// signal to fall back to a sane default (Leads: "warm"; Data always
// hardcodes "cold" regardless, never even calls this), not something
// this function silently coerces one way or another.
const PRIORITY_SYNONYMS: Record<LeadPriority, string[]> = {
  hot: ["hot", "high", "urgent"],
  warm: ["warm", "medium", "moderate"],
  cold: ["cold", "low"]
};

function normalizeText(raw: string): string {
  return raw.trim().toLowerCase();
}

export function normalizeLeadPriority(raw: string | null | undefined): LeadPriority | null {
  if (!raw) return null;

  const normalized = normalizeText(raw);

  for (const priority of Object.keys(PRIORITY_SYNONYMS) as LeadPriority[]) {
    if (PRIORITY_SYNONYMS[priority].includes(normalized)) {
      return priority;
    }
  }

  return null;
}
