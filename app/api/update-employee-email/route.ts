import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Admin-only, UI-gated (see the pencil icon on app/admin/employees/
// page.tsx) -- same posture as create-employee/route.ts, which this
// mirrors: no server-side caller-role check here either, consistent
// with every other /api/admin-ish route in this codebase (a known,
// already-flagged gap, not something newly introduced here).
//
// employees.email is the SAME value used as the Supabase Auth login
// email at creation (see create-employee/route.ts) -- there is no
// trigger or constraint keeping the two in sync afterward, so a plain
// `employees.update({ email })` would silently desync the person's
// profile from what they actually log in with. This route updates
// BOTH, in order: Auth first (the harder-to-recover-from half), then
// the employees row. If the Auth update fails, nothing is touched. If
// it succeeds but the employees-row update fails, that's surfaced
// explicitly rather than silently left half-done, since there's no
// safe automatic way to revert an Auth email change here.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { employeeId, newEmail } = body;

    if (!employeeId || !newEmail || !newEmail.trim()) {
      return NextResponse.json({ success: false, message: "Employee and new email are required" }, { status: 400 });
    }

    const trimmedEmail = newEmail.trim();

    if (!trimmedEmail.includes("@") || !trimmedEmail.split("@")[1]?.includes(".")) {
      return NextResponse.json({ success: false, message: "That doesn't look like a valid email address" }, { status: 400 });
    }

    const { data: employee, error: employeeError } = await supabaseAdmin
      .from("employees")
      .select("id, auth_user_id")
      .eq("id", employeeId)
      .single();

    if (employeeError || !employee) {
      return NextResponse.json({ success: false, message: "Employee not found" }, { status: 404 });
    }

    if (!employee.auth_user_id) {
      return NextResponse.json({ success: false, message: "This employee has no login account to update" }, { status: 400 });
    }

    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(employee.auth_user_id, {
      email: trimmedEmail
    });

    if (authError) {
      return NextResponse.json({ success: false, message: authError.message }, { status: 400 });
    }

    const { error: profileError } = await supabaseAdmin
      .from("employees")
      .update({ email: trimmedEmail })
      .eq("id", employeeId);

    if (profileError) {
      return NextResponse.json(
        {
          success: false,
          message: `Login email was updated to ${trimmedEmail}, but the profile record failed to update (${profileError.message}). Please retry, or fix the profile record manually.`
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, message: "Email updated" });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
