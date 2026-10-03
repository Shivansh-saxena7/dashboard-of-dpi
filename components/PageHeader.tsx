"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { motion } from "framer-motion";

const TONES = {
  admin: { bg: "from-slate-900 via-blue-800 to-cyan-600", eyebrow: "text-cyan-100" },
  hr: { bg: "from-teal-700 via-emerald-600 to-teal-500", eyebrow: "text-teal-100" },
  payroll: { bg: "from-emerald-800 via-emerald-600 to-lime-500", eyebrow: "text-emerald-100" }
} as const;

// Shared page header (UI/UX Phase 7, 2026-10-03) — the gradient-banner
// pattern UI/UX Phases 1–5 established on the HR/Payroll pages
// (hr/attendance is the reference), so every Admin page opens the same
// way instead of four different title sizes and two header styles.
//
// actions: buttons — beside the title on wide screens, below it on
// phones. children: an optional extra row (stat chips, tabs) inside
// the banner.
export default function PageHeader({
  eyebrow,
  title,
  description,
  icon: Icon,
  actions,
  children,
  tone = "admin"
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  icon?: LucideIcon;
  actions?: ReactNode;
  children?: ReactNode;
  tone?: keyof typeof TONES;
}) {
  const colors = TONES[tone];

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative overflow-hidden rounded-[24px] bg-gradient-to-br ${colors.bg} text-white p-5 sm:p-6`}
    >
      {Icon && (
        <Icon size={170} strokeWidth={1.1} className="absolute -right-8 -bottom-12 text-white/10 pointer-events-none hidden sm:block" />
      )}

      <div className="relative flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && (
            <p className={`text-[10px] font-semibold tracking-[0.2em] uppercase mb-2 ${colors.eyebrow}`}>{eyebrow}</p>
          )}
          <h1 className="text-xl sm:text-2xl font-bold">{title}</h1>
          {description && <div className="text-sm text-white/70 mt-1">{description}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 lg:justify-end lg:shrink-0">{actions}</div>}
      </div>

      {children && <div className="relative mt-5">{children}</div>}
    </motion.div>
  );
}
