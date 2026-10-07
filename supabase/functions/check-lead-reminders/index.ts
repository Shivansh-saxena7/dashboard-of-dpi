// @ts-nocheck

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createMonitoredClient, withMonitoring } from "../_shared/monitoring.ts";
import { fetchAllRows } from "../../../lib/fetchAllRows.ts";
import { recyclingTomorrowCutoff } from "../../../lib/recyclingTomorrow.ts";
import { isNotificationWindowOpen, loadJobWorkingCalendar, nonWorkingStatusAt, timerCalendar } from "../../../lib/workingCalendar.ts";
import { logAnomaly } from "../../../lib/logAnomaly.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.0";

// Scheduled sweep (pg_cron, once daily) — reminders now carry
// hour/day/month precision (reminder_at, a timestamptz), so this
// checks against the exact current moment rather than a calendar-day
// string. Still only run once daily since that's the sweep cadence
// that was set up; an hours-scoped reminder just becomes accurate to
// within a day rather than to the minute — same tradeoff as before,
// just no longer baked into the column type itself. System job, no
// CORS/auth, same posture as mark-missed-posts/recycle-stale-leads.
//
// Only notifies once per note (reminder_notified_at guard, same
// pattern as lead_history.sla_warning_sent_at), and only while the
// employee still actually owns the lead (lead_history.is_active =
// true) — a reminder for a lead that's since been recycled/
// reassigned away would be a stale, confusing notification to send.

// --- Recycling-tomorrow reminders (2026-10-05) ----------------------------
// A worth-saving Follow-up lead whose recycle cutoff is within 24h gets ONE
// "RECYCLE_TOMORROW" notification to its current owner — the same rule the
// employee's "Recycling Tomorrow" filter uses (lib/recyclingTomorrow.ts), so
// the reminder and the filter always agree. Read-only toward leads: this
// never touches recycle, SLA or assignment state; the recycle sweep is
// untouched. Sent only 9 AM-8 PM IST (a 24h window always overlaps that).
//
// Once only, with no new column: skip when this owner already has a
// RECYCLE_TOMORROW notification for the lead created since their CURRENT
// assignment began — a reassigned lead's new owner gets their own reminder.
async function sendRecycleTomorrowReminders(supabase: any, workingCalendar: any) {
  const istHour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()));
  if (istHour < 9 || istHour >= 20) {
    return { skipped: "outside 9 AM-8 PM IST", istHour };
  }

  const { data: followups, error } = await fetchAllRows(
    () =>
      supabase
        .from("leads")
        .select(
          `id, name, status, sla_deadline, recycle_count, board_stage, current_owner_id, is_personal_lead,
           lead_history!inner ( assigned_at, call_count, paused_until, last_activity_at, pause_reason, outcome_at )`,
          { count: "exact" }
        )
        .eq("board_stage", "FOLLOW_UP")
        .eq("lead_type", "LEAD")
        .eq("lead_history.is_active", true)
        .order("id"),
    { anomalyContext: { supabase, source: "check-lead-reminders:recycleTomorrow" } }
  );
  if (error) return { error: error.message };

  // Working calendar: loaded once per run in the handler below (Step 6),
  // so "recycles at" matches the sweep.

  const now = Date.now();
  const due = (followups || [])
    .map((lead: any) => {
      const h = lead.lead_history?.[0];
      if (!h || !lead.current_owner_id) return null;
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
        now,
        workingCalendar
      );
      return cutoff ? { lead, assignedAt: h.assigned_at, cutoff } : null;
    })
    .filter(Boolean);

  if (due.length === 0) return { candidates: 0, sent: 0 };

  const { data: existing } = await supabase
    .from("notification")
    .select("employee_id, related_lead_id, created_at")
    .eq("type", "RECYCLE_TOMORROW")
    .in("related_lead_id", due.map((d: any) => d.lead.id))
    .limit(5000);

  const { data: owners } = await supabase
    .from("employees")
    .select("id, name")
    .in("id", Array.from(new Set(due.map((d: any) => d.lead.current_owner_id))));
  const nameById = new Map((owners || []).map((e: any) => [e.id, e.name]));

  const rows = due
    .filter((d: any) =>
      !(existing || []).some(
        (n: any) =>
          n.related_lead_id === d.lead.id &&
          n.employee_id === d.lead.current_owner_id &&
          new Date(n.created_at).getTime() >= new Date(d.assignedAt).getTime()
      )
    )
    .map((d: any) => {
      const hoursLeft = Math.max(1, Math.round((d.cutoff.getTime() - now) / (60 * 60 * 1000)));
      return {
        employee_id: d.lead.current_owner_id,
        employee_name: nameById.get(d.lead.current_owner_id) || "",
        title: `⏳ ${d.lead.name || "A lead"} recycles tomorrow`,
        message: `About ${hoursLeft}h left before this Follow-up lead is reassigned to someone else — call now to keep it.`,
        type: "RECYCLE_TOMORROW",
        is_read: false,
        related_lead_id: d.lead.id
      };
    });

  if (rows.length === 0) return { candidates: due.length, sent: 0 };

  const { error: insertError } = await supabase.from("notification").insert(rows);
  if (insertError) return { candidates: due.length, error: insertError.message };

  return { candidates: due.length, sent: rows.length };
}

