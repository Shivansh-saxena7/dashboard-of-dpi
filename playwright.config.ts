import { defineConfig, devices } from "@playwright/test";

// Call-return browser tests (2026-11-13): `npm run test:e2e`. Runs the app with `next dev` against a FAKE Supabase
// URL, and every request to it is answered by the test itself (tests/e2e/mockSupabase.ts), so nothing ever reaches
// the real database. Android Chrome (Pixel 7, Chromium) and iPhone Safari (iPhone 14, WebKit) emulation.
const PORT = 3123;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "off" },
  projects: [
    { name: "android-chrome", use: { ...devices["Pixel 7"] } },
    { name: "iphone-safari", use: { ...devices["iPhone 14"] } }
  ],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://fake-supabase.test",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "fake-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
      NEXT_TELEMETRY_DISABLED: "1"
    }
  }
});
