// Single source of truth for the WhatsApp-group Daily Report message
// text (Point 4, 2026-08-19 live-production review) — same "one
// function, imported wherever needed" pattern as calculateSLAStatus.ts
// etc. Deliberately separate from shareAssetsViaWhatsApp.ts's
// buildClientMessage: that one is CLIENT-facing (must stay English,
// professional — see that file's own comment on why employee-side
// text must never leak in there). This one is INTERNAL team-group
// text, Hinglish on purpose — matches how the team actually talks
// in-group, and the format the user asked for directly.
export interface WorkReportSummary {
  employeeName: string;
  date: Date;
  calls: number;
  notInterested: number;
  followUps: number;
  visits: number;
  bookings: number;
}

export function buildWorkReportMessage(report: WorkReportSummary): string {
  const dateLabel = report.date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });

  return [
    `📊 Daily Report – ${report.employeeName} – ${dateLabel}`,
    `📞 Calls: ${report.calls}`,
    `❌ Not Interested: ${report.notInterested}`,
    `➡️ Moved to Follow-up: ${report.followUps}`,
    `🏠 Visits: ${report.visits}`,
    `🎉 Bookings: ${report.bookings}`
  ].join("\n");
}
