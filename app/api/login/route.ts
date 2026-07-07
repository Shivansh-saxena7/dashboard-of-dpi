import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const email = body.email;
    const password = body.password;

    if (!email || !password) {
      return NextResponse.json(
        {
          success: false,
          message: "Email and password required",
        },
        { status: 400 }
      );
    }

    // LOGIN
    const { data, error } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      });

    if (error || !data.user) {
      return NextResponse.json(
        {
          success: false,
          message: error?.message || "Login failed",
        },
        { status: 401 }
      );
    }

    // FIND USER IN EMPLOYEES TABLE
    const { data: employee, error: employeeError } =
      await supabase
        .from("employees")
        .select("*")
        .eq(
          "auth_user_id",
          data.user.id
        )
        .single();

    if (employeeError || !employee) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Employee record not found",
        },
        { status: 404 }
      );
    }

    // BLOCK INACTIVE USER
    if (!employee.is_active) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Account disabled",
        },
        { status: 403 }
      );
    }

    // SUCCESS + ROLE
    return NextResponse.json({
      success: true,

      user: data.user,

      session: data.session,

      employee: {
        id: employee.id,
        name: employee.name,
        role: employee.role,
      },
    });

  } catch (error: any) {

    return NextResponse.json(
      {
        success: false,
        message: error.message,
      },
      { status: 500 }
    );

  }
}