import type { NextConfig } from "next";

// iOS Home-Screen PWA stale-content fix, Part B (2026-09-23) — frozen
// once per build (this config module only re-evaluates on a fresh
// `next build`/`next dev` start), then baked into both the client
// bundle (via NEXT_PUBLIC_ prefix) and readable server-side (by
// app/api/version/route.ts) from the identical value — that equality
// is exactly what UpdateAvailableBanner.tsx compares.
const buildId = Date.now().toString();

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_ID: buildId
  }
};

export default nextConfig;
