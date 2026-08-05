// @ts-nocheck

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.0";
import { calculateAttendanceType } from "../../../lib/calculateAttendanceType.ts";
import { calculateEndShiftWindow } from "../../../lib/calculateEndShiftWindow.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { resolveCallingEmployeeId } from "../_shared/auth.ts";

// Records a voluntary End Shift for the CALLING employee (resolved
// from their own verified session JWT — see _shared/auth.ts — never
// from a client-supplied employee_id), for today. No request body
// fields are required — send {} — since identity comes entirely from
// the Authorization header now.
//
// Deliberately NO geofence check — DPI is real-estate-adjacent and
// employees may legitimately be off-site (site visits, going home
// directly) when their workday ends; the geofence only guards the
// clock-IN moment (see start-shift). Idempotent: once shift_end_at
// is set, calling again just confirms the existing value rather than
// pushing it later.
//
// Time-window gate: End Shift is only allowed after a minimum time
// that depends on which half was started — First-Half shifts after
// first_half_min_end_time, Second-Half shifts after
// second_half_min_end_time (calculateEndShiftWindow). No grace
// window, exact cutoffs, per spec. Checked server-side, authoritative
// — the client only mirrors this for instant UI feedback.
//
// Half-day correction: if the end time falls before
// half_day_boundary_time (e.g. someone started at 10:30 AM expecting
// a full day but stopped at 1:00 PM), attendance_type is corrected
// to HALF_DAY_FIRST in this same call — reusing
// calculateAttendanceType (the same "is this timestamp before the
// boundary" check that decides the start-time classification) rather
// than re-deriving the IST-boundary math a second time. This is a
// single if-condition, not a general reclassification engine —
// HALF_DAY_SECOND rows are never touched here, since their
// classification was already correct at start time.

function respond(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

serve(async (req) => {

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const auth = await resolveCallingEmployeeId(req, supabase, corsHeaders);

    if (auth.errorResponse) {
      return auth.errorResponse;
    }

    const employee_id = auth.employeeId;

    const today = new Date().toISOString().split("T")[0];

    const { data: attendance, error: attendanceError } = await supabase
      .from("attendance")
      .select("id, shift_end_at, attendance_type")
      .eq("employee_id", employee_id)
      .eq("date", today)
      .maybeSingle();

    if (attendanceError) {
      return respond(
        {
          success: false,
          step: "FETCH_ATTENDANCE",
          error: attendanceError.message
        },
        500
      );
    }

    if (!attendance) {
      return respond(
        {
          success: false,
          message: "No shift started today — nothing to end"
        },
        400
      );
    }

    // Idempotent: don't let a second click push the end time later.
    if (attendance.shift_end_at) {
      return respond({
        success: true,
        alreadyEnded: true,
        shiftEndAt: attendance.shift_end_at,
        attendanceType: attendance.attendance_type
      });
    }

    const { data: settings, error: settingsError } = await supabase
      .from("lead_engine_settings")
      .select("half_day_boundary_time, first_half_min_end_time, second_half_min_end_time")
      .eq("id", 1)
      .single();

    if (settingsError || !settings) {
      return respond(
        {
          success: false,
          message: "lead_engine_settings row not found"
        },
        500
      );
    }

    const now = new Date();

    const window = calculateEndShiftWindow(
      now,
      attendance.attendance_type,
      settings.first_half_min_end_time,
      settings.second_half_min_end_time
    );

    if (!window.allowed) {
      return respond({
        success: false,
        message: window.reason
      });
    }

    const updateData: any = {
      shift_end_at: now.toISOString()
    };

    // Only downgrades a FULL_DAY that ended before the boundary —
    // never touches an already-correct HALF_DAY_SECOND row.
    const endedBeforeBoundary =
      calculateAttendanceType(now, settings.half_day_boundary_time) === "FULL_DAY";

    if (attendance.attendance_type === "FULL_DAY" && endedBeforeBoundary) {
      updateData.attendance_type = "HALF_DAY_FIRST";
    }

    const { data: updated, error: updateError } = await supabase
      .from("attendance")
      .update(updateData)
      .eq("id", attendance.id)
      .select()
      .single();

    if (updateError) {
      return respond(
        {
          success: false,
          step: "UPDATE_ATTENDANCE",
          error: updateError.message
        },
        500
      );
    }

    return respond({
      success: true,
      alreadyEnded: false,
      shiftEndAt: updated.shift_end_at,
      attendanceType: updated.attendance_type
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
});
