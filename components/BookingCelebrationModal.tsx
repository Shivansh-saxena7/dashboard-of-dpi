"use client";

import { motion } from "framer-motion";
import { createPortal } from "react-dom";
import { PartyPopper, X } from "lucide-react";

interface BookingCelebrationModalProps {
  message: string;
  onClose: () => void;
}

// Portaled to document.body — same reasoning as every other full-
// screen overlay in this app (AdminLeadHistoryModal, ManualLeadEntry
// Modal): needs to resolve against the viewport, not whatever
// transformed/animated ancestor happens to be mounting it (Header is
// itself sticky + can sit inside animated wrappers on some pages).
//
// Manual-close only, no timer — a celebration is worth reading, not
// racing a clock over. Closable via the corner X (matches every other
// modal's convention — AdminLeadHistoryModal etc.), backdrop click, or
// the "🎉 Nice!" button, all deliberate user actions. Every close path
// calls the same onClose, which is what Header.tsx uses to advance
// its celebration queue — this component has no idea whether it's
// showing a live one or a catch-up one, by design (that distinction
// lives entirely in Header).
export default function BookingCelebrationModal({ message, onClose }: BookingCelebrationModalProps) {

  const modal = (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.85, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 22 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-sm rounded-[28px] bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500 p-1 shadow-[0_20px_60px_rgba(217,119,6,0.4)]"
      >
        <div className="relative rounded-[24px] bg-white px-6 py-8 text-center">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 h-8 w-8 flex items-center justify-center rounded-full bg-slate-900/5 hover:bg-slate-900/10 text-slate-500 hover:text-slate-700 transition"
          >
            <X size={16} />
          </button>

          <motion.div
            initial={{ scale: 0, rotate: -20 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 14, delay: 0.1 }}
            className="mx-auto h-16 w-16 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 shadow-[0_8px_20px_rgba(217,119,6,0.35)] flex items-center justify-center"
          >
            <PartyPopper size={28} className="text-white" />
          </motion.div>

          <p className="mt-5 text-[15px] font-bold text-slate-800 leading-relaxed">{message}</p>

          <button
            onClick={onClose}
            className="mt-6 w-full h-11 rounded-xl font-semibold text-white bg-gradient-to-r from-amber-500 to-orange-500 shadow-[0_6px_16px_rgba(217,119,6,0.3)]"
          >
            🎉 Nice!
          </button>
        </div>
      </motion.div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : null;
}
