import { createClient } from "@supabase/supabase-js";

// Single owner for "actually create the employee account from a
// candidate" -- used by both the legacy direct-conversion route
// (app/api/convert-candidate-to-employee) and the new Super-Admin
// approval route (app/api/review-employee-creation-request). Keeping
// this in one place means the legacy route's behavior stays exactly
// unchanged (still a thin wrapper around this), while the new approval
// path reuses the identical, already-proven creation logic instead of
// a second copy that could drift.
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
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

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
