"use client";

import type { LucideIcon } from "lucide-react";

export interface SectionTab {
  id: string;
  label: string;
  icon?: LucideIcon;
}

// In-page tab switcher for long section-stacked pages (Salary etc.) --
// distinct from components/EmployeeTabBar.tsx, which is route-based
// (<Link>-driven, navigates between actual pages). This one is a pure
// client-side visibility toggle within a single page: activeTab is
// owned by the parent (controlled), so the page can read/drive it.
// Visual language matches the existing card/button conventions already
// used across components/payroll/* (rounded-2xl bg-white border
// border-slate-200 shadow-sm cards; solid dark active state, same as
// this codebase's other segmented toggles e.g. Basic Pay Overview's
// "All Employees" pill).
export function SectionTabBar({ tabs, activeTab, onTabChange }: { tabs: SectionTab[]; activeTab: string; onTabChange: (id: string) => void }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-1.5 overflow-x-auto">
      <div className="flex gap-1.5 min-w-max">
        {tabs.map((tab) => {
          const active = tab.id === activeTab;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`h-10 px-4 rounded-xl text-sm font-bold whitespace-nowrap transition flex items-center gap-1.5 ${
                active ? "bg-slate-800 text-white" : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              {Icon && <Icon size={15} />}
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Always mounted, visibility toggled via CSS -- deliberate, not
// {activeTab === id && <panel/>}. Un-mounting on tab switch would
// re-fire every child's data-fetching useEffect and drop any
// in-progress form input the moment a user tabbed away and back.
export function SectionTabPanel({ id, activeTab, children }: { id: string; activeTab: string; children: React.ReactNode }) {
  return <div className={activeTab === id ? "space-y-5" : "hidden"}>{children}</div>;
}
