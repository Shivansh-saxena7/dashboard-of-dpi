"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Posts" },
  { href: "/leads", label: "Leads" }
];

// Simple two-tab nav between the V1 (Posts) and V2 (Leads) employee
// views. No shared layout wraps both pages yet, so this is dropped
// into each page individually (app/page.tsx, app/leads/page.tsx) —
// same as StartShiftCard. Deliberately minimal/extensible: a third
// V3 tab is just one more entry in this array, nothing to restructure.
export default function EmployeeTabBar() {
  const pathname = usePathname();

  return (
    <div className="mx-4 mt-4 flex gap-1 rounded-2xl bg-slate-100 p-1">
      {TABS.map((tab) => {
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
