"use client";

import { memo, useState } from "react";
import { motion } from "framer-motion";
import { Phone, PencilLine, ChevronDown, PhoneCall } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";
import { LEAD_STATUS_DISPLAY } from "@/lib/leadStatusDisplay";
import { LeadStatus } from "@/lib/getValidNextLeadStatuses";
import { MAX_DATA_ATTEMPTS } from "@/lib/calculateSLAStatus";
import { buildWhatsAppLink } from "@/lib/buildWhatsAppLink";
import { rememberCalledCard } from "@/lib/lastCalledLead";
import { leadCardFont } from "@/lib/leadCardFont";
import {
  formatMobileDisplay, BUTTON_BG,
  callStyle,
  CALL_BUTTON, FACT_LABEL, FACT_VALUE, FACTS_BOX, NUMBER_INK, CHAMPAGNE, DOCK, FACTS,
  cardSurface, dotStyle,
  formatAgo,
  formatAssignedExact,
  formatExactTime,
  HAIRLINE,
  headerChip,
  HEADER_GLASS,
  ICON_BUTTON,
  INK,
  NAME_COLOR,
  NEUTRAL_TAG,
  PASS,
  PassTone,
  SIZE,
  statusPillStyle,
  TAG,
  TEXT2,
  TINT_TAG
} from "@/lib/leadCardLook";
import FactIcon from "@/components/FactIcon";
import SourceChip from "@/components/SourceChip";
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

interface DataCardProps {
  lead: DataCardLead;
  // Takes the id, not a no-arg closure (2026-09-18, matches LeadCard's
  // own onOpen exactly) — lets DataList pass one stable useCallback
  // reference for every card, which is what lets memo below skip
  // re-rendering unchanged cards.
  onOpen: (id: string) => void;
  index?: number;
}

