"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import EmployeeTabBar from "@/components/EmployeeTabBar";
import WeeklyLeaderboardView from "@/components/WeeklyLeaderboardView";

// Leaderboard's own top-level route — mirrors app/data/page.tsx
// exactly (same inline auth-check block; no shared employee layout
// exists yet for just a few pages). This is the permanent,
// check-anytime counterpart to Header.tsx's Tuesday-only Weekly
// Visits popup — Monthly Bookings stays popup-only for now, not
// added here, since only the weekly view was asked to become
// permanent.
export default function LeaderboardPage() {

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

      // Weekly Visits Leaderboard is a Sales-achievement view — a
      // non-Sales employee has nothing to check here. Route-level
      // redirect, not just tab-hiding (a direct URL hit is blocked
      // the same way admin's is above), matching the same hardening
      // now applied to /leads and /data.
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
      <WeeklyLeaderboardView myEmployeeId={employee?.id ?? null} />
      <Footer />
    </main>
  );
}
