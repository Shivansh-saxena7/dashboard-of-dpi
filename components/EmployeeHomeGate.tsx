"use client";
// Which flag-on Home to show (2026-11-29). employee_home_mode still decides new vs old (app/page.tsx: flag off or an
// error = the old Posts Home). With the flag on, the v3 Home shows. Preview / local only (never the live domain):
// ?home=p1 shows the previous Home and ?home=v3 the new one, to compare without any database change.
import { useEffect, useState } from "react";
import EmployeeHomeP1 from "@/components/EmployeeHomeP1";
import EmployeeHomeV3 from "@/components/EmployeeHomeV3";
import { HOME_VARIANT_KEY, homeVariantFromUrl } from "@/lib/homeV3";

export default function EmployeeHomeGate(props: { employeeId: string; employeeName?: string | null; role?: string | null; teamId?: string | null }) {
  const [variant, setVariant] = useState<"v3" | "p1">("v3");
  useEffect(() => {
    let remembered: string | null = null;
    try {
      remembered = sessionStorage.getItem(HOME_VARIANT_KEY);
    } catch {
      // private mode: no memory
    }
    const v = homeVariantFromUrl(window.location.search, window.location.hostname, remembered);
    // Preview / local only: keep the choice for this tab (Back to Home keeps the same Home).
    if (v !== "v3" || remembered) {
      try {
        sessionStorage.setItem(HOME_VARIANT_KEY, v);
      } catch {
        // ignore
      }
    }
    setVariant(v);
  }, []);
  if (variant === "p1") return <EmployeeHomeP1 {...props} />;
  return (
    <div className="px-4 pb-6 pt-3 sm:px-6">
      <EmployeeHomeV3 {...props} />
    </div>
  );
}
