import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "react-hot-toast";
import UpdateAvailableBanner from "@/components/UpdateAvailableBanner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DPI Dashboard | Divya Padma Infosystem",
  description: "The internal command center for Divya Padma Infosystem LLP — performance, leads, and growth in one place.",
  manifest: "/manifest.json",
  icons: {
    icon: "/dpi-icon.png",
    apple: "/icon-192.png",
  },
  // apple-mobile-web-app-* meta tags (2026-09-24) — Apple's own
  // documented companion setting for a genuine standalone iOS PWA,
  // found missing while researching the cold-launch zoom bug above.
  // manifest.json's display:"standalone" alone is known to not be
  // fully honored by iOS the way these legacy Apple-specific tags
  // are — capable:true is what actually removes Safari's chrome on
  // Add-to-Home-Screen; statusBarStyle "default" matches the light
  // color-scheme/white background already set everywhere else here;
  // title is the short name shown under the home-screen icon (same
  // as manifest.json's own short_name, kept in sync deliberately).
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "DPI Dashboard",
  },
  other: {
    "color-scheme": "light",
    // Next's appleWebApp.capable only emits the modern
    // mobile-web-app-capable tag (confirmed via the actual built
    // HTML — apple-mobile-web-app-capable was missing entirely).
    // iOS/Safari only started recognizing the modern tag in 17.4+;
    // older versions still need this legacy one specifically, so
    // it's added explicitly rather than relying on Next alone.
    "apple-mobile-web-app-capable": "yes",
  },
};

// iOS standalone-PWA cold-launch zoom bug fix (2026-09-24) — with no
// viewport export at all, Next.js fell back to its own default
// (`width=device-width, initial-scale=1`, confirmed via the actual
// built HTML), which is fine in a normal browser tab but hits a
// documented WebKit bug specifically in iOS's standalone
// (Add-to-Home-Screen) launch path: without an explicit min/max scale
// pinned, the very first frame can render at a stale/wrong zoom level
// — a manual pinch forces WebKit to recompute layout, which is why
// that "fixes" it. Pinning the scale range removes the ambiguity
// WebKit gets wrong here; Android is unaffected since Chrome's
// standalone rendering path doesn't have this specific bug. Doesn't
// disable pinch-zoom outright (no user-scalable=no) — min/max both
// pinned to 1 already removes the zoom range that triggers the bug,
// without an extra, more aggressive flag on top.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
  <html
    lang="en"
    className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
  >
  <body className="min-h-full flex flex-col overflow-x-hidden" style={{ colorScheme: "light" }}>

      {children}

      <UpdateAvailableBanner />

      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: {
            borderRadius: "14px",
            background: "#0f172a",
            color: "#fff",
            fontWeight: "600",
            padding: "14px 18px",
          },
          success: {
            style: {
              background: "#16a34a",
              color: "#fff",
            },
          },
          error: {
            style: {
              background: "#dc2626",
              color: "#fff",
            },
          },
        }}
      />

    </body>
  </html>
);
}
