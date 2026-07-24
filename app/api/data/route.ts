import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export async function GET(request: Request) {

  const { searchParams } = new URL(request.url);

  const employeeId = searchParams.get("employeeId");
  const date = searchParams.get("date");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  let query = supabase
  .from("tracking")
  .select(`
    id,
    employee_id,
    ig_done,
    fb_done,
    date,
    employees(name),
    posts(post_number, ig_link, fb_link)
  `);
  

if (employeeId) {
  query = query.eq("employee_id", employeeId);
}
if (date) {
  query = query.eq("date", date);
}

query = query.order("date", { ascending: false });
const { data, error } = await query;


if (error) {
  return NextResponse.json({ error }, { status: 500 });
}

  const formatted = data.map((row: any) => ({
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
//console.log("TRACKING API RESPONSE");
//console.table(formatted);
  return NextResponse.json(formatted);
}