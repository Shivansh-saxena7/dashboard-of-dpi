// @ts-nocheck

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Resolves the CALLING employee's own id from their verified Supabase
// session JWT (the Authorization header) — never from a client-
// supplied employee_id in the request body, which could be tampered
// with to act on someone else's attendance record. One
// implementation, reused by every Edge Function that needs to know
// "which employee is calling me" (start-shift, end-shift, and future
// ones) — same one-owner principle as everything else in this
// project, instead of each function re-deriving this itself.
//
// Returns { employeeId } on success, or { errorResponse } (a ready-
// to-return Response, CORS headers already included) on failure.
// Callers do:
//   const auth = await resolveCallingEmployeeId(req, supabase, corsHeaders);
//   if (auth.errorResponse) return auth.errorResponse;
//   const employeeId = auth.employeeId;
export async function resolveCallingEmployeeId(
  req: Request,
  serviceRoleClient: any,
  corsHeaders: Record<string, string>
) {

  const authHeader = req.headers.get("Authorization");

  if (!authHeader) {
    return {
      errorResponse: new Response(
        JSON.stringify({
          success: false,
          message: "Missing authorization header"
        }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      )
    };
  }

  // Client scoped to the caller's own JWT — auth.getUser() both
  // validates the token and tells us who it belongs to.
  const callerClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: userError } = await callerClient.auth.getUser();

  if (userError || !user) {
    return {
      errorResponse: new Response(
        JSON.stringify({
          success: false,
          message: "Invalid or expired session"
        }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      )
    };
  }

  const { data: employee, error: employeeError } = await serviceRoleClient
    .from("employees")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  if (employeeError || !employee) {
    return {
      errorResponse: new Response(
        JSON.stringify({
          success: false,
          message: "No employee record found for this account"
        }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      )
    };
  }

  return { employeeId: employee.id };

}