serve(withMonitoring("check-lead-reminders", async () => {
  try {

    const supabase = createMonitoredClient("check-lead-reminders");

    // Working calendar (Steps 4 + 6), once per run. Failed load (see
    // loadJobWorkingCalendar): switch OFF = carry on exactly as before + a
    // warning; switch ON = hold this run's reminders (never send at a
    // wrong time) + a warning, so the hold is never silent.
    const calendarSource = "check-lead-reminders:working-calendar";
    const calendarLoad = await loadJobWorkingCalendar(
      supabase,
      async () => {
        const { data, error: switchError } = await supabase
          .from("lead_engine_settings")
          .select("working_days_timers_enabled")
          .eq("id", 1)
          .single();
        if (switchError) throw switchError;
        return data?.working_days_timers_enabled === true;
      },
      (message, context) => logAnomaly(supabase, { source: calendarSource, severity: "warning", message, context })
    );
    if (calendarLoad.skipTimerWork) {
      await logAnomaly(supabase, {
        source: calendarSource,
        severity: "warning",
        message: "Working calendar failed to load with the working-days switch ON (or unreadable); reminders held this run",
        context: { error: calendarLoad.error }
      });
      return new Response(
        JSON.stringify({ success: true, held: "working calendar unavailable", error: calendarLoad.error }),
        { headers: { "Content-Type": "application/json" } }
      );
    }
    const workingCalendar = calendarLoad.calendar;

    // Step 6 (2026-10-07): with the switch ON, LEAD_REMINDER and
    // RECYCLE_TOMORROW only go out 9 AM-8 PM IST on a working day. Outside
    // that window this run sends nothing and marks nothing — due reminders
    // stay unnotified and go out on the first run inside the window (the
    // next working day ~9:30 AM, this cron runs at :30 IST). 200, so the
    // heartbeat is still written. OFF = always open (old behaviour).
    if (!isNotificationWindowOpen(workingCalendar)) {
      const nonWorking = timerCalendar(workingCalendar) ? nonWorkingStatusAt(workingCalendar) : { isNonWorking: false };
      return new Response(
        JSON.stringify({ success: true, held: "outside working notification window", nonWorking }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    const { data: dueNotes, error: dueNotesError } = await supabase
      .from("lead_notes")
      .select(
        `
        id, note, lead_id, employee_id,
        lead_history ( is_active ),
        leads ( name )
        `
      )
      .lte("reminder_at", new Date().toISOString())
      .is("reminder_notified_at", null);

    if (dueNotesError) {
      return new Response(
        JSON.stringify({ success: false, step: "FETCH_DUE_REMINDERS", error: dueNotesError.message }),
        { headers: { "Content-Type": "application/json" }, status: 500 }
      );
    }

    let notifiedCount = 0;
    const diagnostics: any[] = [];

    for (const item of dueNotes || []) {

      if (!item.lead_history?.is_active) {
        diagnostics.push({ noteId: item.id, action: "SKIPPED", reason: "lead_history no longer active" });
        continue;
      }

      const { data: employee } = await supabase
        .from("employees")
        .select("name")
        .eq("id", item.employee_id)
        .single();

      const { error: notifyError } = await supabase.from("notification").insert({
        employee_id: item.employee_id,
        employee_name: employee?.name || "",
        title: "Lead follow-up reminder",
        message: `Follow-up due for ${item.leads?.name || "a lead"}: "${item.note}"`,
        type: "LEAD_REMINDER",
        is_read: false,
        // Notification-Call-Action (2026-09-23) -- lets the bell
        // dropdown show a direct Call/View-Lead button instead of the
        // employee having to search for this lead themselves. ID-only
        // (see notification.related_lead_id's own comment) -- the
        // frontend joins leads live at render time, so a lead
        // reassigned away between now and when this is viewed
        // correctly stops exposing its number, rather than a frozen
        // snapshot staying callable.
        related_lead_id: item.lead_id
      });

      if (notifyError) {
        diagnostics.push({ noteId: item.id, action: "NOTIFY_FAILED", error: notifyError.message });
        continue;
      }

      await supabase
        .from("lead_notes")
        .update({ reminder_notified_at: new Date().toISOString() })
        .eq("id", item.id);

      notifiedCount++;
      diagnostics.push({ noteId: item.id, action: "NOTIFIED" });

    }

    const recycleTomorrow = await sendRecycleTomorrowReminders(supabase, workingCalendar);

    return new Response(
      JSON.stringify({ success: true, notifiedCount, totalChecked: (dueNotes || []).length, diagnostics, recycleTomorrow }),
      { headers: { "Content-Type": "application/json" } }
    );

  } catch (err) {

    console.error("check-lead-reminders: unhandled error:", err.message, err.stack);

    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { headers: { "Content-Type": "application/json" }, status: 500 }
    );

  }
}, { heartbeat: true }));
