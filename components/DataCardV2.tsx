"use client";

// Data card, redesign "Pass" look (ported 2026-11-26 behind employee_card_mode). Same information, rules and actions
// as components/DataCard.tsx (unchanged, used whenever the flag is off): stage pill and the calls / attempts text are
// word for word the old card's (lib/cardText.ts); the Call tap goes through lib/logCallClick.ts. Redesign-only
// extras kept: the look, copy-number, the last-note panel, "Show details", and "Assigned" (the time this person got
// the lead, from the same active lead_history row the list already reads).

import { memo, useState } from "react";
import { motion } from "framer-motion";
import { Phone, PencilLine, ChevronDown } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";
import { LEAD_STATUS_DISPLAY } from "@/lib/leadStatusDisplay";
import { LeadStatus } from "@/lib/getValidNextLeadStatuses";
import { MAX_DATA_ATTEMPTS } from "@/lib/calculateSLAStatus";
import { buildWhatsAppLink } from "@/lib/buildWhatsAppLink";
import { rememberCalledCard } from "@/lib/lastCalledLead";
import { logCallClick } from "@/lib/logCallClick";
import { tagText } from "@/lib/reassignedJourney";
import { leadCardFont } from "@/lib/leadCardFont";
import { oldAssignedText, oldDataCallsText, oldDataStageText } from "@/lib/cardText";
import {
  formatMobileDisplay, BUTTON_BG, callStyle, CALL_BUTTON, FACT_LABEL, FACT_VALUE, FACTS_BOX, NUMBER_INK, CHAMPAGNE, DOCK, FACTS, cardSurface,
  dotStyle, DOT, HAIRLINE, HEADER_GLASS, ICON_BUTTON, NAME_COLOR, NEUTRAL_TAG, PASS, PassTone, SIZE, statusPillStyle, TAG, TEXT2, TINT_TAG
} from "@/lib/leadCardLook";
import FactIcon from "@/components/FactIcon";
import LeadCardMore, { ExpandSection } from "./LeadCardMore";
import LastLogPanel from "./LastLogPanel";
import WhatsAppIcon from "./WhatsAppIcon";

interface DataCardLead {
  id: string;
  leadHistoryId: string;
  name: string;
  mobile: string;
  source?: string | null;
  status: LeadStatus;
  board_stage?: string | null;
  call_count: number;
  assigned_at?: string | null;
}

// Same props as the old DataCard.
interface DataCardProps {
  lead: DataCardLead;
  onOpen: (id: string) => void;
  index?: number;
  previouslyWith?: string | null;
  onJourney?: (id: string) => void;
}

