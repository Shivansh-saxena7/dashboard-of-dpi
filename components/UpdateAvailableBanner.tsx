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
  // Changelog-in-banner (2026-09-24) — /api/version's latestChanges,
  // see that route's own comment: only the most-recently-shipped
  // entry's list, not a full multi-version diff. Empty array (never
  // shown) when nothing was recorded for this deploy — the banner
  // falls back to the plain generic message, same as before this
  // feature existed.
  const [changes, setChanges] = useState<string[]>([]);

  useEffect(() => {
    async function checkVersion() {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;

        const data = await res.json();
        if (data.buildId && data.buildId !== process.env.NEXT_PUBLIC_BUILD_ID) {
          setUpdateAvailable(true);
          setChanges(Array.isArray(data.latestChanges) ? data.latestChanges : []);
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
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-96 z-[200] rounded-2xl bg-slate-900 text-white shadow-2xl p-4">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold">Update available</p>
          {changes.length > 0 ? (
            <ul className="mt-1.5 space-y-1">
              {changes.map((change, i) => (
                <li key={i} className="text-xs text-white/70 leading-snug flex gap-1.5">
                  <span className="text-white/40">•</span>
                  <span>{change}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-white/70 mt-0.5">A newer version of this app is ready.</p>
          )}
        </div>
        <button
          onClick={() => setUpdateAvailable(false)}
          aria-label="Dismiss"
          className="shrink-0 h-7 w-7 rounded-lg bg-white/10 flex items-center justify-center"
        >
          <X size={13} />
        </button>
      </div>
      <button
        onClick={() => window.location.reload()}
        className="mt-3 w-full flex items-center justify-center gap-1.5 h-9 rounded-xl bg-white text-slate-900 text-xs font-bold"
      >
        <RefreshCw size={13} />
        Refresh
      </button>
    </div>
  );
}
