import { NextResponse } from "next/server";
import { performCandidateConversion } from "@/lib/convertCandidateToEmployee";

// Legacy direct-conversion path -- kept reachable, unchanged in
// behavior, as the fallback while the new Super-Admin-approval path
// (app/api/review-employee-creation-request) is being tested on live
// production. Remove this route (and the "legacy" form in
// app/hr/candidates/page.tsx that calls it) once the new path is
// confirmed working end-to-end.
//
// Same no-server-side-caller-check posture as create-employee and
// every other /api/admin/* route in this project (confirmed, not
// assumed). Left consistent with the existing project-wide pattern
// rather than inventing a stricter model for just this one route.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { candidateId, email, password, role, department } = body;

    if (!candidateId || !email || !password) {
      return NextResponse.json(
        { success: false, message: "candidateId, email, and password are required" },
        { status: 400 }
      );
    }

    const result = await performCandidateConversion({ candidateId, email, password, role, department });

    if (!result.success) {
      return NextResponse.json(result, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
