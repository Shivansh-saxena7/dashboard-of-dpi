// Single source of truth for Site Visit -> Revisit -> Booked points.
// Same pattern as lib/calculateStats.ts — loop over raw event rows,
// aggregate, return one object. Written once, imported wherever a
// score is shown (admin leaderboard, employee dashboard, PDF export)
// so the number is guaranteed identical everywhere it appears.

export type SiteVisitEventType = "VISIT" | "REVISIT" | "BOOKED";

// Blueprint (Section 4.6) leaves Booked as "suggested 5-10, confirm
// exact value at build time" — set to 10 here, adjust if a different
// value was intended.
export const LEAD_POINTS = {
  VISIT: 1,
  REVISIT: 1,
  BOOKED: 10,
} as const;

interface SiteVisitEvent {
  event_type: SiteVisitEventType;
}

export function calculateLeadPoints(events: SiteVisitEvent[]) {

  let visitPoints = 0;
  let revisitPoints = 0;
  let bookedPoints = 0;

  events.forEach((event) => {

    switch (event.event_type) {

      case "VISIT":
        visitPoints += LEAD_POINTS.VISIT;
        break;

      case "REVISIT":
        revisitPoints += LEAD_POINTS.REVISIT;
        break;

      case "BOOKED":
        bookedPoints += LEAD_POINTS.BOOKED;
        break;

    }

  });

  const totalPoints = visitPoints + revisitPoints + bookedPoints;

  return {

    visitPoints,

    revisitPoints,

    bookedPoints,

    totalPoints

  };

}
