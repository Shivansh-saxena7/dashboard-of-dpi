"use client";
// Admin Home (admin and super_admin, one Home). A1 (2026-11-19): behind lead_engine_settings.admin_home_mode
// (lib/adminHome.ts). Off, missing, unknown, failed or slow (2 s) = the old dashboard at once, exactly as before; the
// flag is read in the background and remembered for the tab (lib/useAdminHomeMode.ts).
import AdminSocialDashboard from "@/components/AdminSocialDashboard";
import AdminHomeA1 from "@/components/AdminHomeA1";
import { useAdminHomeMode } from "@/lib/useAdminHomeMode";

export default function AdminDashboard() {
  const mode = useAdminHomeMode();
  return mode.on && mode.employeeId ? <AdminHomeA1 /> : <AdminSocialDashboard />;
}
