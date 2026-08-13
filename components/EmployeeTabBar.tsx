"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Image as ImageIcon, Target, Database, Users, Trophy, Ticket } from "lucide-react";

interface EmployeeTabBarProps {
  role?: string;
  department?: string;
}

const SALES_TABS = [
  { href: "/", label: "Posts", icon: ImageIcon },
  { href: "/leads", label: "Leads", icon: Target },
  { href: "/data", label: "Data", icon: Database },
  { href: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { href: "/tickets", label: "Tickets", icon: Ticket }
];

// Tickets is deliberately universal — "koi-bhi-employee" can raise
// one, so unlike Leads/Data/Leaderboard (Sales-only) it belongs on
// BOTH branches. Non-Sales departments previously got no tab bar at
// all (Posts was their entire experience) — that's reversed here,
// specifically because Tickets exists now and is genuinely relevant
// to them, not a blanket re-expansion of their access.
const NON_SALES_TABS = [
  { href: "/", label: "Posts", icon: ImageIcon },
  { href: "/tickets", label: "Tickets", icon: Ticket }
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
//
// Container styling mirrors LeadCard's own "premium card" treatment
// exactly (rounded-[22px], real depth-shadow rgba(15,23,42,0.06),
// same icon-badge shadow intensity 0.35) rather than the generic
// Tailwind shadow-sm this used to have — so the bar reads as a
// clearly-elevated card sitting on the page, not a flat strip. The
// thin gold top-hairline reuses the exact accent-strip technique
// Header.tsx's own drawer already uses (#B8860B via #E8C766 to
// #B8860B), just 2px instead of 3px given this card is much shorter.
//
// Base background is the SAME warm-cream diagonal wash Header.tsx's
// own drawer hero already uses (#FFFDF8 -> #F3ECDA) rather than a new
// color — reused verbatim so this reads as the same "premium surface"
// material already established there, not a one-off. The moving
// shimmer band on top is a translateX sweep (GPU-composited, cheap)
// rather than an animated background-position (JS/paint-driven) —
// deliberate, since this card is mounted permanently on every
// employee page, not a one-off loading state. 8s sweep + 3s pause
// between cycles keeps it feeling like light catching a surface
// occasionally, not a constant loading-spinner. Both the wash and the
// shimmer sit behind the tab row in DOM order with no z-index of
// their own, so the gold hairline (explicit z-10) and the tab content
// (painted last) both stay visually on top without needing to fight
// for stacking order.
//
// Split into an outer fixed-size card (rounded corners + gold-strip
// anchor) and an inner overflow-x-auto row — deliberate, not
// decorative: at flex-1, each tab's own text has a default min-content
// floor it won't shrink below (same min-width:auto flex behavior
// documented on the admin/coordinator layout fix elsewhere in this
// app), so the row's natural width can exceed the card's at narrow
// phone widths. overflow-hidden there would silently CLIP the last
// tab's label mid-word — verified this happening via Playwright
// before landing on overflow-x-auto instead (same "make it
// scrollable, never hidden" principle as the Employee-Summary table
// fix). Re-verified after adding Tickets: at 360px even the base
// 5-tab Sales case (no team_leader) now scrolls (353px content vs
// 326px available) — confirmed via screenshot this degrades cleanly
// (trailing tab fades at the edge, swipeable, not clipped/broken),
// same as the 6-tab team_leader case already did. The 2-tab
// NON_SALES_TABS case is the only one that never needs to scroll.
export default function EmployeeTabBar({ role, department }: EmployeeTabBarProps) {
  const pathname = usePathname();

  // department defaults to "sales" here (undefined — e.g. mid-flight
  // before the employee row has loaded — falls through to the Sales
  // tab-set, matching the DB column's own default so nothing changes
  // for the common case).
  const isNonSales = Boolean(department && department !== "sales");
  const baseTabs = isNonSales ? NON_SALES_TABS : SALES_TABS;
  const tabs = !isNonSales && role === "team_leader" ? [...baseTabs, TEAM_LEADER_TAB] : baseTabs;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="relative mx-4 mt-4 rounded-[22px] bg-gradient-to-br from-[#FFFDF8] to-[#F3ECDA] border border-slate-100 shadow-[0_4px_20px_rgba(15,23,42,0.06)] overflow-hidden"
    >
      <motion.div
        aria-hidden
        className="absolute inset-y-0 left-0 w-1/2 pointer-events-none"
        style={{ background: "linear-gradient(90deg, transparent, rgba(212,175,55,0.22), transparent)" }}
        animate={{ x: ["-100%", "200%"] }}
        transition={{ duration: 8, repeat: Infinity, repeatDelay: 3, ease: "easeInOut" }}
      />

      <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-[#B8860B] via-[#E8C766] to-[#B8860B] z-10" />

      <div className="flex gap-1 p-1.5 overflow-x-auto">
        {tabs.map((tab) => {
          const active = pathname === tab.href;
          const Icon = tab.icon;

          return (
            <Link key={tab.href} href={tab.href} className="flex-1">
              <motion.div
                whileTap={{ scale: 0.97 }}
                className={`relative h-11 flex items-center justify-center gap-1.5 rounded-xl overflow-hidden transition-colors ${
                  !active ? "hover:bg-slate-50" : ""
                }`}
              >
                {active && (
                  <motion.div
                    layoutId="employeeTabActivePill"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    className="absolute inset-0 rounded-xl bg-gradient-to-r from-yellow-400 to-amber-500 shadow-[0_4px_12px_rgba(217,119,6,0.35)]"
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
      </div>
    </motion.div>
  );
}
