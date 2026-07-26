export type LeadPriority = "cold" | "warm" | "hot";

export interface LeadPriorityDisplay {
  label: string;
  badgeClassName: string;
}

// Single source of truth for lead priority labels/colors — same
// reasoning as leadStatusDisplay.ts.
export const LEAD_PRIORITY_DISPLAY: Record<LeadPriority, LeadPriorityDisplay> = {
  cold: {
    label: "Cold",
    badgeClassName: "bg-slate-100 text-slate-500"
  },
  warm: {
    label: "Warm",
    badgeClassName: "bg-orange-50 text-orange-600"
  },
  hot: {
    label: "Hot",
    badgeClassName: "bg-red-50 text-red-600"
  }
};
