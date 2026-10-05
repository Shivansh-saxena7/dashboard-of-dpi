import { supabase } from "@/lib/supabase";
import { recyclingTomorrowCutoff } from "@/lib/recyclingTomorrow";

// Focus reminders (2026-10-05) — the notifications that get the prominent
// toast instead of only a bell entry. Both are ordinary notification rows
// (so they're in the bell too); this only decides what the toast shows.
//   RECYCLE_TOMORROW      — check-lead-reminders cron: worth-saving Follow-up
//                           lead whose recycle cutoff is within 24h
//   PAUSE_EXPIRY_WARNING  — existing recycle-sweep warning: a Visit lock or
//                           Snooze ends within 3 days (unchanged backend)
export const FOCUS_REMINDER_TYPES = ["RECYCLE_TOMORROW", "PAUSE_EXPIRY_WARNING"];

export type FocusReminderKind = "RECYCLE" | "VISIT_LOCK" | "SNOOZE";

export interface FocusReminderItem {
  notificationIds: number[];
  leadId: string;
  leadType: string;
  name: string;
  kind: FocusReminderKind;
  msLeft: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Unread focus reminders from the last 24h, re-checked against the lead's
// CURRENT state: a lead the employee already acted on (cutoff moved), no
// longer owns (reassigned), or whose pause already ended is dropped, so the
// toast never nags about something that's no longer urgent. Read-only.
export async function loadFocusReminderItems(employeeId: string): Promise<FocusReminderItem[]> {
  const { data: notes } = await supabase
    .from("notification")
    .select("id, type, related_lead_id")
    .eq("employee_id", employeeId)
    .in("type", FOCUS_REMINDER_TYPES)
    .eq("is_read", false)
    .gte("created_at", new Date(Date.now() - DAY_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(50);

  const leadIds = Array.from(new Set((notes || []).map((n) => n.related_lead_id).filter(Boolean)));
  if (leadIds.length === 0) return [];

  const { data: leads } = await supabase
    .from("leads")
    .select(
      `id, name, lead_type, status, sla_deadline, recycle_count, board_stage, is_personal_lead,
       lead_history!inner ( assigned_at, call_count, paused_until, last_activity_at, pause_reason, outcome_at )`
    )
    .in("id", leadIds)
    .eq("current_owner_id", employeeId)
    .eq("lead_history.is_active", true)
    .limit(50);

  const now = Date.now();
  const byLead = new Map<string, FocusReminderItem>();

  for (const note of notes || []) {
    const lead = (leads || []).find((l) => l.id === note.related_lead_id);
    const h = lead?.lead_history?.[0];
    if (!lead || !h) continue;

    let kind: FocusReminderKind | null = null;
    let msLeft = 0;

    if (note.type === "RECYCLE_TOMORROW") {
      const cutoff = recyclingTomorrowCutoff(
        {
          status: lead.status,
          sla_deadline: lead.sla_deadline,
          recycle_count: lead.recycle_count,
          board_stage: lead.board_stage,
          paused_until: h.paused_until,
          last_activity_at: h.last_activity_at,
          pause_reason: h.pause_reason,
          assigned_at: h.assigned_at
        },
        h.outcome_at,
        h.call_count ?? 0,
        Boolean(lead.is_personal_lead),
        now
      );
      if (cutoff) {
        kind = "RECYCLE";
        msLeft = cutoff.getTime() - now;
      }
    } else if (h.paused_until && (h.pause_reason === "VISIT_LOCK" || h.pause_reason === "SNOOZE")) {
      const left = new Date(h.paused_until).getTime() - now;
      if (left > 0 && left <= 3 * DAY_MS) {
        kind = h.pause_reason === "VISIT_LOCK" ? "VISIT_LOCK" : "SNOOZE";
        msLeft = left;
      }
    }

    if (!kind) continue;

    const existing = byLead.get(lead.id);
    if (existing) {
      existing.notificationIds.push(note.id);
      if (msLeft < existing.msLeft) {
        existing.kind = kind;
        existing.msLeft = msLeft;
      }
    } else {
      byLead.set(lead.id, { notificationIds: [note.id], leadId: lead.id, leadType: lead.lead_type || "LEAD", name: lead.name || "Lead", kind, msLeft });
    }
  }

  return Array.from(byLead.values()).sort((a, b) => a.msLeft - b.msLeft);
}

// "5h" under two days, else "2 days".
export function formatTimeLeft(msLeft: number): string {
  const hours = Math.max(1, Math.round(msLeft / (60 * 60 * 1000)));
  if (hours < 48) return `${hours}h`;
  const days = Math.ceil(msLeft / DAY_MS);
  return `${days} days`;
}

export async function markFocusRemindersRead(notificationIds: number[]): Promise<void> {
  if (notificationIds.length === 0) return;
  await supabase
    .from("notification")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .in("id", notificationIds);
}
