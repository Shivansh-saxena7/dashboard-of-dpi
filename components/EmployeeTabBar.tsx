"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface EmployeeTabBarProps {
  role?: string;
}

const BASE_TABS = [
  { href: "/", label: "Posts" },
  { href: "/leads", label: "Leads" },
  { href: "/data", label: "Data" }
];

const TEAM_LEADER_TAB = { href: "/team", label: "Team" };

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
export default function EmployeeTabBar({ role }: EmployeeTabBarProps) {
  const pathname = usePathname();

  const tabs = role === "team_leader" ? [...BASE_TABS, TEAM_LEADER_TAB] : BASE_TABS;

  return (
    <div className="mx-4 mt-4 flex gap-1 rounded-2xl bg-slate-100 p-1">
      {tabs.map((tab) => {
        const active = pathname === tab.href;

        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex-1 text-center py-2 rounded-xl text-sm font-semibold transition-colors ${
              active
                ? "bg-white text-slate-800 shadow"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
