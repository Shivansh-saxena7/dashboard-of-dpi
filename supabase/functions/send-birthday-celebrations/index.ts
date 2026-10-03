// @ts-nocheck

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createMonitoredClient, withMonitoring } from "../_shared/monitoring.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.0";

// Scheduled sweep (pg_cron, once daily, ~8:00 AM IST) -- finds every
// active employee whose date_of_birth falls on today's IST calendar
// date (month+day only, year ignored) and calls
// send_birthday_celebration_atomic once per match, independently. Two
// employees sharing a birthday each get their own separate 3-message
// broadcast -- kept simple on purpose, not combined into one. System
// job, no CORS/auth, same posture as the other scheduled functions
// (check-lead-reminders, mark-missed-posts, etc.).
//
// date_of_birth is a plain `date` column -- new Date("YYYY-MM-DD")
// always parses as UTC midnight for that calendar date regardless of
// the runtime's own timezone, so reading it back with getUTCMonth()/
// getUTCDate() is timezone-safe without needing lib/istTime.ts's
// time-of-day helpers (those solve a different problem: a precise
// clock instant, not a stored calendar date).

serve(withMonitoring("send-birthday-celebrations", async () => {
  try {

    const supabase = createMonitoredClient("send-birthday-celebrations");

    const nowIst = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const todayMonth = nowIst.getUTCMonth() + 1;
    const todayDay = nowIst.getUTCDate();

    const { data: activeEmployees, error: employeesError } = await supabase
      .from("employees")
      .select("id")
      .eq("is_active", true);

    if (employeesError) {
      return new Response(
        JSON.stringify({ success: false, step: "FETCH_ACTIVE_EMPLOYEES", error: employeesError.message }),
        { headers: { "Content-Type": "application/json" }, status: 500 }
      );
    }

    const activeIds = (activeEmployees || []).map((e) => e.id);

    const { data: dobRows, error: dobError } = await supabase
      .from("employee_payroll_details")
      .select("employee_id, date_of_birth")
      .not("date_of_birth", "is", null)
      .in("employee_id", activeIds);

    if (dobError) {
      return new Response(
        JSON.stringify({ success: false, step: "FETCH_DATES_OF_BIRTH", error: dobError.message }),
        { headers: { "Content-Type": "application/json" }, status: 500 }
      );
    }

    const birthdayToday = (dobRows || []).filter((row) => {
      const dob = new Date(row.date_of_birth);
      return dob.getUTCMonth() + 1 === todayMonth && dob.getUTCDate() === todayDay;
    });

    let celebratedCount = 0;
    for (const row of birthdayToday) {
      const { error: rpcError } = await supabase.rpc("send_birthday_celebration_atomic", {
        p_employee_id: row.employee_id
      });
      if (!rpcError) celebratedCount++;
    }

    return new Response(
      JSON.stringify({ success: true, checkedCount: birthdayToday.length, celebratedCount }),
      { headers: { "Content-Type": "application/json" } }
    );

  } catch (err) {

    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { headers: { "Content-Type": "application/json" }, status: 500 }
    );

  }
}, { heartbeat: true }));
