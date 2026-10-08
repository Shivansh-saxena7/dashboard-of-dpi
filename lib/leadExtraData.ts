// Lead "extra data" display (2026-10-08). leads.extra_data holds the CSV
// columns the import wizard didn't map to a lead field, keyed by the raw
// sheet header — so the same question arrives spelled several ways
// ("budget", "BUdget", "Purcahsing Timeline"...). This turns that jsonb
// into one clean, English, labelled list for the lead modal. Display only:
// nothing here is written back, and the import path is untouched.

export interface ExtraDataItem {
  label: string;
  value: string;
}

// Header -> comparison key: lowercase, letters/digits only, so case,
// spaces, punctuation and underscores don't matter.
function squash(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Known questions, matched on the squashed header. A rule matches when the
// squashed header contains every fragment of one of its patterns.
const LABEL_RULES: { label: string; patterns: string[][] }[] = [
  { label: "Budget", patterns: [["budget"]] },
  // "Purchase Timeline", "Purcahsing Timeline", "purchasing time line"...
  { label: "Purchase timeline", patterns: [["purc", "time"], ["purch", "time"], ["buying", "time"]] },
  { label: "Planning to invest", patterns: [["planning", "invest"], ["plan", "invest"], ["when", "invest"]] },
  { label: "Requirement", patterns: [["requirement"], ["requirment"], ["require"]] },
  { label: "Purpose", patterns: [["purpose"]] },
  { label: "Property type", patterns: [["property", "type"], ["propertytype"]] },
  { label: "Configuration", patterns: [["configuration"], ["bhk"]] },
  { label: "Preferred location", patterns: [["location"], ["locality"]] },
  { label: "City", patterns: [["city"]] },
  { label: "Occupation", patterns: [["occupation"], ["profession"]] },
  { label: "Remarks", patterns: [["remark"], ["comment"]] },
  { label: "Campaign", patterns: [["campaign"]] },
  { label: "Ad name", patterns: [["adname"]] },
  { label: "Form name", patterns: [["formname"]] },
  { label: "Platform", patterns: [["platform"]] }
];

// Never shown: serial-number columns and internal bookkeeping keys.
const HIDDEN_EXACT = new Set(["sno", "srno", "serialno", "serialnumber", "sn", "slno", "no", "id", "originalleadtime"]);

function isHidden(header: string): boolean {
  const k = squash(header);
  return k === "" || HIDDEN_EXACT.has(k);
}

function labelFor(header: string): string {
  const k = squash(header);
  for (const rule of LABEL_RULES) {
    if (rule.patterns.some((frags) => frags.every((f) => k.includes(f)))) return rule.label;
  }
  // Unknown header: tidy it into Title Case.
  const words = header.replace(/[_\-.:]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase().split(" ");
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

// Returns labelled rows in first-seen order. Two headers that resolve to
// the same label are merged into one row (different values joined with
// " · "; an identical value isn't repeated).
export function parseLeadExtraData(extra: unknown): ExtraDataItem[] {
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) return [];
  const byLabel = new Map<string, string[]>();
  for (const [header, raw] of Object.entries(extra as Record<string, unknown>)) {
    if (isHidden(header)) continue;
    const value = toText(raw);
    if (!value || value === "-" || value.toLowerCase() === "null" || value.toLowerCase() === "n/a") continue;
    const label = labelFor(header);
    if (!label) continue;
    const values = byLabel.get(label) || [];
    if (!values.some((v) => v.toLowerCase() === value.toLowerCase())) values.push(value);
    byLabel.set(label, values);
  }
  return [...byLabel.entries()].map(([label, values]) => ({ label, value: values.join(" · ") }));
}
