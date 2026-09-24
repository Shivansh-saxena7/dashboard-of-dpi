import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Companion to convert_candidate_to_employee_atomic (2026-09-24) —
// mirrors app/api/create-employee/route.ts's exact shape, since this
// is genuinely the same operation (create a real employee account),
// just pre-filled from a candidate record instead of a blank form.
// The RPC alone can't do this end-to-end: creating a real Supabase
// Auth account needs the Auth Admin API, which only server-side code
// with the service-role key can reach — a plain SQL RPC has no path
// to it. So this route does the two-step dance: create the Auth user
// here, then hand its id to the RPC for the data-side conversion.
//
// Same no-server-side-caller-check posture as create-employee and
// every other /api/admin/* route in this project (confirmed, not
// assumed — see that file). Left consistent with the existing
// project-wide pattern rather than inventing a stricter model for
// just this one route; the underlying RPC's own admin/hr gate is
// also a no-op when called with the service-role key (auth.uid()
// resolves null, so current_employee_role() does too) — same as any
// other RPC called this way. Worth knowing, not silently fixed here.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { candidateId, email, password, role, department } = body;

    if (!candidateId || !email || !password) {
      return NextResponse.json(
        { success: false, message: "candidateId, email, and password are required" },
        { status: 400 }
      );
    }

    const { data: userData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });

    if (authError) {
      return NextResponse.json({ success: false, message: authError.message }, { status: 400 });
    }

    if (!userData || !userData.user || !userData.user.id) {
      return NextResponse.json(
        { success: false, message: "Auth account creation failed unexpectedly - no user ID returned." },
        { status: 500 }
      );
    }

    const authUserId = userData.user.id;

    const { data: newEmployeeId, error: conversionError } = await supabaseAdmin.rpc(
      "convert_candidate_to_employee_atomic",
      {
        p_candidate_id: candidateId,
        p_auth_user_id: authUserId,
        p_email: email,
        p_role: role || "employee",
        p_department: department || "sales"
      }
    );

    if (conversionError) {
      // The Auth account exists but conversion failed (e.g. already
      // converted) -- clean it up rather than leave a dangling Auth
      // user with no employees row, which would also block a retry
      // with the same email ("already registered").
      await supabaseAdmin.auth.admin.deleteUser(authUserId);

      return NextResponse.json({ success: false, message: conversionError.message }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      message: "Candidate converted to employee",
      employeeId: newEmployeeId
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
