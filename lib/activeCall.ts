// Active call (2026-11-13): the one record of "this employee tapped Call on this lead and has not saved a result yet".
//
// Why localStorage: on a low-memory phone the installed app is often closed by the OS while the dialer is open. It
// then starts again from the manifest start_url (/login), in a new session, so sessionStorage and React state are
// gone. localStorage survives that, on every Android and iPhone browser, so the app can always bring the employee
// back to the same lead, same list position, with the result form open.
//
// Written by lib/logCallClick.ts (every Call button goes through it), cleared when a result is saved
// (lib/logLeadUpdate.ts), when the employee taps Skip, or after ACTIVE_CALL_MAX_AGE_MS. Read by
// lib/useActiveCallRestore.ts (Leads and Data lists), components/ResumeCallStrip.tsx, and the cold-start redirect in
// app/login/page.tsx and app/page.tsx. The pure parts are known-answer tested in scripts/check-active-call.js.

export type ActiveCallListType = "LEAD" | "DATA";

export interface ActiveCallListState {
  tab: string;
  statusFilter: string;
  sortBy: string;
  searchQuery?: string;
  sourceFilter?: string;
  projectFilter?: string;
}

export interface ActiveCallEntry {
  v: 1;
  employeeId: string;
  leadId: string;
  leadName: string | null;
  listType: ActiveCallListType;
  list: ActiveCallListState;
  index: number;
  scrollY: number;
  clickId: string | null;
  at: number;
  returnLogged?: boolean;
}

export const ACTIVE_CALL_MAX_AGE_MS = 6 * 60 * 60 * 1000;
export const ACTIVE_CALL_CHANGE_EVENT = "activecall:change";
const KEY_PREFIX = "activeCall:v1:";
const BOOT_FLAG_KEY = "activeCall:v1:bootHandled";

// When this copy of the app's JavaScript started. A call placed before it means the page was reloaded or the app
// was started again while the employee was on the phone ("cold"); after it means the same page simply came back.
export const APP_BOOTED_AT = Date.now();

export function activeCallKey(employeeId: string): string {
  return KEY_PREFIX + employeeId;
}

function isString(x: unknown): x is string {
  return typeof x === "string" && x.length > 0;
}

// Pure: a stored value -> a usable entry, or null when it is broken, for someone else, from the future or too old.
export function parseActiveCall(raw: string | null, now: number, employeeId?: string): ActiveCallEntry | null {
  if (!raw) return null;
  try {
    const e = JSON.parse(raw);
    if (!e || e.v !== 1 || !isString(e.employeeId) || !isString(e.leadId)) return null;
    if (e.listType !== "LEAD" && e.listType !== "DATA") return null;
    if (typeof e.at !== "number" || now - e.at < -60 * 1000 || now - e.at > ACTIVE_CALL_MAX_AGE_MS) return null;
    if (employeeId && e.employeeId !== employeeId) return null;
    const list = e.list && typeof e.list === "object" ? e.list : {};
    return {
      v: 1,
      employeeId: e.employeeId,
      leadId: e.leadId,
      leadName: typeof e.leadName === "string" ? e.leadName : null,
      listType: e.listType,
      list: {
        tab: typeof list.tab === "string" ? list.tab : "LEADS",
        statusFilter: typeof list.statusFilter === "string" ? list.statusFilter : "",
        sortBy: typeof list.sortBy === "string" ? list.sortBy : "NEWEST",
        searchQuery: typeof list.searchQuery === "string" ? list.searchQuery : "",
        sourceFilter: typeof list.sourceFilter === "string" ? list.sourceFilter : "",
        projectFilter: typeof list.projectFilter === "string" ? list.projectFilter : ""
      },
      index: Number.isInteger(e.index) && e.index >= 0 ? e.index : -1,
      scrollY: typeof e.scrollY === "number" && e.scrollY >= 0 ? e.scrollY : 0,
      clickId: isString(e.clickId) ? e.clickId : null,
      at: e.at,
      returnLogged: e.returnLogged === true
    };
  } catch {
    return null;
  }
}

// Pure: where a resumed call should land.
export function resumePathFor(entry: Pick<ActiveCallEntry, "listType" | "leadId">): string {
  return `${entry.listType === "DATA" ? "/data" : "/leads"}?openLead=${encodeURIComponent(entry.leadId)}`;
}

