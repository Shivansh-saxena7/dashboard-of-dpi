import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Own route, own card on the Settings page — mirrors
// update-sla-office-hours exactly. Only the 6 fields that actual
// Edge Function code (start-shift/end-shift) reads are exposed here;
// shift_day_end_time and start_shift_grace_minutes are DB columns
// with defaults but no consuming code yet, so they're deliberately
// left out (editing them would silently do nothing — misleading).
export async function POST(req: Request) {

  try {

    const {
      first_half_start_time,
      first_half_start_window_end,
      half_day_boundary_time,
      second_half_start_window_end,
      first_half_min_end_time,
      second_half_min_end_time
    } = await req.json();

    const fields = {
      first_half_start_time,
      first_half_start_window_end,
      half_day_boundary_time,
      second_half_start_window_end,
      first_half_min_end_time,
      second_half_min_end_time
    };

    for (const [key, value] of Object.entries(fields)) {
      if (typeof value !== "string" || !value) {
        return NextResponse.json(
          { error: `${key} is required` },
          { status: 400 }
        );
      }
    }

    // Same "start < end" sanity the two window-pairs imply — doesn't
    // fully validate the whole day's ordering (that's a lot of cross-
    // field logic for a settings form), but catches the most obvious
    // mistakes.
    if (first_half_start_time >= first_half_start_window_end) {
      return NextResponse.json(
        { error: "First-Half Start must be before First-Half Start Window End" },
        { status: 400 }
      );
    }

    if (half_day_boundary_time >= second_half_start_window_end) {
      return NextResponse.json(
        { error: "Half-Day Boundary must be before Second-Half Start Window End" },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin
      .from("lead_engine_settings")
      .update(fields)
      .eq("id", 1);

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Shift timing updated successfully"
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
