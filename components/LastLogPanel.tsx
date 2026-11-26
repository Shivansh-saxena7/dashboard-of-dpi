"use client";

// Last note of this assignment on the redesign cards (2026-11-26 port). Display only. Loads through useLastLog (one
// batched RPC for all visible cards, POST body). Not available (older database) or an error: renders nothing.

import { StickyNote, PhoneCall } from "lucide-react";
import { useLastLog } from "@/lib/useLastLog";
import { CHAMPAGNE, formatAgo, HAIRLINE, MUTED } from "@/lib/leadCardLook";

export default function LastLogPanel({
  id,
  version,
  resultLabel,
  called,
  className = ""
}: {
  id: string | null | undefined;
  version?: string | null;
  resultLabel?: string | null;
  called?: boolean;
  className?: string;
}) {
  const log = useLastLog(id, version);
  const box = { background: "rgba(255,255,255,.7)", boxShadow: `inset 0 0 0 1px ${HAIRLINE}` };
  if (log === "off") return null;
  if (log === undefined) {
    return (
      <div className={`rounded-[12px] px-2.5 py-2 ${className}`} style={box} aria-label="Loading last note" data-testid="last-note-loading">
        <div className="h-2.5 w-2/3 rounded bg-slate-200/80 motion-safe:animate-pulse" />
        <div className="mt-1.5 h-2.5 w-full rounded bg-slate-200/70 motion-safe:animate-pulse" />
      </div>
    );
  }
  if (!log) {
    return (
      <div className="inline-flex w-fit shrink-0 items-center gap-1.5 self-start rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ ...box, color: MUTED }} data-testid="last-note-none">
        <StickyNote size={12} strokeWidth={2} aria-hidden="true" />
        No note yet
      </div>
    );
  }
  const ageMs = Date.now() - new Date(log.at).getTime();
  const stale = ageMs > 24 * 3600000;
  const what = called ? `Called${resultLabel ? ` · ${resultLabel}` : ""}` : resultLabel || "Note";
  return (
    <div className={`min-w-0 rounded-[12px] px-2.5 py-2 ${className}`} style={box} title={log.note} data-testid="last-note">
      <p className="flex items-center gap-1.5 text-[11px] font-bold leading-none" style={{ color: CHAMPAGNE.text }}>
        {called ? <PhoneCall size={11} strokeWidth={2} aria-hidden="true" /> : <StickyNote size={11} strokeWidth={2} aria-hidden="true" />}
        <span className="truncate">Last note · {what}</span>
        <span className="shrink-0 tabular-nums font-semibold" style={{ color: stale ? "#b45309" : "#6f6553" }}>· {formatAgo(ageMs)}</span>
      </p>
      <p className="mt-1 text-[12px] font-medium leading-snug break-words line-clamp-2" style={{ color: "#475569" }}>{log.note}</p>
    </div>
  );
}
