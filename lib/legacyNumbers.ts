// Legacy numbers register, Phase 1 (2026-10-08) — the browser-side rules
// for reading an employee's old sheet. Only what these return (normalized
// mobile + project/status/visit) is ever sent to the server; client names,
// emails and notes never leave the browser. Pure, so the known-answer
// prebuild check covers it with fake values.

export type LegacyMobileKind =
  | "blank"
  | "valid"                 // already a clean 10-digit mobile
  | "normalized_spaces"     // 10 digits once spaces / dashes are removed
  | "normalized_plus91"     // +91 / 91 prefix removed
  | "normalized_leading0"   // leading 0 removed
  | "multiple"              // more than one number in the cell (each one kept)
  | "bad";                  // anything else (too short, letters, ...)

const MOBILE = /^[6-9]\d{9}$/;

export function normalizeLegacyMobile(raw: string | null | undefined): { kind: LegacyMobileKind; numbers: string[] } {
  const s = (raw ?? "").trim();
  if (!s) return { kind: "blank", numbers: [] };

  const runs = (s.match(/\d[\d\s-]{8,}\d/g) || []).map((r) => r.replace(/\D/g, "")).filter((d) => d.length >= 10);
  if (runs.length > 1) {
    const numbers = Array.from(new Set(runs.map((d) => d.slice(-10)).filter((d) => MOBILE.test(d))));
    return { kind: numbers.length ? "multiple" : "bad", numbers };
  }

  const digits = s.replace(/\D/g, "");
  if (MOBILE.test(digits)) return { kind: /^\d{10}$/.test(s) ? "valid" : "normalized_spaces", numbers: [digits] };
  if (/^91[6-9]\d{9}$/.test(digits)) return { kind: "normalized_plus91", numbers: [digits.slice(2)] };
  if (/^0[6-9]\d{9}$/.test(digits)) return { kind: "normalized_leading0", numbers: [digits.slice(1)] };
  return { kind: "bad", numbers: [] };
}

// A tab's first row is a header only if none of its cells looks like data
// (a phone-ish run of 7+ digits). Otherwise the tab is HEADERLESS: the
// first row is data and columns are only ever shown as "Col 1, Col 2…".
export function isHeaderlessFirstRow(cells: string[]): boolean {
  return cells.some((c) => (c ?? "").replace(/\D/g, "").length >= 7);
}

export type LegacyField = "mobile" | "project" | "status" | "visit";
const GUESS: Record<LegacyField, RegExp> = {
  mobile: /mob|phone|contact|number|whatsapp|cell/i,
  project: /project|property|site/i,
  status: /status|stage|remark|feedback/i,
  visit: /visit/i
};

// Best column for a field from header labels (-1 = none). Headerless tabs
// have no labels, so the Admin picks by column number.
export function guessLegacyColumn(headers: string[], field: LegacyField): number {
  return headers.findIndex((h) => GUESS[field].test(h ?? ""));
}

// Mobile column by CONTENT (for headerless tabs, or when no header
// matches): the column where most of the first 50 rows hold 10+ digits.
// Looks at values only to count them — nothing is returned but an index.
export function guessLegacyMobileColumnByContent(rows: string[][]): number {
  const sample = rows.slice(0, 50);
  const width = Math.max(0, ...sample.map((r) => r.length));
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < width; i++) {
    const score = sample.filter((r) => (r[i] ?? "").replace(/\D/g, "").length >= 10).length;
    if (score > bestScore) { best = i; bestScore = score; }
  }
  return best;
}

// Project / status text guard — same rule as save_legacy_numbers on the
// server: trimmed, at most 60 characters, and fewer than 10 digits (spaces
// and dashes ignored), so a phone number or pasted note never leaves the
// browser. Returns the cleaned text, or null when it must be dropped.
export function cleanLegacyText(value: string | null | undefined): { text: string | null; rejected: boolean } {
  const v = (value ?? "").trim();
  if (!v) return { text: null, rejected: false };
  if (v.length > 60 || v.replace(/[^0-9]/g, "").length >= 10) return { text: null, rejected: true };
  return { text: v, rejected: false };
}

// A "visit" cell counts as visit done unless it is empty or clearly negative.
export function isLegacyVisitDone(value: string | null | undefined): boolean {
  const v = (value ?? "").trim();
  return v !== "" && !/^(no|n|0|not done|pending|-|na|n\/a)$/i.test(v);
}
