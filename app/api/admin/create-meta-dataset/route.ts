import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveAdminCaller } from "@/lib/resolveAdminCaller";

// Calls admin_create_meta_dataset via the service-role client
// (supabaseAdmin) — that RPC's own current_employee_role() check
// would silently no-op (not raise) if called this way without a real
// auth check first, since the service-role client carries no user JWT
// at all (auth.uid() resolves null, not "not an admin"). The REAL
// authorization gate for this route is resolveAdminCaller below;
// the RPC's own check is defense-in-depth for any other caller.
export async function POST(req: Request) {

  const auth = await resolveAdminCaller(req);
  if (auth.errorResponse) return auth.errorResponse;

  try {

    const { label, dataset_id, access_token } = await req.json();

    if (typeof label !== "string" || !label.trim()) {
      return NextResponse.json({ error: "label is required" }, { status: 400 });
    }

    if (typeof dataset_id !== "string" || !dataset_id.trim()) {
      return NextResponse.json({ error: "dataset_id is required" }, { status: 400 });
    }

    if (typeof access_token !== "string" || !access_token.trim()) {
      return NextResponse.json({ error: "access_token is required" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin.rpc("admin_create_meta_dataset", {
      p_label: label.trim(),
      p_dataset_id: dataset_id.trim(),
      p_access_token: access_token.trim()
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, id: data });

  } catch (err: any) {

    return NextResponse.json({ error: err.message }, { status: 500 });

  }

}
