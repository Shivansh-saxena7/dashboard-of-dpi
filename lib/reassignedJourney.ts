// "Previously with" tag + Journey (2026-11-23) for leads an admin gave from the Performance Report. Pure helpers, no
// database; known-answer tested in scripts/check-reassigned-journey.js. The database decides which leads qualify
// (get_my_reassigned_leads) and never sends the admin's reason, label or batch; this file only reads and words it.

// lead_engine_settings.reassigned_journey_mode: "off" (default) | "admin_pilot" (only reassigned_journey_pilot_ids) |
// "on". Read with select("*"): before the SQL is applied the column is missing, which means off. Anything unknown = off.
export function journeyModeAllows(settings: Record<string, unknown> | null | undefined, employeeId: string | null | undefined): boolean {
  if (!employeeId) return false;
  const mode = settings?.reassigned_journey_mode;
  if (mode === "on") return true;
  if (mode !== "admin_pilot") return false;
  const pilots = settings?.reassigned_journey_pilot_ids;
  return Array.isArray(pilots) && pilots.includes(employeeId);
}

export interface ReassignedLead { lead_id: string; previously_with: string | null; given_at: string }
export interface JourneyRow {
  employee: string | null; is_you: boolean; origin: string; given_by_admin: boolean; assigned_at: string; ended_at: string | null; current: boolean;
  followup: boolean; visit: boolean; converted: boolean; result: string | null;
}
export interface ReassignedContext {
  lead_id: string; previously_with: string | null; given_at: string;
  previous: { assigned_at: string; ended_at: string | null; followup: boolean; visit: boolean; converted: boolean; result: string | null } | null;
  journey: JourneyRow[];
}

export const tagText = (name: string | null | undefined) => `Previously with ${name?.trim() || "another person"}`;

const ORIGIN: Record<string, string> = { FRESH: "Fresh", RECYCLED: "Recycled", RESTORED: "Given back", ADMIN_GIVEN: "Given by admin", SELF: "Personal", OTHER: "Assigned" };
export const originText = (k: string) => ORIGIN[k] ?? "Assigned";

// What happened in one assignment, in plain words: the strongest thing first.
export function outcomeText(r: { followup?: boolean; visit?: boolean; converted?: boolean; result?: string | null }): string {
  if (r.converted || r.result === "CONVERTED") return "Converted";
  if (r.visit) return "Visit done";
  if (r.followup) return "Follow-up";
  switch (r.result) {
    case "CONNECTED": return "Connected";
    case "NOT_INTERESTED": return "Not interested";
    case "NOT_CONNECTED": return "Not connected";
    case "SWITCHED_OFF": return "Switched off";
    case null: case undefined: return "No result";
    default: return r.result.charAt(0) + r.result.slice(1).toLowerCase().replace(/_/g, " ");
  }
}

export function dayText(iso: string | null | undefined): string {
  if (!iso) return "now";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
}

export function byLeadId(rows: ReassignedLead[] | null | undefined): Map<string, ReassignedLead> {
  return new Map((rows ?? []).filter((r) => r && r.lead_id).map((r) => [r.lead_id, r]));
}

// Session memory for the flag (same rules as the employee Home flag): only a real answer is remembered, for 30 min.
export const JOURNEY_MODE_REMEMBER_MS = 30 * 60 * 1000;
export const JOURNEY_MODE_TIMEOUT_MS = 2000;
export function readRememberedMode(raw: string | null | undefined, nowMs: number): boolean | null {
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as { on?: unknown; at?: unknown };
    if (typeof saved.on !== "boolean" || typeof saved.at !== "number") return null;
    return nowMs - saved.at < JOURNEY_MODE_REMEMBER_MS ? saved.on : null;
  } catch {
    return null;
  }
}
