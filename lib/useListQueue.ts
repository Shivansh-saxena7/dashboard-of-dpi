"use client";
// "Start with next lead" queue state (2026-11-18, Employee Home Phase 3), shared by /leads (LEAD) and /data (DATA).
// The list keeps its own modal, Call and result-save; this only decides which lead the modal shows:
//   * start(ids): the queue in order, minus the leads skipped today in this tab; the first one opens.
//   * onSaved(id): the modal saved a result for the queue's current lead -> the next lead opens a moment later
//     (after the "Update logged." toast). Closing the sheet in that moment cancels the opening; the bar moves on.
//   * skip(): local only (sessionStorage, today's IST day); nothing is written to the database.
// A lead that left the list (saved away, given to someone else) is passed over.
import { useRef, useState } from "react";
import { queueSkipKey } from "@/lib/employeeHome";

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

export function useListQueue(employeeId: string, leadIds: string[], setSelectedLeadId: (id: string | null) => void) {
  const [queue, setQueue] = useState<ListQueue | null>(null);
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const idsRef = useRef(leadIds);
  idsRef.current = leadIds;
  const advanceRef = useRef<{ timer: ReturnType<typeof setTimeout>; from: number } | null>(null);

  function moveTo(from: number, open: boolean) {
    const q = queueRef.current;
    if (!q) return;
    let i = from;
    while (i < q.ids.length && !idsRef.current.includes(q.ids[i])) i++;
    const next = { ...q, index: i };
    queueRef.current = next;
    setQueue(next);
    if (open) setSelectedLeadId(i < q.ids.length ? q.ids[i] : null);
  }

  return {
    queue,
    start(ids: string[]) {
      const skips = readQueueSkips(employeeId);
      const list = ids.filter((id) => !skips.has(id));
      const q = { ids: list, index: 0 };
      queueRef.current = q;
      setQueue(q);
      setSelectedLeadId(list[0] ?? null);
    },
    onSaved(leadId: string) {
      const q = queueRef.current;
      if (!q || q.ids[q.index] !== leadId) return;
      const from = q.index + 1;
      if (advanceRef.current) clearTimeout(advanceRef.current.timer);
      advanceRef.current = {
        from,
        timer: setTimeout(() => {
          advanceRef.current = null;
          moveTo(from, true);
        }, QUEUE_NEXT_DELAY_MS)
      };
    },
    onClosed() {
      if (!advanceRef.current) return;
      clearTimeout(advanceRef.current.timer);
      moveTo(advanceRef.current.from, false);
      advanceRef.current = null;
    },
    skip() {
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
      if (advanceRef.current) clearTimeout(advanceRef.current.timer);
      advanceRef.current = null;
      queueRef.current = null;
      setQueue(null);
    }
  };
}
