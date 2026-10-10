"use client";

// Compact "Last log" panel on the lead card (employee + admin/coordinator).
// Shows what happened last (Called · result / status / Note), how long ago
// (amber once older than 24h) and two lines of the latest note (full text
// in the tooltip). Soft slate note, champagne label/time. Display only.

import { StickyNote, PhoneCall } from "lucide-react";
import { useLastLog, LastLogKey } from "@/lib/useLastLog";
import { CHAMPAGNE, formatAgo, HAIRLINE, MUTED } from "@/lib/leadCardLook";

export default function LastLogPanel({
  lookupKey,
  id,
  version,
  resultLabel,
  called,
  className = ""
}: {
  lookupKey: LastLogKey;
  id: string | null | undefined;
  // changes when the lead gets new activity, so the panel refreshes
  version?: string | null;
  // current outcome, e.g. "Not connected" (null while the status is still New)
  resultLabel?: string | null;
  called?: boolean;
  className?: string;
}) {
  const log = useLastLog(lookupKey, id, version);
  const box = { background: "rgba(255,255,255,.7)", boxShadow: `inset 0 0 0 1px ${HAIRLINE}` };

  if (log === undefined) {
    return (
      <div className={`rounded-[12px] px-2.5 py-2 ${className}`} style={box} aria-label="Loading last log">
        <div className="h-2.5 w-2/3 rounded bg-slate-200/80 motion-safe:animate-pulse" />
        <div className="mt-1.5 h-2.5 w-full rounded bg-slate-200/70 motion-safe:animate-pulse" />
      </div>
    );
  }

  if (!log) {
    return (
      <div className={`flex items-center gap-1.5 rounded-[12px] px-2.5 py-2 text-[11.5px] font-semibold ${className}`} style={{ ...box, color: MUTED }}>
        <StickyNote size={12} strokeWidth={2} aria-hidden="true" />
        No activity yet
      </div>
    );
  }

  const ageMs = new Date().getTime() - new Date(log.at).getTime();
  const stale = ageMs > 24 * 3600000;
  const what = called ? `Called${resultLabel ? ` · ${resultLabel}` : ""}` : resultLabel || "Note";

  return (
    <div className={`min-w-0 rounded-[12px] px-2.5 py-2 ${className}`} style={box} title={log.note}>
      <p className="flex items-center gap-1.5 text-[11px] font-bold leading-none" style={{ color: CHAMPAGNE.text }}>
        {called ? <PhoneCall size={11} strokeWidth={2} aria-hidden="true" /> : <StickyNote size={11} strokeWidth={2} aria-hidden="true" />}
        <span className="truncate">{what}</span>
        <span className="shrink-0 tabular-nums font-semibold" style={{ color: stale ? "#b45309" : "#6f6553" }}>· {formatAgo(ageMs)}</span>
      </p>
      <p className="mt-1 text-[12px] font-medium leading-snug break-words line-clamp-2" style={{ color: "#475569" }}>{log.note}</p>
    </div>
  );
}
