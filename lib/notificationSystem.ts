// Single source of truth for "which system does this notification
// belong to" and "what should its badge actually say" — same pattern
// as leadStatusDisplay.ts/leadPriorityDisplay.ts, one lookup table
// imported everywhere this decision is needed.

export type NotificationSystem = "LEADS" | "POSTS" | "TICKETS";

// V1 (Posts-tracking) is the closed, stable system already live in
// production separately — it essentially never gains new
// notification types. An explicit allowlist for IT (not for Leads)
// is the more future-proof direction: anything not in this list
// defaults to "LEADS" below, so a brand-new V2 Lead Engine
// notification type is correctly bucketed the moment it's added,
// without ever needing to touch this file again.
const POST_SYSTEM_TYPES = new Set(["POST_ASSIGNED"]);

// Tickets is a genuinely third, independent system — company-wide
// (HR/Accounts/Sales-Coordinator/Admin), not part of the Lead Engine
// the "LEADS" default is really meant for. Explicit allowlist here
// too (same reasoning as POST_SYSTEM_TYPES) rather than letting it
// fall into "LEADS" by default and get mislabeled.
const TICKET_SYSTEM_TYPES = new Set(["TICKET_RAISED", "TICKET_RESOLVED"]);

export function classifyNotificationSystem(type: string | null | undefined): NotificationSystem {
  if (type && POST_SYSTEM_TYPES.has(type)) return "POSTS";
  if (type && TICKET_SYSTEM_TYPES.has(type)) return "TICKETS";
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
  RECYCLE_TOMORROW: "Recycle tomorrow",
  PAUSE_EXPIRED: "Pause Ended",
  VISIT_VERIFIED: "Visit Verified",
  VISIT_DENIED: "Visit Not Verified",
  VISIT_VERIFICATION_OVERDUE: "Visit Verification Overdue",
  BOOKING_CELEBRATION: "Booking! 🎉",
  TICKET_RAISED: "New Ticket",
  SYSTEM_ANOMALY_ERROR: "System Error",
  SYSTEM_ANOMALY_WARNING: "System Warning",
  TICKET_RESOLVED: "Ticket Resolved"
};

export function notificationTypeLabel(type: string | null | undefined): string {
  if (!type) return "Notification";
  return notificationStyle(type).label;
}

// Notification look (2026-10-08): every type gets a group colour, an icon
// and an English label, so types can be told apart at a glance. Colours
// are fixed Tailwind class strings (a -100/-50 background with -800/-900
// text, readable on light and dark backgrounds). Presentation only — how
// and when notifications are created is untouched.
export type NotificationGroup =
  | "NEW_LEAD"      // blue
  | "FOLLOW_UP"     // violet
  | "SLA"           // red (urgent) / amber (heads-up)
  | "JUNK"          // slate
  | "VISIT"         // teal
  | "PEOPLE"        // green — attendance, HR, expenses, tickets
  | "SYSTEM"        // rose
  | "CELEBRATION"   // gold
  | "OTHER";

const GROUP_STYLE: Record<NotificationGroup | "SLA_URGENT", { iconBox: string; chip: string; groupLabel: string }> = {
  NEW_LEAD: { iconBox: "bg-blue-100 text-blue-800", chip: "bg-blue-50 text-blue-800 border-blue-200", groupLabel: "New lead" },
  FOLLOW_UP: { iconBox: "bg-violet-100 text-violet-800", chip: "bg-violet-50 text-violet-800 border-violet-200", groupLabel: "Follow-up" },
  SLA: { iconBox: "bg-amber-100 text-amber-900", chip: "bg-amber-50 text-amber-900 border-amber-200", groupLabel: "Timer" },
  SLA_URGENT: { iconBox: "bg-red-100 text-red-800", chip: "bg-red-50 text-red-800 border-red-200", groupLabel: "SLA" },
  JUNK: { iconBox: "bg-slate-200 text-slate-800", chip: "bg-slate-100 text-slate-800 border-slate-300", groupLabel: "Junk / recycle" },
  VISIT: { iconBox: "bg-teal-100 text-teal-800", chip: "bg-teal-50 text-teal-800 border-teal-200", groupLabel: "Visit" },
  PEOPLE: { iconBox: "bg-green-100 text-green-800", chip: "bg-green-50 text-green-800 border-green-200", groupLabel: "Attendance & HR" },
  SYSTEM: { iconBox: "bg-rose-100 text-rose-800", chip: "bg-rose-50 text-rose-800 border-rose-200", groupLabel: "System" },
  CELEBRATION: { iconBox: "bg-yellow-100 text-yellow-900", chip: "bg-yellow-50 text-yellow-900 border-yellow-300", groupLabel: "Celebration" },
  OTHER: { iconBox: "bg-slate-100 text-slate-700", chip: "bg-slate-50 text-slate-700 border-slate-200", groupLabel: "Notification" }
};

