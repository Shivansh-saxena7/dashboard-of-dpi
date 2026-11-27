// Words and rules of the old admin card (components/AdminLeadCard.tsx, unchanged) for AdminLeadCardV2 (2026-11-27
// admin card port). The old card keeps its own inline copy (it must stay byte-for-byte the same while the flag is
// off); this is a line-by-line copy of its lines 194-287 and 375-475 as one pure function, so the new card shows the
// same badges, in the same cases, with the same words. tests/e2e/admin-card-parity.spec.ts renders both on the same
// data and fails on any difference; scripts/check-admin-card-port.js holds this function to known answers.
import { FOLLOWUP_INACTIVITY_WARNING_DAYS, FOLLOWUP_INACTIVITY_RECYCLE_DAYS, getRecycleCutoff, type RecycleCutoffReason } from "@/lib/calculateSLAStatus";
import { isLeadTerminal } from "@/lib/isLeadTerminal";
import { DAY_MS, timerCalendar, workingElapsedMs } from "@/lib/workingCalendar";
import { BOARD_STAGES } from "@/lib/leadBoardStageDisplay";
import { RECYCLE_REASON_LABEL, formatDaysHoursLeft } from "@/lib/cardText";

export interface AdminCardLeadInput {
  status: string;
  boardStage: string;
  recycleCount: number;
  assignedAt: string | null;
  leadType: string;
  callCount: number;
  pausedUntil: string | null;
  pauseReason: string | null;
  lastActivityAt: string | null;
  outcomeAt?: string | null;
  isPersonalLead?: boolean;
}

export type AdminBadgeTone = "red" | "amber" | "green" | "blue" | "teal" | "slate";
export interface AdminBadge {
  key: "pause" | "stale" | "cooldown" | "leave";
  text: string;
  tone: AdminBadgeTone;
  pulse?: boolean;
  // The old card's hover text ("Exact time: ..."); the new card also shows it as a visible line (phones have no hover).
  exact?: string;
}

export interface AdminCardState {
  isTerminal: boolean;
  isPaused: boolean;
  recycleCutoff: { cutoffAt: Date; reason: RecycleCutoffReason } | null;
  recyclingNow: boolean;
  stageText: string | null;
  calledText: string | null;
  badges: AdminBadge[];
}

const exactText = (d: Date) => `Exact time: ${d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;

// workingCalendar: the value of useWorkingCalendar() (same argument the old card passes on).
export function adminCardState(
  lead: AdminCardLeadInput,
  isOwnerOnLeave: boolean,
  workingCalendar: Parameters<typeof timerCalendar>[0],
  nowMs: number
): AdminCardState {
  const isTerminal = isLeadTerminal(lead.status as never, lead.boardStage as never);
  const isPaused =
    !isTerminal && (lead.pauseReason === "VISIT_PENDING_VERIFICATION" || Boolean(lead.pausedUntil && new Date(lead.pausedUntil).getTime() > nowMs));
  const workingCal = timerCalendar(workingCalendar);
  const daysSinceActivity = lead.lastActivityAt
    ? workingCal
      ? workingElapsedMs(workingCal, lead.lastActivityAt, nowMs) / DAY_MS
      : (nowMs - new Date(lead.lastActivityAt).getTime()) / (1000 * 60 * 60 * 24)
    : null;
  const isBeyondLeadsStage = lead.leadType !== "DATA" && lead.boardStage !== "LEADS";
  const isStale =
    !isTerminal && !isPaused && !isOwnerOnLeave && !lead.isPersonalLead && isBeyondLeadsStage && daysSinceActivity !== null && daysSinceActivity >= FOLLOWUP_INACTIVITY_WARNING_DAYS;
  const isGoingStale = isStale && daysSinceActivity !== null && daysSinceActivity >= FOLLOWUP_INACTIVITY_RECYCLE_DAYS;
  const showOnLeaveBadge = isOwnerOnLeave && !isTerminal && isBeyondLeadsStage;
  const recycleCutoff =
    !isTerminal && !isPaused && !isOwnerOnLeave && !lead.isPersonalLead
      ? getRecycleCutoff(
          {
            status: lead.status as never,
            sla_deadline: null,
            recycle_count: lead.recycleCount,
            board_stage: lead.boardStage,
            paused_until: lead.pausedUntil,
            last_activity_at: lead.lastActivityAt,
            pause_reason: lead.pauseReason,
            assigned_at: lead.assignedAt,
            lead_type: lead.leadType
          },
          lead.outcomeAt ?? null,
          false,
          workingCalendar
        )
      : null;
  const msLeft = recycleCutoff ? recycleCutoff.cutoffAt.getTime() - nowMs : 0;

  const badges: AdminBadge[] = [];
  if (isPaused) {
    const until = lead.pausedUntil ? new Date(lead.pausedUntil).toLocaleDateString([], { month: "short", day: "numeric" }) : "";
    badges.push(
      lead.pauseReason === "VISIT_LOCK"
        ? { key: "pause", text: `🔒 Locked until ${until}`, tone: "green" }
        : lead.pauseReason === "VISIT_PENDING_VERIFICATION"
        ? { key: "pause", text: "⏳ Pending verification", tone: "amber" }
        : { key: "pause", text: `😴 Snoozed until ${until}`, tone: "blue" }
    );
  }
  if (isStale) {
    badges.push({
      key: "stale",
      text: isGoingStale
        ? `⚠️ Recycling now — ${recycleCutoff ? RECYCLE_REASON_LABEL[recycleCutoff.reason] : "Going stale"}`
        : recycleCutoff
        ? `⏳ ${formatDaysHoursLeft(msLeft)} — ${RECYCLE_REASON_LABEL[recycleCutoff.reason]}`
        : "⏳ Needs follow-up",
      tone: isGoingStale ? "red" : "amber",
      pulse: isGoingStale,
      exact: recycleCutoff ? exactText(recycleCutoff.cutoffAt) : undefined
    });
  }
  if (!isStale && recycleCutoff) {
    badges.push({
      key: "cooldown",
      text: msLeft <= 0 ? `⚠️ Recycling now — ${RECYCLE_REASON_LABEL[recycleCutoff.reason]}` : `⏳ ${formatDaysHoursLeft(msLeft)} — ${RECYCLE_REASON_LABEL[recycleCutoff.reason]}`,
      tone: msLeft <= 0 ? "red" : "slate",
      pulse: msLeft <= 0,
      exact: exactText(recycleCutoff.cutoffAt)
    });
  }
  if (showOnLeaveBadge) badges.push({ key: "leave", text: "🌴 Timer Paused — Owner on Leave", tone: "teal" });

  const stage = BOARD_STAGES.find((b) => b.stage === lead.boardStage);
  return {
    isTerminal,
    isPaused,
    recycleCutoff,
    recyclingNow: Boolean(isGoingStale || (!isStale && recycleCutoff && msLeft <= 0)),
    stageText: lead.leadType !== "DATA" && stage ? `${stage.emoji} ${stage.label}` : null,
    calledText: lead.callCount > 0 ? `Called ${lead.callCount}x` : null,
    badges
  };
}

// Old card: "Nov 10, 10:29 AM" (browser locale).
export const adminAssignedText = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
