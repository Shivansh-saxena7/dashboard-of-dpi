import { createClient } from "@supabase/supabase-js";
import { createReportingFetch } from "@/lib/reportingFetch";

// Single owner for "actually create the employee account from a
// candidate", called by the Super-Admin approval route
// (app/api/review-employee-creation-request) once a request is
// approved. Used to also back a direct-conversion route with no
// approval step; that route was removed once the approval flow was
// confirmed working end-to-end on live production with a real
// candidate.
export async function performCandidateConversion({
  candidateId,
  email,
  password,
  role,
  department
}: {
  candidateId: string;
  email: string;
  password: string;
  role?: string;
  department?: string;
}): Promise<{ success: boolean; message: string; employeeId?: string }> {
  const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  global: { fetch: createReportingFetch({ layer: "API", source: () => "api:convertCandidateToEmployee" }) }
});

  const { data: userData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });

  if (authError) {
    return { success: false, message: authError.message };
  }

  if (!userData || !userData.user || !userData.user.id) {
    return { success: false, message: "Auth account creation failed unexpectedly - no user ID returned." };
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
    // converted) -- clean it up rather than leave a dangling Auth user
    // with no employees row, which would also block a retry with the
    // same email ("already registered").
    await supabaseAdmin.auth.admin.deleteUser(authUserId);
    return { success: false, message: conversionError.message };
  }

  return { success: true, message: "Candidate converted to employee", employeeId: newEmployeeId as string };
}
