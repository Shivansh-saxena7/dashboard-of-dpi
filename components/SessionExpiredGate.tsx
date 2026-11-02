"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { logAnomaly } from "@/lib/logAnomaly";
import { consumeDraftReturnPath } from "@/lib/leadUpdateDraft";
import { SESSION_EXPIRED_EVENT, SESSION_EXPIRED_MESSAGE } from "@/lib/sessionGuard";

const PENDING_LOG_KEY = "session_expired_pending_log";

// The message the session guard (lib/sessionGuard.ts) asks for. The page stays as it is behind it, so
// nothing typed is lost until the employee chooses to log in. The event is logged after the next login
// because the anomaly log only accepts a logged-in employee.
export default function SessionExpiredGate() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onExpired = () => {
      setOpen(true);
      try {
        localStorage.setItem(PENDING_LOG_KEY, JSON.stringify({ at: new Date().toISOString(), page: window.location.pathname }));
      } catch {
        // no storage, the event just is not logged
      }
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);

    (async () => {
      let pending: string | null = null;
      try {
        pending = localStorage.getItem(PENDING_LOG_KEY);
      } catch {
        return;
      }
      if (!pending) return;
      const { data } = await supabase.auth.getSession();
      if (!data.session) return;
      try {
        localStorage.removeItem(PENDING_LOG_KEY);
      } catch {
        // logged again next time at worst
      }
      await logAnomaly(supabase, {
        source: "session_expired",
        severity: "warning",
        message: "A write was stopped because the login had expired; the employee logged in again",
        context: JSON.parse(pending)
      });
    })();

    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  if (!open) return null;

  async function logInAgain() {
    const next = consumeDraftReturnPath() ?? `${window.location.pathname}${window.location.search}`;
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    window.location.href = `/login?next=${encodeURIComponent(next)}`;
  }

  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="session-expired-title" className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <h2 id="session-expired-title" className="text-base font-semibold text-slate-900">Session expired</h2>
        <p className="mt-2 text-sm text-slate-600">{SESSION_EXPIRED_MESSAGE}</p>
        <button onClick={logInAgain} className="mt-4 h-11 w-full rounded-xl bg-amber-500 text-sm font-semibold text-white hover:bg-amber-600">
          Log in again
        </button>
        <button onClick={() => setOpen(false)} className="mt-2 h-11 w-full rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100">
          Not now
        </button>
      </div>
    </div>
  );
}
