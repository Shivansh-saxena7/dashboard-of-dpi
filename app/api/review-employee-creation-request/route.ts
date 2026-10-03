import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createReportingFetch } from "@/lib/reportingFetch";
import { performCandidateConversion } from "@/lib/convertCandidateToEmployee";

const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  global: { fetch: createReportingFetch({ layer: "API", source: () => "api:review-employee-creation-request" }) }
});

// Approve or reject a pending employee_creation_requests row. Unlike
// most /api/admin/* routes in this project, this one DOES check the
// caller server-side -- approving is literally setting someone's
// initial role/department, the same thing the Super Admin column-lock
// trigger already protects at the DB level, so the same exclusivity
// has to hold here too (the service-role key used below bypasses RLS
// entirely, so without this check anyone able to reach this route
// could approve regardless of their own role).
export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();

    if (!token) {
      return NextResponse.json({ success: false, message: "Not authenticated" }, { status: 401 });
    }

    const {
      data: { user },
      error: userError
    } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json({ success: false, message: "Not authenticated" }, { status: 401 });
    }

    const { data: reviewer } = await supabaseAdmin
      .from("employees")
      .select("id, role")
      .eq("auth_user_id", user.id)
      .single();

    if (!reviewer || reviewer.role !== "super_admin") {
      return NextResponse.json(
        { success: false, message: "Only Super Admin can review employee creation requests." },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { requestId, action, password, rejectionReason } = body;

    if (!requestId || (action !== "APPROVE" && action !== "REJECT")) {
      return NextResponse.json(
        { success: false, message: "requestId and a valid action (APPROVE/REJECT) are required" },
        { status: 400 }
      );
    }

    const { data: reqRow, error: reqError } = await supabaseAdmin
      .from("employee_creation_requests")
      .select("*")
      .eq("id", requestId)
      .single();

    if (reqError || !reqRow) {
      return NextResponse.json({ success: false, message: "Request not found" }, { status: 404 });
    }

    if (reqRow.status !== "PENDING") {
      return NextResponse.json(
        { success: false, message: `This request is already ${reqRow.status}.` },
        { status: 400 }
      );
    }

    if (action === "REJECT") {
      await supabaseAdmin
        .from("employee_creation_requests")
        .update({
          status: "REJECTED",
          reviewed_by: reviewer.id,
          reviewed_at: new Date().toISOString(),
          rejection_reason: rejectionReason || null
        })
        .eq("id", requestId);

      return NextResponse.json({ success: true, message: "Request rejected" });
    }

    // action === "APPROVE"
    if (!password || String(password).length < 6) {
      return NextResponse.json(
        { success: false, message: "A temporary password (6+ characters) is required to approve." },
        { status: 400 }
      );
    }

    const result = await performCandidateConversion({
      candidateId: reqRow.candidate_id,
      email: reqRow.email,
      password,
      role: reqRow.role,
      department: reqRow.department
    });

    if (!result.success) {
      // Request stays PENDING -- nothing was created, Super Admin can
      // retry (e.g. the email was already registered elsewhere).
      return NextResponse.json({ success: false, message: result.message }, { status: 400 });
    }

    await supabaseAdmin
      .from("employee_creation_requests")
      .update({
        status: "APPROVED",
        reviewed_by: reviewer.id,
        reviewed_at: new Date().toISOString(),
        resulting_employee_id: result.employeeId
      })
      .eq("id", requestId);

    return NextResponse.json({ success: true, message: "Employee account created", employeeId: result.employeeId });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
