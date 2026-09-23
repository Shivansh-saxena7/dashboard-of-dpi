import { NextResponse } from "next/server";

// iOS Home-Screen PWA stale-content fix, Part B (2026-09-23) — the
// one endpoint UpdateAvailableBanner.tsx polls (on mount + on
// visibilitychange) to detect a newer deploy. force-dynamic + its own
// explicit no-store header — deliberately not relying on
// middleware.ts's no-store (that's scoped to exclude /api/ entirely,
// since API routes control their own caching individually, see that
// file's own comment) — this route needs the identical guarantee for
// itself specifically, so it sets it directly.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { buildId: process.env.NEXT_PUBLIC_BUILD_ID || null },
    { headers: { "Cache-Control": "no-store, must-revalidate" } }
  );
}
