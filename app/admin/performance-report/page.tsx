"use client";
// Admin Performance Report (2026-11-20). Admin / super admin only (app/admin/layout.tsx checks the role; the RPCs check
// is_admin() again). Hidden unless lead_engine_settings.admin_report_mode = 'on'; a missing column counts as off. The give
// leads controls (2026-11-23) show only while admin_report_reassign_mode = 'on' too.
import PerfReport from "@/components/PerfReport";
import { useAdminReportFlags } from "@/lib/usePerfReport";

export default function PerformanceReportPage() {
  const { mode, reassign } = useAdminReportFlags();
  if (mode === "loading") return <div aria-busy className="h-40 animate-pulse rounded-2xl bg-slate-200/70 motion-reduce:animate-none" />;
  if (mode === "off")
    return (
      <p data-testid="perf-hidden" className="rounded-2xl border border-slate-200 bg-white p-4 text-[15px] text-slate-700">
        The Performance report is not turned on.
      </p>
    );
  return <PerfReport reassign={reassign} />;
}