// Pure: was the page started again while the employee was on the phone?
export function returnKind(entry: Pick<ActiveCallEntry, "at">, bootedAt: number = APP_BOOTED_AT): "cold" | "resume" {
  return entry.at < bootedAt ? "cold" : "resume";
}

function notifyChange() {
  try {
    window.dispatchEvent(new Event(ACTIVE_CALL_CHANGE_EVENT));
  } catch {
    // no window
  }
}

export function readActiveCall(employeeId: string | null | undefined, now: number = Date.now()): ActiveCallEntry | null {
  if (!employeeId) return null;
  try {
    const raw = localStorage.getItem(activeCallKey(employeeId));
    const entry = parseActiveCall(raw, now, employeeId);
    if (raw && !entry) localStorage.removeItem(activeCallKey(employeeId));
    return entry;
  } catch {
    return null;
  }
}

export function writeActiveCall(entry: ActiveCallEntry): void {
  try {
    localStorage.setItem(activeCallKey(entry.employeeId), JSON.stringify(entry));
    notifyChange();
  } catch {
    // no storage: the call still goes through, only the return help is lost
  }
}

// Clears the entry of this employee, or of anyone, but only when it is for this lead (when one is given).
export function clearActiveCall(employeeId: string | null, leadId?: string | null): void {
  try {
    const keys: string[] = [];
    if (employeeId) keys.push(activeCallKey(employeeId));
    else for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(KEY_PREFIX) && k !== BOOT_FLAG_KEY) keys.push(k);
    }
    let changed = false;
    for (const k of keys) {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      if (leadId) {
        try {
          if (JSON.parse(raw)?.leadId !== leadId) continue;
        } catch {
          // broken entry: remove it
        }
      }
      localStorage.removeItem(k);
      changed = true;
    }
    if (changed) notifyChange();
  } catch {
    // no storage
  }
}

export function markReturnLogged(entry: ActiveCallEntry): void {
  writeActiveCall({ ...entry, returnLogged: true });
}

// --- Context for logCallClick ------------------------------------------------------------------------------------
// The Leads / Data list that is on screen registers itself, so a Call tap anywhere on it (card or detail modal)
// records where the employee was without the cards having to know about any of this.
export interface ActiveCallContext {
  employeeId: string;
  listType: ActiveCallListType;
  hasLead: (leadId: string) => boolean;
  leadName: (leadId: string) => string | null;
  getListState: () => ActiveCallListState;
  indexOf: (leadId: string) => number;
}

let currentContext: ActiveCallContext | null = null;

export function registerActiveCallContext(context: ActiveCallContext): () => void {
  currentContext = context;
  return () => {
    if (currentContext === context) currentContext = null;
  };
}

// Called on every Call tap. Only a lead of the list on screen is tracked: a call from a notification or the work
// report has no list position to return to.
export function startActiveCall(leadId: string, now: number = Date.now()): ActiveCallEntry | null {
  const ctx = currentContext;
  if (!ctx || !ctx.hasLead(leadId)) return null;
  let scrollY = 0;
  try {
    scrollY = Math.max(0, Math.round(window.scrollY || 0));
  } catch {
    scrollY = 0;
  }
  const entry: ActiveCallEntry = {
    v: 1,
    employeeId: ctx.employeeId,
    leadId,
    leadName: ctx.leadName(leadId),
    listType: ctx.listType,
    list: ctx.getListState(),
    index: ctx.indexOf(leadId),
    scrollY,
    clickId: null,
    at: now
  };
  writeActiveCall(entry);
  return entry;
}

export function attachActiveCallClickId(leadId: string, clickId: string | null): void {
  const ctx = currentContext;
  if (!ctx || !clickId) return;
  const entry = readActiveCall(ctx.employeeId);
  if (entry && entry.leadId === leadId) writeActiveCall({ ...entry, clickId });
}

// Any page of the app that is already showing the lists counts as the start of this session, so a later visit to
// Home in the same session shows the strip instead of redirecting.
export function markColdStartHandled(now: number = Date.now()): void {
  try {
    if (!sessionStorage.getItem(BOOT_FLAG_KEY)) sessionStorage.setItem(BOOT_FLAG_KEY, String(now));
  } catch {
    // no sessionStorage
  }
}

