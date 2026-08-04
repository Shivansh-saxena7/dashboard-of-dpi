import { normalizeMobile } from "./normalizeMobile";

// wa.me needs the full international number with no +, spaces, or
// dashes — reuses normalizeMobile's digit-stripping, then prefixes
// India's country code. This app's leads are domestic, same
// assumption normalizeMobile itself already makes (a 10-digit Indian
// mobile is the canonical form).
export function buildWhatsAppLink(rawMobile: string): string {
  const normalized = normalizeMobile(rawMobile);
  return `https://wa.me/91${normalized}`;
}
