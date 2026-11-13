"use client";

// Brings the employee back to the lead they were calling (2026-11-13), on the Leads and the Data list alike.
// See lib/activeCall.ts for the record itself and why it lives in localStorage.
//
// - Registers the list on screen, so a Call tap records the list state (tab, filter, sort), the lead's index and
//   the scroll position (lib/logCallClick.ts -> startActiveCall).
// - On return it puts the list state back (only after a reload / restart: on a plain resume the list is still on
//   screen), opens the lead with its result form, and scrolls its card into view (by card id, else by index, else
//   by the saved scroll position).
// - Triggers: first load after a restart, visibilitychange to visible, pageshow (back/forward cache).
// - activeLeadId lets the list keep that lead in view (not dropped by "New" / "Needs your call") until a result is
//   saved or the employee skips.
// - Every return is counted (restored or not, cold or resume, time away, OS family) and sent in batches.

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { logAnomaly } from "@/lib/logAnomaly";
import {
  ACTIVE_CALL_CHANGE_EVENT,
  type ActiveCallEntry,
  type ActiveCallListState,
  type ActiveCallListType,
  clearActiveCall,
  markColdStartHandled,
  markReturnLogged,
  readActiveCall,
  recordCallReturn,
  registerActiveCallContext,
  returnKind
} from "@/lib/activeCall";

export { keepActiveLeadInList } from "@/lib/activeCall";
import { currentOsFamily, rememberEmployeeId } from "@/lib/clientIdentity";

export interface ActiveCallRestoreOptions {
  listType: ActiveCallListType;
  employeeId: string;
  loading: boolean;
  leads: { id: string; name?: string | null }[];
  getVisibleIds: () => string[];
  getListState: () => ActiveCallListState;
  applyListState: (state: ActiveCallListState) => void;
  openLead: (leadId: string) => void;
  cardDomId: (leadId: string) => string;
}

function logCallReturn(entry: ActiveCallEntry, restored: boolean, kind: "cold" | "resume", awayMs: number) {
  if (entry.returnLogged) return;
  const stats = recordCallReturn(entry.employeeId, { restored, kind, awayMs });
  if (restored) markReturnLogged(entry);
  if (!stats) return;
  const os = currentOsFamily();
  void logAnomaly(supabase, {
    source: `call_return:${entry.employeeId.slice(0, 8)}`,
    severity: "info",
    layer: "FRONTEND",
    message: `Call returns ${stats.day}: ${stats.total} (restored ${stats.restored}, not restored ${stats.notRestored}; cold start ${stats.cold}, resume ${stats.resume}) on ${os}`,
    context: {
      employeeId: entry.employeeId,
      os,
      ...stats,
      avgAwayMs: stats.total ? Math.round(stats.awayMsTotal / stats.total) : 0,
      last: { restored, kind, awayMs: Math.round(awayMs), listType: entry.listType }
    }
  });
}

function scrollBack(entry: ActiveCallEntry, getVisibleIds: () => string[], cardDomId: (id: string) => string) {
  let tries = 0;
  const tick = () => {
    tries += 1;
    const own = document.getElementById(cardDomId(entry.leadId));
    if (own) {
      own.scrollIntoView({ block: "center" });
      return;
    }
    const ids = getVisibleIds();
    if (entry.index >= 0 && ids.length > 0) {
      const near = document.getElementById(cardDomId(ids[Math.min(entry.index, ids.length - 1)]));
      if (near) {
        near.scrollIntoView({ block: "center" });
        return;
      }
    }
    if (tries < 15) {
      setTimeout(tick, 100);
      return;
    }
    window.scrollTo(0, entry.scrollY);
  };
  requestAnimationFrame(() => requestAnimationFrame(tick));
}

export function useActiveCallRestore(options: ActiveCallRestoreOptions): { activeLeadId: string | null; skip: () => void } {
  const ref = useRef(options);
  ref.current = options;
  const { employeeId, listType, loading } = options;
  const [activeLeadId, setActiveLeadId] = useState<string | null>(null);
  const handledAtRef = useRef<number | null>(null);

  useEffect(() => {
    rememberEmployeeId(employeeId);
    markColdStartHandled();
  }, [employeeId]);

  useEffect(
    () =>
      registerActiveCallContext({
        employeeId,
        listType,
        hasLead: (id) => ref.current.leads.some((lead) => lead.id === id),
        leadName: (id) => ref.current.leads.find((lead) => lead.id === id)?.name ?? null,
        getListState: () => ref.current.getListState(),
        indexOf: (id) => ref.current.getVisibleIds().indexOf(id)
      }),
    [employeeId, listType]
  );

  useEffect(() => {
    const sync = () => {
      const entry = readActiveCall(employeeId);
      setActiveLeadId(entry && entry.listType === listType ? entry.leadId : null);
    };
    sync();
    window.addEventListener(ACTIVE_CALL_CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(ACTIVE_CALL_CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [employeeId, listType]);

  useEffect(() => {
    if (loading) return;

    const attempt = (trigger: "load" | "visible" | "pageshow") => {
      if (document.visibilityState === "hidden") return;
      const o = ref.current;
      const entry = readActiveCall(o.employeeId);
      if (!entry || entry.listType !== o.listType) return;
      const kind = returnKind(entry);
      // A call started on this very page: wait until the page comes back from the dialer.
      if (trigger === "load" && kind !== "cold") return;
      if (handledAtRef.current === entry.at) return;
      handledAtRef.current = entry.at;

      const awayMs = Date.now() - entry.at;
      if (!o.leads.some((lead) => lead.id === entry.leadId)) {
        // The lead is no longer this employee's (recycled, merged, junked): nothing to return to.
        clearActiveCall(entry.employeeId, entry.leadId);
        logCallReturn(entry, false, kind, awayMs);
        return;
      }
      if (kind === "cold") o.applyListState(entry.list);
      o.openLead(entry.leadId);
      scrollBack(entry, () => ref.current.getVisibleIds(), o.cardDomId);
      logCallReturn(entry, true, kind, awayMs);
    };

    attempt("load");
    const onVisible = () => {
      if (document.visibilityState === "visible") attempt("visible");
    };
    const onPageShow = () => attempt("pageshow");
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [loading]);

  return {
    activeLeadId,
    skip: () => clearActiveCall(employeeId)
  };
}

