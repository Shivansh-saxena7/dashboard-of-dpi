"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { supabase } from "@/lib/supabase";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import EmployeeTabBar from "@/components/EmployeeTabBar";
import TeamMemberCard, { MemberAttendanceStatus } from "@/components/TeamMemberCard";
import TeamMemberDetailModal from "@/components/TeamMemberDetailModal";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Team Leader's own read-only dashboard. Every read here relies
// entirely on the Phase 5 RLS policies (employees/leads/attendance/
// site_visits team_leader-select) — no client-side ownership
// filtering beyond .eq("team_id", ...) for convenience; the database
// itself is what actually scopes this to "my team only." "Top
// Performer" sums the frozen site_visits.points column directly
// (not lib/calculateLeadPoints.ts, which uses CURRENT point
// constants) — consistent with the historical-accuracy design
// decided in Phase 4.
export default function TeamPage() {

  const router = useRouter();

  const [employee, setEmployee] = useState<any>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const [team, setTeam] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [attendanceByEmployee, setAttendanceByEmployee] = useState<Map<string, any>>(new Map());
  const [leadCountByEmployee, setLeadCountByEmployee] = useState<Map<string, number>>(new Map());
  const [pointsByEmployee, setPointsByEmployee] = useState<Map<string, number>>(new Map());
  const [totalLeads, setTotalLeads] = useState(0);
  const [bookingsThisWeek, setBookingsThisWeek] = useState(0);
  const [loadingTeam, setLoadingTeam] = useState(true);

  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);

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

      // This whole page only makes sense for a team_leader — a
      // regular employee has no led team to show.
      if (data.role !== "team_leader") {
        router.replace("/");
        return;
      }

      setEmployee(data);
      setAuthChecked(true);
    }

    getLoggedInEmployee();
  }, []);

  useEffect(() => {
    if (employee?.id) {
      loadTeamData();
    }
  }, [employee]);

  async function loadTeamData() {
    setLoadingTeam(true);

    const { data: teamData } = await supabase
      .from("teams")
      .select("*")
      .eq("id", employee.team_id)
      .single();

    if (!teamData) {
      setLoadingTeam(false);
      return;
    }

    setTeam(teamData);

    const { data: memberRows } = await supabase
      .from("employees")
      .select("id, name, email, is_active")
      .eq("team_id", teamData.id)
      .order("name");

    const memberList = memberRows || [];
    setMembers(memberList);

    const memberIds = memberList.map((m) => m.id);

    if (memberIds.length === 0) {
      setLoadingTeam(false);
      return;
    }

    const today = new Date().toISOString().split("T")[0];

    const [{ data: attendanceRows }, { data: leadsRows }, { data: siteVisitsRows }] = await Promise.all([
      supabase
        .from("attendance")
        .select("employee_id, shift_start_at, shift_end_at")
        .eq("date", today)
        .in("employee_id", memberIds),
      supabase
        .from("leads")
        .select("id, current_owner_id")
        .in("current_owner_id", memberIds),
      supabase
        .from("site_visits")
        .select("employee_id, event_type, points, created_at")
        .in("employee_id", memberIds)
    ]);

    const attendanceMap = new Map<string, any>();
    (attendanceRows || []).forEach((a) => attendanceMap.set(a.employee_id, a));
    setAttendanceByEmployee(attendanceMap);

    const leadCountMap = new Map<string, number>();
    (leadsRows || []).forEach((l) => {
      leadCountMap.set(l.current_owner_id, (leadCountMap.get(l.current_owner_id) || 0) + 1);
    });
    setLeadCountByEmployee(leadCountMap);
    setTotalLeads((leadsRows || []).length);

    const pointsMap = new Map<string, number>();
    let bookingsCount = 0;
    const nowMs = Date.now();

    (siteVisitsRows || []).forEach((v) => {
      pointsMap.set(v.employee_id, (pointsMap.get(v.employee_id) || 0) + v.points);

      if (v.event_type === "BOOKED" && nowMs - new Date(v.created_at).getTime() <= WEEK_MS) {
        bookingsCount++;
      }
    });

    setPointsByEmployee(pointsMap);
    setBookingsThisWeek(bookingsCount);

    setLoadingTeam(false);
  }

  function getAttendanceStatus(employeeId: string): MemberAttendanceStatus {
    const row = attendanceByEmployee.get(employeeId);
    if (!row) return "NOT_STARTED";
    if (row.shift_end_at) return "ENDED";
    return "ACTIVE";
  }

  const topPerformer = useMemo(() => {
    const ranked = members
      .map((m) => ({ id: m.id, name: m.name, points: pointsByEmployee.get(m.id) || 0 }))
      .filter((m) => m.points > 0)
      .sort((a, b) => b.points - a.points);

    return ranked[0] || null;
  }, [members, pointsByEmployee]);

  if (!authChecked) {
    return <div className="min-h-screen bg-white" />;
  }

  const selectedMember = members.find((m) => m.id === selectedMemberId) || null;

  return (
    <main className="min-h-screen bg-gradient-to-br from-white via-blue-50 to-blue-100">
      <Header />
      <EmployeeTabBar role={employee?.role} />

      {/* Hero — dark/gold with looping ambient glow. Deliberate
          exception to the static-only treatment used elsewhere
          (LeadCard, StartShiftCard) — Section 2.4 explicitly names
          "Team Leader dashboard landing" as a full-screen hero moment
          allowed to use this richer motion. */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden mx-4 mt-4 rounded-[28px] bg-[#0b0b0b] p-7"
      >
        <motion.div
          animate={{ x: [-20, 20, -20], y: [0, -20, 0] }}
          transition={{ duration: 11, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -top-16 -left-10 h-56 w-56 rounded-full bg-amber-500/20 blur-3xl pointer-events-none"
        />
        <motion.div
          animate={{ x: [20, -20, 20], y: [0, 20, 0] }}
          transition={{ duration: 13, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -bottom-16 -right-10 h-56 w-56 rounded-full bg-yellow-400/15 blur-3xl pointer-events-none"
        />

        <p className="relative text-[10px] font-semibold tracking-[0.25em] text-amber-400 uppercase mb-2">
          Team Dashboard
        </p>
        <h1 className="relative text-2xl font-bold text-white">
          {team?.name || "Your Team"}
        </h1>
        <p className="relative text-sm text-white/50 mt-1">
          {members.length} member{members.length === 1 ? "" : "s"}
        </p>

        <div className="relative grid grid-cols-3 gap-3 mt-6">
          <div className="rounded-2xl bg-white/[0.05] backdrop-blur-xl p-4">
            <p className="text-[10px] uppercase tracking-wide text-white/40 font-semibold">Total Leads</p>
            <p className="text-2xl font-bold text-white mt-1">{totalLeads}</p>
          </div>
          <div className="rounded-2xl bg-white/[0.05] backdrop-blur-xl p-4">
            <p className="text-[10px] uppercase tracking-wide text-white/40 font-semibold">Bookings (Wk)</p>
            <p className="text-2xl font-bold text-white mt-1">{bookingsThisWeek}</p>
          </div>
          <div className="rounded-2xl bg-white/[0.05] backdrop-blur-xl p-4">
            <p className="text-[10px] uppercase tracking-wide text-white/40 font-semibold">Top Performer</p>
            <p className="text-sm font-bold text-white mt-2 truncate">
              {topPerformer ? topPerformer.name : "—"}
            </p>
            {topPerformer && <p className="text-[11px] text-amber-400">{topPerformer.points} pts</p>}
          </div>
        </div>
      </motion.div>

      <div className="mx-4 mt-5">
        <p className="text-[10.5px] uppercase tracking-[0.25em] text-slate-400 font-bold mb-3">
          Team Roster
        </p>

        {loadingTeam ? (
          <p className="text-sm text-slate-400">Loading team...</p>
        ) : members.length === 0 ? (
          <p className="text-sm text-slate-400">No members assigned to your team yet.</p>
        ) : (
          <div className="space-y-2.5 pb-6">
            {members.map((member, index) => (
              <TeamMemberCard
                key={member.id}
                member={member}
                index={index}
                attendanceStatus={getAttendanceStatus(member.id)}
                leadCount={leadCountByEmployee.get(member.id) || 0}
                points={pointsByEmployee.get(member.id) || 0}
                onOpen={() => setSelectedMemberId(member.id)}
              />
            ))}
          </div>
        )}
      </div>

      {selectedMember && (
        <TeamMemberDetailModal
          member={selectedMember}
          teamLeaderId={employee.id}
          attendanceStatus={getAttendanceStatus(selectedMember.id)}
          onClose={() => setSelectedMemberId(null)}
        />
      )}

      <Footer />
    </main>
  );
}
