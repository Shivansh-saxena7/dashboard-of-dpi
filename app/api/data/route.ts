import { createClient } from "@supabase/supabase-js";
import { createReportingFetch } from "@/lib/reportingFetch";
import { decideApiDataAccess } from "@/lib/apiDataAccess";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { NextResponse } from "next/server";

// Runs as the caller (their token + the anon key), never with the service_role key: the login is
// checked here and row access stays with the database's own policies. See lib/apiDataAccess.ts.
export async function GET(request: Request) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    return NextResponse.json({ error: "Missing authorization header" }, { status: 401 });
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: authHeader },
      fetch: createReportingFetch({ layer: "API", source: () => "api:data" })
    }
  });

  const { data: { user }, error: userError } = await supabase.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
  if (userError || !user) {
    return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });
  }

  const { data: caller } = await supabase
    .from("employees")
    .select("id, role, is_active")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  const { searchParams } = new URL(request.url);
  const access = decideApiDataAccess(caller, searchParams.get("employeeId"), searchParams.get("date"));
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { data, error } = await fetchAllRows(
    () => {
      let query = supabase
        .from("tracking")
        .select(
          `
    id,
    employee_id,
    ig_done,
    fb_done,
    date,
    employees(name),
    posts(post_number, ig_link, fb_link)
  `,
          { count: "exact" }
        );
      if (access.employeeId) query = query.eq("employee_id", access.employeeId);
      if (access.date) query = query.eq("date", access.date);
      return query.order("date", { ascending: false }).order("id");
    },
    { anomalyContext: { supabase, source: "api:data" } }
  );

  if (error) {
    return NextResponse.json({ error: "Could not load tracking data" }, { status: 500 });
  }

  const formatted = (data || []).map((row: any) => ({
    id: row.id,
    employee_id: row.employee_id,
    Date: row.date,
    "Post ID": `${row.date}-P${row.posts.post_number}`,
    "IG Link": row.posts.ig_link,
    "FB Link": row.posts.fb_link,
    Employee: row.employees.name,
    "IG Like": row.ig_done ? "YES" : "NO",
    "FB Like": row.fb_done ? "YES" : "NO",
  }));

  return NextResponse.json(formatted);
}
