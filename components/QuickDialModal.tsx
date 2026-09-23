"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { createPortal } from "react-dom";
import { X, Phone } from "lucide-react";
import { rememberQuickDialNumber } from "@/lib/lastCalledLead";

interface QuickDialModalProps {
  onClose: () => void;
}

// Quick Dial (2026-09-23) — deliberately separate from every existing
// lead card's own Call button (LeadCard.tsx), which stays untouched
// and keeps calling its own lead's number exactly as it does today.
// This is for when an employee has just a number and no lead card for
// it yet — call first, decide whether to log it afterward (see the
// "Add as Personal Lead?" prompt this feeds, driven by a
// visibilitychange listener in LeadList.tsx, not here).
//
// Same tel: anchor pattern LeadCard.tsx's own Call button already
// uses (a plain <a href="tel:...">), not a JS-driven navigation —
// rememberQuickDialNumber fires in onClick, synchronously, before the
// href navigation actually happens, same ordering as LeadCard's own
// handleCallClick/rememberCalledCard pairing.
export default function QuickDialModal({ onClose }: QuickDialModalProps) {

  const [mobile, setMobile] = useState("");

  const canCall = mobile.trim().length > 0;

  function handleCallClick() {
    if (!canCall) return;
    rememberQuickDialNumber(mobile.trim());
    onClose();
  }

  const modal = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div onClick={onClose} className="absolute inset-0 bg-black/40" />

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="relative w-full max-w-sm bg-white rounded-[24px] shadow-2xl p-6"
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold text-slate-800">⚡ Quick Dial</h2>
          <button onClick={onClose} className="h-8 w-8 rounded-lg bg-slate-50 flex items-center justify-center text-slate-400 hover:text-slate-600 transition">
            <X size={16} />
          </button>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          Just a number, no lead yet — call now, decide after whether to log it.
        </p>

        <div className="space-y-3">
          <input
            type="tel"
            placeholder="Mobile number"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            autoFocus
            className="w-full h-11 rounded-xl bg-slate-50 border border-slate-200 px-3.5 text-sm outline-none focus:ring-2 focus:ring-amber-200"
          />

          <motion.a
            href={canCall ? `tel:${mobile.trim()}` : undefined}
            onClick={handleCallClick}
            whileTap={canCall ? { scale: 0.98 } : undefined}
            aria-disabled={!canCall}
            className={`w-full h-11 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition ${
              canCall
                ? "bg-gradient-to-r from-yellow-400 to-amber-500 text-slate-900 shadow-[0_6px_16px_rgba(217,119,6,0.3)]"
                : "bg-slate-100 text-slate-400 pointer-events-none"
            }`}
          >
            <Phone size={15} />
            Call
          </motion.a>
        </div>
      </motion.div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : null;
}