// Deliberately NOT a reuse of LeadCard — no SLA countdown (Data has
// none), no priority badge (Data is always Cold), no project. Attempt-
// count is what matters here, the Data equivalent of LeadCard's SLA
// countdown — auto-recycle triggers at MAX_DATA_ATTEMPTS while status is
// still NEW/NOT_CONNECTED/SWITCHED_OFF (lib/calculateSLAStatus.ts), so
// that's what gets the header chip and the warning treatment.
//
// Design C "Pass" look (2026-10-09), shared with LeadCard / AdminLeadCard
// via lib/leadCardLook.ts. Presentation only — the attempt rules and the
// call / WhatsApp logging below are unchanged. Wrapped in memo() (2026-09-18
// perf audit) with DataList passing a stable onOpen + memoized lead object.
function DataCard({ lead, onOpen, index = 0 }: DataCardProps) {
  const [expanded, setExpanded] = useState(false);

  // Attempt-count auto-recycle only applies while board_stage is still
  // "LEADS" — once moved to Follow-up/Visit it no longer fires, so the
  // warning must stop showing too.
  const inLeadsStage = !lead.board_stage || lead.board_stage === "LEADS";
  const stillAtRisk =
    inLeadsStage &&
    (lead.status === "NEW" || lead.status === "NOT_CONNECTED" || lead.status === "SWITCHED_OFF");
  const attemptsLeft = Math.max(MAX_DATA_ATTEMPTS - lead.call_count, 0);
  const showAttemptWarning = stillAtRisk && attemptsLeft <= 1;

  // Same fire-and-forget pattern LeadCard uses — logs first-call/
  // first-whatsapp timestamps via the shared RPCs, never blocks the
  // tel:/wa.me link itself from opening.
  function handleCallClick(e: React.MouseEvent) {
    e.stopPropagation();
    rememberCalledCard(lead.id);
    supabase
      .rpc("log_call_click_atomic", { p_lead_history_id: lead.leadHistoryId })
      .then(({ error }) => {
        if (error) console.error("log_call_click_atomic failed:", error.message);
      });
  }

  function handleWhatsAppClick(e: React.MouseEvent) {
    e.stopPropagation();
    supabase
      .rpc("log_whatsapp_click_atomic", { p_lead_history_id: lead.leadHistoryId })
      .then(({ error }) => {
        if (error) console.error("log_whatsapp_click_atomic failed:", error.message);
      });
  }

  // ---- presentation
  const tone: PassTone = showAttemptWarning ? "OVERDUE" : !inLeadsStage ? "FOLLOW_UP" : "NEW";
  const look = PASS[tone];
  const statusLabel = (LEAD_STATUS_DISPLAY[lead.status]?.label || lead.status).toUpperCase();
  const initial = lead.name?.charAt(0)?.toUpperCase() || "?";
  const stageLabel = lead.board_stage === "FOLLOW_UP" ? "Follow-up" : lead.board_stage === "VISIT" ? "Visit" : lead.board_stage === "BOOKING" ? "Booked" : null;
  const nowMs = new Date().getTime();
  const dot = (color: string) => <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={dotStyle(color)} aria-hidden="true" />;
  // Header chip: attempts left (shown once the lead has been called, while it can still auto-recycle).
  const showAttemptChip = stillAtRisk && lead.call_count > 0;

  return (
    <motion.div
      id={`data-card-${lead.id}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index, 8) * 0.04 }}
      onClick={() => onOpen(lead.id)}
      style={cardSurface(tone)}
      className={`${leadCardFont.className} @container relative w-full min-w-0 scroll-mt-28 overflow-hidden rounded-[18px] border cursor-pointer shadow-[var(--card-shadow)] transition-[transform,box-shadow] duration-200 hover:-translate-y-px hover:shadow-[var(--card-shadow-hover)] focus-within:ring-2 focus-within:ring-slate-300 motion-reduce:transition-none motion-reduce:hover:translate-y-0`}
    >
      {/* 3px accent line + slim header: position, source, status | attempts chip */}
      <div className="h-[3px]" style={{ background: look.line }} aria-hidden="true" />
      <div className={`flex items-center justify-between gap-2 px-3.5 py-1.5 ${HEADER_GLASS}`} style={{ background: look.header }}>
        <div data-header-tags className="flex min-w-0 flex-wrap @[340px]:flex-nowrap items-center gap-1 @[360px]:gap-1.5 overflow-hidden [&>span:not(:first-child)]:shrink-0 @max-[420px]:[&>span]:px-1.5">
          {/* Position in the current list — a visual count, not a lead ID. */}
          <span className="text-[11px] font-bold tabular-nums" style={{ color: CHAMPAGNE.text }}>#{index + 1}</span>
          <span className={`${TAG} tracking-[.04em]`} style={statusPillStyle(lead.status)}>{statusLabel}</span>
        </div>
        {showAttemptChip && (
          <span
            title={`Auto-recycles after ${MAX_DATA_ATTEMPTS} attempts`}
            className={`inline-flex h-[24px] shrink-0 items-center gap-1 rounded-full bg-white px-2.5 tabular-nums ${showAttemptWarning ? "motion-safe:animate-pulse" : ""}`}
            style={headerChip(look.accent)}
          >
            <PhoneCall size={12} strokeWidth={2} aria-hidden="true" />
            <span className="text-[12px] font-extrabold whitespace-nowrap">
              {attemptsLeft}
              <span className="hidden @[420px]:inline"> attempt{attemptsLeft === 1 ? "" : "s"}</span> left
            </span>
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2 px-3.5 pt-2.5 pb-3">
        {/* Identity + last log: side by side on a wide card, stacked on a narrow one. */}
        <div className="flex flex-col gap-2 @[400px]:flex-row @[400px]:items-start @[400px]:gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-extrabold" style={{ background: "#eef2f6", color: TEXT2, boxShadow: `inset 0 0 0 1px ${HAIRLINE}` }} aria-hidden="true">
              {initial}
            </span>
            <div className="min-w-0 flex-1">
              <p title={lead.name} className={`${SIZE.name} break-words line-clamp-2`} style={{ color: NAME_COLOR }}>{lead.name}</p>
              {/* Tap the number to copy it (Call button unchanged); source chip on the same line. */}
              <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard?.writeText(lead.mobile).then(() => toast.success("Number copied"), () => {});
                }}
                title="Tap to copy"
                className={`block shrink-0 ${SIZE.number} tabular-nums cursor-copy rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300`}
                style={{ color: NUMBER_INK }}
              >
                {formatMobileDisplay(lead.mobile)}
              </button>
              <SourceChip source={lead.source} inline />
              </div>
            </div>
          </div>
          <LastLogPanel
            lookupKey="lead_history_id"
            id={lead.leadHistoryId}
            version={`${lead.status}|${lead.call_count}|${lead.board_stage ?? ""}`}
            called={lead.call_count > 0}
            resultLabel={lead.status !== "NEW" ? LEAD_STATUS_DISPLAY[lead.status]?.label : null}
            className="@[400px]:w-[44%] @[400px]:max-w-[230px] @[400px]:shrink-0"
          />
        </div>

        {/* Facts row: Assigned (exact · ago) / Calls / Attempts left */}
        <dl className={FACTS} style={FACTS_BOX}>
          <div className="min-w-0">
            <dt className={FACT_LABEL}><FactIcon name="assigned" />Assigned</dt>
            <dd className={`${FACT_VALUE} tabular-nums`}>
              {lead.assigned_at ? (
                <>
                  <span className="whitespace-nowrap">{formatAssignedExact(lead.assigned_at)}</span>{" "}
                  <span className="whitespace-nowrap font-semibold" style={{ color: TEXT2 }}>· {formatAgo(nowMs - new Date(lead.assigned_at).getTime())}</span>
                </>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className={FACT_LABEL}><FactIcon name="calls" />Calls</dt>
            <dd className={`${FACT_VALUE} tabular-nums`}>
              {lead.call_count > 0 ? `${lead.call_count} ${lead.call_count === 1 ? "call" : "calls"}` : "None yet"}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className={FACT_LABEL}><FactIcon name="attempts" />Attempts left</dt>
            <dd className={`${SIZE.factValue} font-bold tabular-nums`} style={{ color: showAttemptWarning ? "#b42318" : INK }}>
              {stillAtRisk ? attemptsLeft : "—"}
            </dd>
          </div>
        </dl>

        {/* Tags: board stage (Data moved past Leads) and the last-attempt warning. Empty row collapses. */}
        <div className="flex flex-wrap items-center gap-1.5 min-w-0 [&:not(:has(>:not(:empty)))]:hidden">
          {showAttemptWarning && <span className={TAG} style={TINT_TAG.callFirst}>Last attempt</span>}
          {stageLabel && (
            <span className={TAG} style={NEUTRAL_TAG}>
              {dot(look.accent)}
              {stageLabel}
            </span>
          )}
        </div>

        {/* Dashed divider, then the action stub */}
        <div className="border-t border-dashed" style={{ borderColor: CHAMPAGNE.line }} aria-hidden="true" />
        <div className={DOCK}>
          <motion.a href={`tel:${lead.mobile}`} onClick={handleCallClick} whileTap={{ scale: 0.98 }} style={callStyle(tone)} className={`${CALL_BUTTON} ${SIZE.button}`}>
            <Phone size={16} strokeWidth={2} />
            Call now
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
            <LeadCardMore
              leadId={lead.id}
              leadHistoryId={lead.leadHistoryId}
              status={lead.status}
              boardStage={lead.board_stage}
              contacted={lead.status === "NEW" && lead.call_count > 0}
              accent={look.accent}
              times={lead.assigned_at ? [{ label: "Assigned", value: formatExactTime(lead.assigned_at) }] : []}
            />
          </div>
        </ExpandSection>
      </div>
    </motion.div>
  );
}

export default memo(DataCard);