// Full-row tint (2026-10-09): white → a soft 4–6% tint of the group's hue
// (a touch stronger while unread), a hairline border in the same hue and a
// 3px accent bar. Hex values so the gradient can be built inline.
const ROW_TINT: Record<NotificationGroup | "SLA_URGENT", { read: string; unread: string; border: string; bar: string }> = {
  NEW_LEAD: { read: "#f3f7ff", unread: "#e8f0ff", border: "#dbe7fe", bar: "#3b82f6" },
  FOLLOW_UP: { read: "#f7f4ff", unread: "#efe8ff", border: "#e7defd", bar: "#8b5cf6" },
  SLA: { read: "#fffaf0", unread: "#fff2da", border: "#fbe5bd", bar: "#f59e0b" },
  SLA_URGENT: { read: "#fff5f5", unread: "#ffe9e9", border: "#fbd5d5", bar: "#ef4444" },
  JUNK: { read: "#f6f8fa", unread: "#eef2f6", border: "#e2e8f0", bar: "#94a3b8" },
  VISIT: { read: "#f2fbf9", unread: "#e4f7f2", border: "#c9eee5", bar: "#14b8a6" },
  PEOPLE: { read: "#f2fbf5", unread: "#e5f7eb", border: "#cdeed8", bar: "#22c55e" },
  SYSTEM: { read: "#fff4f6", unread: "#ffe8ee", border: "#fad3dd", bar: "#f43f5e" },
  CELEBRATION: { read: "#fffcee", unread: "#fff6d4", border: "#f6e3a1", bar: "#eab308" },
  OTHER: { read: "#f7f9fb", unread: "#f0f3f7", border: "#e2e8f0", bar: "#94a3b8" }
};

// Every type this app writes (notification table + code + DB functions).
const NOTIFICATION_TYPES: Record<string, { label: string; icon: string; group: NotificationGroup | "SLA_URGENT" }> = {
  // New lead / data / reassignment — blue
  LEAD_ASSIGNED: { label: "Lead Assigned", icon: "🎯", group: "NEW_LEAD" },
  DATA_ASSIGNED: { label: "Data Assigned", icon: "📋", group: "NEW_LEAD" },
  TEAM_LEADER_REASSIGNED: { label: "Reassigned by Team Leader", icon: "🔁", group: "NEW_LEAD" },
  LEAD_TRANSFER_REQUESTED: { label: "Lead Transfer Requested", icon: "🔁", group: "NEW_LEAD" },
  LEAD_TRANSFER_APPROVED: { label: "Lead Transfer Approved", icon: "✅", group: "NEW_LEAD" },
  LEAD_TRANSFER_REJECTED: { label: "Lead Transfer Rejected", icon: "✖️", group: "NEW_LEAD" },
  POST_ASSIGNED: { label: "Post Assigned", icon: "📌", group: "NEW_LEAD" },
  // Follow-up — violet
  LEAD_REMINDER: { label: "Follow-up Reminder", icon: "⏰", group: "FOLLOW_UP" },
  // SLA / timers — red (urgent) and amber (heads-up)
  SLA_WARNING: { label: "SLA Warning", icon: "⚠️", group: "SLA_URGENT" },
  RECYCLE_TOMORROW: { label: "Recycle tomorrow", icon: "⏳", group: "SLA" },
  PAUSE_EXPIRY_WARNING: { label: "Pause Ending Soon", icon: "⏸️", group: "SLA" },
  PAUSE_EXPIRED: { label: "Pause Ended", icon: "▶️", group: "SLA" },
  PROJECT_RULE_STALE: { label: "Project Rule Alert", icon: "📐", group: "SLA" },
  STATUS_UPDATE_NO_CONTACT_CLICK: { label: "Status Updated Without a Call", icon: "📵", group: "SLA" },
  // Junk / recycle — slate
  LEAD_JUNKED: { label: "Lead Junked", icon: "♻️", group: "JUNK" },
  // Visits — teal
  VISIT_VERIFIED: { label: "Visit Verified", icon: "📍", group: "VISIT" },
  VISIT_DENIED: { label: "Visit Not Verified", icon: "📍", group: "VISIT" },
  VISIT_VERIFICATION_OVERDUE: { label: "Visit Verification Overdue", icon: "🕒", group: "VISIT" },
  CATCHER_LEAD_VISIT: { label: "Your Lead Was Visited", icon: "🤝", group: "VISIT" },
  // Attendance, HR, expenses, tickets — green
  ATTENDANCE_GAP_NUDGE: { label: "No Recent Attendance", icon: "🕘", group: "PEOPLE" },
  LEAVE_OPEN_ENDED_NUDGE: { label: "Open-ended Leave", icon: "🌴", group: "PEOPLE" },
  HR_DOCUMENT_UPLOADED: { label: "HR Document Uploaded", icon: "📄", group: "PEOPLE" },
  EXPENSE_SUBMITTED: { label: "Expense Submitted", icon: "🧾", group: "PEOPLE" },
  EXPENSE_APPROVED: { label: "Expense Approved", icon: "🧾", group: "PEOPLE" },
  EXPENSE_REJECTED: { label: "Expense Rejected", icon: "🧾", group: "PEOPLE" },
  EXPENSE_PAID: { label: "Expense Paid", icon: "💸", group: "PEOPLE" },
  TICKET_RAISED: { label: "New Ticket", icon: "🎫", group: "PEOPLE" },
  TICKET_RESOLVED: { label: "Ticket Resolved", icon: "🎫", group: "PEOPLE" },
  // System — rose
  SYSTEM_ANOMALY_ERROR: { label: "System Error", icon: "🛠️", group: "SYSTEM" },
  SYSTEM_ANOMALY_WARNING: { label: "System Warning", icon: "🛠️", group: "SYSTEM" },
  META_CAPI_FAILED: { label: "Meta Signal Failed", icon: "📡", group: "SYSTEM" },
  BACKUP_FAILED: { label: "Backup Failed", icon: "💾", group: "SYSTEM" },
  BACKUP_PARTIAL_FAILURE: { label: "Backup Partly Failed", icon: "💾", group: "SYSTEM" },
  // Celebration — gold
  BOOKING_CELEBRATION: { label: "Booking! 🎉", icon: "🎉", group: "CELEBRATION" },
  BIRTHDAY_CELEBRATION: { label: "Birthday", icon: "🎂", group: "CELEBRATION" }
};

