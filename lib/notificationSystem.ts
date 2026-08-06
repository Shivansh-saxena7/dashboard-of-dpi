// Single source of truth for "which system does this notification
// belong to" and "what should its badge actually say" — same pattern
// as leadStatusDisplay.ts/leadPriorityDisplay.ts, one lookup table
// imported everywhere this decision is needed.

export type NotificationSystem = "LEADS" | "POSTS";

// V1 (Posts-tracking) is the closed, stable system already live in
// production separately — it essentially never gains new
// notification types. An explicit allowlist for IT (not for Leads)
// is the more future-proof direction: anything not in this list
// defaults to "LEADS" below, so a brand-new V2 Lead Engine
// notification type is correctly bucketed the moment it's added,
// without ever needing to touch this file again.
const POST_SYSTEM_TYPES = new Set(["POST_ASSIGNED"]);

export function classifyNotificationSystem(type: string | null | undefined): NotificationSystem {
  if (type && POST_SYSTEM_TYPES.has(type)) return "POSTS";
  return "LEADS";
}

// Every notification.type this app currently writes, mapped to its
// actual human label — replaces a bug where every single
// notification card hardcoded the literal text "POST ASSIGNED"
// regardless of its real type.
const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  POST_ASSIGNED: "Post Assigned",
  LEAD_ASSIGNED: "Lead Assigned",
  DATA_ASSIGNED: "Data Assigned",
  TEAM_LEADER_REASSIGNED: "Reassigned by Team Leader",
  LEAD_REMINDER: "Follow-up Reminder",
  SLA_WARNING: "SLA Warning",
  LEAD_JUNKED: "Lead Junked",
  PROJECT_RULE_STALE: "Project Rule Alert",
  PAUSE_EXPIRY_WARNING: "Pause Ending Soon",
  PAUSE_EXPIRED: "Pause Ended",
  VISIT_VERIFIED: "Visit Verified",
  VISIT_DENIED: "Visit Not Verified",
  VISIT_VERIFICATION_OVERDUE: "Visit Verification Overdue",
  BOOKING_CELEBRATION: "Booking! 🎉"
};

export function notificationTypeLabel(type: string | null | undefined): string {
  if (!type) return "Notification";
  return NOTIFICATION_TYPE_LABELS[type] || type;
}
