// @ts-nocheck

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createMonitoredClient, withMonitoring } from "../_shared/monitoring.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.0";
import { calculateGeofenceStatus } from "../../../lib/calculateGeofenceStatus.ts";
import { calculateStartShiftWindow } from "../../../lib/calculateStartShiftWindow.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { resolveCallingEmployeeId } from "../_shared/auth.ts";
import { loadJobWorkingCalendar, shiftStartBlock } from "../../../lib/workingCalendar.ts";
import { logAnomaly } from "../../../lib/logAnomaly.ts";


// Records a successful Start Shift for the CALLING employee (resolved
// from their own verified session JWT — see _shared/auth.ts — never
// from a client-supplied employee_id), for today. Idempotent —
// calling it again the same day (e.g. on refresh) just confirms the
// existing shift rather than erroring.
//
// Two independent gates, both server-side authoritative (the client
// only mirrors them for instant UI feedback — never trusted):
//   1. Time window — Start Shift is only allowed inside the
//      First-Half or Second-Half start windows (calculateStartShiftWindow).
//      Checked first since it's cheap and doesn't need location.
//   2. Geofence — must be physically at/near the office
//      (calculateGeofenceStatus). Failed attempts on either gate are
//      not written to the DB — just an error response back to the
//      client.
//
// attendance_type is decided directly by WHICH window matched
// (First-Half -> FULL_DAY, Second-Half -> HALF_DAY_SECOND) — no
// separate boundary comparison needed now that start eligibility
// itself is gated to those two windows.

