"use client";

import { motion } from "framer-motion";
import { AlertTriangle, Trash2, Repeat, ClipboardList, LucideIcon } from "lucide-react";
import { ENDED_REASON_TEXT, ENDED_REASON_BADGE, DEFAULT_ENDED_REASON_BADGE } from "@/lib/endedReasonDisplay";

interface SLABreachHistoryEntry {
  lead_history_id: string;
  assigned_at: string;
  ended_reason: string;
  reassign_note: string | null;
  project: string | null;
  source: string | null;
}

interface SLABreachHistoryCardProps {
  entry: SLABreachHistoryEntry;
  index?: number;
}

// Icon + gradient per ended_reason — kept local (JSX/component
// references don't belong in a plain lib/*Display.ts data file), but
// the label/color-class pairing itself lives in ENDED_REASON_BADGE
// (lib/endedReasonDisplay.ts) so this stays the one place either is
// defined. Falls back to a neutral clipboard icon for anything not
// listed, mirroring DEFAULT_ENDED_REASON_BADGE.
const REASON_ICON: Record<string, LucideIcon> = {
  SLA_BREACHED: AlertTriangle,
  RECYCLE_READY: AlertTriangle,
  JUNK: Trash2,
  TEAM_LEADER_REASSIGNED: Repeat
};

const REASON_ICON_GRADIENT: Record<string, string> = {
  SLA_BREACHED: "from-red-400 to-rose-500 shadow-[0_4px_12px_rgba(225,29,72,0.3)]",
  RECYCLE_READY: "from-red-400 to-rose-500 shadow-[0_4px_12px_rgba(225,29,72,0.3)]",
  JUNK: "from-slate-400 to-slate-500 shadow-[0_4px_12px_rgba(100,116,139,0.3)]",
  TEAM_LEADER_REASSIGNED: "from-amber-400 to-orange-500 shadow-[0_4px_12px_rgba(217,119,6,0.3)]"
};

// Client name and mobile number are deliberately absent — not
// because this component chooses to hide them, but because
// employee_sla_breach_history never has access to those columns in
// the first place: project/source come through lead_project_source(),
// a function whose return signature only has room for those two
// fields, so there is no code path here that could leak name/mobile
// even by mistake. Non-interactive (no onClick) — there is nothing
// further to drill into.
export default function SLABreachHistoryCard({ entry, index = 0 }: SLABreachHistoryCardProps) {

  const reasonText = ENDED_REASON_TEXT[entry.ended_reason] || "This lead was reassigned.";
  const badge = ENDED_REASON_BADGE[entry.ended_reason] || DEFAULT_ENDED_REASON_BADGE;
  const Icon = REASON_ICON[entry.ended_reason] || ClipboardList;
  const iconGradient = REASON_ICON_GRADIENT[entry.ended_reason] || "from-slate-400 to-slate-500 shadow-[0_4px_12px_rgba(100,116,139,0.3)]";

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index, 8) * 0.05 }}
      className="rounded-[20px] bg-white border border-slate-100 shadow-[0_4px_20px_rgba(15,23,42,0.06)] p-4"
    >
      <div className="flex items-start gap-3">
        <div className={`shrink-0 h-11 w-11 rounded-2xl bg-gradient-to-br ${iconGradient} flex items-center justify-center`}>
          <Icon size={18} className="text-white" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              {entry.project ? (
                <p className="text-[15px] font-bold text-slate-800 truncate">{entry.project}</p>
              ) : (
                <p className="text-[15px] font-bold text-slate-400 italic">Project unavailable</p>
              )}
            </div>

            {entry.source && (
              <span className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600">
                {entry.source}
              </span>
            )}
          </div>

          <span className={`inline-block mt-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full ${badge.className}`}>
            {badge.icon} {badge.label}
          </span>
        </div>
      </div>

      <p className="text-xs text-slate-600 mt-3 leading-relaxed">
        {reasonText}
      </p>

      {entry.reassign_note && (
        <p className="text-xs text-slate-600 mt-2 leading-relaxed">
          Reason: <span className="font-medium">{entry.reassign_note}</span>
        </p>
      )}

      <p className="text-[11px] text-slate-400 mt-2">
        Assigned{" "}
        {new Date(entry.assigned_at).toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        })}
      </p>
    </motion.div>
  );
}
