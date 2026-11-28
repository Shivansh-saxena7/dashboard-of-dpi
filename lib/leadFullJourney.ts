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

// ---- Single timeline (2026-11-29 v2, owner's request): one vertical list, oldest first, like the old History modal.
// Owner changes are events in the same list ("got the lead" / "lost the lead"); no separate owners section.
export type TimelineTone = "owner" | "ownerOut" | "status" | "stage" | "call" | "note" | "visit" | "snooze" | "admin" | "guard" | "transfer" | "leave";
export type TimelineIcon = "user" | "userMinus" | "status" | "stage" | "phone" | "whatsapp" | "note" | "visit" | "snooze" | "restore" | "guard" | "transfer" | "reserve" | "leave";

export interface TimelineItem {
  key: string;
  at: string;
  tone: TimelineTone;
  icon: TimelineIcon;
  title: string;
  who: string;
  lines: string[];
  text: string | null;
  adminLine: string | null;
}

const gapText = (s: unknown) => {
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 60 ? `${Math.round(n)} sec` : n < 3600 ? `${Math.round(n / 60)} min` : `${Math.round(n / 3600)} h`;
};
const str = (v: unknown) => (v == null ? "" : String(v));

export function buildTimeline(j: FullJourney): TimelineItem[] {
  const items: (TimelineItem & { order: number })[] = [];
  j.stints.forEach((s, i) => {
    const name = s.employee_name ?? "Unknown employee";
    const how =
      s.origin === "RESTORED" ? "given back by admin" : s.origin === "ADMIN_GIVEN" ? "given by admin" : s.origin === "SELF" ? "own lead" : s.origin === "FRESH" ? "fresh" : s.origin === "RECYCLED" ? "recycled" : "assigned";
    const lines: string[] = [];
    if (s.recycled_from_status || s.recycled_from_stage) lines.push(`Came back from ${word(s.recycled_from_status)} at ${word(s.recycled_from_stage)}`);
    lines.push(`Employee saw: ${s.employee_sees}`);
    if (s.restore?.protected_until) lines.push(`Protected until ${istTime(s.restore.protected_until)}${s.restore.undone_at ? ` · undone ${istTime(s.restore.undone_at)}` : ""}`);
    if (s.pause_reason) lines.push(`Paused (${word(s.pause_reason)}) until ${istTime(s.paused_until)}`);
    const by = s.assigned_by_name ?? (s.assigned_by_type === "SYSTEM" ? "System" : s.assigned_by_type === "SELF" ? name : word(s.assigned_by_type));
    items.push({ key: `in-${s.stint_id}`, at: s.assigned_at, order: 0, tone: "owner", icon: "user", title: `${name} got the lead (${how})`, who: by, lines, text: null, adminLine: adminReason(s) });
    if (!s.active) {
      const c = stintCounts(j, s.stint_id);
      const endAt = s.ended_at ?? j.stints[i + 1]?.assigned_at ?? null;
      const out = [endedText(s), `${c.calls} call${c.calls === 1 ? "" : "s"} · ${c.notes} note${c.notes === 1 ? "" : "s"} while with them${s.result ? ` · last result ${word(s.result)}` : ""}`];
      items.push({ key: `out-${s.stint_id}`, at: endAt ?? s.assigned_at, order: endAt ? -1 : 9, tone: "ownerOut", icon: "userMinus", title: endAt ? `${name} lost the lead` : `${name}: lead closed`, who: "System", lines: out, text: null, adminLine: null });
    }
  });
  let status = "NEW";
  let stage = "LEADS";
  const ev = [...j.events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  ev.forEach((e, n) => {
    const x = e.extra ?? {};
    const base = { key: `ev-${n}-${e.kind}`, at: e.at, order: 1, who: e.employee_name ?? (e.kind === "GUARD" ? "System" : "Unknown"), text: null as string | null, adminLine: null as string | null };
    if (e.kind === "STATUS") {
      items.push({ ...base, tone: "status", icon: "status", title: `Status: ${word(status)} → ${word(e.detail)}`, lines: [] });
      status = e.detail ?? status;
    } else if (e.kind === "STAGE") {
      items.push({ ...base, tone: "stage", icon: "stage", title: `Moved from ${word(stage)} to ${word(e.detail)}`, lines: [] });
      stage = e.detail ?? stage;
    } else if (e.kind === "CALL" || e.kind === "WHATSAPP") {
      const lines: string[] = [];
      if (e.detail) lines.push(`Result: ${word(e.detail)}`);
      const gap = gapText(x.gap_seconds);
      if (gap) lines.push(`Result saved ${gap} after the tap`);
      items.push({ ...base, tone: "call", icon: e.kind === "WHATSAPP" ? "whatsapp" : "phone", title: e.kind === "WHATSAPP" ? "WhatsApp opened" : "Call", lines });
    } else if (e.kind === "NOTE") {
      items.push({ ...base, tone: "note", icon: "note", title: x.reminder_at ? `Note · reminder ${istTime(str(x.reminder_at))}` : "Note", lines: [], text: e.text });
    } else if (e.kind === "VISIT" || e.kind === "BOOKING") {
      const lines: string[] = [];
      if (x.verified_at) lines.push(`Verified ${istTime(str(x.verified_at))}${x.verified_by ? ` by ${str(x.verified_by)}` : ""}`);
      if (x.denied_at) lines.push(`Denied ${istTime(str(x.denied_at))}${x.denied_by ? ` by ${str(x.denied_by)}` : ""}${x.deny_reason ? ` · Reason: ${str(x.deny_reason)}` : ""}`);
      items.push({ ...base, tone: "visit", icon: "visit", title: eventTitle(e), lines, text: e.text });
    } else if (e.kind === "SNOOZE") {
      const lines = [`Until ${istTime(x.until ? str(x.until) : null)}`];
      if (e.detail) lines.push(`Reason: ${e.detail}`);
      if (x.cancelled_at) lines.push(`Cancelled ${istTime(str(x.cancelled_at))}${x.cancelled_by ? ` by ${str(x.cancelled_by)}` : ""}`);
      items.push({ ...base, tone: "snooze", icon: "snooze", title: eventTitle(e), lines });
    } else if (e.kind === "RESTORE") {
      const lines: string[] = [];
      if (x.to_name) lines.push(`To ${str(x.to_name)}`);
      lines.push(`Comes back as ${word(str(x.restored_status))} · ${word(str(x.restored_stage))}`);
      if (x.undone_at) lines.push(`Undone ${istTime(str(x.undone_at))}${x.undone_note ? ` · ${str(x.undone_note)}` : ""}`);
      items.push({ ...base, tone: "admin", icon: "restore", title: eventTitle(e), lines, adminLine: e.text });
    } else if (e.kind === "ADMIN_REASSIGN" || e.kind === "ADMIN_RESTORE") {
      items.push({ ...base, tone: "admin", icon: "restore", title: eventTitle(e), lines: e.detail ? [e.detail] : [] });
    } else if (e.kind === "GUARD") {
      const lines: string[] = [];
      if (x.holder_owner) lines.push(`Same number is with ${str(x.holder_owner)}${x.holder_lead8 ? ` (lead ${str(x.holder_lead8)})` : ""}`);
      if (x.mode) lines.push(`Mode: ${word(str(x.mode))}`);
      items.push({ ...base, tone: "guard", icon: "guard", title: guardText(e.detail), lines });
    } else if (e.kind === "TRANSFER_REQUEST") {
      const lines: string[] = [];
      if (x.to_name) lines.push(`To ${str(x.to_name)}`);
      if (x.reviewed_at) lines.push(`Reviewed ${istTime(str(x.reviewed_at))}${x.reviewed_by ? ` by ${str(x.reviewed_by)}` : ""}`);
      items.push({ ...base, tone: "transfer", icon: "transfer", title: eventTitle(e), lines, text: e.text });
    } else if (e.kind === "TEAM_RESERVATION") {
      items.push({ ...base, tone: "transfer", icon: "reserve", title: eventTitle(e), lines: [] });
    } else if (e.kind === "LEAVE") {
      items.push({ ...base, tone: "leave", icon: "leave", title: "Owner on leave", lines: [`${str(x.start_date)} to ${x.end_date ? str(x.end_date) : "open"}${e.detail ? ` · ${e.detail}` : ""}`] });
    } else {
      items.push({ ...base, tone: "leave", icon: "status", title: eventTitle(e), lines: e.detail ? [e.detail] : [] });
    }
  });
  // Oldest first. At the same moment: the old owner leaves, then the new one gets it, then what they did.
  return items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.order - b.order).map(({ order: _order, ...t }) => t);
}

export function nowLine(j: FullJourney): string {
  if (!j.lead) return "";
  const owner = j.lead.current_owner_name ? `with ${j.lead.current_owner_name}` : j.lead.pending_team_name ? `reserved for ${j.lead.pending_team_name}` : "no owner";
  return `Now: ${word(j.lead.status)} · ${word(j.lead.board_stage ?? "LEADS")} · ${owner}`;
}
