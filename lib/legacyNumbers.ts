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

// A first row holding a phone-like value (10+ digits once spaces/dashes are
// removed) is DATA, never a header — the tab is then headerless and its
// columns are only ever shown as "Col 1, Col 2…". (10, not fewer: a header
// cell can hold a date like 17/08/2026, which is only 8 digits.)
export function isHeaderlessFirstRow(cells: string[]): boolean {
  return cells.some((c) => (c ?? "").replace(/[^0-9]/g, "").length >= 10);
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

// ---------------------------------------------------------------------------
// Content-based auto-mapping (2026-10-08). Every decision below looks at
// the values only to COUNT them. The only values ever returned for display
// are a column's top values when that column is "safe" — short (<60
// chars), no 10+ digit run, not a mobile / email / name / notes column —
// i.e. category-like columns such as status or project.

const digitCount = (v: string) => v.replace(/[^0-9]/g, "").length;
const HEADER_WORDS = /^(s\.?\s*no|sr|name|client|customer|number|mobile|phone|contact|email|e-?mail|mail|project|property|site|status|stage|remark|remarks|feedback|visit|date|budget|size|inventory|rate|assigned)/i;

export interface LegacyColumnProfile {
  index: number;
  fillRate: number;          // share of rows with a value (0..1)
  filled: number;
  distinct: number;
  phoneShare: number;        // share of filled values holding 10+ digits
  digitShare: number;        // share of filled values holding any digit
  maxLen: number;
  avgLen: number;
  looksLikeEmail: boolean;
  looksLikeNames: boolean;   // many different short alphabetic values
  safeToShow: boolean;
  topValues: { value: string; count: number }[];   // only when safeToShow
}

export function profileLegacyColumns(rows: string[][], width: number): LegacyColumnProfile[] {
  const total = Math.max(1, rows.length);
  return Array.from({ length: width }, (_, index) => {
    const values = rows.map((r) => (r[index] ?? "").trim()).filter(Boolean);
    const counts = new Map<string, number>();
    for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
    const filled = values.length;
    const distinct = counts.size;
    const share = (pred: (v: string) => boolean) => (filled ? values.filter(pred).length / filled : 0);
    const phoneShare = share((v) => digitCount(v) >= 10);
    const digitShare = share((v) => digitCount(v) > 0);
    const maxLen = values.reduce((m, v) => Math.max(m, v.length), 0);
    const avgLen = filled ? values.reduce((s, v) => s + v.length, 0) / filled : 0;
    const looksLikeEmail = share((v) => v.includes("@")) > 0.2;
    const looksLikeNames =
      filled >= 5 && distinct / filled > 0.6 && share((v) => /^[a-z .']{2,40}$/i.test(v)) > 0.7;
    const safeToShow =
      filled > 0 && phoneShare === 0 && !looksLikeEmail && !looksLikeNames && maxLen < 60 &&
      values.every((v) => digitCount(v) < 10) && (distinct <= 30 || distinct / filled <= 0.3);
    const topValues = safeToShow
      ? [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([value, count]) => ({ value, count }))
      : [];
    return { index, fillRate: filled / total, filled, distinct, phoneShare, digitShare, maxLen, avgLen, looksLikeEmail, looksLikeNames, safeToShow, topValues };
  });
}

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

export interface LegacyTabAutoMap {
  hasHeader: boolean;
  mobileCol: number;
  projectCol: number;
  statusCol: number;
  visitCol: number;
  wholeTabVisit: boolean;
  profiles: LegacyColumnProfile[];
  flags: string[];
}

export function autoMapLegacyTab(tabName: string, matrix: string[][]): LegacyTabAutoMap {
  const hasHeader = detectLegacyHeaderRow(matrix);
  const headers = hasHeader ? matrix[0].map((c) => (c ?? "").trim()) : [];
  const rows = hasHeader ? matrix.slice(1) : matrix;
  const width = Math.max(0, ...matrix.map((r) => r.length));
  const profiles = profileLegacyColumns(rows, width);
  const flags: string[] = [];
  const headerHit = (i: number, re: RegExp) => Boolean(headers[i] && re.test(headers[i]));

  // Mobile: by content.
  const mobileCol = profiles.reduce((best, p) => (p.phoneShare > 0 && (best < 0 || p.phoneShare * p.fillRate > profiles[best].phoneShare * profiles[best].fillRate) ? p.index : best), -1);
  if (mobileCol >= 0 && profiles[mobileCol].phoneShare < 0.7) flags.push("Mobile column mein kaafi values number nahi lagti — check karein");

  // One value in (almost) every row: never project/status; "visit" text = visit-done signal.
  const singleValue = profiles.filter((p) => p.index !== mobileCol && p.filled >= 3 && p.distinct === 1);
  const visitSignal = singleValue.some((p) => p.safeToShow && /visit/i.test(p.topValues[0]?.value ?? ""));
  for (const p of singleValue) flags.push(`Col ${p.index + 1} mein har row ki ek hi value hai — project/status nahi maana`);

  const usable = (p: LegacyColumnProfile) => p.index !== mobileCol && p.safeToShow && p.distinct >= 2 && p.fillRate >= 0.2;

  // Status vocabulary: a column whose common values read like lead
  // statuses (hot / warm / cold / np / interested / follow up / visit …)
  // is a status column, not a project — settles headerless tabs.
  const STATUS_WORDS = /\b(hot|warm|cold|np|not\s*picked|interested|not\s*interested|follow|call|busy|switch|visit|booked|done|pending|ringing|dnd|junk|lost|plan)/i;
  const statusVocab = (p: LegacyColumnProfile) => {
    const counted = p.topValues.reduce((s, t) => s + t.count, 0);
    return counted ? p.topValues.filter((t) => STATUS_WORDS.test(t.value)).reduce((s, t) => s + t.count, 0) / counted : 0;
  };

  // Status: few short distinct values, no digits; most filled wins
  // (status header word or status vocabulary = bonus).
  const statusCandidates = profiles
    .filter((p) => usable(p) && p.distinct <= 30 && p.digitShare <= 0.1)
    .map((p) => ({
      p,
      score: p.fillRate + (headerHit(p.index, /status|stage|remark|feedback/i) ? 0.25 : 0) + (statusVocab(p) >= 0.5 ? 0.3 : 0)
    }))
    .sort((a, b) => b.score - a.score);
  const statusCol = statusCandidates[0]?.p.index ?? -1;
  // Ambiguous only if the runner-up scores about the same INCLUDING the
  // header-word bonus (a "status" header settles it; headerless tabs with
  // two equally filled short-value columns genuinely can't be told apart).
  if (statusCandidates.length >= 2 && Math.abs(statusCandidates[0].score - statusCandidates[1].score) <= 0.1) {
    flags.push(`Do status jaise columns (Col ${statusCandidates[0].p.index + 1}, Col ${statusCandidates[1].p.index + 1}) lagbhag barabar bhare hain — sahi wala chunein`);
  }

  // Project: short text values, not the status column; header word or more filled wins.
  const projectCandidates = profiles
    .filter((p) => usable(p) && p.index !== statusCol && p.avgLen <= 40 && p.digitShare <= 0.5 && statusVocab(p) < 0.5)
    .map((p) => ({ p, score: p.fillRate + (headerHit(p.index, /project|property|site/i) ? 0.5 : 0) }))
    .sort((a, b) => b.score - a.score);
  const projectCol = projectCandidates[0]?.p.index ?? -1;

  // Visit column: a "visit" header, or values that mostly say visit.
  let visitCol = headers.findIndex((h) => /visit/i.test(h));
  if (visitCol < 0) {
    const byText = profiles.find((p) => p.index !== mobileCol && p.safeToShow && p.distinct >= 2 && p.topValues.filter((t) => /visit/i.test(t.value)).reduce((s, t) => s + t.count, 0) / Math.max(1, p.filled) >= 0.5);
    visitCol = byText ? byText.index : -1;
  }

  return {
    hasHeader,
    mobileCol,
    projectCol,
    statusCol,
    visitCol,
    wholeTabVisit: /visit/i.test(tabName) || visitSignal,
    profiles,
    flags
  };
}
