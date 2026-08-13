import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { employeeId } = body;

    if (!employeeId) {
      return NextResponse.json(
        { success: false, message: "Employee ID required" },
        { status: 400 }
      );
    }

    const { data: employee, error: fetchError } = await supabaseAdmin
      .from("employees")
      .select("auth_user_id")
      .eq("id", employeeId)
      .single();

    if (fetchError || !employee) {
      return NextResponse.json(
        { success: false, message: "Employee not found" },
        { status: 404 }
      );
    }

    // Pre-check — every V2 table with an employee_id-style FK uses
    // Postgres's default ON DELETE NO ACTION (confirmed via a full
    // V1-compatibility audit: leads, lead_history, site_visits,
    // attendance, tickets, and ~15 more), so deleting an employee with
    // any real history used to just fail with a raw Postgres foreign-
    // key-violation error. This checks the 3 tables that actually have
    // real data for real employees (leads owned, visits logged,
    // attendance) and returns a specific, friendly count instead of
    // attempting a delete that's certain to fail. Deactivate (the
    // existing toggle on this same page) is the correct action for an
    // employee with real history — Delete is only meant for a mistaken/
    // empty employee row.
    const { data: blockers, error: blockersError } = await supabaseAdmin
      .rpc("check_employee_deletion_blockers", { p_employee_id: employeeId })
      .single();

    if (blockersError) {
      return NextResponse.json(
        { success: false, message: "Could not check employee history before deleting: " + blockersError.message },
        { status: 500 }
      );
    }

    const { active_leads_count, site_visits_count, attendance_count } = blockers as {
      active_leads_count: number;
      site_visits_count: number;
      attendance_count: number;
    };

    if (active_leads_count > 0 || site_visits_count > 0 || attendance_count > 0) {
      const parts: string[] = [];
      if (active_leads_count > 0) parts.push(`${active_leads_count} active lead${active_leads_count === 1 ? "" : "s"}`);
      if (site_visits_count > 0) parts.push(`${site_visits_count} site visit${site_visits_count === 1 ? "" : "s"}`);
      if (attendance_count > 0) parts.push(`${attendance_count} attendance record${attendance_count === 1 ? "" : "s"}`);

      return NextResponse.json(
        {
          success: false,
          message: `This employee has ${parts.join(", ")} — please Deactivate instead of Delete.`
        },
        { status: 400 }
      );
    }

    const { error: deleteEmployeeError } = await supabaseAdmin
      .from("employees")
      .delete()
      .eq("id", employeeId);

    if (deleteEmployeeError) {
      // Safety net for every OTHER FK-referencing table not covered
      // by the specific pre-check above (tickets, csv_import_batches,
      // lead_snooze_log, team_notes, and ~13 more, all far rarer in
      // practice) — a raw Postgres foreign-key-violation (23503) still
      // never reaches the Admin as a technical error, even if it's a
      // table this route doesn't name individually.
      if (deleteEmployeeError.code === "23503") {
        return NextResponse.json(
          {
            success: false,
            message: "This employee has other related records (e.g. tickets, imports, or notes) — please Deactivate instead of Delete."
          },
          { status: 400 }
        );
      }

      return NextResponse.json(
        { success: false, message: deleteEmployeeError.message },
        { status: 400 }
      );
    }

    if (employee.auth_user_id) {
      const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(
        employee.auth_user_id
      );

      if (deleteAuthError) {
        return NextResponse.json(
          {
            success: false,
            message: "Employee record deleted, but Auth account cleanup failed: " + deleteAuthError.message,
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ success: true, message: "Employee fully deleted" });

  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}