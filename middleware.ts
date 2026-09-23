import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// iOS Home-Screen PWA stale-content fix (2026-09-23) — confirmed via
// research this app has NO service worker at all (no next-pwa,
// no sw.js, zero navigator.serviceWorker.register() calls anywhere),
// so the "employee has to delete and reinstall to see updates"
// symptom isn't a service-worker caching-strategy problem — it's
// iOS/WebKit's own well-documented, sticky HTTP caching of the
// top-level HTML document for standalone "Add to Home Screen" apps,
// independent of any service worker. Explicitly setting no-store here
// is the strongest available signal to make iOS re-fetch the shell
// (which references the correctly content-hashed, already-safe-to-
// cache JS/CSS chunk names) on next launch, instead of silently
// reusing a stale one indefinitely.
//
// Deliberately ONLY touches the page/document response, never the
// static asset pipeline — those stay on Next.js's own default
// long-cache behavior (content-hashed filenames already make that
// safe: a new build gets new filenames, so there's nothing to go
// stale). Getting the matcher wrong here would be a real regression
// (forcing re-download of immutable hashed assets on every request),
// which is exactly why the matcher below is deliberately conservative
// and was shown for explicit review before being applied.
export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "no-store, must-revalidate");
  return response;
}

// Matches everything EXCEPT:
//   - _next/static/*  and _next/image/*  — Next's own content-hashed
//     build output and image-optimizer cache; must stay long-cached.
//   - favicon.ico, manifest.json — small, rarely-changing static
//     files; no benefit to forcing a re-fetch of these specifically.
//   - api/* — JSON API routes control their own caching individually
//     (the new /api/version route explicitly sets its own no-store);
//     this middleware is scoped to the HTML document only.
//   - any request path ending in a common static-file extension
//     (icons, images) served from public/ — covers dpi-icon.png,
//     icon-192.png, icon-512.png, dpilogo.png, and any future ones,
//     without needing to name each file individually.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|manifest\\.json|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"
  ]
};
