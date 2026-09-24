import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Deliberately NOT the same shape as this codebase's other app/api/*
// routes (create-employee, delete-employee, data) -- checked all three
// and none of them verify caller identity at all, they trust whatever
// the client sends. That's fine for those (Admin-only actions gated by
// UI, not by this route), but wrong here: this route's entire job is
// deciding whether THIS specific caller may see a private document, so
// it has to actually know who's calling.
//
// Two clients, two different jobs:
// - `callerClient` is built with the ANON key + the caller's own
//   access token attached, so calling the RPC through it makes
//   auth.uid() resolve as the real logged-in user -- get_hr_document_
//   view_path_atomic (SECURITY DEFINER) does the actual authorization
//   check using that identity, exactly the same current_employee_id()/
//   current_employee_role() pattern used everywhere else in this app.
//   No auth logic is reimplemented in JS here.
// - `serviceClient` only ever mints a signed URL, and only after the
//   RPC above has already said yes -- it's never used to bypass that
//   check, only to do the one operation (createSignedUrl on a private
//   bucket) that requires elevated privileges.
export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");

    if (!authHeader) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { documentId } = await req.json();

    if (!documentId) {
      return NextResponse.json({ error: "documentId required" }, { status: 400 });
    }

    const callerClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: storagePath, error: rpcError } = await callerClient.rpc("get_hr_document_view_path_atomic", {
      p_document_id: documentId
    });

    if (rpcError || !storagePath) {
      return NextResponse.json({ error: rpcError?.message || "Not authorized" }, { status: 403 });
    }

    const serviceClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    // 60s -- long enough to load into the canvas viewer, short enough
    // that the URL is useless to anyone by the time it could be shared.
    const { data: signed, error: signError } = await serviceClient.storage
      .from("hr-documents")
      .createSignedUrl(storagePath, 60);

    if (signError || !signed) {
      return NextResponse.json({ error: signError?.message || "Could not generate view link" }, { status: 500 });
    }

    return NextResponse.json({ url: signed.signedUrl });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