// Cold start (login page or Home): the first page of a fresh app session sends the employee straight back to the
// call they were on. Only once per session, so going to Home on purpose later shows the strip instead.
export function takeColdStartResume(employeeId: string | null | undefined, now: number = Date.now()): string | null {
  if (!employeeId) return null;
  try {
    if (sessionStorage.getItem(BOOT_FLAG_KEY)) return null;
    sessionStorage.setItem(BOOT_FLAG_KEY, String(now));
  } catch {
    // no sessionStorage: still resume, the strip covers repeats
  }
  const entry = readActiveCall(employeeId, now);
  return entry ? resumePathFor(entry) : null;
}

// --- Call-return record ---------------------------------------------------------------------------------------------
// One day's totals per employee, kept on the phone and sent at most every CALL_RETURN_FLUSH_MS, so the anomaly log
// gets a few rows a day (never 5 in an hour, which would notify Admin) with the proof: restored or not, cold start or
// resume, how long the employee was away, OS family.
export const CALL_RETURN_FLUSH_MS = 2 * 60 * 60 * 1000;
const RETURN_STATS_PREFIX = "callReturn:v1:";

export interface CallReturnStats {
  day: string;
  total: number;
  restored: number;
  notRestored: number;
  cold: number;
  resume: number;
  awayMsTotal: number;
  awayMsMax: number;
  lastFlushAt: number;
}

export function emptyCallReturnStats(day: string): CallReturnStats {
  return { day, total: 0, restored: 0, notRestored: 0, cold: 0, resume: 0, awayMsTotal: 0, awayMsMax: 0, lastFlushAt: 0 };
}

// Pure: add one return; a new IST day starts new totals.
export function addCallReturn(stats: CallReturnStats | null, day: string, r: { restored: boolean; kind: "cold" | "resume"; awayMs: number }): CallReturnStats {
  const s = stats && stats.day === day ? { ...stats } : { ...emptyCallReturnStats(day), lastFlushAt: stats?.lastFlushAt ?? 0 };
  const away = Math.max(0, Math.round(r.awayMs));
  s.total += 1;
  if (r.restored) s.restored += 1;
  else s.notRestored += 1;
  if (r.kind === "cold") s.cold += 1;
  else s.resume += 1;
  s.awayMsTotal += away;
  s.awayMsMax = Math.max(s.awayMsMax, away);
  return s;
}

// Pure: time to send? The first return of the day always goes out, then at most every CALL_RETURN_FLUSH_MS.
export function shouldFlushCallReturns(stats: CallReturnStats, now: number): boolean {
  return stats.total > 0 && (stats.lastFlushAt === 0 || now - stats.lastFlushAt >= CALL_RETURN_FLUSH_MS);
}

export function istDay(now: number): string {
  return new Date(now + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Records one return and gives back the totals to send when it is time, else null.
export function recordCallReturn(employeeId: string, r: { restored: boolean; kind: "cold" | "resume"; awayMs: number }, now: number = Date.now()): CallReturnStats | null {
  try {
    const key = RETURN_STATS_PREFIX + employeeId;
    let stats: CallReturnStats | null = null;
    try {
      stats = JSON.parse(localStorage.getItem(key) || "null");
    } catch {
      stats = null;
    }
    const next = addCallReturn(stats, istDay(now), r);
    const flush = shouldFlushCallReturns(next, now);
    if (flush) next.lastFlushAt = now;
    localStorage.setItem(key, JSON.stringify(next));
    return flush ? next : null;
  } catch {
    return null;
  }
}

// The pinned lead stays in the list until its result is saved, even when a filter ("New", "Needs your call") would
// now drop it, so the list does not jump under the employee. Pure, known-answer tested in scripts/check-active-call.js.
export function keepActiveLeadInList<T extends { id: string }>(filtered: T[], all: T[], activeLeadId: string | null, inSameTab: (lead: T) => boolean): T[] {
  if (!activeLeadId || filtered.some((lead) => lead.id === activeLeadId)) return filtered;
  const lead = all.find((l) => l.id === activeLeadId);
  return lead && inSameTab(lead) ? [...filtered, lead] : filtered;
}
