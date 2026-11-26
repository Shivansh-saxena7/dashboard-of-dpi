"use client";

// Lead card, redesign "Pass" look (design 2026-10-09, ported 2026-11-26 behind employee_card_mode). Same information,
// same rules and same actions as components/LeadCard.tsx (the old card stays unchanged and is used whenever the flag
// is off): every word the old card shows is shown here too, also on a 390 px phone (no text hidden by width); the
// SLA / recycle text comes from the same calculateSLAStatus / getRecycleCutoff branches, word for word
// (lib/cardText.ts). The Call tap goes through lib/logCallClick.ts (call-return, pending result, one network retry).
// Redesign-only extras kept: the look, copy-number, the last-note panel and the "Show details" section.

import { memo, useState } from "react";
import { motion } from "framer-motion";
import { Phone, Timer, Repeat, Zap, PencilLine, ChevronDown } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";
import { calculateSLAStatus, getRecycleCutoff } from "@/lib/calculateSLAStatus";
import { useWorkingCalendar } from "@/lib/useWorkingCalendar";
import { LEAD_STATUS_DISPLAY } from "@/lib/leadStatusDisplay";
import { LEAD_PRIORITY_DISPLAY, LeadPriority } from "@/lib/leadPriorityDisplay";
import { LeadStatus } from "@/lib/getValidNextLeadStatuses";
import { AssignedBySource } from "@/lib/assignedByDisplay";
import { buildWhatsAppLink } from "@/lib/buildWhatsAppLink";
import { rememberCalledCard } from "@/lib/lastCalledLead";
import { logCallClick } from "@/lib/logCallClick";
import type { LeadSibling } from "@/lib/useLeadSiblings";
import { recycledFromText } from "@/lib/recycleReasonDisplay";
import { tagText } from "@/lib/reassignedJourney";
import { leadCardFont } from "@/lib/leadCardFont";
import { oldSlaBadge, oldAssignedText, oldAgo } from "@/lib/cardText";
import {
  formatMobileDisplay, FACT_LABEL, FACT_VALUE, FACTS_BOX, NUMBER_INK, CHAMPAGNE, dotStyle, BUTTON_BG, CALL_BUTTON, cardSurface, DOCK, FACTS,
  callStyle, GLASS_BOX, NAME_COLOR, DOT, formatExactTime, GOLD, HAIRLINE, HEADER_GLASS, ICON_BUTTON, INK, NEUTRAL_TAG, PASS, PassTone, SIZE,
  statusPillStyle, TAG, TEXT2, TINT_TAG
} from "@/lib/leadCardLook";
import FactIcon from "@/components/FactIcon";
import LeadCardMore, { ExpandSection } from "./LeadCardMore";
import WhatsAppIcon from "./WhatsAppIcon";
import LastLogPanel from "./LastLogPanel";
import TimerPausedBadge from "./TimerPausedBadge";

interface LeadCardLead {
  id: string;
  leadHistoryId: string;
  name: string;
  mobile: string;
  project: string | null;
  source: string | null;
  catcher_name?: string | null;
  status: LeadStatus;
  priority: LeadPriority;
  board_stage?: string | null;
  sla_deadline: string | null;
  recycle_count: number;
  call_count: number;
  outcome_at: string | null;
  assigned_at: string | null;
  assigned_by_type: AssignedBySource["assigned_by_type"] | null;
  assigned_by: { name: string } | null;
  reassign_note: string | null;
  last_activity_at?: string | null;
  paused_until?: string | null;
  pause_reason?: string | null;
  is_personal_lead?: boolean;
  siblings?: LeadSibling[];
  recycle_reason?: string | null;
  recycled_from_status?: string | null;
  recycled_from_stage?: string | null;
}

// Same props as the old LeadCard, so LeadList passes one object to either card.
interface LeadCardProps {
  lead: LeadCardLead;
  now: Date;
  onOpen: (id: string) => void;
  onQuickDial: () => void;
  index?: number;
  previouslyWith?: string | null;
  onJourney?: (id: string) => void;
}

