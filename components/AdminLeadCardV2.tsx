"use client";

// Admin / coordinator lead card, redesign "Pass" look (design dde20ef, 2026-10-09; ported 2026-11-27 behind
// lead_engine_settings.admin_card_mode). Same information, same rules, same actions as components/AdminLeadCard.tsx
// (the old card stays unchanged and is used whenever the flag is off):
//   * every word the old card shows is shown here too, also on a 390 px phone (nothing hidden by width; the recycle
//     reason and the old hover "Exact time" are visible lines);
//   * badges come from lib/adminCardText.ts, a line-by-line copy of the old card's rules and words;
//   * the same gates: bulk checkbox only when selectable && !terminal && !readOnly; team-reserve select only for an
//     unowned lead and never readOnly; JUNK Reassign only for JUNK, never readOnly; View History for everyone;
//   * same props, so the pages pass one object to either card. The one addition is lead.leadHistoryId (optional), for
//     the last-note panel (one batched RPC for all visible cards, POST body, 200 ids a call; see lib/useLastLog.ts).
// Redesign-only extras: the look and the last-note panel. Nothing else new (no countdown chip, no "Call first", no
// copy-number, no details section). Personal = blue/slate, no violet. Taps >= 44 px.

import { memo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, History } from "lucide-react";
import { LEAD_STATUS_DISPLAY } from "@/lib/leadStatusDisplay";
import { LEAD_PRIORITY_DISPLAY, LeadPriority } from "@/lib/leadPriorityDisplay";
import { LeadStatus } from "@/lib/getValidNextLeadStatuses";
import { BoardStage } from "@/lib/leadBoardStageDisplay";
import { useWorkingCalendar } from "@/lib/useWorkingCalendar";
import { adminAssignedText, adminCardState, type AdminBadgeTone } from "@/lib/adminCardText";
import { leadCardFont } from "@/lib/leadCardFont";
import {
  cardSurface, dotStyle, DOT, GLASS_BOX, HAIRLINE, HEADER_GLASS, INK, MUTED, NAME_COLOR, NEUTRAL_TAG, NUMBER_INK, PASS, PassTone, SIZE,
  statusPillStyle, TAG, TEXT2, TINT_TAG, raised
} from "@/lib/leadCardLook";
import AdminLeadHistoryModal from "./AdminLeadHistoryModal";
import ExistingClientBadge from "./ExistingClientBadge";
import RecycledBadge from "./RecycledBadge";
import TimerPausedBadge from "./TimerPausedBadge";
import LastLogPanel from "./LastLogPanel";
import type { LeadSibling } from "@/lib/useLeadSiblings";

interface AdminLeadCardLead {
  id: string;
  leadHistoryId?: string | null;
  name: string;
  mobile: string;
  project: string | null;
  source: string | null;
  status: LeadStatus;
  priority: LeadPriority;
  boardStage: BoardStage;
  recycleCount: number;
  ownerName: string | null;
  currentOwnerId?: string | null;
  catcherName?: string | null;
  assignedAt: string | null;
  pendingTeamId: string | null;
  pendingTeamName: string | null;
  leadType: string;
  callCount: number;
  pausedUntil: string | null;
  pauseReason: string | null;
  lastActivityAt: string | null;
  outcomeAt?: string | null;
  isPersonalLead?: boolean;
  siblings?: LeadSibling[];
  recycleReason?: string | null;
  recycledFromStatus?: string | null;
  recycledFromStage?: string | null;
}

// Same props as the old AdminLeadCard.
interface AdminLeadCardProps {
  lead: AdminLeadCardLead;
  teams: { id: string; name: string }[];
  onReserveTeam: (leadId: string, teamId: string | null) => void;
  index?: number;
  employees?: { id: string; name: string; is_active: boolean }[];
  onUnjunkReassign?: (leadId: string, employeeId: string, reason: string) => void | Promise<void>;
  readOnly?: boolean;
  isOwnerOnLeave?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (leadId: string) => void;
}

