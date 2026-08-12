import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Own route (not folded into update-lead-engine-settings) — separate
// concern from the geofence card above it on the Settings page, own
// Save button, own owner. Values are "HH:MM" from <input type="time">;
// Postgres's `time` column accepts that directly, no reformatting
// needed.
export async function POST(req: Request) {

  try {

    const {
      sla_office_start_time,
      sla_office_end_time,
      sla_weekly_off_day
    } = await req.json();

    if (
      typeof sla_office_start_time !== "string" ||
      typeof sla_office_end_time !== "string" ||
      !sla_office_start_time ||
      !sla_office_end_time
    ) {
      return NextResponse.json(
        { error: "sla_office_start_time and sla_office_end_time are required" },
        { status: 400 }
      );
    }

    if (sla_office_start_time >= sla_office_end_time) {
      return NextResponse.json(
        { error: "Office start time must be before office end time" },
        { status: 400 }
      );
    }

    if (
      typeof sla_weekly_off_day !== "number" ||
      !Number.isInteger(sla_weekly_off_day) ||
      sla_weekly_off_day < 0 ||
      sla_weekly_off_day > 6
    ) {
      return NextResponse.json(
        { error: "sla_weekly_off_day must be an integer 0-6 (0=Sunday ... 6=Saturday)" },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin
      .from("lead_engine_settings")
      .update({
        sla_office_start_time,
        sla_office_end_time,
        sla_weekly_off_day
      })
      .eq("id", 1);

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "SLA office-hours updated successfully"
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
