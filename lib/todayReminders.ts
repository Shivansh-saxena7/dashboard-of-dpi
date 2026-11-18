"use client";
// Reminders today (2026-11-18, Employee Home Phase 2): the employee's own lead_notes reminders whose reminder_at falls
// in today's IST day. One bounded read (employee_id + the day's range + a limit; lead_notes_employee_id_idx), used by
// the Home and by /leads?filter=reminders-today, so both show the same leads. RLS already limits lead_notes to the
// employee's own rows. Read-only: reminder_notified_at and the reminder cron are not touched.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { istDayBounds, remindersByLead, type ReminderRow } from "@/lib/employeeHome";

// A day's reminders for one person are a handful; the cap only stops a runaway answer.
export const TODAY_REMINDERS_LIMIT = 500;

export async function fetchTodayReminders(
  employeeId: string,
  now: number = Date.now()
): Promise<{ byLead: Map<string, number>; error: boolean }> {
  const { start, end } = istDayBounds(now);
  const { data, error } = await supabase
    .from("lead_notes")
    .select("lead_id, reminder_at")
    .eq("employee_id", employeeId)
    .gte("reminder_at", new Date(start).toISOString())
    .lt("reminder_at", new Date(end).toISOString())
    .order("reminder_at", { ascending: true })
    .limit(TODAY_REMINDERS_LIMIT);
  if (error) return { byLead: new Map(), error: true };
  return { byLead: remindersByLead((data || []) as ReminderRow[]), error: false };
}

// For /leads: asks only while the Reminders-today filter is on.
export function useTodayReminders(employeeId: string | null | undefined, enabled: boolean) {
  const [byLead, setByLead] = useState<Map<string, number>>(new Map());
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!employeeId) return;
    const result = await fetchTodayReminders(employeeId);
    setByLead(result.byLead);
    setLoaded(true);
  }, [employeeId]);

  useEffect(() => {
    if (enabled) load();
    else setLoaded(false);
  }, [enabled, load]);

  return { byLead, loaded, reload: load };
}
