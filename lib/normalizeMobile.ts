// Strips everything except digits, then collapses to the last 10
// digits as the canonical comparison key — "+91 98765 43210",
// "91-9876543210", and "098765 43210" all normalize to the same
// "9876543210", so CSV duplicate-detection catches format-variant
// matches an exact string comparison would miss. Comparison-only:
// never changes how a number is actually stored or displayed
// anywhere — leads.mobile itself is left exactly as entered.
export function normalizeMobile(raw: string | null | undefined): string {
  const digitsOnly = (raw || "").replace(/\D/g, "");
  return digitsOnly.length > 10 ? digitsOnly.slice(-10) : digitsOnly;
}
