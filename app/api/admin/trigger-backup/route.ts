import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Manual "Trigger Now" for the nightly Google Sheets disaster-recovery
// backup (backup-to-google-sheets) — that Edge Function was built to be
// invoked ONLY by pg_cron (see its own top-of-file comment: "no CORS,
// no caller-identity resolution, a system job never invoked from the
// browser") and has zero caller-role check of its own, relying entirely
// on the service-role key it's invoked with. Calling it directly from
// the browser via supabase.functions.invoke() would attach whichever
// employee is logged in's own session JWT — that passes Supabase's
// default verify_jwt gate (any valid JWT, not a specific role), which
// would let ANY logged-in employee trigger it, not just Admin, and
// the function would still run with its own full service-role
// privileges internally regardless of who called it.
//
// Deliberately breaks from this codebase's typical no-auth-check
// app/api/* convention (same reasoning, same two-client shape as
// app/api/hr-documents/view-url/route.ts): an anon-key client
// configured with the caller's own bearer token resolves who's
// actually asking and checks their role via employees' own
// employees_select_own RLS, entirely separate from the service-role
// key (server-side only, never sent to the browser) used to invoke
// the Edge Function itself only after that check passes.
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const callerClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: authHeader } }
  });

  const {
    data: { user },
    error: userError
  } = await callerClient.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Invalid session." }, { status: 401 });
  }

  const { data: employee, error: employeeError } = await callerClient
    .from("employees")
    .select("role, is_active")
    .eq("auth_user_id", user.id)
    .single();

  if (employeeError || !employee || !employee.is_active || employee.role !== "admin") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/backup-to-google-sheets`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json"
    }
  });

  const body = await res.json();
  return NextResponse.json(body, { status: res.status });
}
