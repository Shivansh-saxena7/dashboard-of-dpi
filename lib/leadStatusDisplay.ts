import { LeadStatus } from "./getValidNextLeadStatuses";

export interface LeadStatusDisplay {
  label: string;
  badgeClassName: string;
}

// Single source of truth for how each lead status is labeled/colored
// across the Lead Manager UI (list, detail, and later admin views) —
// written once, imported wherever a status is shown, same principle
// as every other lib/ file in this project.
export const LEAD_STATUS_DISPLAY: Record<LeadStatus, LeadStatusDisplay> = {
  NEW: {
    label: "New",
    badgeClassName: "bg-amber-50 text-amber-700 border border-amber-200"
  },
  CONNECTED: {
    label: "Connected",
    badgeClassName: "bg-cyan-50 text-cyan-700 border border-cyan-200"
  },
  NOT_CONNECTED: {
    label: "Not Connected",
    badgeClassName: "bg-slate-100 text-slate-600 border border-slate-200"
  },
  SWITCHED_OFF: {
    label: "Switched Off",
    badgeClassName: "bg-slate-100 text-slate-600 border border-slate-200"
  },
  NOT_INTERESTED: {
    label: "Not Interested",
    badgeClassName: "bg-red-50 text-red-600 border border-red-200"
  },
  CONVERTED: {
    label: "Converted",
    badgeClassName: "bg-green-50 text-green-700 border border-green-200"
  },
  JUNK: {
    label: "Junk",
    badgeClassName: "bg-slate-200 text-slate-500 border border-slate-300"
  }
};
