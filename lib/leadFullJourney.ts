// Full lead journey (2026-11-29): the answer of get_admin_lead_full_journey (admin only) and pure wording helpers for
// the History modal. Every assignment and every event of one lead, start to end, for any lead (junk, restored,
// recycled, merged). No customer name / number here: those come only from the admin contact lookup (lib/leadContacts.ts).
import { ENDED_REASON_TEXT } from "@/lib/endedReasonDisplay";

export interface JourneyStint {
  stint_id: string;
  employee_id: string | null;
  employee_name: string | null;
  assigned_at: string;
  ended_at: string | null;
  active: boolean;
  origin: "FRESH" | "RECYCLED" | "RESTORED" | "ADMIN_GIVEN" | "SELF" | "OTHER" | string;
  employee_sees: string;
  assigned_by_type: string | null;
  assigned_by_name: string | null;
  reassign_note: string | null;
  ended_reason: string | null;
  outcome: string | null;
  call_count: number | null;
  recycle_reason: string | null;
  recycled_from_status: string | null;
  recycled_from_stage: string | null;
  paused_until: string | null;
  pause_reason: string | null;
  followup?: boolean;
  visit?: boolean;
  converted?: boolean;
  connected?: boolean;
  result?: string | null;
  restore: { restored_at: string; by_name: string | null; reason: string | null; protected_until: string | null; undone_at: string | null; undone_note: string | null } | null;
  batch: { mode: string; label: string | null; reason: string | null; at: string; from_name: string | null } | null;
}

export interface JourneyEvent {
  at: string;
  kind: "STATUS" | "STAGE" | "ADMIN_REASSIGN" | "ADMIN_RESTORE" | "CALL" | "WHATSAPP" | "NOTE" | "VISIT" | "BOOKING" | "SNOOZE" | "RESTORE" | "GUARD" | "TRANSFER_REQUEST" | "TEAM_RESERVATION" | "LEAVE" | string;
  detail: string | null;
  employee_id: string | null;
  employee_name: string | null;
  stint_id: string | null;
  text: string | null;
  extra: Record<string, unknown> | null;
}

export interface FullJourney {
  found: boolean;
  lead?: {
    id: string; id8: string; lead_type: string; status: string; board_stage: string | null; project: string | null; source: string | null;
    catcher_name: string | null; is_personal_lead: boolean; created_at: string; recycle_count: number; last_unjunked_at: string | null;
    current_owner_id: string | null; current_owner_name: string | null; pending_team_name: string | null; merged_into8: string | null;
    csv_batch8: string | null; csv_batch_file: string | null;
  };
  stints: JourneyStint[];
  events: JourneyEvent[];
  truncated: boolean;
}

export const WORDS: Record<string, string> = {
  NEW: "New", CONNECTED: "Connected", NOT_CONNECTED: "Not connected", SWITCHED_OFF: "Switched off", NOT_INTERESTED: "Not interested",
  CONVERTED: "Converted", JUNK: "Junk", LEADS: "Leads", FOLLOW_UP: "Follow-up", VISIT: "Visit", BOOKING: "Booking",
  FRESH: "New lead", RECYCLED: "Recycled", RESTORED: "Given back by admin", ADMIN_GIVEN: "Given by admin", SELF: "Own lead", OTHER: "Assigned"
};
export const word = (k: string | null | undefined) => (k ? WORDS[k] ?? k.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : "—");

export function endedText(s: Pick<JourneyStint, "active" | "ended_reason">): string {
  if (s.active) return "Still with them";
  if (!s.ended_reason) return "Ended";
  return ENDED_REASON_TEXT[s.ended_reason] ?? word(s.ended_reason);
}

// Admin-only reason / label for how the lead reached this owner (never shown to the employee).
export function adminReason(s: JourneyStint): string | null {
  if (s.batch) return [s.batch.label, s.batch.reason].filter(Boolean).join(" · ") || null;
  if (s.restore?.reason) return s.restore.reason;
  return s.reassign_note?.trim() || null;
}

export type EventGroup = "status" | "calls" | "notes" | "visits" | "other";
export function eventGroup(e: JourneyEvent): EventGroup {
  if (e.kind === "STATUS" || e.kind === "STAGE") return "status";
  if (e.kind === "CALL" || e.kind === "WHATSAPP") return "calls";
  if (e.kind === "NOTE") return "notes";
  if (e.kind === "VISIT" || e.kind === "BOOKING") return "visits";
  return "other";
}

export function eventTitle(e: JourneyEvent): string {
  const x = e.extra ?? {};
  switch (e.kind) {
    case "STATUS": return `Status: ${word(e.detail)}`;
    case "STAGE": return `Moved to ${word(e.detail)}`;
    case "ADMIN_REASSIGN": return "Admin gave the lead to someone else";
    case "ADMIN_RESTORE": return "Admin gave the lead back";
    case "CALL": return e.detail ? `Call · ${word(e.detail)}` : "Call";
    case "WHATSAPP": return "WhatsApp";
    case "NOTE": return x.reminder_at ? "Note with reminder" : "Note";
    case "VISIT": return x.denied_at ? "Visit (denied)" : x.verified_at ? "Visit (verified)" : "Visit";
    case "BOOKING": return x.denied_at ? "Booking (denied)" : "Booking";
    case "SNOOZE": return x.cancelled_at ? `Snoozed ${x.months ?? ""} month(s), later cancelled` : `Snoozed ${x.months ?? ""} month(s)`;
    case "RESTORE": return x.undone_at ? "Given back by admin (undone later)" : "Given back by admin";
    case "GUARD": return guardText(e.detail);
    case "TRANSFER_REQUEST": return `Transfer request · ${word(e.detail)}`;
    case "TEAM_RESERVATION": return `Reserved for team ${e.detail ?? ""}`.trim();
    case "LEAVE": return "Owner on leave";
    default: return word(e.kind);
  }
}

export function guardText(d: string | null): string {
  const [source, action] = (d ?? "").split("/");
  if (/JUNK/i.test(action ?? "") && /refus/i.test(action ?? "")) return "Junk stopped by a safety check";
  if (/RECYCLE_REFUSED/i.test(action ?? "")) return "Recycle stopped: the number is positive with someone else";
  if (/HOLD/i.test(action ?? "")) return "Held (not recycled) by a safety check";
  if (/LEAVE/i.test(action ?? "")) return "Skipped: owner on leave";
  if (source === "admin_junk") return "Marked junk by admin";
  return `Safety check: ${word(action || source)}`;
}

export function istTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

export function stintCounts(j: FullJourney, stintId: string): { calls: number; notes: number; moves: number } {
  const ev = j.events.filter((e) => e.stint_id === stintId);
  return { calls: ev.filter((e) => e.kind === "CALL" || e.kind === "WHATSAPP").length, notes: ev.filter((e) => e.kind === "NOTE").length, moves: ev.filter((e) => e.kind === "STATUS" || e.kind === "STAGE").length };
}
