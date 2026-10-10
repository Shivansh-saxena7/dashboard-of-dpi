"use client";

import { motion } from "framer-motion";
import { AlertTriangle, Trash2, Repeat, ClipboardList, LucideIcon } from "lucide-react";
import { ENDED_REASON_TEXT, ENDED_REASON_BADGE, DEFAULT_ENDED_REASON_BADGE } from "@/lib/endedReasonDisplay";
import { leadCardFont } from "@/lib/leadCardFont";
import {
  cardSurface, dotStyle,
  formatAgo,
  formatAssignedExact,
  GLASS_BOX,
  headerChip,
  HEADER_GLASS,
  INK,
  MUTED,
  NAME_COLOR,
  NEUTRAL_TAG,
  PASS,
  PassTone,
  SIZE,
  sourceDot,
  TAG,
  TEXT2
} from "@/lib/leadCardLook";
import LastLogPanel from "./LastLogPanel";

interface SLABreachHistoryEntry {
  lead_history_id: string;
  assigned_at: string;
  ended_reason: string;
  reassign_note: string | null;
  project: string | null;
  source: string | null;
  name: string | null;
  mobile_last4: string | null;
}

interface SLABreachHistoryCardProps {
  entry: SLABreachHistoryEntry;
  index?: number;
}

// Icon per ended_reason — kept local (component references don't belong
// in a plain lib/*Display.ts data file); the label pairing lives in
// ENDED_REASON_BADGE (lib/endedReasonDisplay.ts). Falls back to a neutral
// clipboard icon for anything not listed, mirroring
// DEFAULT_ENDED_REASON_BADGE.
const REASON_ICON: Record<string, LucideIcon> = {
  SLA_BREACHED: AlertTriangle,
  RECYCLE_READY: AlertTriangle,
  JUNK: Trash2,
  TEAM_LEADER_REASSIGNED: Repeat
};

// Card tone per ended_reason (lead-card look, 2026-10-09): an SLA breach /
// recycle is OVERDUE coral, junk is QUIET slate, a reassignment is NEW blue.
function toneFor(reason: string): PassTone {
  if (reason === "JUNK") return "QUIET";
  if (reason === "TEAM_LEADER_REASSIGNED" || reason === "ADMIN_REASSIGNED") return "NEW";
  return "OVERDUE";
}

// Name and a masked last-4-digits are shown now (a deliberate, bounded
// relaxation of the original fully-masked design — approved
// explicitly) so a past lead is actually recognizable ("oh, that
// one") without re-identifying it: the FULL mobile number, current
// status/board_stage, and current owner are still never exposed —
// employee_sla_breach_history has no columns for any of those, and
// lead_project_source() (the one function allowed to reach into
// `leads` on an ex-owner's behalf) only ever returns project/source/
// name/mobile_last4, nothing else, so there's no code path here that
// could leak more even by mistake. Non-interactive (no onClick) —
// there is nothing further to drill into.
//
// Lead-card look (2026-10-09), presentation only. The last-log panel shows
// the employee's own latest note on that past assignment (lead_notes RLS:
// an employee reads their own notes).
export default function SLABreachHistoryCard({ entry, index = 0 }: SLABreachHistoryCardProps) {

  const reasonText = ENDED_REASON_TEXT[entry.ended_reason] || "This lead was reassigned.";
  const badge = ENDED_REASON_BADGE[entry.ended_reason] || DEFAULT_ENDED_REASON_BADGE;
  const Icon = REASON_ICON[entry.ended_reason] || ClipboardList;
  const tone = toneFor(entry.ended_reason);
  const look = PASS[tone];
  const nowMs = new Date().getTime();

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index, 8) * 0.04 }}
      style={cardSurface(tone)}
      className={`${leadCardFont.className} @container relative w-full min-w-0 overflow-hidden rounded-[18px] border shadow-[var(--card-shadow)]`}
    >
      {/* 3px accent line + slim header: what ended the assignment | source, last 4 digits */}
      <div className="h-[3px]" style={{ background: look.line }} aria-hidden="true" />
      <div className={`flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-3.5 py-1.5 ${HEADER_GLASS}`} style={{ background: look.header }}>
        <span className={`${TAG} tracking-[.02em]`} style={headerChip(look.accent)}>
          <Icon size={11} strokeWidth={2} aria-hidden="true" />
          {badge.label}
        </span>
        <div className="ml-auto flex min-w-0 items-center gap-1.5">
          {entry.source && (
            <span className={`${TAG} min-w-0 max-w-[130px]`} style={NEUTRAL_TAG} title={entry.source}>
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={dotStyle(sourceDot(entry.source))} aria-hidden="true" />
              <span className="truncate">{entry.source}</span>
            </span>
          )}
          {entry.mobile_last4 && (
            <span className={`${TAG} shrink-0 tabular-nums`} style={NEUTRAL_TAG}>
              •••• {entry.mobile_last4}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 px-3.5 pt-2.5 pb-3">
        {/* Identity + last log: side by side on a wide card, stacked on a narrow one. */}
        <div className="flex flex-col gap-2 @[400px]:flex-row @[400px]:items-start @[400px]:gap-3">
          <div className="min-w-0 flex-1">
            {entry.name ? (
              <p title={entry.name} className={`${SIZE.name} break-words line-clamp-2`} style={{ color: NAME_COLOR }}>{entry.name}</p>
            ) : (
              <p className={`${SIZE.name} italic`} style={{ color: MUTED }}>Name unavailable</p>
            )}
            {entry.project ? (
              <p className={`mt-0.5 ${SIZE.project} font-bold truncate`} style={{ color: look.project }}>{entry.project}</p>
            ) : (
              <p className={`mt-0.5 ${SIZE.project} italic`} style={{ color: MUTED }}>Project unavailable</p>
            )}
          </div>
          <LastLogPanel lookupKey="lead_history_id" id={entry.lead_history_id} className="@[400px]:w-[44%] @[400px]:max-w-[230px] @[400px]:shrink-0" />
        </div>

        {/* What happened, in the same words as before */}
        <p className="rounded-[12px] px-3 py-2 text-[12.5px] leading-snug font-semibold" style={{ ...GLASS_BOX, color: TEXT2 }}>
          {reasonText}
          {entry.reassign_note && (
            <span className="mt-1 block">
              <span className="font-bold" style={{ color: MUTED }}>Reason: </span>
              <span style={{ color: INK }}>{entry.reassign_note}</span>
            </span>
          )}
        </p>

        {/* Facts row: Assigned (exact · ago) */}
        <dl className="rounded-[12px] px-3 py-2" style={GLASS_BOX}>
          <dt className={`${SIZE.factLabel} font-bold`} style={{ color: MUTED }}>Assigned</dt>
          <dd className={`${SIZE.factValue} font-bold tabular-nums`} style={{ color: INK }}>
            <span className="whitespace-nowrap">{formatAssignedExact(entry.assigned_at)}</span>{" "}
            <span className="whitespace-nowrap font-semibold" style={{ color: TEXT2 }}>· {formatAgo(nowMs - new Date(entry.assigned_at).getTime())}</span>
          </dd>
        </dl>
      </div>
    </motion.div>
  );
}
