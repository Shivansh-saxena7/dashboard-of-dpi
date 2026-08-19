import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "./supabaseAdmin";

// Next.js API-route counterpart to supabase/functions/_shared/auth.ts's
// resolveCallingEmployeeId — same verification concept (validate the
// caller's own JWT, never trust a client-supplied id), ported to this
// runtime because no equivalent existed here. Every OTHER existing
// admin API route in this codebase (update-sla-office-hours,
// update-work-report-settings, update-user, create-employee) has zero
// server-side auth check at all — a real, pre-existing gap, out of
// scope to fix broadly here, but not one to repeat in new routes that
// create/rotate an actual Meta access token. Additionally checks
// role === 'admin' (the Edge Function helper only resolves identity;
// each Edge Function caller does its own role check on top, e.g.
// import-leads-csv) — done here too, matching that same two-step shape.
//
// Returns { employeeId } on success, or { errorResponse } (a ready-to-
// return NextResponse) on failure. Callers do:
//   const auth = await resolveAdminCaller(req);
//   if (auth.errorResponse) return auth.errorResponse;
export async function resolveAdminCaller(req: Request) {

  const authHeader = req.headers.get("Authorization");

  if (!authHeader) {
    return {
      errorResponse: NextResponse.json({ error: "Missing authorization header" }, { status: 401 })
    };
  }

  const callerClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: userError } = await callerClient.auth.getUser();

  if (userError || !user) {
    return {
      errorResponse: NextResponse.json({ error: "Invalid or expired session" }, { status: 401 })
    };
  }

  const { data: employee, error: employeeError } = await supabaseAdmin
    .from("employees")
    .select("id, role, is_active")
    .eq("auth_user_id", user.id)
    .single();

  if (employeeError || !employee) {
    return {
      errorResponse: NextResponse.json({ error: "No employee record found for this account" }, { status: 404 })
    };
  }

  if (!employee.is_active || employee.role !== "admin") {
    return {
      errorResponse: NextResponse.json({ error: "Only an active Admin can perform this action" }, { status: 403 })
    };
  }

  return { employeeId: employee.id };
}
