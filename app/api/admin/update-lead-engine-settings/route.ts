import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {

  try {

    const {
      office_lat,
      office_lng,
      geofence_radius_meters
    } = await req.json();

    if (
      typeof office_lat !== "number" ||
      typeof office_lng !== "number" ||
      typeof geofence_radius_meters !== "number"
    ) {
      return NextResponse.json(
        { error: "office_lat, office_lng, and geofence_radius_meters are required numbers" },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin
      .from("lead_engine_settings")
      .update({
        office_lat,
        office_lng,
        geofence_radius_meters
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
      message: "Geofence settings updated successfully"
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
