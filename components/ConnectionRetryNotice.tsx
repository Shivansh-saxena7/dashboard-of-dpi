"use client";

// Shown by the Admin / HR / Payroll layouts when the access check could not reach the server even after one retry
// (lib/currentUser.ts withNetworkRetry). The employee stays on the page instead of being sent to /login.
export default function ConnectionRetryNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      data-testid="connection-retry-notice"
      className="fixed bottom-4 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-lg"
    >
      <span className="flex-1">Connection problem. Could not check your access.</span>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-lg bg-amber-600 px-3 py-1.5 font-semibold text-white hover:bg-amber-700"
      >
        Retry
      </button>
    </div>
  );
}
