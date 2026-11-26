"use client";
// "Start with next lead" queue state (2026-11-18, Employee Home Phase 3), shared by /leads (LEAD) and /data (DATA).
// The list keeps its own modal, Call and result-save; this only decides which lead the modal shows:
//   * start(ids): the queue in order, minus the leads skipped today in this tab; the first one opens.
//   * onSaved(id): the modal saved a result for the queue's current lead -> the next lead opens a moment later
//     (after the "Update logged." toast). Closing the sheet in that moment cancels the opening; the bar moves on.
//   * skip(): local only (sessionStorage, today's IST day); nothing is written to the database. E4: also offered
//     inside the sheet (one tap); right after a saved result it simply moves on (the saved lead is not "skipped").
//   * E4 resume: today's run is kept in localStorage per employee and list. After a cold restart during a call the
//     existing call-return flow opens the lead; resumeFor(leadId) then puts the queue back at that lead. A run from
//     another IST day is dropped. Exit or the end of the queue clears it.
// A lead that left the list (saved away, given to someone else) is passed over.
import { useRef, useState } from "react";
import { parseStoredQueue, queueDay, queueSkipKey, queueStoreKey } from "@/lib/employeeHome";

export interface ListQueue {
  ids: string[];
  index: number;
}

export const QUEUE_NEXT_DELAY_MS = 800;

export function readQueueSkips(employeeId: string): Set<string> {
  try {
    const raw = sessionStorage.getItem(queueSkipKey(employeeId));
    const ids = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function addQueueSkip(employeeId: string, id: string) {
  try {
    const skips = readQueueSkips(employeeId);
    skips.add(id);
    sessionStorage.setItem(queueSkipKey(employeeId), JSON.stringify([...skips]));
  } catch {
    // private window: the skip still applies to this queue run
  }
}

function storeQueue(key: string, q: ListQueue | null) {
  try {
    if (!q || q.index >= q.ids.length) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify({ day: queueDay(), ids: q.ids, index: q.index }));
  } catch {
    // no storage: the queue still runs, it just cannot resume after a restart
  }
}

export function readStoredQueue(employeeId: string, listType: "LEAD" | "DATA"): ListQueue | null {
  try {
    return parseStoredQueue(localStorage.getItem(queueStoreKey(employeeId, listType)));
  } catch {
    return null;
  }
}

export function useListQueue(
  employeeId: string,
  listType: "LEAD" | "DATA",
  leadIds: string[],
  setSelectedLeadId: (id: string | null) => void
) {
  const [queue, setQueueState] = useState<ListQueue | null>(null);
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const idsRef = useRef(leadIds);
  idsRef.current = leadIds;
  const advanceRef = useRef<{ timer: ReturnType<typeof setTimeout>; from: number } | null>(null);
  const storeKey = queueStoreKey(employeeId, listType);

  function setQueue(q: ListQueue | null) {
    queueRef.current = q;
    setQueueState(q);
    storeQueue(storeKey, q);
  }

  function moveTo(from: number, open: boolean) {
    const q = queueRef.current;
    if (!q) return;
    let i = from;
    while (i < q.ids.length && !idsRef.current.includes(q.ids[i])) i++;
    setQueue({ ...q, index: i });
    if (open) setSelectedLeadId(i < q.ids.length ? q.ids[i] : null);
  }

  function cancelAdvance(): number | null {
    if (!advanceRef.current) return null;
    clearTimeout(advanceRef.current.timer);
    const from = advanceRef.current.from;
    advanceRef.current = null;
    return from;
  }

  return {
    queue,
    start(ids: string[]) {
      const skips = readQueueSkips(employeeId);
      const list = ids.filter((id) => !skips.has(id));
      setQueue({ ids: list, index: 0 });
      setSelectedLeadId(list[0] ?? null);
    },
    // Cold restart: today's stored run that holds this lead comes back, positioned on it. No lead is opened here.
    resumeFor(leadId: string): boolean {
      if (queueRef.current) return false;
      const stored = readStoredQueue(employeeId, listType);
      const at = stored ? stored.ids.indexOf(leadId) : -1;
      if (!stored || at < 0) return false;
      setQueue({ ids: stored.ids, index: at });
      return true;
    },
    isCurrent(leadId: string): boolean {
      const q = queueRef.current;
      return Boolean(q && q.ids[q.index] === leadId);
    },
    onSaved(leadId: string) {
      const q = queueRef.current;
      if (!q || q.ids[q.index] !== leadId) return;
      const from = q.index + 1;
      cancelAdvance();
      advanceRef.current = {
        from,
        timer: setTimeout(() => {
          advanceRef.current = null;
          moveTo(from, true);
        }, QUEUE_NEXT_DELAY_MS)
      };
    },
    onClosed() {
      const from = cancelAdvance();
      if (from !== null) moveTo(from, false);
    },
    skip() {
      const from = cancelAdvance();
      if (from !== null) {
        moveTo(from, true);
        return;
      }
      const q = queueRef.current;
      if (!q || q.index >= q.ids.length) return;
      addQueueSkip(employeeId, q.ids[q.index]);
      moveTo(q.index + 1, true);
    },
    open() {
      const q = queueRef.current;
      if (q && q.index < q.ids.length) setSelectedLeadId(q.ids[q.index]);
    },
    exit() {
      cancelAdvance();
      setQueue(null);
    }
  };
}
