import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Own route, same pattern as update-sla-office-hours — one concern,
// one Save button. work_report_whatsapp_group_label is purely a
// descriptive on-screen reminder shown in WorkReportView ("Post this
// in: <label>") — NOT a real link target. WhatsApp's own web scheme
// has no mechanism to pre-target a specific group with pre-filled
// text (only a 1:1 wa.me/<number> chat can be pre-targeted) — see
// WorkReportView.tsx's own comment on this. Nullable/optional by
// design: an empty string clears the reminder entirely.
export async function POST(req: Request) {

  try {

    const { work_report_whatsapp_group_label } = await req.json();

    if (typeof work_report_whatsapp_group_label !== "string") {
      return NextResponse.json(
        { error: "work_report_whatsapp_group_label must be a string" },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin
      .from("lead_engine_settings")
      .update({
        work_report_whatsapp_group_label: work_report_whatsapp_group_label.trim() || null
      })
      .eq("id", 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: "Work Report settings updated successfully"
    });

  } catch (err: any) {

    return NextResponse.json({ error: err.message }, { status: 500 });

  }

}
