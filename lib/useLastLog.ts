"use client";
// Latest note of each visible card's assignment, for the redesign cards' last-note panel (2026-11-26 port).
//   * One RPC (get_last_notes) per batch of cards: the cards that mount in the same 40 ms are asked together, 200
//     assignment ids a call, in the POST body (never an id list in a URL). No per-card query, no polling.
//   * Read again only when the card's version changes (its last activity / status), e.g. after a result or note is
//     saved — this works without realtime on lead_notes; if that realtime is turned on later nothing changes here.
//   * The function missing (older database) or any error: the panel shows nothing (the card is unchanged otherwise).
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export interface LastLog {
  note: string;
  at: string;
}
export const LAST_LOG_CHUNK = 200;
export const LAST_LOG_BATCH_MS = 40;
const OFF = "off" as const;
const cache = new Map<string, LastLog | null>(); // `${id}|${version}` -> latest note (null = none)
const listeners = new Map<string, Set<() => void>>();
const pending = new Map<string, string[]>(); // id -> cache keys waiting
let timer: ReturnType<typeof setTimeout> | null = null;
let unavailable = false;
const failedKeys = new Set<string>(); // an error for this card's version: hide the panel (asked again on the next version)

const missingFn = (e: { code?: string; message?: string } | null) => !!e && (e.code === "PGRST202" || e.code === "42883" || /could not find the function/i.test(e.message || ""));
function notify(cacheKey: string) {
  listeners.get(cacheKey)?.forEach((fn) => fn());
}

async function flush() {
  timer = null;
  const entries = [...pending.entries()];
  pending.clear();
  for (let i = 0; i < entries.length; i += LAST_LOG_CHUNK) {
    const slice = entries.slice(i, i + LAST_LOG_CHUNK);
    const latest = new Map<string, LastLog>();
    let failed = unavailable;
    if (!unavailable) {
      const { data, error } = await supabase.rpc("get_last_notes", { p_history_ids: slice.map(([id]) => id) });
      if (error) {
        failed = true;
        if (missingFn(error)) unavailable = true;
      } else {
        for (const row of (data as { lead_history_id: string; note: string; created_at: string }[] | null) ?? []) {
          if (row.lead_history_id && !latest.has(row.lead_history_id)) latest.set(row.lead_history_id, { note: row.note, at: row.created_at });
        }
      }
    }
    for (const [id, cacheKeys] of slice) {
      for (const cacheKey of cacheKeys) {
        if (!failed) cache.set(cacheKey, latest.get(id) ?? null);
        else failedKeys.add(cacheKey);
        notify(cacheKey);
      }
    }
  }
}
function request(id: string, cacheKey: string) {
  const list = pending.get(id) || [];
  if (!list.includes(cacheKey)) list.push(cacheKey);
  pending.set(id, list);
  if (!timer) timer = setTimeout(flush, LAST_LOG_BATCH_MS);
}

// undefined = loading, null = no note, LastLog = the note, "off" = not available (hide the panel).
export function useLastLog(id: string | null | undefined, version?: string | null): LastLog | null | undefined | typeof OFF {
  const cacheKey = id ? `${id}|${version ?? ""}` : "";
  const [, rerender] = useState(0);
  useEffect(() => {
    if (!cacheKey || !id || unavailable) return;
    const fn = () => rerender((n) => n + 1);
    const set = listeners.get(cacheKey) || new Set();
    set.add(fn);
    listeners.set(cacheKey, set);
    if (!cache.has(cacheKey)) request(id, cacheKey);
    return () => {
      set.delete(fn);
      if (set.size === 0) listeners.delete(cacheKey);
    };
  }, [cacheKey, id]);
  if (!cacheKey) return null;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  return unavailable || failedKeys.has(cacheKey) ? OFF : undefined;
}
