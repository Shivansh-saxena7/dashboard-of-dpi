"use client";

import { motion } from "framer-motion";
import { createPortal } from "react-dom";
import { X, Trophy } from "lucide-react";

interface LeaderboardRow {
  employeeId: string;
  employeeName: string;
  count: number;
}

interface LeaderboardPopupModalProps {
  title: string;
  subtitle: string;
  countLabel: string;
  rows: LeaderboardRow[];
  myEmployeeId: string | null;
  onClose: () => void;
}

const MEDALS = ["🥇", "🥈", "🥉"];

// Portaled to document.body — same reasoning as BookingCelebration
// Modal. No auto-dismiss (unlike the celebration popup) — a
// leaderboard has more to read/scroll through than a one-line
// message, so it waits for a deliberate close instead of racing a
// timer.
export default function LeaderboardPopupModal({
  title,
  subtitle,
  countLabel,
  rows,
  myEmployeeId,
  onClose
}: LeaderboardPopupModalProps) {

  const modal = (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 280, damping: 24 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md max-h-[85vh] flex flex-col rounded-[28px] bg-white shadow-2xl overflow-hidden"
      >
        <div className="relative shrink-0 overflow-hidden bg-gradient-to-br from-[#0f172a] via-[#1d4ed8] to-[#06b6d4] p-6 text-white">
          <div className="absolute top-[-40px] right-[-40px] w-[120px] h-[120px] rounded-full bg-white/10 blur-3xl" />

          <button
            onClick={onClose}
            className="absolute top-4 right-4 h-8 w-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition"
          >
            <X size={16} />
          </button>

          <div className="relative flex items-center gap-3">
            <div className="shrink-0 h-11 w-11 rounded-2xl bg-white/15 flex items-center justify-center">
              <Trophy size={20} />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold truncate pr-8">{title}</h2>
              <p className="text-white/70 text-xs mt-0.5">{subtitle}</p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
          {rows.map((row, index) => {
            const isMe = row.employeeId === myEmployeeId;
            return (
              <div
                key={row.employeeId}
                className={`flex items-center gap-3 rounded-2xl px-3.5 py-2.5 ${
                  isMe ? "bg-blue-50 border border-blue-200" : "bg-slate-50 border border-slate-100"
                }`}
              >
                <div className="shrink-0 w-7 text-center text-sm font-bold text-slate-500">
                  {MEDALS[index] || index + 1}
                </div>
                <p className={`min-w-0 flex-1 truncate text-sm ${isMe ? "font-bold text-blue-800" : "font-semibold text-slate-700"}`}>
                  {row.employeeName}{isMe && " (You)"}
                </p>
                <div className="shrink-0 text-sm font-bold text-slate-800">
                  {row.count} <span className="text-[11px] font-medium text-slate-400">{countLabel}</span>
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : null;
}
