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
