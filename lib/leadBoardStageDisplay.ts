export type BoardStage = "LEADS" | "FOLLOW_UP" | "VISIT" | "BOOKING";

export interface BoardStageDisplay {
  stage: BoardStage;
  label: string;
  emoji: string;
}

// Single source of truth for the 4 Lead Board tabs, in display order
// — used by LeadList (tab bar) and LeadDetailModal (move-button
// labels), so the emoji/label pairing is never duplicated.
export const BOARD_STAGES: BoardStageDisplay[] = [
  { stage: "LEADS", label: "Leads", emoji: "📋" },
  { stage: "FOLLOW_UP", label: "Follow-up", emoji: "📞" },
  { stage: "VISIT", label: "Visit", emoji: "🏠" },
  { stage: "BOOKING", label: "Booking", emoji: "✅" }
];