function DataCardV2({ lead, onOpen, index = 0, previouslyWith, onJourney }: DataCardProps) {
  const [expanded, setExpanded] = useState(false);
  // Same attempt rule as the old card (auto-recycle only while still in Leads and NEW / NC / SO).
  const inLeadsStage = !lead.board_stage || lead.board_stage === "LEADS";
  const stillAtRisk = inLeadsStage && (lead.status === "NEW" || lead.status === "NOT_CONNECTED" || lead.status === "SWITCHED_OFF");
  const attemptsLeft = Math.max(MAX_DATA_ATTEMPTS - lead.call_count, 0);
  const showAttemptWarning = stillAtRisk && attemptsLeft <= 1;
  const stageText = oldDataStageText(lead.board_stage);
  const callsText = oldDataCallsText(lead.call_count, stillAtRisk, attemptsLeft);

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

  const tone: PassTone = showAttemptWarning ? "OVERDUE" : !inLeadsStage ? "FOLLOW_UP" : "NEW";
  const look = PASS[tone];
  const statusLabel = LEAD_STATUS_DISPLAY[lead.status]?.label || lead.status;
  const initial = lead.name?.charAt(0)?.toUpperCase() || "?";
  const dot = (color: string) => <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={dotStyle(color)} aria-hidden="true" />;

  return (
    <motion.div
      id={`data-card-${lead.id}`}
      data-card="v2"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index, 8) * 0.04 }}
      onClick={() => onOpen(lead.id)}
      style={cardSurface(tone)}
      className={`${leadCardFont.className} relative w-full min-w-0 scroll-mt-28 overflow-hidden rounded-[18px] border cursor-pointer shadow-[var(--card-shadow)] transition-[transform,box-shadow] duration-200 hover:-translate-y-px hover:shadow-[var(--card-shadow-hover)] focus-within:ring-2 focus-within:ring-slate-300 motion-reduce:transition-none motion-reduce:hover:translate-y-0`}
    >
      <div className="h-[3px]" style={{ background: look.line }} aria-hidden="true" />
      <div className={`flex flex-wrap items-center gap-1.5 px-3.5 py-1.5 ${HEADER_GLASS}`} style={{ background: look.header }}>
        <span className="text-[11px] font-bold tabular-nums" style={{ color: CHAMPAGNE.text }}>{index + 1}</span>
        <span className={TAG} style={statusPillStyle(lead.status)}>{statusLabel}</span>
      </div>

      <div className="flex flex-col gap-2 px-3.5 pt-2.5 pb-3">
        <div className="flex flex-col gap-2 min-[420px]:flex-row min-[420px]:items-start min-[420px]:gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-extrabold" style={{ background: "#eef2f6", color: TEXT2, boxShadow: `inset 0 0 0 1px ${HAIRLINE}` }}>
              {initial}
            </span>
            <div className="min-w-0 flex-1">
              <p title={lead.name} className={`${SIZE.name} break-words line-clamp-2`} style={{ color: NAME_COLOR }}>{lead.name}</p>
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
            </div>
          </div>
          <LastLogPanel
            id={lead.leadHistoryId}
            version={`${lead.status}|${lead.call_count}|${lead.board_stage ?? ""}`}
            called={lead.call_count > 0}
            resultLabel={lead.status !== "NEW" ? LEAD_STATUS_DISPLAY[lead.status]?.label : null}
            className="min-[420px]:w-[44%] min-[420px]:max-w-[230px] min-[420px]:shrink-0"
          />
        </div>

        {lead.assigned_at && (
          <dl className={FACTS} style={FACTS_BOX}>
            <div className="min-w-0">
              <dt className={FACT_LABEL}><FactIcon name="assigned" />Assigned</dt>
              <dd className={`${FACT_VALUE} tabular-nums`}>{oldAssignedText(lead.assigned_at)}</dd>
            </div>
          </dl>
        )}

        {/* Tags: source, stage and calls / attempts — the old card's words and conditions. */}
        <div className="flex flex-wrap items-center gap-1.5 min-w-0 [&:not(:has(>:not(:empty)))]:hidden">
          {lead.source && (
            <span className={`${TAG} max-w-full`} style={NEUTRAL_TAG} title={`Source: ${lead.source}`}>
              {dot(DOT.slate)}
              <span className="truncate">{lead.source}</span>
            </span>
          )}
          {stageText && <span className={TAG} style={NEUTRAL_TAG}>{stageText}</span>}
          {callsText && (
            <span data-testid="card-attempts" className={TAG} style={showAttemptWarning ? TINT_TAG.hot : NEUTRAL_TAG}>
              {callsText}
            </span>
          )}
        </div>

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

      <div className="px-3.5 empty:hidden" onClick={(e) => e.stopPropagation()}>
        <ExpandSection open={expanded}>
          <div className="mb-3.5 rounded-[14px] px-3 pb-3" style={{ background: "rgba(255,255,255,.8)", boxShadow: `inset 0 0 0 1px ${HAIRLINE}` }}>
            <LeadCardMore leadId={lead.id} leadHistoryId={lead.leadHistoryId} status={lead.status} boardStage={lead.board_stage} accent={look.accent}
              times={lead.assigned_at ? [{ label: "Assigned", value: oldAssignedText(lead.assigned_at) }] : []} />
          </div>
        </ExpandSection>
      </div>
    </motion.div>
  );
}

export default memo(DataCardV2);
