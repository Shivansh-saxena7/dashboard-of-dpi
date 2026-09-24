import { NextResponse } from "next/server";
import { CHANGELOG } from "@/lib/changelog";

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
    {
      buildId: process.env.NEXT_PUBLIC_BUILD_ID || null,
      // Changelog-in-banner (2026-09-24) — only the LAST entry's
      // changes, deliberately not a full multi-version diff, see
      // lib/changelog.ts's own comment for why. [] (never a missing
      // key) when CHANGELOG is empty, so the banner's check stays a
      // simple length check with no undefined-guarding needed.
      latestChanges: CHANGELOG.at(-1)?.changes ?? []
    },
    { headers: { "Cache-Control": "no-store, must-revalidate" } }
  );
}
