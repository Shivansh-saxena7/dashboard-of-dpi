"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import EmployeeTabBar from "@/components/EmployeeTabBar";
import WorkReportView from "@/components/WorkReportView";
import { todayKey } from "@/lib/leaderboardWeek";

// Employee's own "My Report" tab (Point 4, 2026-08-19 live-production
// review) — same auth-check pattern app/leads/page.tsx and
// app/data/page.tsx already use (no shared employee layout exists yet
// — see those files' own comments). Sales-only, same reasoning as
// Leads/Data: a non-Sales employee has no calls/leads/visits to
// report on.
//
// Always TODAY, always self — an employee never picks another day or
// another employee here (that's Admin's Work Reports page, a
// deliberately separate surface reusing the exact same WorkReportView
// + get_employee_work_report RPC, just with its own Employee-selector/
// Date-picker). "Today" reuses todayKey() from lib/leaderboardWeek.ts
// (Golden Rule — this file previously duplicated its own IST-date
// logic inline; found and fixed 2026-08-19) — an IST calendar date,
// regardless of the device's own local timezone, matching what
// get_employee_work_report itself expects (a plain date interpreted
// as an IST day boundary).

export default function MyReportPage() {

  const router = useRouter();

  const [employee, setEmployee] = useState<any>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [whatsappGroupLabel, setWhatsappGroupLabel] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("lead_engine_settings")
      .select("work_report_whatsapp_group_label")
      .eq("id", 1)
      .single()
      .then(({ data }) => setWhatsappGroupLabel(data?.work_report_whatsapp_group_label || null));
  }, []);

  useEffect(() => {
    async function getLoggedInEmployee() {

      const {
        data: { user }
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/login");
        return;
      }

      const { data, error } = await supabase
        .from("employees")
        .select("*")
        .eq("auth_user_id", user.id)
        .single();

      if (error || !data) {
        console.error("Employee not found");
        return;
      }

      if (!data.is_active) {
        await supabase.auth.signOut();
        router.replace("/login");
        return;
      }

      if (data.role === "admin") {
        router.replace("/admin");
        return;
      }

      if (data.department !== "sales") {
        router.replace("/");
        return;
      }

      setEmployee(data);
      setAuthChecked(true);
    }

    getLoggedInEmployee();
  }, []);

  if (!authChecked) {
    return <div className="min-h-screen bg-white" />;
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-white via-blue-50 to-blue-100">
      <Header />
      <EmployeeTabBar role={employee?.role} department={employee?.department} />
      {employee?.id && (
        <div className="mx-4 mt-4 pb-6">
          <WorkReportView
            employeeId={employee.id}
            employeeName={employee.name}
            date={todayKey()}
            whatsappGroupLabel={whatsappGroupLabel}
          />
        </div>
      )}
      <Footer />
    </main>
  );
}
