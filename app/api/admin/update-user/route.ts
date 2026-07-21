import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {

  try {

    const {
      auth_user_id,
      email,
      password
    } = await req.json();

    if (!auth_user_id) {
      return NextResponse.json(
        { error: "User ID missing" },
        { status: 400 }
      );
    }

    const updateData: any = {};

    if (email && email.trim() !== "") {
      updateData.email = email.trim();
    }

    if (password && password.trim() !== "") {
      updateData.password = password.trim();
    }

    const { error } =
      await supabaseAdmin.auth.admin.updateUserById(
        auth_user_id,
        updateData
      );

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    if (email) {

      await supabaseAdmin
        .from("employees")
        .update({
          email: email.trim()
        })
        .eq("auth_user_id", auth_user_id);

    }

    return NextResponse.json({
      success: true,
      message: "Credentials updated successfully"
    });

  } catch (err: any) {

    return NextResponse.json(
      {
        error: err.message
      },
      {
        status: 500
      }
    );

  }

}