function respond(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

serve(withMonitoring("start-shift", async (req) => {

  // Preflight — must be answered before anything else, and before
  // touching req.json() (an OPTIONS request has no body).
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {

    // accuracy is optional (older cached clients may not send it yet)
    // and purely diagnostic — never affects whether the gate passes,
    // only what the rejection message says, so a genuinely-far-away
    // employee with a great GPS lock can't talk their way past this by
    // claiming bad accuracy.
    const { lat, lng, accuracy } = await req.json();

    if (typeof lat !== "number" || typeof lng !== "number") {
      return respond(
        {
          success: false,
          message: "lat and lng are required"
        },
        400
      );
    }

    const supabase = createMonitoredClient("start-shift");

    // Perf (2026-10-01): auth resolution (JWT verify + employees
    // lookup, 2 round trips internally) and the settings fetch don't
    // depend on each other -- settings is keyed on id=1, not on who's
    // calling -- so they run concurrently instead of back-to-back.
    // is_field_employee now comes back from resolveCallingEmployeeId
    // itself (see _shared/auth.ts), removing what used to be a THIRD,
    // separate employees lookup for the exact same row. Net: 3 serial
    // round trips collapsed to effectively 2 before the existing-
    // attendance check.
    const [auth, settingsResult] = await Promise.all([
      resolveCallingEmployeeId(req, supabase, corsHeaders),
      supabase.from("lead_engine_settings").select("*").eq("id", 1).single()
    ]);

    if (auth.errorResponse) {
      return auth.errorResponse;
    }

    const employee_id = auth.employeeId;
    const isFieldEmployee = auth.isFieldEmployee;

    const { data: settings, error: settingsError } = settingsResult;

    if (settingsError || !settings) {
      return respond(
        {
          success: false,
          message: "lead_engine_settings row not found"
        },
        500
      );
    }

    if (settings.office_lat === null || settings.office_lng === null) {
      return respond(
        {
          success: false,
          message: "Office location has not been configured yet — ask Admin to set it in Settings"
        },
        400
      );
    }

    const today = new Date().toISOString().split("T")[0];

    // Idempotent: if today's shift is already started, confirm it
    // instead of erroring (e.g. the employee refreshes the page) —
    // deliberately checked before the time-window gate, so someone
    // who started inside the window can still get a success response
    // even if they reload the page after the window has closed.
    const { data: existing, error: existingError } = await supabase
      .from("attendance")
      .select("id, shift_start_at")
      .eq("employee_id", employee_id)
      .eq("date", today)
      .maybeSingle();

    if (existingError) {
      return respond(
        {
          success: false,
          step: "CHECK_EXISTING_ATTENDANCE",
          error: existingError.message
        },
        500
      );
    }

    if (existing) {
      return respond({
        success: true,
        alreadyStarted: true,
        shiftStartAt: existing.shift_start_at
      });
    }

    // Non-working-day gate (2026-10-08). Only with the working-days switch
    // ON: on the weekly off (lead_engine_settings.sla_weekly_off_day — never
    // hardcoded) or an Admin HOLIDAY range (not a TIMER_PAUSE — see
    // shiftStartBlock) Start Shift is refused unless Admin granted an
    // override for today (shift_day_overrides: this employee, or everyone). If the
    // calendar can't be loaded the shift is ALLOWED (fail-open — an infra
    // glitch must never stop everyone working; the sweep already rests on
    // non-working days) and a warning is logged.
    const calendarLoad = await loadJobWorkingCalendar(
      supabase,
      async () => settings.working_days_timers_enabled === true,
      (message, context) => logAnomaly(supabase, { source: "start-shift:working-calendar", severity: "warning", message, context })
    );
    if (calendarLoad.skipTimerWork) {
      await logAnomaly(supabase, {
        source: "start-shift:working-calendar",
        severity: "warning",
        message: "Working calendar failed to load with the switch ON; weekly-off check skipped, shift allowed",
        context: { error: calendarLoad.error, employee_id }
      });
    } else {
      const gate = shiftStartBlock(calendarLoad.calendar, Date.now(), { hasOverride: false });
      if (gate.blocked) {
        const { data: override, error: overrideError } = await supabase
          .from("shift_day_overrides")
          .select("id")
          .eq("work_date", today)
          .is("cancelled_at", null)
          .or(`employee_id.is.null,employee_id.eq.${employee_id}`)
          .limit(1)
          .maybeSingle();
        if (overrideError) {
          return respond({ success: false, step: "CHECK_SHIFT_OVERRIDE", error: overrideError.message }, 500);
        }
        if (!override) {
          return respond({ success: false, step: "NON_WORKING_DAY", kind: gate.kind, until: gate.until, message: gate.message });
        }
      }
    }

    const now = new Date();

    const window = calculateStartShiftWindow(now, {
      firstHalfStartTime: settings.first_half_start_time,
      firstHalfStartWindowEnd: settings.first_half_start_window_end,
      secondHalfStartWindowStart: settings.half_day_boundary_time,
      secondHalfStartWindowEnd: settings.second_half_start_window_end
    });

    if (!window.allowed) {
      return respond({
        success: false,
        message: window.reason
      });
    }

    // Field-Employee exemption — skips the geofence check entirely for
    // a flagged employee; everyone else goes through it exactly as
    // before. Not just "always pass" — genuinely never evaluated, so
    // no distance/accuracy computation happens for this employee at
    // all.
    //
    // distanceMeters is declared here, outside the if block (2026-10-05):
    // `geofence` only exists inside the block, so the success response
    // below used to throw "geofence is not defined" AFTER the attendance
    // row was saved — every first Start Shift tap showed an error even
    // though the shift had started. Field employees get null.
    let distanceMeters: number | null = null;

    if (!isFieldEmployee) {
      const geofence = calculateGeofenceStatus(
        lat,
        lng,
        settings.office_lat,
        settings.office_lng,
        settings.geofence_radius_meters
      );

      distanceMeters = Math.round(geofence.distanceMeters);

      if (!geofence.withinGeofence) {
        const roundedAccuracy = typeof accuracy === "number" ? Math.round(accuracy) : null;
        // >50m accuracy is a real, common signal for "Approximate" (not
        // "Precise") location permission on iOS 14+/Android 12+, which
        // deliberately fuzzes the coordinate — surfaced here so an
        // employee genuinely at the office has something actionable to
        // check, instead of a flatly confusing "you're 44m away".
        const accuracyNote =
          roundedAccuracy !== null && roundedAccuracy > 50
            ? ` Your device reported ±${roundedAccuracy}m location accuracy — if you're actually at the office, check that Precise/Exact Location is enabled for this site in your phone's location settings.`
            : "";
        return respond({
          success: false,
          withinGeofence: false,
          distanceMeters: Math.round(geofence.distanceMeters),
          accuracyMeters: roundedAccuracy,
          message: `You are ${Math.round(geofence.distanceMeters)}m from the office — must be within ${settings.geofence_radius_meters}m to start your shift.${accuracyNote}`
        });
      }
    }

    const attendanceType = window.half === "FIRST" ? "FULL_DAY" : "HALF_DAY_SECOND";

    const { data: inserted, error: insertError } = await supabase
      .from("attendance")
      .insert({
        employee_id,
        date: today,
        shift_start_at: now.toISOString(),
        shift_start_lat: lat,
        shift_start_lng: lng,
        // null (not true) for an exempted employee — true would
        // misrepresent "the check ran and passed" when it never ran
        // at all; null keeps that genuinely distinguishable in
        // reporting from a real, evaluated pass.
        geofence_pass: isFieldEmployee ? null : true,
        attendance_type: attendanceType
      })
      .select()
      .single();

    if (insertError) {

      // Unique violation on (employee_id, date) means a concurrent
      // request already started today's shift — treat as success
      // rather than surfacing a race condition to the user.
      if (insertError.code === "23505") {
        return respond({
          success: true,
          alreadyStarted: true
        });
      }

      return respond(
        {
          success: false,
          step: "INSERT_ATTENDANCE",
          error: insertError.message
        },
        500
      );
    }

    return respond({
      success: true,
      alreadyStarted: false,
      shiftStartAt: inserted.shift_start_at,
      attendanceType: inserted.attendance_type,
      distanceMeters
    });

  } catch (err) {

    return respond(
      {
        success: false,
        error: err.message
      },
      500
    );

  }
}));
