"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import EmployeeTabBar from "@/components/EmployeeTabBar";
import StartShiftCard from "@/components/StartShiftCard";
import LeadList from "@/components/LeadList";
import { getCurrentUser } from "@/lib/currentUser";

// New V2 route — deliberately its own page rather than folded into
// app/page.tsx (V1's employee dashboard), so V1 stays untouched. No
// shared employee layout exists yet, so this repeats the same
// inline auth-check block app/page.tsx already uses, rather than
// introducing a new layout abstraction for just two pages.
export default function LeadsPage() {

  const router = useRouter();

  const [employee, setEmployee] = useState<any>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    async function getLoggedInEmployee() {

      // Network-safe: a dropped connection no longer sends a logged-in employee to /login (lib/currentUser.ts).
      const user = await getCurrentUser();

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

      // Leads is Sales-only active work — a non-Sales employee
      // (department !== 'sales') has no owned leads to manage here,
      // and non-Sales departments have no dedicated module of their
      // own yet (Posts is their whole experience) — so this redirects
      // to "/" rather than a Sales-adjacent substitute. Redirects at
      // the route level, not just tab-hiding, so a direct URL hit is
      // blocked the same way admin's is above.
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
      {employee?.id && <LeadList employeeId={employee.id} />}
      <Footer />
    </main>
  );
}
