// @ts-nocheck

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Scheduled sweep (pg_cron, once daily — reminders are day-
// granularity, unlike recycle-stale-leads' 15-min SLA-urgency
// cadence). System job, no CORS/auth, same posture as
// mark-missed-posts/recycle-stale-leads.
//
// Only notifies once per note (reminder_notified_at guard, same
// pattern as lead_history.sla_warning_sent_at), and only while the
// employee still actually owns the lead (lead_history.is_active =
// true) — a reminder for a lead that's since been recycled/
// reassigned away would be a stale, confusing notification to send.

serve(async () => {
  try {

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const today = new Date().toISOString().split("T")[0];

    const { data: dueNotes, error: dueNotesError } = await supabase
      .from("lead_notes")
      .select(
        `
        id, note, lead_id, employee_id,
        lead_history ( is_active ),
        leads ( name )
        `
      )
      .lte("reminder_date", today)
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
        is_read: false
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

    return new Response(
      JSON.stringify({ success: true, notifiedCount, totalChecked: (dueNotes || []).length, diagnostics }),
      { headers: { "Content-Type": "application/json" } }
    );

  } catch (err) {

    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { headers: { "Content-Type": "application/json" }, status: 500 }
    );

  }
});
