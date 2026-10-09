"use client";

// Last log on the lead card (2026-10-09). Every visible card asks for its
// own latest note; requests made in the same ~40ms are batched into ONE
// lead_notes query per key (.in() over up to 200 ids, newest first,
// .limit(1000), four columns). Read-only, no schema change. Results are
// cached per (id, version) — the card passes its last-activity time as the
// version, so a new update on a lead re-fetches just that lead. A different
// page / filter simply means different ids, which batch the same way.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export interface LastLog {
  note: string;
  at: string;
}
export type LastLogKey = "lead_history_id" | "lead_id";

const cache = new Map<string, LastLog | null>(); // `${key}:${id}|${version}` -> latest note (null = none)
const listeners = new Map<string, Set<() => void>>();
const pending: Record<LastLogKey, Map<string, string[]>> = { lead_history_id: new Map(), lead_id: new Map() };
let timer: ReturnType<typeof setTimeout> | null = null;

const CHUNK = 200;

function notify(cacheKey: string) {
  listeners.get(cacheKey)?.forEach((fn) => fn());
}

async function flush() {
  timer = null;
  for (const key of ["lead_history_id", "lead_id"] as LastLogKey[]) {
    const batch = pending[key];
    if (batch.size === 0) continue;
    const entries = [...batch.entries()];
    batch.clear();
    for (let i = 0; i < entries.length; i += CHUNK) {
      const slice = entries.slice(i, i + CHUNK);
      const ids = slice.map(([id]) => id);
      const latest = new Map<string, LastLog>();
      const { data, error } = await supabase.from("lead_notes").select("lead_id, lead_history_id, note, created_at").in(key, ids).order("created_at", { ascending: false }).limit(1000);
      if (!error) {
        for (const row of data || []) {
          const id = (row as Record<string, string>)[key];
          if (id && !latest.has(id)) latest.set(id, { note: row.note, at: row.created_at });
        }
      }
      for (const [id, cacheKeys] of slice) {
        for (const cacheKey of cacheKeys) {
          // On a failed request leave it uncached so a later render retries.
          if (!error) cache.set(cacheKey, latest.get(id) ?? null);
          notify(cacheKey);
        }
      }
    }
  }
}

function request(key: LastLogKey, id: string, cacheKey: string) {
  const list = pending[key].get(id) || [];
  if (!list.includes(cacheKey)) list.push(cacheKey);
  pending[key].set(id, list);
  if (!timer) timer = setTimeout(flush, 40);
}

// undefined = still loading, null = no note, LastLog = latest note.
export function useLastLog(key: LastLogKey, id: string | null | undefined, version?: string | null): LastLog | null | undefined {
  const cacheKey = id ? `${key}:${id}|${version ?? ""}` : "";
  const [, rerender] = useState(0);

  useEffect(() => {
    if (!cacheKey || !id) return;
    const fn = () => rerender((n) => n + 1);
    const set = listeners.get(cacheKey) || new Set();
    set.add(fn);
    listeners.set(cacheKey, set);
    if (!cache.has(cacheKey)) request(key, id, cacheKey);
    return () => {
      set.delete(fn);
      if (set.size === 0) listeners.delete(cacheKey);
    };
  }, [cacheKey, key, id]);

  if (!cacheKey) return null;
  return cache.has(cacheKey) ? cache.get(cacheKey) : undefined;
}
