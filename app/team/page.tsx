"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ChevronDown, FileSpreadsheet, FileText, Loader2, UserPlus, Table2 } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import EmployeeTabBar from "@/components/EmployeeTabBar";
import TeamMemberCard, { MemberAttendanceStatus } from "@/components/TeamMemberCard";
import TeamMemberDetailModal from "@/components/TeamMemberDetailModal";
import ExportPreviewTable from "@/components/ExportPreviewTable";
import { LEAD_STATUS_DISPLAY } from "@/lib/leadStatusDisplay";
import { BOARD_STAGES } from "@/lib/leadBoardStageDisplay";
import { exportLeadsToExcel, exportLeadsToPDF } from "@/lib/exportLeadsReport";
import { DateRangeOption, isWithinDateRange, dateRangeFilterLabel } from "@/lib/dateRangeFilter";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const ALL_STATUSES = Object.keys(LEAD_STATUS_DISPLAY);

// Same appearance-none + overlaid chevron pattern as LeadList's
// FilterSelect, but kept as its own local copy rather than a shared
// component — the gold ring here is deliberate (employee-facing
// accent, Section 2.7), and Admin's equivalent is blue. Sharing one
// component across both would either force a theme prop for two call
// sites or silently drift the colors together; a third near-identical
// copy is cheaper than that coupling.
function FilterSelect({
  value,
  onChange,
  children,
  className = ""
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <select
        value={value}
        onChange={onChange}
        className="appearance-none w-full h-10 rounded-xl bg-white border border-slate-200 pl-3 pr-8 text-xs font-semibold text-slate-600 outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-300 transition"
      >
        {children}
      </select>
      <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
    </div>
  );
}

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
  const [dataCountByEmployee, setDataCountByEmployee] = useState<Map<string, number>>(new Map());
  const [pointsByEmployee, setPointsByEmployee] = useState<Map<string, number>>(new Map());
  const [totalLeads, setTotalLeads] = useState(0);
  const [bookingsThisWeek, setBookingsThisWeek] = useState(0);
  const [loadingTeam, setLoadingTeam] = useState(true);

  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);

  const [pendingLeads, setPendingLeads] = useState<any[]>([]);
  const [loadingPending, setLoadingPending] = useState(true);
  const [assigningLeadId, setAssigningLeadId] = useState<string | null>(null);
  const [assignTargetId, setAssignTargetId] = useState("");
  const [assignNote, setAssignNote] = useState("");
  const [assignSubmitting, setAssignSubmitting] = useState(false);

  const [reportLeads, setReportLeads] = useState<any[]>([]);
  const [loadingReport, setLoadingReport] = useState(true);
  const [reportEmployeeFilter, setReportEmployeeFilter] = useState("");
  const [reportProjectFilter, setReportProjectFilter] = useState("");
  const [reportSourceFilter, setReportSourceFilter] = useState("");
  const [reportBoardStageFilter, setReportBoardStageFilter] = useState("");
  const [reportStatusFilter, setReportStatusFilter] = useState("");
  const [reportTypeFilter, setReportTypeFilter] = useState("");
  const [reportDateRangeFilter, setReportDateRangeFilter] = useState<DateRangeOption>("ALL");
  const [reportCustomStart, setReportCustomStart] = useState("");
  const [reportCustomEnd, setReportCustomEnd] = useState("");
  const [exportingReport, setExportingReport] = useState(false);
  const [showPreviewTable, setShowPreviewTable] = useState(false);

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
      loadReportLeads();
      loadPendingLeads();
    }
  }, [employee]);

  // Leads Admin has reserved for this team (pending_team_id set,
  // current_owner_id still null) — relies on the
  // leads_team_leader_pending_select RLS policy, plus the explicit
  // .eq/.is here as a readable convenience filter matching the same
  // condition the RPC itself re-checks atomically at claim time.
  async function loadPendingLeads() {
    setLoadingPending(true);

    const { data, error } = await supabase
      .from("leads")
      .select("id, name, mobile, project, source, priority")
      .eq("pending_team_id", employee.team_id)
      .is("current_owner_id", null)
      .order("created_at", { ascending: false });

    if (!error && data) {
      setPendingLeads(data);
    }

    setLoadingPending(false);
  }

  async function submitAssignPending(lead: { id: string }) {
    if (!assignTargetId) return;

    setAssignSubmitting(true);

    try {

      const { error } = await supabase.rpc("assign_lead_by_team_leader_atomic", {
        p_lead_id: lead.id,
        p_employee_id: assignTargetId,
        p_note: assignNote.trim() || null
      });

      if (error) {
        toast.error(error.message || "Could not assign this lead.");
        return;
      }

      toast.success("Lead assigned.");
      setAssigningLeadId(null);
      setAssignTargetId("");
      setAssignNote("");
      loadPendingLeads();
      loadTeamData();
      loadReportLeads();

    } catch (err) {
      console.log(err);
      toast.error("Something went wrong.");
    } finally {
      setAssignSubmitting(false);
    }
  }

  // Team Reports data source — relies entirely on leads_team_leader_select
  // + lead_history_team_leader_select RLS (Phase 5 + the gap we filled
  // fixing this same read for the roster), no explicit team_id filter
  // here. Separate from loadTeamData's stats fetch above: that one is
  // scoped by memberIds for the roster cards, this one needs the full
  // row shape (priority, board_stage, first_call_at, etc.) that
  // lib/exportLeadsReport.ts expects.
  async function loadReportLeads() {
    setLoadingReport(true);

    const { data, error } = await supabase
      .from("leads")
      .select(
        `
        id, name, mobile, project, source, status, priority, board_stage, recycle_count, lead_type,
        current_owner_id,
        employees ( name ),
        lead_history (
          assigned_at, is_active, first_call_at, first_whatsapp_at, assigned_by_type,
          assigned_by:employees!lead_history_assigned_by_employee_id_fkey(name)
        )
      `
      )
      .eq("lead_history.is_active", true)
      .order("created_at", { ascending: false });

    if (!error && data) {
      setReportLeads(data);
    }

    setLoadingReport(false);
  }

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
        .select("id, current_owner_id, lead_type")
        .in("current_owner_id", memberIds),
      supabase
        .from("site_visits")
        .select("employee_id, event_type, points, created_at")
        .in("employee_id", memberIds)
    ]);

    const attendanceMap = new Map<string, any>();
    (attendanceRows || []).forEach((a) => attendanceMap.set(a.employee_id, a));
    setAttendanceByEmployee(attendanceMap);

    // BUG FIX: previously counted every row (Lead + Data) into one
    // "leads" number per member — a member handed Data would show an
    // inflated/mixed leadCount that was neither an accurate Leads nor
    // Data count. Split by lead_type here instead, same rule
    // everywhere else in the app uses (omitted/anything-but-DATA
    // treated as LEAD).
    const leadCountMap = new Map<string, number>();
    const dataCountMap = new Map<string, number>();
    let totalLeadsOnly = 0;

    (leadsRows || []).forEach((l) => {
      if (l.lead_type === "DATA") {
        dataCountMap.set(l.current_owner_id, (dataCountMap.get(l.current_owner_id) || 0) + 1);
      } else {
        leadCountMap.set(l.current_owner_id, (leadCountMap.get(l.current_owner_id) || 0) + 1);
        totalLeadsOnly++;
      }
    });

    setLeadCountByEmployee(leadCountMap);
    setDataCountByEmployee(dataCountMap);
    setTotalLeads(totalLeadsOnly);

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

  const reportProjectOptions = useMemo(
    () => Array.from(new Set(reportLeads.map((l) => l.project).filter(Boolean))) as string[],
    [reportLeads]
  );

  const reportSourceOptions = useMemo(
    () => Array.from(new Set(reportLeads.map((l) => l.source).filter(Boolean))) as string[],
    [reportLeads]
  );

  const visibleReportLeads = useMemo(() => {
    let result = reportLeads;

    if (reportEmployeeFilter) {
      result = result.filter((lead) => lead.current_owner_id === reportEmployeeFilter);
    }

    if (reportProjectFilter) {
      result = result.filter((lead) => lead.project === reportProjectFilter);
    }

    if (reportSourceFilter) {
      result = result.filter((lead) => lead.source === reportSourceFilter);
    }

    if (reportBoardStageFilter) {
      result = result.filter((lead) => (lead.board_stage || "LEADS") === reportBoardStageFilter);
    }

    if (reportStatusFilter) {
      result = result.filter((lead) => lead.status === reportStatusFilter);
    }

    if (reportTypeFilter) {
      result = result.filter((lead) => (lead.lead_type || "LEAD") === reportTypeFilter);
    }

    if (reportDateRangeFilter !== "ALL") {
      result = result.filter((lead) =>
        isWithinDateRange(
          lead.lead_history?.[0]?.assigned_at,
          reportDateRangeFilter,
          reportCustomStart,
          reportCustomEnd
        )
      );
    }

    return result;
  }, [
    reportLeads,
    reportEmployeeFilter,
    reportProjectFilter,
    reportSourceFilter,
    reportBoardStageFilter,
    reportStatusFilter,
    reportTypeFilter,
    reportDateRangeFilter,
    reportCustomStart,
    reportCustomEnd
  ]);

  const reportMeta = useMemo(() => {
    const employeeLabel = reportEmployeeFilter
      ? members.find((m) => m.id === reportEmployeeFilter)?.name ?? null
      : null;

    const otherFilters: { label: string; value: string }[] = [];

    if (reportProjectFilter) {
      otherFilters.push({ label: "Project", value: reportProjectFilter });
    }

    if (reportSourceFilter) {
      otherFilters.push({ label: "Source", value: reportSourceFilter });
    }

    if (reportBoardStageFilter) {
      otherFilters.push({
        label: "Board Stage",
        value: BOARD_STAGES.find((b) => b.stage === reportBoardStageFilter)?.label || reportBoardStageFilter
      });
    }

    if (reportStatusFilter) {
      otherFilters.push({
        label: "Status",
        value: LEAD_STATUS_DISPLAY[reportStatusFilter as keyof typeof LEAD_STATUS_DISPLAY]?.label || reportStatusFilter
      });
    }

    if (reportTypeFilter) {
      otherFilters.push({ label: "Type", value: reportTypeFilter === "DATA" ? "Data" : "Leads" });
    }

    const dateLabel = dateRangeFilterLabel(reportDateRangeFilter, reportCustomStart, reportCustomEnd);
    if (dateLabel) {
      otherFilters.push({ label: "Date", value: dateLabel });
    }

    return { employeeLabel, otherFilters, scopeLabel: team?.name };
  }, [
    reportEmployeeFilter,
    reportProjectFilter,
    reportSourceFilter,
    reportBoardStageFilter,
    reportStatusFilter,
    reportTypeFilter,
    reportDateRangeFilter,
    reportCustomStart,
    reportCustomEnd,
    members,
    team
  ]);

  async function handleReportExport(format: "excel" | "pdf") {
    if (visibleReportLeads.length === 0 || exportingReport) return;

    setExportingReport(true);
    try {
      if (format === "excel") {
        await exportLeadsToExcel(visibleReportLeads, reportMeta);
      } else {
        await exportLeadsToPDF(visibleReportLeads, reportMeta);
      }
    } catch (err) {
      console.error(err);
      toast.error("Export failed. Please try again.");
    } finally {
      setExportingReport(false);
    }
  }

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

      {pendingLeads.length > 0 && (
        <div className="mx-4 mt-5">
          <p className="text-[10.5px] uppercase tracking-[0.25em] text-slate-400 font-bold mb-3">
            Pending Leads ({pendingLeads.length})
          </p>

          <div className="space-y-2.5">
            {pendingLeads.map((lead) => {
              const isAssigning = assigningLeadId === lead.id;

              return (
                <div key={lead.id} className="rounded-2xl bg-white border border-slate-100 shadow-md p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-800 truncate">{lead.name}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{lead.mobile}</p>
                      {lead.project && <p className="text-xs text-slate-500">{lead.project}</p>}
                    </div>
                    {lead.source && (
                      <span className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600">
                        {lead.source}
                      </span>
                    )}
                  </div>

                  {!isAssigning ? (
                    <button
                      onClick={() => {
                        setAssigningLeadId(lead.id);
                        setAssignTargetId("");
                        setAssignNote("");
                      }}
                      className="flex items-center gap-1.5 mt-3 text-[11px] font-bold text-amber-700 hover:text-amber-800 transition"
                    >
                      <UserPlus size={12} />
                      Assign to a team member
                    </button>
                  ) : (
                    <div className="mt-3 pt-3 border-t border-slate-100 space-y-1.5">
                      <select
                        value={assignTargetId}
                        onChange={(e) => setAssignTargetId(e.target.value)}
                        className="w-full h-9 rounded-lg bg-slate-50 border border-slate-200 px-2 text-xs font-semibold text-slate-600 outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-300 transition"
                      >
                        <option value="">Select member...</option>
                        {members.filter((m) => m.is_active).map((m) => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </select>

                      <input
                        type="text"
                        value={assignNote}
                        onChange={(e) => setAssignNote(e.target.value)}
                        placeholder="Reason (optional)"
                        className="w-full h-9 rounded-lg bg-slate-50 border border-slate-200 px-2 text-xs text-slate-600 outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-300 transition"
                      />

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => submitAssignPending(lead)}
                          disabled={!assignTargetId || assignSubmitting}
                          className="flex-1 h-9 rounded-lg bg-amber-500 text-white text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-amber-600 transition"
                        >
                          {assignSubmitting ? <Loader2 className="animate-spin mx-auto" size={13} /> : "Confirm"}
                        </button>
                        <button
                          onClick={() => {
                            setAssigningLeadId(null);
                            setAssignTargetId("");
                            setAssignNote("");
                          }}
                          disabled={assignSubmitting}
                          className="h-9 px-3 rounded-lg text-slate-400 text-xs font-semibold hover:text-slate-600 transition"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

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
                dataCount={dataCountByEmployee.get(member.id) || 0}
                points={pointsByEmployee.get(member.id) || 0}
                onOpen={() => setSelectedMemberId(member.id)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="mx-4 mt-6">
        <p className="text-[10.5px] uppercase tracking-[0.25em] text-slate-400 font-bold mb-3">
          Team Reports
        </p>

        <div className="bg-white rounded-[24px] border border-slate-100 shadow-md p-5 space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <FilterSelect value={reportEmployeeFilter} onChange={(e) => setReportEmployeeFilter(e.target.value)}>
              <option value="">All Members</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </FilterSelect>

            <FilterSelect value={reportProjectFilter} onChange={(e) => setReportProjectFilter(e.target.value)}>
              <option value="">All Projects</option>
              {reportProjectOptions.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </FilterSelect>

            <FilterSelect value={reportSourceFilter} onChange={(e) => setReportSourceFilter(e.target.value)}>
              <option value="">All Sources</option>
              {reportSourceOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </FilterSelect>

            <FilterSelect value={reportBoardStageFilter} onChange={(e) => setReportBoardStageFilter(e.target.value)}>
              <option value="">All Board Stages</option>
              {BOARD_STAGES.map((stage) => (
                <option key={stage.stage} value={stage.stage}>{stage.emoji} {stage.label}</option>
              ))}
            </FilterSelect>

            <FilterSelect value={reportStatusFilter} onChange={(e) => setReportStatusFilter(e.target.value)}>
              <option value="">All Statuses</option>
              {ALL_STATUSES.map((status) => (
                <option key={status} value={status}>{LEAD_STATUS_DISPLAY[status as keyof typeof LEAD_STATUS_DISPLAY].label}</option>
              ))}
            </FilterSelect>

            <FilterSelect value={reportTypeFilter} onChange={(e) => setReportTypeFilter(e.target.value)}>
              <option value="">All Types</option>
              <option value="LEAD">Leads</option>
              <option value="DATA">Data</option>
            </FilterSelect>

            <FilterSelect
              value={reportDateRangeFilter}
              onChange={(e) => setReportDateRangeFilter(e.target.value as DateRangeOption)}
            >
              <option value="ALL">Any Time</option>
              <option value="THIS_WEEK">This Week</option>
              <option value="THIS_MONTH">This Month</option>
              <option value="CUSTOM">Custom</option>
            </FilterSelect>

            {reportDateRangeFilter === "CUSTOM" && (
              <div className="col-span-2 flex gap-2">
                <input
                  type="date"
                  value={reportCustomStart}
                  onChange={(e) => setReportCustomStart(e.target.value)}
                  className="flex-1 h-10 rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs text-slate-600 outline-none"
                />
                <input
                  type="date"
                  value={reportCustomEnd}
                  onChange={(e) => setReportCustomEnd(e.target.value)}
                  className="flex-1 h-10 rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs text-slate-600 outline-none"
                />
              </div>
            )}
          </div>

          {/* flex-col on mobile: the label + 3 buttons (View Report/
              Excel/PDF) sharing one justify-between row had no wrap at
              all — on a phone-width screen that's a label plus ~280px
              of buttons fighting for ~300px, guaranteed overflow.
              Stacking them (row layout only from sm: up) plus
              flex-wrap on the button group as a safety net fixes it. */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pt-3 border-t border-slate-100">
            <p className="text-xs text-slate-500">
              {loadingReport ? "Loading..." : `${visibleReportLeads.length} lead${visibleReportLeads.length === 1 ? "" : "s"} match these filters`}
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setShowPreviewTable((v) => !v)}
                disabled={visibleReportLeads.length === 0}
                className={`flex items-center gap-1.5 h-10 px-3 rounded-lg text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed transition ${
                  showPreviewTable ? "bg-amber-500 text-white" : "bg-amber-50 text-amber-700 hover:bg-amber-100"
                }`}
              >
                <Table2 size={14} />
                {showPreviewTable ? "Hide Table" : "View Report"}
              </button>

              <button
                onClick={() => handleReportExport("excel")}
                disabled={visibleReportLeads.length === 0 || exportingReport}
                className="flex items-center gap-1.5 h-10 px-3 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-emerald-100 transition"
              >
                <FileSpreadsheet size={14} />
                Excel
              </button>

              <button
                onClick={() => handleReportExport("pdf")}
                disabled={visibleReportLeads.length === 0 || exportingReport}
                className="flex items-center gap-1.5 h-10 px-3 rounded-lg bg-red-50 text-red-700 text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-red-100 transition"
              >
                <FileText size={14} />
                PDF
              </button>
            </div>
          </div>

          {!loadingReport && showPreviewTable && (
            <div className="pt-3 border-t border-slate-100">
              <ExportPreviewTable leads={visibleReportLeads} />
            </div>
          )}
        </div>
      </div>

      {selectedMember && (
        <TeamMemberDetailModal
          member={selectedMember}
          teamLeaderId={employee.id}
          teamId={team.id}
          teamMembers={members}
          attendanceStatus={getAttendanceStatus(selectedMember.id)}
          onClose={() => setSelectedMemberId(null)}
          onReassigned={() => {
            loadTeamData();
            loadReportLeads();
          }}
        />
      )}

      <Footer />
    </main>
  );
}
