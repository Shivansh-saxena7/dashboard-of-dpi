"use client";
// The "Start with next lead" bar (2026-11-18, Home Phase 3), shown on /leads and /data while a queue runs and the
// lead sheet is closed: Skip (local only) / Open / Exit, or "All done" at the end.
import type { ListQueue } from "@/lib/useListQueue";

export default function QueueBar({
  queue,
  nameOf,
  onSkip,
  onOpen,
  onExit
}: {
  queue: ListQueue;
  nameOf: (id: string) => string | null | undefined;
  onSkip: () => void;
  onOpen: () => void;
  onExit: () => void;
}) {
  const current = queue.index < queue.ids.length ? queue.ids[queue.index] : null;
  return (
    <div
      data-testid="queue-bar"
      className="fixed inset-x-3 bottom-3 z-30 mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-3 shadow-lg"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
    >
      {current ? (
        <>
          <p className="mb-2 text-sm text-slate-700">
            Next lead <b className="tabular-nums text-slate-900">{queue.index + 1}</b> of{" "}
            <b className="tabular-nums text-slate-900">{queue.ids.length}</b>
            {": "}
            <span className="font-semibold text-slate-900">{nameOf(current) || "Lead"}</span>
          </p>
          <div className="grid grid-cols-3 gap-2">
            <button type="button" data-testid="queue-skip" onClick={onSkip} className="min-h-12 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700">
              Skip
            </button>
            <button type="button" data-testid="queue-open" onClick={onOpen} className="min-h-12 rounded-xl bg-blue-600 text-sm font-semibold text-white">
              Open
            </button>
            <button type="button" data-testid="queue-exit" onClick={onExit} className="min-h-12 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700">
              Exit
            </button>
          </div>
        </>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p data-testid="queue-done" className="text-sm font-semibold text-slate-900">
            All done. No more leads in the queue.
          </p>
          <div className="flex gap-2">
            <a href="/" className="flex min-h-12 items-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white">
              Home
            </a>
            <button type="button" onClick={onExit} className="min-h-12 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