function LeadCardV2({ lead, now, onOpen, onQuickDial, index = 0, previouslyWith, onJourney }: LeadCardProps) {
  const [expanded, setExpanded] = useState(false);
  const workingCalendar = useWorkingCalendar();
  const input = {
    status: lead.status,
    sla_deadline: lead.sla_deadline,
    recycle_count: lead.recycle_count,
    board_stage: lead.board_stage,
    paused_until: lead.paused_until,
    last_activity_at: lead.last_activity_at,
    pause_reason: lead.pause_reason,
    assigned_at: lead.assigned_at
  };
  const slaStatus = calculateSLAStatus(input, lead.outcome_at, 0, false, lead.is_personal_lead, workingCalendar);
  const recycleCutoff = getRecycleCutoff(input, lead.outcome_at, lead.is_personal_lead, workingCalendar);
  const slaBadge = oldSlaBadge(slaStatus, lead, recycleCutoff, now);

  function handleCallClick(e: React.MouseEvent) {
    e.stopPropagation();
    rememberCalledCard(lead.id);
    logCallClick(lead.leadHistoryId, lead.id);
  }
  function handleWhatsAppClick(e: React.MouseEvent) {
    e.stopPropagation();
    supabase
      .rpc("log_whatsapp_click_atomic", { p_lead_history_id: lead.leadHistoryId })
      .then(({ error }) => {
        if (error) console.error("log_whatsapp_click_atomic failed:", error.message);
      });
  }

  // Presentation only (tone of the card), from values computed above.
  const overdue = Boolean(slaBadge?.pulse);
  const stage = lead.board_stage || "LEADS";
  const quiet = slaStatus === "PAUSED" || slaStatus === "COOLDOWN" || Boolean(lead.is_personal_lead);
  const tone: PassTone = overdue ? "OVERDUE" : quiet ? "QUIET" : stage !== "LEADS" || slaStatus !== "WITHIN_SLA" ? "FOLLOW_UP" : "NEW";
  const look = PASS[tone];
  const statusLabel = LEAD_STATUS_DISPLAY[lead.status]?.label || lead.status;
  // Guarded: a lead with no / unknown priority shows no chip (the old card would throw).
  const priorityLabel = lead.priority ? LEAD_PRIORITY_DISPLAY[lead.priority]?.label || lead.priority : null;
  const recycledFrom = lead.recycle_reason ? recycledFromText(lead.recycled_from_stage, lead.recycled_from_status, false) : null;
  const recycledText =
    lead.recycle_reason || lead.recycle_count > 0 ? `Recycled${lead.recycle_count > 0 ? ` ${lead.recycle_count}x` : ""}${recycledFrom ? ` · from ${recycledFrom}` : ""}` : null;
  const timersRunning = Boolean(recycleCutoff) || (slaStatus === "WITHIN_SLA" && Boolean(lead.sla_deadline));
  const source = !lead.is_personal_lead && lead.source ? lead.source : null;
  const dot = (color: string) => <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={dotStyle(color)} aria-hidden="true" />;

  return (
    <motion.div
      id={`lead-card-${lead.id}`}
      data-card="v2"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index, 8) * 0.04 }}
      onClick={() => onOpen(lead.id)}
      style={cardSurface(tone)}
      className={`${leadCardFont.className} relative w-full min-w-0 scroll-mt-28 overflow-hidden rounded-[18px] border cursor-pointer shadow-[var(--card-shadow)] transition-[transform,box-shadow] duration-200 hover:-translate-y-px hover:shadow-[var(--card-shadow-hover)] focus-within:ring-2 focus-within:ring-slate-300 motion-reduce:transition-none motion-reduce:hover:translate-y-0`}
    >
      <div className="h-[3px]" style={{ background: look.line }} aria-hidden="true" />
      {/* Header: position, priority, status. */}
      <div className={`flex flex-wrap items-center gap-1.5 px-3.5 py-1.5 ${HEADER_GLASS}`} style={{ background: look.header }}>
        <span className="text-[11px] font-bold tabular-nums" style={{ color: CHAMPAGNE.text }}>{index + 1}</span>
        {priorityLabel && (
          <span className={TAG} style={lead.priority === "hot" ? TINT_TAG.hot : lead.priority === "warm" ? TINT_TAG.warm : NEUTRAL_TAG}>{priorityLabel}</span>
        )}
        <span className={TAG} style={statusPillStyle(lead.status)}>{statusLabel}</span>
      </div>

      <div className="flex flex-col gap-2 px-3.5 pt-2.5 pb-3">
        {/* The old card's timer badge, full text (wraps on a phone, never cut). */}
        {slaBadge && (
          <p
            data-testid="card-sla"
            title={recycleCutoff ? `Exact time: ${recycleCutoff.cutoffAt.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : undefined}
            className={`flex w-fit max-w-full items-start gap-1.5 rounded-[12px] bg-white px-2.5 py-1.5 text-[12.5px] font-extrabold leading-snug ${slaBadge.pulse ? "motion-safe:animate-pulse" : ""}`}
            style={{ color: look.accent, boxShadow: `inset 0 0 0 1px ${look.accent}33` }}
          >
            <Timer size={13} strokeWidth={2} className="mt-px shrink-0" aria-hidden="true" />
            <span>{slaBadge.label}</span>
          </p>
        )}

        <div className="flex flex-col gap-2 min-[420px]:flex-row min-[420px]:items-start min-[420px]:gap-3">
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard?.writeText(lead.mobile).then(() => toast.success("Number copied"), () => {});
              }}
              title="Tap to copy"
              className={`block min-h-11 ${SIZE.number} tabular-nums cursor-copy rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300`}
              style={{ color: NUMBER_INK }}
            >
              {formatMobileDisplay(lead.mobile)}
            </button>
            {lead.project && <p className={`${SIZE.project} font-semibold truncate`} style={{ color: look.project }}>{lead.project}</p>}
            <p title={lead.name} className={`${SIZE.name} break-words line-clamp-2`} style={{ color: NAME_COLOR }}>{lead.name}</p>
          </div>
          <LastLogPanel
            id={lead.leadHistoryId}
            version={lead.last_activity_at}
            called={lead.call_count > 0}
            resultLabel={lead.status !== "NEW" ? LEAD_STATUS_DISPLAY[lead.status]?.label : null}
            className="min-[420px]:w-[46%] min-[420px]:max-w-[230px] min-[420px]:shrink-0"
          />
        </div>

        {/* Facts: the old meta line (last activity, assigned, calls), same words. */}
        <dl className={FACTS} style={FACTS_BOX}>
          {lead.last_activity_at && (
            <div className="min-w-0">
              <dt className={FACT_LABEL}><FactIcon name="activity" />Last activity</dt>
              <dd className={`${FACT_VALUE} tabular-nums`}>{oldAgo(now.getTime() - new Date(lead.last_activity_at).getTime())}</dd>
            </div>
          )}
          {lead.assigned_at && (
            <div className="min-w-0">
              <dt className={FACT_LABEL}><FactIcon name="assigned" />Assigned</dt>
              <dd className={`${FACT_VALUE} tabular-nums`}>{oldAssignedText(lead.assigned_at)}</dd>
            </div>
          )}
          <div className="min-w-0">
            <dt className={FACT_LABEL}><FactIcon name="calls" />Calls</dt>
            <dd className={`${FACT_VALUE} tabular-nums`}>{lead.call_count > 0 ? `${lead.call_count} ${lead.call_count === 1 ? "call" : "calls"}` : "No calls yet"}</dd>
          </div>
        </dl>

        {/* Tags: the old card's badges, same conditions and words. */}
        <div className="flex flex-wrap items-center gap-1.5 min-w-0 [&:not(:has(>:not(:empty)))]:hidden">
          {source && (
            <span className={`${TAG} max-w-full`} style={NEUTRAL_TAG} title={`Source: ${source}`}>
              {dot(DOT.slate)}
              <span className="truncate">{source}</span>
            </span>
          )}
          {lead.is_personal_lead && (
            <span className={TAG} style={{ ...NEUTRAL_TAG, color: "#1d4ed8" }}>
              {dot("#2563eb")}
              Personal
            </span>
          )}
          {lead.source === "Legacy" && (
            <span className={TAG} style={NEUTRAL_TAG}>
              {dot(DOT.gold)}
              Legacy
            </span>
          )}
          {lead.catcher_name && (
            <span title={`Catcher: ${lead.catcher_name}`} className={`${TAG} max-w-[170px]`} style={NEUTRAL_TAG}>
              {dot(DOT.slate)}
              <span className="truncate">{lead.catcher_name}</span>
            </span>
          )}
          {recycledText && (
            <span title={recycledText} className={`${TAG} max-w-full`} style={NEUTRAL_TAG}>
              {dot(DOT.slate)}
              <span className="truncate">{recycledText}</span>
            </span>
          )}
          {lead.siblings && lead.siblings.length > 0 && (
            <span className={TAG} style={NEUTRAL_TAG}>
              {dot(DOT.gold)}
              Existing client
            </span>
          )}
          <span className="inline-flex empty:hidden [&>span]:inline-flex [&>span]:h-[22px] [&>span]:items-center [&>span]:text-[11px] [&>span]:bg-[#f3f6fa]! [&>span]:text-[#475569]! [&>span]:shadow-[inset_0_0_0_1px_#e8edf3]">
            <TimerPausedBadge size="sm" clockRunning={timersRunning} />
          </span>
        </div>

        {lead.assigned_by_type === "TEAM_LEADER" && (
          <div className="flex items-start gap-1.5 rounded-[12px] px-3 py-2" style={GLASS_BOX}>
            <Repeat size={12} strokeWidth={2} className="shrink-0 mt-0.5" style={{ color: GOLD }} />
            <p className="text-[12px] leading-snug font-semibold" style={{ color: TEXT2 }}>
              {lead.assigned_by?.name || "Your Team Leader"} reassigned this lead to you
              {lead.reassign_note && (
                <>
                  {" "}— <span className="font-extrabold" style={{ color: INK }}>{lead.reassign_note}</span>
                </>
              )}
            </p>
          </div>
        )}

        {/* "Previously with" + Journey (2026-11-23): only when the list passes both (report-given leads, flag on). */}
        {previouslyWith !== undefined && onJourney && (
          <div className="flex items-center gap-2" data-testid="reassigned-tag-row">
            <span className="min-w-0 truncate rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700" data-testid="reassigned-tag">
              {tagText(previouslyWith)}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onJourney(lead.id);
              }}
              data-testid="reassigned-journey"
              className="shrink-0 min-h-11 rounded-xl border border-blue-200 bg-blue-50 px-3 text-[13px] font-semibold text-blue-700"
            >
              Journey
            </button>
          </div>
        )}

        <div className="border-t border-dashed" style={{ borderColor: CHAMPAGNE.line }} aria-hidden="true" />
        <div className={DOCK}>
          <motion.a href={`tel:${lead.mobile}`} onClick={handleCallClick} whileTap={{ scale: 0.98 }} style={callStyle(tone)} className={`${CALL_BUTTON} ${SIZE.button}`}>
            <Phone size={16} strokeWidth={2} />
            Call
          </motion.a>
          <a
            href={buildWhatsAppLink(lead.mobile)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleWhatsAppClick}
            aria-label="WhatsApp"
            title="WhatsApp"
            className={ICON_BUTTON}
            style={BUTTON_BG.whatsapp}
          >
            <WhatsAppIcon size={20} />
          </a>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(lead.id);
            }}
            aria-label="Update status"
            title="Update status"
            className={ICON_BUTTON}
            style={look.update}
          >
            <PencilLine size={17} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onQuickDial();
            }}
            aria-label="Quick Dial a new number"
            title="Quick Dial a new number"
            className={ICON_BUTTON}
            style={BUTTON_BG.quickDial}
          >
            <Zap size={17} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            aria-label={expanded ? "Hide details" : "Show details"}
            aria-expanded={expanded}
            title={expanded ? "Hide details" : "Show details"}
            className={ICON_BUTTON}
            style={expanded ? BUTTON_BG.chevronOpen : BUTTON_BG.chevronClosed}
          >
            <ChevronDown size={18} strokeWidth={2} className={`transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      <div className="px-3.5 empty:hidden">
        <ExpandSection open={expanded}>
          <div className="mb-3.5 rounded-[14px] px-3 pb-3" style={{ background: "rgba(255,255,255,.8)", boxShadow: `inset 0 0 0 1px ${HAIRLINE}` }}>
            <LeadCardMore
              leadId={lead.id}
              leadHistoryId={lead.leadHistoryId}
              status={lead.status}
              boardStage={lead.board_stage}
              accent={look.accent}
              times={[
                ...(lead.assigned_at ? [{ label: "Assigned", value: formatExactTime(lead.assigned_at) }] : []),
                ...(lead.last_activity_at ? [{ label: "Last activity", value: formatExactTime(lead.last_activity_at) }] : []),
                ...(recycleCutoff ? [{ label: "Recycles at", value: formatExactTime(recycleCutoff.cutoffAt.toISOString()) }] : [])
              ]}
            />
          </div>
        </ExpandSection>
      </div>
    </motion.div>
  );
}

export default memo(LeadCardV2);
