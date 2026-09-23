"use client";

import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";

// iOS Home-Screen PWA stale-content fix, Part B (2026-09-23) — pairs
// with middleware.ts's no-store header on the document itself (Part
// A). Checks on mount AND on visibilitychange — the exact "tab/app
// regained foreground" trigger already established for Quick Dial
// (lib/lastCalledLead.ts's consumeQuickDialNumber pair), reused here
// rather than a new pattern — since that's precisely the moment a
// stale-reinstalled-PWA scenario would show up: the employee reopens
// the app after it's been backgrounded or fully closed.
//
// Deliberately a dismissible prompt, never a forced reload — an
// automatic reload could wipe out an employee's half-typed note or
// mid-call-log update. No polling interval either: this targets the
// reported "app reopened, still shows old version" problem
// specifically, not "notify everyone instantly mid-session," which
// would need constant background network chatter for a lower-priority
// benefit.
export default function UpdateAvailableBanner() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    async function checkVersion() {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;

        const data = await res.json();
        if (data.buildId && data.buildId !== process.env.NEXT_PUBLIC_BUILD_ID) {
          setUpdateAvailable(true);
        }
      } catch {
        // Network hiccup / genuinely offline — not worth surfacing as
        // an error, just skip this check until the next trigger.
      }
    }

    checkVersion();

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") checkVersion();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  if (!updateAvailable) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-96 z-[200] rounded-2xl bg-slate-900 text-white shadow-2xl p-4 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold">Update available</p>
        <p className="text-xs text-white/70 mt-0.5">A newer version of this app is ready.</p>
      </div>
      <button
        onClick={() => window.location.reload()}
        className="shrink-0 flex items-center gap-1.5 h-9 px-3.5 rounded-xl bg-white text-slate-900 text-xs font-bold"
      >
        <RefreshCw size={13} />
        Refresh
      </button>
      <button
        onClick={() => setUpdateAvailable(false)}
        aria-label="Dismiss"
        className="shrink-0 h-9 w-9 rounded-xl bg-white/10 flex items-center justify-center"
      >
        <X size={14} />
      </button>
    </div>
  );
}
