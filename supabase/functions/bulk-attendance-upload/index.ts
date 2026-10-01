// @ts-nocheck

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.0";
import { corsHeaders } from "../_shared/cors.ts";
import { resolveCallingEmployeeId } from "../_shared/auth.ts";
import { timeStringToMinutes } from "../../../lib/istTime.ts";

// Bulk Attendance Upload — Payroll/HR/Admin-only. Writes into the SAME
// `attendance` table the GPS start-shift/end-shift flow already writes
// (attendance_type 'LEAVE'/'HALF_DAY_MANUAL' and source='BULK_UPLOAD'
// are the only new values here, both impossible from the GPS flow —
// see lib/calculateHrmsAttendanceStatus.ts/lib/computePayrollAdjustments.ts
// for how Compute reads them). No new Compute path, no second
// pagination/duplicate-check implementation — same server-side-
// re-validates-everything posture as import-leads-csv, the
// established pattern for this repo's bulk-upload Edge Functions.

const VALID_CODES = new Set(["P", "A", "HD", "WO", "L"]);

function respond(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

// Builds the UTC instant for a given "YYYY-MM-DD" date at a given
// "HH:MM:SS" IST wall-clock time — the inverse of
// lib/istTime.ts's toISTMinutesSinceMidnight, needed here because a
// bulk-uploaded row has no real punch to derive shift_start_at from.
function buildISTTimestamp(dateStr: string, hhmmss: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const totalMinutes = timeStringToMinutes(hhmmss);
  const hh = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;
  const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
  const utcMs = Date.UTC(y, m - 1, d, hh, mm, 0) - IST_OFFSET_MS;
  return new Date(utcMs).toISOString();
}

function daysInMonth(yyyyMm: string): number {
  const [y, m] = yyyyMm.split("-").map(Number);
  return new Date(y, m, 0).getDate();
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
    if (auth.errorResponse) return auth.errorResponse;

    const { data: callerEmployee, error: callerEmployeeError } = await supabase
      .from("employees")
      .select("role")
      .eq("id", auth.employeeId)
      .single();

    if (callerEmployeeError || !callerEmployee) {
      return respond({ success: false, message: "Employee record not found" }, 404);
    }

    if (!["admin", "hr", "payroll"].includes(callerEmployee.role)) {
      return respond({ success: false, message: "Only Admin, HR, or Payroll can upload attendance" }, 403);
    }

    const { pay_period, rows, filename } = await req.json();

    if (typeof pay_period !== "string" || !/^\d{4}-\d{2}$/.test(pay_period)) {
      return respond({ success: false, message: "pay_period must be YYYY-MM" }, 400);
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      return respond({ success: false, message: "No rows to import" }, 400);
    }

    const lastDay = daysInMonth(pay_period);
    const minDate = `${pay_period}-01`;
    const maxDate = `${pay_period}-${String(lastDay).padStart(2, "0")}`;

    // --- Load the employee_code -> {employee_id, is_active} map once ---
    const { data: payrollRows, error: payrollError } = await supabase
      .from("employee_payroll_details")
      .select("employee_id, employee_code, employee:employees!employee_payroll_details_employee_id_fkey(is_active)");

    if (payrollError) {
      return respond({ success: false, step: "FETCH_EMPLOYEE_CODES", error: payrollError.message }, 500);
    }

    const codeMap = new Map(
      (payrollRows || [])
        .filter((r) => r.employee_code && r.employee_code.trim())
        .map((r) => [r.employee_code.trim().toLowerCase(), { employeeId: r.employee_id, isActive: !!r.employee?.is_active }])
    );

    const { data: settingsRow } = await supabase
      .from("lead_engine_settings")
      .select("sla_weekly_off_day")
      .eq("id", 1)
      .single();
    const weeklyOffDay = settingsRow?.sla_weekly_off_day ?? 0;

    const { data: hrmsSettings, error: hrmsSettingsError } = await supabase
      .from("hrms_settings")
      .select("first_half_ontime_cutoff")
      .eq("id", 1)
      .single();

    if (hrmsSettingsError || !hrmsSettings) {
      return respond({ success: false, step: "FETCH_HRMS_SETTINGS", error: hrmsSettingsError?.message || "hrms_settings not found" }, 500);
    }

    // --- Validate everything first — nothing is written until every
    // row/cell in the whole upload is clean (same spirit as the client
    // preview step, re-done here server-side since a direct API call
    // can't be trusted to have gone through that preview). ---
    const errors: { employeeCode: string; date: string; message: string }[] = [];
    const warnings: { employeeCode: string; date: string; message: string }[] = [];
    const plan: { employeeId: string; date: string; code: string }[] = [];
    let totalRows = 0;

    for (const row of rows) {
      const rawCode = typeof row.employee_code === "string" ? row.employee_code.trim() : "";
      totalRows++;

      if (!rawCode) {
        errors.push({ employeeCode: "", date: "", message: "Missing Employee Code" });
        continue;
      }

      const match = codeMap.get(rawCode.toLowerCase());
      if (!match) {
        errors.push({ employeeCode: rawCode, date: "", message: "Employee Code not found" });
        continue;
      }
      if (!match.isActive) {
        errors.push({ employeeCode: rawCode, date: "", message: "Employee is not active" });
        continue;
      }

      const days = row.days && typeof row.days === "object" ? row.days : {};

      for (let d = 1; d <= lastDay; d++) {
        const dateStr = `${pay_period}-${String(d).padStart(2, "0")}`;
        const rawVal = days[dateStr];
        const val = typeof rawVal === "string" ? rawVal.trim().toUpperCase() : "";

        if (!val) {
          errors.push({ employeeCode: rawCode, date: dateStr, message: "Missing status for this day" });
          continue;
        }

        if (!VALID_CODES.has(val)) {
          errors.push({ employeeCode: rawCode, date: dateStr, message: `Invalid status code "${rawVal}"` });
          continue;
        }

        if (val === "WO") {
          const weekday = new Date(pay_period.split("-")[0] * 1, pay_period.split("-")[1] * 1 - 1, d).getDay();
          if (weekday !== weeklyOffDay) {
            warnings.push({ employeeCode: rawCode, date: dateStr, message: "Marked Week-Off but this isn't the configured weekly-off day" });
          }
        }

        plan.push({ employeeId: match.employeeId, date: dateStr, code: val });
      }
    }

    if (errors.length > 0) {
      return respond({ success: false, errors, warnings, totalRows, errorRows: errors.length }, 400);
    }

    // --- All clean — write for real ---
    const onTimeAt = (dateStr: string) => buildISTTimestamp(dateStr, hrmsSettings.first_half_ontime_cutoff);

    const upserts = plan
      .filter((p) => p.code === "P" || p.code === "HD" || p.code === "L")
      .map((p) => ({
        employee_id: p.employeeId,
        date: p.date,
        attendance_type: p.code === "P" ? "FULL_DAY" : p.code === "HD" ? "HALF_DAY_MANUAL" : "LEAVE",
        source: "BULK_UPLOAD",
        shift_start_lat: null,
        shift_start_lng: null,
        geofence_pass: null,
        shift_start_at: onTimeAt(p.date)
      }));

    const deletions = plan.filter((p) => p.code === "A" || p.code === "WO");

    if (upserts.length > 0) {
      const { error: upsertError } = await supabase
        .from("attendance")
        .upsert(upserts, { onConflict: "employee_id,date" });

      if (upsertError) {
        return respond({ success: false, step: "UPSERT_ATTENDANCE", error: upsertError.message }, 500);
      }
    }

    // Deletes are per-row (no composite .in() for (employee_id,date)
    // pairs in supabase-js) — fine at this volume (one upload = one
    // month for however many employees the template covers, not a
    // high-frequency path).
    for (const del of deletions) {
      const { error: deleteError } = await supabase
        .from("attendance")
        .delete()
        .eq("employee_id", del.employeeId)
        .eq("date", del.date);

      if (deleteError) {
        return respond({ success: false, step: "DELETE_ATTENDANCE", error: deleteError.message }, 500);
      }
    }

    const employeesAffected = new Set(plan.map((p) => p.employeeId)).size;

    const { error: batchError } = await supabase.from("attendance_upload_batches").insert({
      pay_period: minDate,
      uploaded_by_employee_id: auth.employeeId,
      filename: filename || null,
      total_rows: totalRows,
      valid_rows: totalRows,
      error_rows: 0,
      employees_affected: employeesAffected
    });

    if (batchError) {
      // Non-fatal — the attendance writes already committed; losing
      // this audit row only means this one upload won't show in a
      // future batch-history view (none exists yet).
      console.error("bulk-attendance-upload: batch audit insert failed:", batchError.message);
    }

    return respond({ success: true, totalRows, employeesAffected, warnings });

  } catch (err) {

    console.error("bulk-attendance-upload: unhandled error:", err.message, err.stack);
    return respond({ success: false, error: err.message }, 500);

  }
});
