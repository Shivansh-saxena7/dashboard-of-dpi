import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveAdminCaller } from "@/lib/resolveAdminCaller";

// dataset_row_id (our meta_datasets.id, a uuid) — deliberately NOT
// named dataset_id here, to avoid confusion with Meta's own Dataset ID
// text string (the field create-meta-dataset/route.ts calls
// dataset_id). Two different things, kept unambiguously named.
export async function POST(req: Request) {

  const auth = await resolveAdminCaller(req);
  if (auth.errorResponse) return auth.errorResponse;

  try {

    const { dataset_row_id, access_token } = await req.json();

    if (typeof dataset_row_id !== "string" || !dataset_row_id.trim()) {
      return NextResponse.json({ error: "dataset_row_id is required" }, { status: 400 });
    }

    if (typeof access_token !== "string" || !access_token.trim()) {
      return NextResponse.json({ error: "access_token is required" }, { status: 400 });
    }

    const { error } = await supabaseAdmin.rpc("admin_rotate_meta_dataset_token", {
      p_dataset_id: dataset_row_id.trim(),
      p_new_access_token: access_token.trim()
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });

  } catch (err: any) {

    return NextResponse.json({ error: err.message }, { status: 500 });

  }

}
