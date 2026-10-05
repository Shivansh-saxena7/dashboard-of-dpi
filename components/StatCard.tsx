import type { ReactNode } from "react";

// Shared stat tile (UI/UX Phase 9) — was two identical local `Card`
// components (admin/analytics, admin/employees/[id]). The label sits on
// its own full-width line: beside a 56px icon in a half-width phone
// card it collided with the icon, then truncated.
export default function StatCard({ title, value, icon }: { title: string; value: ReactNode; icon: ReactNode }) {
  return (
    <div className="bg-white rounded-[30px] shadow-md p-4 sm:p-5">
      <p className="text-xs text-gray-400">{title}</p>
      <div className="flex items-center justify-between gap-3 mt-2">
        <h2 className="text-2xl sm:text-3xl font-bold">{value}</h2>
        <div className="h-11 w-11 sm:h-14 sm:w-14 shrink-0 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 flex items-center justify-center text-xl sm:text-2xl text-white">
          {icon}
        </div>
      </div>
    </div>
  );
}