export interface NotificationStyle {
  label: string;
  icon: string;
  group: NotificationGroup;
  groupLabel: string;
  iconBoxClass: string;   // the round icon box
  chipClass: string;      // the small label chip
  row: { read: string; unread: string; border: string; bar: string }; // full-row tint
}

export function notificationStyle(type: string | null | undefined): NotificationStyle {
  const entry = type ? NOTIFICATION_TYPES[type] : undefined;
  if (!entry) {
    const fallbackLabel = type
      ? NOTIFICATION_TYPE_LABELS[type] || type.toLowerCase().split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
      : "Notification";
    const s = GROUP_STYLE.OTHER;
    return { label: fallbackLabel, icon: "🔔", group: "OTHER", groupLabel: s.groupLabel, iconBoxClass: s.iconBox, chipClass: s.chip, row: ROW_TINT.OTHER };
  }
  const s = GROUP_STYLE[entry.group];
  return {
    label: entry.label,
    icon: entry.icon,
    group: entry.group === "SLA_URGENT" ? "SLA" : entry.group,
    groupLabel: s.groupLabel,
    iconBoxClass: s.iconBox,
    chipClass: s.chip,
    row: ROW_TINT[entry.group]
  };
}

// Notification-Call-Action (2026-09-23) — deliberately narrow, approved
// scope: only "you should call this lead right now" types get the
// Call/View-Lead buttons in NotificationModal. Explicitly excludes
// decision-type notifications (VISIT_VERIFICATION_OVERDUE, TICKET_*,
// PROJECT_RULE_STALE — Admin/Coordinator-facing config or approval
// alerts, not "go call someone") and anti-gaming/celebration types —
// bolting a Call button onto those would be confusing, not helpful.
const CALL_ACTION_TYPES = new Set([
  "LEAD_ASSIGNED",
  "DATA_ASSIGNED",
  "LEAD_REMINDER",
  "SLA_WARNING",
  "PAUSE_EXPIRY_WARNING",
  "PAUSE_EXPIRED",
  "RECYCLE_TOMORROW"
]);

export function hasCallAction(type: string | null | undefined): boolean {
  return Boolean(type && CALL_ACTION_TYPES.has(type));
}
