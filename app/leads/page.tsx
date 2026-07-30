"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import EmployeeTabBar from "@/components/EmployeeTabBar";
import LeadList from "@/components/LeadList";

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
      <EmployeeTabBar role={employee?.role} />
      {employee?.id && <LeadList employeeId={employee.id} />}
      <Footer />
    </main>
  );
}
