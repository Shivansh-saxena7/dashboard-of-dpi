"use client";

// Expanded part of the lead card (2026-10-09, design C "Pass"). Loads
// only when the card is expanded, for this one lead: its extra_data (one
// row; the last note now lives on the card itself) — the list
// query never selects either, so the list stays light. Display only.

import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { supabase } from "@/lib/supabase";
import { parseLeadExtraData } from "@/lib/leadExtraData";

// Smooth open/close for the expanded section; instant when the viewer
// prefers reduced motion.
export function ExpandSection({ open, children }: { open: boolean; children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="more"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.22, ease: "easeOut" }}
          style={{ overflow: "hidden" }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// The four answers worth a tile; labels come from lib/leadExtraData.ts's
// key normalizing ("budget"/"BUdget" -> Budget, "Purcahsing Timeline" ->
// Purchase timeline...).
const TILE_LABELS: { label: string; title: string }[] = [
  { label: "Budget", title: "Budget" },
  { label: "Purchase timeline", title: "Timeline" },
  { label: "Purpose", title: "Purpose" },
  { label: "Configuration", title: "Configuration" }
];

const STEPS = ["New", "Contacted", "Visit", "Booked"];

function stepIndex(status: string, boardStage: string | null | undefined, contacted = false): number {
  if (boardStage === "BOOKING") return 3;
  if (boardStage === "VISIT") return 2;
  return status === "NEW" && !contacted ? 0 : 1;
}

interface Loaded {
  tiles: { title: string; value: string }[];
}

export default function LeadCardMore({
  leadId,
  leadHistoryId,
  status,
  boardStage,
  times = [],
  accent = "#2563eb",
  contacted = false
}: {
  leadId: string;
  leadHistoryId?: string | null;
  status: string;
  boardStage?: string | null;
  // exact times shown on the old card (assigned, last activity, recycle)
  times?: { label: string; value: string }[];
  // urgency colour for the active stage dot
  accent?: string;
  // status still NEW but already worked (display only) — shows as Contacted
  contacted?: boolean;
}) {
  const [loaded, setLoaded] = useState<{ key: string; data: Loaded } | null>(null);
  const key = `${leadId}:${leadHistoryId}`;

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("leads")
      .select("extra_data")
      .eq("id", leadId)
      .maybeSingle()
      .then((extra) => {
        if (cancelled) return;
        const items = parseLeadExtraData(extra.data?.extra_data);
        const tiles = TILE_LABELS.flatMap(({ label, title }) => {
          const item = items.find((i) => i.label === label);
          return item ? [{ title, value: item.value }] : [];
        });
        setLoaded({ key: `${leadId}:${leadHistoryId}`, data: { tiles } });
      });
    return () => {
      cancelled = true;
    };
  }, [leadId, leadHistoryId]);

  const data = loaded?.key === key ? loaded.data : null;
  const current = stepIndex(status, boardStage, contacted);

  return (
    <div className="pt-[11px]" onClick={(e) => e.stopPropagation()}>
      <div className="h-px mb-[11px]" style={{ background: "#e8edf3" }} />
      <p className="text-[11px] font-extrabold tracking-[.8px] mb-2" style={{ color: "#64748b" }}>
        MORE DETAILS
      </p>

      {times.length > 0 && (
        <dl className="mb-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
          {times.map((t) => (
            <div key={t.label} className="contents">
              <dt className="font-semibold" style={{ color: "#64748b" }}>{t.label}</dt>
              <dd className="font-bold tabular-nums" style={{ color: "#0f172a" }}>{t.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {!data ? (
        <div className="space-y-2" aria-label="Loading details">
          <div className="grid grid-cols-2 gap-2">
            <div className="h-[52px] rounded-[13px] bg-[#f5f7fb] motion-safe:animate-pulse" />
            <div className="h-[52px] rounded-[13px] bg-[#f5f7fb] motion-safe:animate-pulse" />
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Display-only hint when the lead has no budget/timeline answers yet. */}
          {data.tiles.length === 0 && (
            <p className="rounded-[13px] border border-dashed px-3 py-2 text-[12px] font-semibold" style={{ borderColor: "#e8edf3", color: "#64748b" }}>
              Budget and timeline not captured yet — ask on the next call.
            </p>
          )}
          {data.tiles.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {data.tiles.map((tile) => (
                <div key={tile.title} className="min-w-0 rounded-[13px] px-2.5 py-[9px]" style={{ background: "#f5f7fb" }}>
                  <p className="text-[10px] font-extrabold tracking-[.4px] uppercase" style={{ color: "#64748b" }}>{tile.title}</p>
                  <p className="text-[13.5px] font-extrabold break-words line-clamp-2" style={{ color: "#0f172a" }}>{tile.value}</p>
                </div>
              ))}
            </div>
          )}

        </div>
      )}

      {/* Four equal columns; each line runs from one dot's centre to the next, so every line is the same length. */}
      <ol className="mt-3 grid grid-cols-4" aria-label="Lead stage">
        {STEPS.map((step, i) => (
          <li key={step} className="relative flex flex-col items-center gap-1.5">
            {i < STEPS.length - 1 && (
              <span aria-hidden="true" className="absolute top-[8px] left-1/2 w-full h-[3px] rounded-full" style={{ background: i < current ? accent : "#e2e8f0" }} />
            )}
            <span
              className="relative z-10 h-[19px] w-[19px] rounded-full"
              style={
                i < current
                  ? { background: accent }
                  : i === current
                  ? { background: accent, boxShadow: `0 0 0 4px ${accent}33` }
                  : { background: "#fff", border: "3px solid #cbd5e1" }
              }
              aria-current={i === current ? "step" : undefined}
            />
            <span className="text-[11px] font-bold" style={{ color: i <= current ? "#0f172a" : "#64748b" }}>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
