"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Image as ImageIcon, Target, Database, Users } from "lucide-react";

interface EmployeeTabBarProps {
  role?: string;
}

const BASE_TABS = [
  { href: "/", label: "Posts", icon: ImageIcon },
  { href: "/leads", label: "Leads", icon: Target },
  { href: "/data", label: "Data", icon: Database }
];

const TEAM_LEADER_TAB = { href: "/team", label: "Team", icon: Users };

// Nav between the V1 (Posts) and V2 (Leads/Data) employee views, plus
// a conditional "Team" tab for team_leader role only — this is
// exactly the "one more array entry" extensibility this component was
// built for. "Data" is its own tab/route (not folded into Leads)
// because it has no board-stage workflow and shouldn't share
// LeadList's SLA-heavy UI — every employee sees it, not just team
// leaders, since anyone can be handed Data. No shared layout wraps
// these pages yet, so this is dropped into each page individually
// (app/page.tsx, app/leads/page.tsx, app/data/page.tsx,
// app/team/page.tsx) — same as StartShiftCard.
//
// Active-state uses a Framer Motion layoutId shared-element pill
// (Section 2.4's established motion vocabulary, just applied here as
// a sliding-tab-indicator) rather than a plain per-tab color swap —
// on tab change, the SAME motion.div (tracked across renders by
// layoutId) animates its position/size to the new active tab instead
// of one pill disappearing and another appearing. Gold-gradient +
// icon per tab matches the exact treatment LeadList's own board-stage
// tabs already use, for one consistent tab-bar language app-wide.
export default function EmployeeTabBar({ role }: EmployeeTabBarProps) {
  const pathname = usePathname();

  const tabs = role === "team_leader" ? [...BASE_TABS, TEAM_LEADER_TAB] : BASE_TABS;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="mx-4 mt-4 flex gap-1 rounded-2xl bg-white border border-slate-100 shadow-sm p-1.5"
    >
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        const Icon = tab.icon;

        return (
          <Link key={tab.href} href={tab.href} className="flex-1">
            <motion.div
              whileTap={{ scale: 0.97 }}
              className="relative h-11 flex items-center justify-center gap-1.5 rounded-xl overflow-hidden"
            >
              {active && (
                <motion.div
                  layoutId="employeeTabActivePill"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  className="absolute inset-0 rounded-xl bg-gradient-to-r from-yellow-400 to-amber-500 shadow-[0_4px_12px_rgba(217,119,6,0.3)]"
                />
              )}
              <Icon size={15} className={`relative z-10 shrink-0 ${active ? "text-slate-900" : "text-slate-500"}`} />
              <span className={`relative z-10 text-xs sm:text-sm font-bold ${active ? "text-slate-900" : "text-slate-500"}`}>
                {tab.label}
              </span>
            </motion.div>
          </Link>
        );
      })}
    </motion.div>
  );
}
