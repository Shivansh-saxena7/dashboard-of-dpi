import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {

  try {

    const now = new Date();

    const hour = now.getHours();

    // only run after 11 PM
    if (hour < 0) {
      return NextResponse.json({
        success: false,
        message: "Not 11 PM yet",
      });
    }

    const today = now.toISOString().split("T")[0];

    const { data, error } = await supabase
      .from("tracking")
      .select("*")
      .eq("date", today);

    if (error) {
      throw error;
    }

    for (const row of data || []) {

      const igDone =
        String(row["IG Like"] || "").toUpperCase() === "YES";

      const fbDone =
        String(row["FB Like"] || "").toUpperCase() === "YES";

      if (!igDone || !fbDone) {

        await supabase
          .from("tracking")
          .update({
            permanent_missed: true,
          })
          .eq("id", row.id);

      }
    }

    return NextResponse.json({
      success: true,
      updated: data?.length || 0,
    });

  } catch (err) {

    return NextResponse.json({
      success: false,
      error: err,
    });

  }
}