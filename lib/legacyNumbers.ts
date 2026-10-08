// Legacy numbers register (2026-10-08) — the browser-side rules for reading
// an employee's old sheet. Only the MOBILE column is read: each tab's
// mobile column is detected (header or headerless), numbers are
// normalized, and only the normalized mobile + the tab's name are ever sent
// to the server. No other column (names, projects, notes …) is profiled,
// shown or sent. Pure, so the known-answer prebuild check covers it with
// fake values.

export type LegacyMobileKind =
  | "blank"
  | "valid"                 // already a clean 10-digit mobile
  | "normalized_spaces"     // 10 digits once spaces / dashes are removed
  | "normalized_plus91"     // +91 / 91 prefix removed
  | "normalized_leading0"   // leading 0 removed
  | "multiple"              // more than one number in the cell (each one kept)
  | "bad";                  // anything else (too short, letters, ...)

const MOBILE = /^[6-9][0-9]{9}$/;
const digitCount = (v: string) => v.replace(/[^0-9]/g, "").length;

export function normalizeLegacyMobile(raw: string | null | undefined): { kind: LegacyMobileKind; numbers: string[] } {
  const s = (raw ?? "").trim();
  if (!s) return { kind: "blank", numbers: [] };

  const runs = (s.match(/[0-9][0-9\s-]{8,}[0-9]/g) || []).map((r) => r.replace(/[^0-9]/g, "")).filter((d) => d.length >= 10);
  if (runs.length > 1) {
    const numbers = Array.from(new Set(runs.map((d) => d.slice(-10)).filter((d) => MOBILE.test(d))));
    return { kind: numbers.length ? "multiple" : "bad", numbers };
  }

  const digits = s.replace(/[^0-9]/g, "");
  if (MOBILE.test(digits)) return { kind: /^[0-9]{10}$/.test(s) ? "valid" : "normalized_spaces", numbers: [digits] };
  if (/^91[6-9][0-9]{9}$/.test(digits)) return { kind: "normalized_plus91", numbers: [digits.slice(2)] };
  if (/^0[6-9][0-9]{9}$/.test(digits)) return { kind: "normalized_leading0", numbers: [digits.slice(1)] };
  return { kind: "bad", numbers: [] };
}

// A first row holding a phone-like value (10+ digits once spaces/dashes are
// removed) is DATA, never a header — the tab is then headerless and its
// columns are only ever shown as "Col 1, Col 2…". (10, not fewer: a header
// cell can hold a date like 17/08/2026, which is only 8 digits.)
export function isHeaderlessFirstRow(cells: string[]): boolean {
  return cells.some((c) => digitCount(c ?? "") >= 10);
}

// Mobile column by CONTENT: the column where most of the first 50 rows
// hold 10+ digits. Values are only counted — nothing but an index returns.
export function guessLegacyMobileColumnByContent(rows: string[][]): number {
  const sample = rows.slice(0, 50);
  const width = Math.max(0, ...sample.map((r) => r.length));
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < width; i++) {
    const score = sample.filter((r) => digitCount(r[i] ?? "") >= 10).length;
    if (score > bestScore) { best = i; bestScore = score; }
  }
  return best;
}

const HEADER_WORDS = /^(s\.?\s*no|sr|name|client|customer|number|mobile|phone|contact|email|e-?mail|mail|project|property|site|status|stage|remark|remarks|feedback|visit|date|budget|size|inventory|rate|assigned)/i;

// Header row by content: a phone-like value in the first row means data;
// two or more header-ish words mean header; otherwise it is a header only
// if the mobile column's first cell is not a number while most rows below
// are.
export function detectLegacyHeaderRow(matrix: string[][]): boolean {
  if (matrix.length === 0) return false;
  const first = matrix[0].map((c) => (c ?? "").trim());
  if (isHeaderlessFirstRow(first)) return false;
  if (first.filter((c) => HEADER_WORDS.test(c)).length >= 2) return true;
  const rest = matrix.slice(1, 51);
  const mobileCol = guessLegacyMobileColumnByContent(rest);
  if (mobileCol < 0) return false;
  const restPhoneShare = rest.filter((r) => digitCount(r[mobileCol] ?? "") >= 10).length / Math.max(1, rest.length);
  return digitCount(first[mobileCol] ?? "") < 10 && restPhoneShare >= 0.6;
}

// One column's fill / number share — for the "84% bhara · 97% number jaise"
// line under the mobile dropdown. Counts only.
export function legacyMobileColumnStats(rows: string[][], col: number): { fillRate: number; phoneShare: number } {
  if (col < 0 || rows.length === 0) return { fillRate: 0, phoneShare: 0 };
  const values = rows.map((r) => (r[col] ?? "").trim()).filter(Boolean);
  return {
    fillRate: values.length / rows.length,
    phoneShare: values.length ? values.filter((v) => digitCount(v) >= 10).length / values.length : 0
  };
}

// Per tab: header or not, and which column holds the mobile numbers.
export function detectLegacyMobileColumn(matrix: string[][]): { hasHeader: boolean; mobileCol: number } {
  const hasHeader = detectLegacyHeaderRow(matrix);
  const rows = hasHeader ? matrix.slice(1) : matrix;
  return { hasHeader, mobileCol: guessLegacyMobileColumnByContent(rows) };
}