// Badge colours (no purple / violet / indigo).
const BADGE_STYLE: Record<AdminBadgeTone, React.CSSProperties> = {
  red: raised("#ffeaea", "#fbd5d5", "#b42318"),
  amber: raised("#fff3dc", "#fbe3b6", "#92400e"),
  green: raised("#e6f8f0", "#c7ecd9", "#047857"),
  blue: raised("#eaf2ff", "#d4e3fd", "#1d4ed8"),
  teal: raised("#e6f8f5", "#c5ebe4", "#0f766e"),
  slate: NEUTRAL_TAG
};
const FIELD = "block h-11 w-full rounded-[12px] bg-white px-3 text-[13px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-slate-300";
const PERSONAL_TAG: React.CSSProperties = raised("#eaf2ff", "#d4e3fd", "#1d4ed8");
// Long badges wrap instead of being cut (the old card's full text, on any width).
const WRAP_TAG = `${TAG} h-auto! min-h-[22px] py-1 whitespace-normal! leading-snug text-left`;

function AdminLeadCardV2({
  lead,
  teams,
  onReserveTeam,
  index = 0,
  employees = [],
  onUnjunkReassign,
  readOnly = false,
  isOwnerOnLeave = false,
  selectable = false,
  selected = false,
  onToggleSelect
}: AdminLeadCardProps) {
  const workingCalendar = useWorkingCalendar();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassignEmployeeId, setReassignEmployeeId] = useState("");
  const [reassignReason, setReassignReason] = useState("");
  const [reassignSubmitting, setReassignSubmitting] = useState(false);

  // Same as the old card.
  async function submitReassign() {
    if (!onUnjunkReassign || !reassignEmployeeId || !reassignReason.trim() || reassignSubmitting) return;
    setReassignSubmitting(true);
    try {
      await onUnjunkReassign(lead.id, reassignEmployeeId, reassignReason.trim());
      setReassignOpen(false);
      setReassignEmployeeId("");
      setReassignReason("");
    } finally {
      setReassignSubmitting(false);
    }
  }

  const s = adminCardState(lead, isOwnerOnLeave, workingCalendar, Date.now());
  // Guarded: an unknown status / priority shows the raw value (the old card would throw).
  const statusLabel = LEAD_STATUS_DISPLAY[lead.status]?.label || lead.status;
  const priorityLabel = lead.priority ? LEAD_PRIORITY_DISPLAY[lead.priority]?.label || lead.priority : null;
  const initial = lead.name?.charAt(0)?.toUpperCase() || "?";
  // Presentation only (tone of the card), from the same values.
  const tone: PassTone = s.recyclingNow ? "OVERDUE" : s.isTerminal || s.isPaused || lead.isPersonalLead ? "QUIET" : lead.leadType !== "DATA" && lead.boardStage !== "LEADS" ? "FOLLOW_UP" : "NEW";
  const look = PASS[tone];
  const dot = (color: string) => <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={dotStyle(color)} aria-hidden="true" />;

  return (
    <motion.div
      id={`admin-lead-card-${lead.id}`}
      data-card="v2"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index, 10) * 0.04 }}
      style={cardSurface(tone)}
      className={`${leadCardFont.className} relative w-full min-w-0 overflow-hidden rounded-[18px] border shadow-[var(--card-shadow)] transition-[transform,box-shadow] duration-200 hover:-translate-y-px hover:shadow-[var(--card-shadow-hover)] motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${
        lead.isPersonalLead ? "ring-2 ring-blue-200" : ""
      }`}
    >
      <div className="h-[3px]" style={{ background: look.line }} aria-hidden="true" />
      {/* Header: priority, status, Data, board stage, calls (the old card's pills, same words). */}
      <div className={`flex flex-wrap items-center gap-1.5 px-3.5 py-1.5 ${HEADER_GLASS}`} style={{ background: look.header }}>
        {priorityLabel && (
          <span className={TAG} style={lead.priority === "hot" ? TINT_TAG.hot : lead.priority === "warm" ? TINT_TAG.warm : NEUTRAL_TAG}>{priorityLabel}</span>
        )}
        {lead.leadType === "DATA" && (
          <span className={TAG} style={NEUTRAL_TAG}>
            {dot(DOT.slate)}
            Data
          </span>
        )}
        <span className={TAG} style={statusPillStyle(lead.status)}>{statusLabel}</span>
        {s.stageText && <span className={TAG} style={NEUTRAL_TAG}>{s.stageText}</span>}
        {s.calledText && <span className="text-[11px] font-semibold tabular-nums" style={{ color: TEXT2 }}>{s.calledText}</span>}
      </div>

      <div className="flex flex-col gap-2 px-3.5 pt-2.5 pb-3">
        {/* The old card's timer / pause / leave badges, full text (wraps on a phone, never cut). */}
        {s.badges.length > 0 && (
          <div className="flex flex-col gap-1" data-testid="admin-card-badges">
            {s.badges.map((b) => (
              <div key={b.key} className="flex flex-col items-start gap-0.5">
                <span className={`${WRAP_TAG} ${b.pulse ? "motion-safe:animate-pulse" : ""}`} style={BADGE_STYLE[b.tone]} title={b.exact}>
                  {b.text}
                </span>
                {b.exact && <span className="pl-2 text-[11px] font-semibold tabular-nums" style={{ color: MUTED }}>{b.exact}</span>}
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2 min-[420px]:flex-row min-[420px]:items-start min-[420px]:gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-2.5">
            {selectable && !s.isTerminal && !readOnly && (
              <button
                type="button"
                role="checkbox"
                aria-checked={selected}
                aria-label={selected ? "Deselect lead" : "Select lead"}
                onClick={() => onToggleSelect?.(lead.id)}
                className="-m-3 p-3 shrink-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              >
                {/* No transition: the tick paints in the very next frame (old card rule). */}
                <span className={`h-5 w-5 rounded border-2 flex items-center justify-center ${selected ? "bg-blue-600 border-blue-600" : "bg-white border-slate-400"}`}>
                  {selected && <Check size={13} strokeWidth={3} className="text-white" />}
                </span>
              </button>
            )}
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-extrabold"
              style={{ background: lead.isPersonalLead ? "#eaf2ff" : "#eef2f6", color: lead.isPersonalLead ? "#1d4ed8" : TEXT2, boxShadow: `inset 0 0 0 1px ${HAIRLINE}` }}
            >
              {initial}
            </span>
            <div className="min-w-0 flex-1">
              <p title={lead.name} className={`${SIZE.name} break-words line-clamp-2`} style={{ color: NAME_COLOR }}>{lead.name}</p>
              <p className={`mt-0.5 ${SIZE.number} tabular-nums`} style={{ color: NUMBER_INK }}>{lead.mobile}</p>
              {lead.project && <p className={`${SIZE.project} font-semibold break-words`} style={{ color: look.project }}>{lead.project}</p>}
            </div>
          </div>
          {lead.leadHistoryId && (
            <LastLogPanel
              id={lead.leadHistoryId}
              version={lead.lastActivityAt}
              called={lead.callCount > 0}
              resultLabel={lead.status !== "NEW" ? LEAD_STATUS_DISPLAY[lead.status]?.label : null}
              className="min-[420px]:w-[44%] min-[420px]:max-w-[230px] min-[420px]:shrink-0"
            />
          )}
        </div>

        {/* Tags: source / Personal, catcher, Legacy, recycled, existing client, weekly-off pause. Same conditions. */}
        <div className="flex flex-wrap items-center gap-1.5 min-w-0 [&:not(:has(>:not(:empty)))]:hidden">
          {lead.isPersonalLead ? (
            <span className={TAG} style={PERSONAL_TAG}>🔒 Personal</span>
          ) : (
            lead.source && (
              <span className={`${TAG} max-w-full`} style={NEUTRAL_TAG} title={lead.source}>
                {dot(DOT.slate)}
                <span className="truncate">{lead.source}</span>
              </span>
            )
          )}
          {lead.catcherName && (
            <span title={`Catcher: ${lead.catcherName}`} className={`${TAG} max-w-full`} style={NEUTRAL_TAG}>
              <span className="truncate">🎣 Catcher: {lead.catcherName}</span>
            </span>
          )}
          {lead.source === "Legacy" && (
            <span className={TAG} style={NEUTRAL_TAG}>📒 Legacy</span>
          )}
          {(lead.recycleCount > 0 || lead.recycleReason) && (
            <span className="inline-flex min-w-0 max-w-full [&>span]:min-h-[22px] [&>span]:text-[11px]!">
              <RecycledBadge reason={lead.recycleReason} fromStage={lead.recycledFromStage} fromStatus={lead.recycledFromStatus} count={lead.recycleCount} fullDetail />
            </span>
          )}
          {lead.siblings && lead.siblings.length > 0 && (
            <span className="inline-flex [&>span>button]:min-h-11 [&>span>button]:text-[11px]!">
              <ExistingClientBadge siblings={lead.siblings} fullDetail />
            </span>
          )}
          <span className="inline-flex empty:hidden [&>span]:inline-flex [&>span]:h-[22px] [&>span]:items-center [&>span]:text-[11px]">
            <TimerPausedBadge size="sm" clockRunning={Boolean(s.recycleCutoff)} />
          </span>
        </div>

        {/* Owner / Assigned (old words). The team-reserve select only for an unowned lead, never read-only. */}
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 rounded-[12px] px-3 py-2" style={GLASS_BOX}>
          <div className="min-w-0 flex-1">
            <p className={`${SIZE.factLabel} font-bold`} style={{ color: MUTED }}>Owner</p>
            {lead.ownerName ? (
              <p className="text-[13.5px] font-extrabold" style={{ color: INK }}>{lead.ownerName}</p>
            ) : (
              <div className="mt-1 space-y-1.5">
                {lead.pendingTeamName ? (
                  <span className={TAG} style={TINT_TAG.warm}>Reserved for {lead.pendingTeamName}</span>
                ) : (
                  <span className={TAG} style={TINT_TAG.callFirst}>Unassigned</span>
                )}
                {!readOnly && (
                  <select
                    value={lead.pendingTeamId || ""}
                    onChange={(e) => onReserveTeam(lead.id, e.target.value || null)}
                    aria-label="Reserve for a team"
                    className={FIELD}
                    style={{ boxShadow: `inset 0 0 0 1px ${HAIRLINE}`, color: INK }}
                  >
                    <option value="">No team reserved</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>
          {lead.assignedAt && (
            <div className="text-right">
              <p className={`${SIZE.factLabel} font-bold`} style={{ color: MUTED }}>Assigned</p>
              <p className="text-[12.5px] font-semibold tabular-nums" style={{ color: INK }}>{adminAssignedText(lead.assignedAt)}</p>
            </div>
          )}
        </div>

        <div className="border-t border-dashed" style={{ borderColor: HAIRLINE }} aria-hidden="true" />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-[13px] px-3.5 text-[13px] font-bold transition-[filter] hover:brightness-[.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
            style={raised("#eaf2ff", "#d4e3fd", "#1d4ed8")}
          >
            <History size={15} strokeWidth={2} />
            View History
          </button>
          {lead.status === "JUNK" && !readOnly && onUnjunkReassign && !reassignOpen && (
            <button
              type="button"
              onClick={() => setReassignOpen(true)}
              className="inline-flex min-h-11 items-center rounded-[13px] px-3.5 text-[13px] font-bold transition-[filter] hover:brightness-[.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
              style={raised("#e6f8f0", "#c7ecd9", "#047857")}
            >
              🔁 Reassign
            </button>
          )}
        </div>

        {reassignOpen && (
          <div className="space-y-2 rounded-[12px] p-3" style={GLASS_BOX}>
            <p className="text-[12.5px] font-semibold" style={{ color: TEXT2 }}>Recover this JUNK lead and hand it to:</p>
            <select value={reassignEmployeeId} onChange={(e) => setReassignEmployeeId(e.target.value)} aria-label="Employee" className={FIELD} style={{ boxShadow: `inset 0 0 0 1px ${HAIRLINE}`, color: INK }}>
              <option value="">Select employee...</option>
              {employees
                .filter((e) => e.is_active && e.id !== lead.currentOwnerId)
                .map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
            </select>
            <textarea
              value={reassignReason}
              onChange={(e) => setReassignReason(e.target.value)}
              placeholder="Reason (mandatory)"
              aria-label="Reason"
              rows={2}
              className="w-full rounded-[12px] bg-white px-3 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
              style={{ boxShadow: `inset 0 0 0 1px ${HAIRLINE}`, color: INK }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={submitReassign}
                disabled={reassignSubmitting || !reassignEmployeeId || !reassignReason.trim()}
                className="h-11 px-4 rounded-[12px] bg-emerald-600 text-white text-[13px] font-bold disabled:opacity-50"
              >
                {reassignSubmitting ? "..." : "Reassign"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setReassignOpen(false);
                  setReassignEmployeeId("");
                  setReassignReason("");
                }}
                className="h-11 px-3 text-[13px] font-semibold"
                style={{ color: TEXT2 }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <AnimatePresence>
        {historyOpen && (
          <AdminLeadHistoryModal
            key="history-modal"
            leadId={lead.id}
            leadName={lead.name}
            leadType={lead.leadType}
            leadStatus={lead.status}
            leadBoardStage={lead.boardStage}
            catcherName={lead.catcherName ?? null}
            onClose={() => setHistoryOpen(false)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default memo(AdminLeadCardV2);
