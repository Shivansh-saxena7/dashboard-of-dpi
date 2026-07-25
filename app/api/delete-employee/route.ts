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

    const { error: deleteEmployeeError } = await supabaseAdmin
      .from("employees")
      .delete()
      .eq("id", employeeId);

    if (deleteEmployeeError) {
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