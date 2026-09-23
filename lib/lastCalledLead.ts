// Scroll-to-called-lead (2026-09-16) — a real UX gap: on mobile,
// tapping Call opens the phone dialer (tel: link), and the browser
// tab commonly gets discarded/reloaded under memory pressure while
// backgrounded — losing scroll position and dropping the employee
// back at the top of a possibly-long list. sessionStorage survives
// that reload (in-memory React state wouldn't), which is the whole
// reason this works. Scrolls to the specific lead BY ID rather than
// restoring a raw scroll-Y pixel offset — immune to the list having
// re-sorted/re-filtered between the call and the return (e.g. the
// call bumped last_activity_at), which a pixel-position restore isn't.
//
// Shared by both LeadCard/LeadList and DataCard/DataList — identical
// Call-button pattern in both, one owner for the remember/consume
// logic rather than two copies that could drift.
const STORAGE_KEY = "lastCalledCardId";
const MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes — long enough for a real call, short enough that a tab left open for hours doesn't surprise-scroll on some unrelated later visit.

export function rememberCalledCard(id: string) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ id, at: Date.now() }));
  } catch {
    // Storage can throw in rare cases (private-browsing quota, etc.)
    // — this is a UX nicety, never worth failing the actual call over.
  }
}

// One-time consume — clears the entry so a later, unrelated mount of
// the same list (e.g. just navigating back to it normally) doesn't
// keep re-scrolling/re-highlighting.
export function consumeRecentlyCalledCardId(): string | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(STORAGE_KEY);

    const { id, at } = JSON.parse(raw);
    if (typeof id !== "string" || typeof at !== "number") return null;
    if (Date.now() - at > MAX_AGE_MS) return null;

    return id;
  } catch {
    return null;
  }
}

// Scrolls to and briefly highlights the card with this DOM id, if it's
// currently rendered (it may not be — e.g. the call moved the lead to
// a different tab/filter than the one now active — a silent no-op in
// that case, not an error).
export function scrollToAndHighlightCard(domId: string) {
  const el = document.getElementById(domId);
  if (!el) return;

  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("ring-2", "ring-amber-400", "ring-offset-2");

  setTimeout(() => {
    el.classList.remove("ring-2", "ring-amber-400", "ring-offset-2");
  }, 2000);
}

// Quick Dial (2026-09-23) — same sessionStorage/timestamp/try-catch
// shape as rememberCalledCard/consumeRecentlyCalledCardId above (one
// module, one family of "remember something before a tel: link
// navigates away, consume it later" helpers), but a genuinely
// different trigger: those are checked opportunistically on the next
// natural list re-render, which this can't rely on since there's no
// lead/card to re-render at all yet. This pair is meant to be checked
// from a `visibilitychange` listener instead (see LeadList.tsx) — the
// mechanism that component's own scroll-restore does NOT actually use
// today, confirmed by reading it; this is new, not a reuse of that
// trigger, only of the storage pattern.
const QUICK_DIAL_STORAGE_KEY = "lastQuickDialNumber";
const QUICK_DIAL_MAX_AGE_MS = 10 * 60 * 1000; // same 10-minute window as above, same reasoning

export function rememberQuickDialNumber(mobile: string) {
  try {
    sessionStorage.setItem(QUICK_DIAL_STORAGE_KEY, JSON.stringify({ mobile, at: Date.now() }));
  } catch {
    // Same as rememberCalledCard — a UX nicety, never worth failing
    // the actual call over.
  }
}

// One-time consume, same reasoning as consumeRecentlyCalledCardId —
// a later, unrelated visibility change shouldn't keep re-prompting.
export function consumeQuickDialNumber(): string | null {
  try {
    const raw = sessionStorage.getItem(QUICK_DIAL_STORAGE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(QUICK_DIAL_STORAGE_KEY);

    const { mobile, at } = JSON.parse(raw);
    if (typeof mobile !== "string" || typeof at !== "number") return null;
    if (Date.now() - at > QUICK_DIAL_MAX_AGE_MS) return null;

    return mobile;
  } catch {
    return null;
  }
}
