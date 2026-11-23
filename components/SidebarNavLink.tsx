"use client";

import Link from "next/link";

// Shared sidebar row for the Admin / HR / Payroll layouts — one owner
// for the row style and the "which item is the current page" rule.
// A section's root (e.g. /admin, /hr) is active only on an exact match;
// any other item is also active on its own sub-pages (/admin/leads/import
// highlights Leads).
export function isNavItemActive(pathname: string, href: string, sectionRoot: string): boolean {
  if (href === sectionRoot) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function SidebarNavLink({
  href,
  icon,
  name,
  active,
  onNavigate,
  tall = false,
  testId
}: {
  href: string;
  icon: string;
  name: string;
  active: boolean;
  onNavigate: () => void;
  // Optional: at least 44px tall (newer items); existing items keep their size.
  tall?: boolean;
  testId?: string;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      data-testid={testId}
      className={`flex items-center gap-2.5 px-3 py-2.5 ${tall ? "min-h-11 " : ""}rounded-xl text-sm font-semibold transition ${
        active ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50"
      }`}
    >
      <span>{icon}</span>
      {name}
    </Link>
  );
}
