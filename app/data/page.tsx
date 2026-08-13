"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import EmployeeTabBar from "@/components/EmployeeTabBar";
import StartShiftCard from "@/components/StartShiftCard";
import DataList from "@/components/DataList";

// Data's own top-level route — mirrors app/leads/page.tsx exactly
// (same inline auth-check block, same reasoning: no shared employee
// layout exists yet for just a few pages). Kept as a genuinely
// separate page rather than a tab inside LeadList, per the approved
// design — Data has no board-stage workflow and shouldn't share
// LeadList's SLA-heavy UI or its Follow-up/Visit/Booking tabs.
export default function DataPage() {

  const router = useRouter();

  const [employee, setEmployee] = useState<any>(null);
  const [authChecked, setAuthChecked] = useState(false);

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

      // Data is Sales-only active work — same reasoning/redirect as
      // app/leads/page.tsx.
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
      {employee?.id && <StartShiftCard employeeId={employee.id} compact />}
      <EmployeeTabBar role={employee?.role} department={employee?.department} />
      {employee?.id && <DataList employeeId={employee.id} />}
      <Footer />
    </main>
  );
}
