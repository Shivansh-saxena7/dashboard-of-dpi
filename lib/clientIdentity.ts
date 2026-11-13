// Who and what device a browser-side report comes from (2026-11-13), so a client error or a call-return record can be
// tied to an employee and an OS family without asking anyone. Browser only, never throws; the pure parts are
// known-answer tested in scripts/check-active-call.js.

export type OsFamily = "Android" | "iOS" | "Windows" | "Mac" | "Other";

const EMPLOYEE_KEY = "clientIdentity:v1:employeeId";

// iPadOS asks for desktop pages and reports "Macintosh"; a Mac has no touch screen, so touch points tell them apart.
export function osFamily(userAgent: string, maxTouchPoints: number = 0): OsFamily {
  const ua = userAgent || "";
  if (/android/i.test(ua)) return "Android";
  if (/iphone|ipad|ipod/i.test(ua)) return "iOS";
  if (/macintosh/i.test(ua)) return maxTouchPoints > 1 ? "iOS" : "Mac";
  if (/windows/i.test(ua)) return "Windows";
  return "Other";
}

export function currentOsFamily(): OsFamily {
  try {
    return osFamily(navigator.userAgent, navigator.maxTouchPoints || 0);
  } catch {
    return "Other";
  }
}

export function rememberEmployeeId(employeeId: string | null | undefined): void {
  if (!employeeId) return;
  try {
    localStorage.setItem(EMPLOYEE_KEY, employeeId);
  } catch {
    // no storage, nothing to remember
  }
}

export function knownEmployeeId(): string | null {
  try {
    return localStorage.getItem(EMPLOYEE_KEY);
  } catch {
    return null;
  }
}

// Extra fields for client-side anomaly rows.
export function clientIdentityContext(): { employeeId: string | null; os: OsFamily } {
  return { employeeId: knownEmployeeId(), os: currentOsFamily() };
}
