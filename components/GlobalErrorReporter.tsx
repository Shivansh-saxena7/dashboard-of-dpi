"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/reportClientError";

// Mounted once in the root layout (2026-10-03): any uncaught exception
// or unhandled promise rejection on any page reaches
// system_anomaly_log instead of disappearing into the browser console.
export default function GlobalErrorReporter() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => reportClientError("uncaught exception", event.error || event.message);
    const onRejection = (event: PromiseRejectionEvent) => reportClientError("unhandled promise rejection", event.reason);

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
