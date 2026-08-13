"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { Search, ChevronDown, CheckCircle2, XCircle, Clock, FileSpreadsheet, FileText, Table2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import AdminLeadCard from "@/components/AdminLeadCard";
import ExportPreviewTable from "@/components/ExportPreviewTable";
import ManualLeadEntryModal from "@/components/ManualLeadEntryModal";
import WeeklyLeaderboardView from "@/components/WeeklyLeaderboardView";
import TicketsView from "@/components/TicketsView";
import { LEAD_STATUS_DISPLAY } from "@/lib/leadStatusDisplay";
import { BOARD_STAGES } from "@/lib/leadBoardStageDisplay";
import { exportLeadsToExcel, exportLeadsToPDF } from "@/lib/exportLeadsReport";
import { exportEmployeeSummaryToExcel, exportEmployeeSummaryToPDF, SummaryExportRow, NoContactDetailExportRow } from "@/lib/exportEmployeeSummaryReport";
import { exportVisitsToExcel, exportVisitsToPDF, VisitExportRow } from "@/lib/exportVisitReport";
import { exportSnoozesToExcel, exportSnoozesToPDF, SnoozeExportRow } from "@/lib/exportSnoozeReport";
import { DateRangeOption, isWithinDateRange, dateRangeFilterLabel } from "@/lib/dateRangeFilter";

type ActiveTab = "LEADS" | "SUMMARY" | "VERIFY" | "SNOOZE" | "LEADERBOARD" | "TICKETS";
type SortOption = "NEWEST" | "OLDEST" | "SLA_URGENCY";
type VisitStatusFilter = "PENDING" | "VERIFIED" | "DENIED" | "ALL";
type SnoozeStatusFilter = "ACTIVE" | "EXPIRED" | "CANCELLED" | "ALL";
type SummaryGroupBy = "EMPLOYEE" | "TEAM";

const ALL_STATUSES = Object.keys(LEAD_STATUS_DISPLAY);

interface SiteVisitRow {
  id: string;
  event_type: string;
  created_at: string;
  verified_at: string | null;
  denied_at: string | null;
  deny_reason: string | null;
  employee_id: string;
  employees: { name: string } | null;
  verifier: { name: string } | null;
  denier: { name: string } | null;
  leads: { name: string; project: string | null } | null;
}

interface SnoozeLogRow {
  id: string;
  snoozed_at: string;
  duration_months: number;
  snoozed_until: string;
  reason: string;
  cancelled_at: string | null;
  employee_id: string;
  employees: { name: string } | null;
  leads: { name: string } | null;
}

// Same appearance-none + overlaid chevron treatment as
// app/admin/leads/page.tsx — every filter bar on this page (Leads,
// Verify, Snooze) reuses this one component rather than each tab
// rolling its own.
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
        className="appearance-none w-full h-10 rounded-lg bg-slate-50 border border-slate-200 pl-3 pr-8 text-xs font-semibold text-slate-600 outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300 transition"
      >
        {children}
      </select>
      <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
    </div>
  );
}

function formatDurationMs(ms: number | null): string {
  if (ms === null) return "—";
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function daysAgoLabel(iso: string | null) {
  if (!iso) return "—";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  return `${days}d ago`;
}

function shortDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

// Derived entirely from existing state — no new tracking needed. A
// lead can genuinely show BOTH facts (status changed AND the board
// was moved), so this lists whichever apply rather than picking one;
// showing "NEW" alone when a board-move (not a status change) was
// what actually happened was the exact confusion this replaces.
function describeNoContactAction(status: string, boardStage: string | null): string {
  const parts: string[] = [];
  if (status !== "NEW") parts.push(`Status changed to ${status}`);
  if (boardStage === "FOLLOW_UP") parts.push("Moved to Follow-up");
  else if (boardStage === "VISIT") parts.push("Moved to Visit");
  return parts.length > 0 ? parts.join(" · ") : "—";
}

function EmptyState({ emoji, text }: { emoji: string; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center mt-16 text-center px-4">
      <div className="text-5xl mb-3">{emoji}</div>
      <p className="text-sm text-slate-500">{text}</p>
    </div>
  );
}

// Sales Coordinator's dashboard — "Aankhen aur Reports," never
// "Haath": full lead visibility (Leads tab), per-employee/per-team
// metrics (Summary tab), Visit-Verification (Verify or Deny, with
// mandatory reason on Deny) and Snooze-Activity monitoring — no
// assignment, no team/rule management, no CSV import anywhere on this
// page. Every tab is filterable (including a Team filter alongside
// Employee, for "how's Team Yogesh doing" questions) and exportable
// (Excel/PDF, via the shared lib/exportTable.ts engine). Admin can
// also reach this page — one dashboard, not a second copy in /admin.
export default function CoordinatorDashboard() {

  const [activeTab, setActiveTab] = useState<ActiveTab>("LEADS");
  const [loading, setLoading] = useState(true);

  // The logged-in viewer's own role — this page is shared by Admin
  // and Sales Coordinator (coordinator/layout.tsx's guard already
  // enforces only these two can even reach it), but Force-Reassign
  // is an Admin-only power within it, so the page needs to know
  // which one it's rendering for.
  const [viewerRole, setViewerRole] = useState<"admin" | "sales_coordinator" | null>(null);
  // Needed by the new Tickets tab (TicketsView) to bucket "My
  // Tickets" vs "To Resolve" correctly for whoever's viewing this
  // page — not needed anywhere else this page already does.
  const [viewerEmployeeId, setViewerEmployeeId] = useState<string | null>(null);

  const [leads, setLeads] = useState<any[]>([]);
  const [employees, setEmployees] = useState<{ id: string; name: string; is_active: boolean; team_id: string | null }[]>([]);
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [siteVisits, setSiteVisits] = useState<SiteVisitRow[]>([]);
  const [snoozeLog, setSnoozeLog] = useState<SnoozeLogRow[]>([]);

  // --- No-Contact-Click remarks + Admin Force-Reassign (Summary
  // drill-down) ---
  const [remarksByLeadHistoryId, setRemarksByLeadHistoryId] = useState<
    Map<string, { id: string; remark: string; created_at: string; loggerName: string }[]>
  >(new Map());
  const [remarkDraft, setRemarkDraft] = useState<Record<string, string>>({});
  const [remarkSubmittingId, setRemarkSubmittingId] = useState<string | null>(null);

  const [reassignOpenLeadId, setReassignOpenLeadId] = useState<string | null>(null);
  const [reassignTargetEmployeeId, setReassignTargetEmployeeId] = useState("");
  const [reassignReason, setReassignReason] = useState("");
  const [reassignSubmitting, setReassignSubmitting] = useState(false);

  const [verifying, setVerifying] = useState<string | null>(null);
  const [denyingVisitId, setDenyingVisitId] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState("");
  const [denySubmitting, setDenySubmitting] = useState(false);

  const [exporting, setExporting] = useState(false);
  const [manualEntryOpen, setManualEntryOpen] = useState(false);

  // --- Leads tab filters ---
  const [showPreviewTable, setShowPreviewTable] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [boardStageFilter, setBoardStageFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [dateRangeFilter, setDateRangeFilter] = useState<DateRangeOption>("ALL");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("NEWEST");

  // --- Visit Verification tab filters ---
  const [visitEmployeeFilter, setVisitEmployeeFilter] = useState("");
  const [visitTeamFilter, setVisitTeamFilter] = useState("");
  const [visitStatusFilter, setVisitStatusFilter] = useState<VisitStatusFilter>("PENDING");
  const [visitDateRangeFilter, setVisitDateRangeFilter] = useState<DateRangeOption>("ALL");
  const [visitCustomStart, setVisitCustomStart] = useState("");
  const [visitCustomEnd, setVisitCustomEnd] = useState("");

  // --- Snooze Activity tab filters ---
  const [snoozeEmployeeFilter, setSnoozeEmployeeFilter] = useState("");
  const [snoozeTeamFilter, setSnoozeTeamFilter] = useState("");
  const [snoozeStatusFilter, setSnoozeStatusFilter] = useState<SnoozeStatusFilter>("ALL");
  const [snoozeDateRangeFilter, setSnoozeDateRangeFilter] = useState<DateRangeOption>("ALL");
  const [snoozeCustomStart, setSnoozeCustomStart] = useState("");
  const [snoozeCustomEnd, setSnoozeCustomEnd] = useState("");

  // --- Employee Summary tab ---
  const [summaryGroupBy, setSummaryGroupBy] = useState<SummaryGroupBy>("EMPLOYEE");
  const [summaryTeamFilter, setSummaryTeamFilter] = useState("");
  const [expandedSummaryRowId, setExpandedSummaryRowId] = useState<string | null>(null);
  const [expandedLeadDetailId, setExpandedLeadDetailId] = useState<string | null>(null);
  const [summaryDateRangeFilter, setSummaryDateRangeFilter] = useState<DateRangeOption>("ALL");
  const [summaryCustomStart, setSummaryCustomStart] = useState("");
  const [summaryCustomEnd, setSummaryCustomEnd] = useState("");

  useEffect(() => {
    loadAll();
  }, []);

  // Realtime — same proven pattern as LeadList.tsx's, but
  // deliberately UNFILTERED (no employee_id/current_owner_id clause):
  // Coordinator/Admin need to see everyone's activity, not just their
  // own. Four tables watched, each refetching only what actually
  // reads from it — a site_visits change (Verify/Deny) also touches
  // leads.board_stage and lead_history's pause fields, so it refetches
  // both. Requires site_visits/lead_snooze_log/leads/lead_history all
  // present in the supabase_realtime publication — postgres_changes
  // is silent (not an error) if a table's missing from it.
  useEffect(() => {
    const existing = supabase.getChannels().find((ch) => ch.topic === "realtime:coordinator-dashboard");
    if (existing) {
      supabase.removeChannel(existing);
    }

    let cancelled = false;

    const channel = supabase
      .channel("coordinator-dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => {
        if (!cancelled) loadLeads();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "lead_history" }, () => {
        if (!cancelled) loadLeads();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "site_visits" }, () => {
        if (!cancelled) {
          loadSiteVisits();
          loadLeads();
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "lead_snooze_log" }, () => {
        if (!cancelled) loadSnoozeLog();
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  async function loadAll() {
    setLoading(true);
    await Promise.all([loadViewerRole(), loadLeads(), loadEmployees(), loadTeams(), loadSiteVisits(), loadSnoozeLog(), loadRemarks()]);
    setLoading(false);
  }

  async function loadViewerRole() {
    const {
      data: { session }
    } = await supabase.auth.getSession();
    if (!session) return;

    const { data, error } = await supabase
      .from("employees")
      .select("id, role")
      .eq("auth_user_id", session.user.id)
      .single();

    if (error) {
      console.error("coordinator: loadViewerRole failed:", error.message);
      return;
    }
    if (data) {
      setViewerRole(data.role);
      setViewerEmployeeId(data.id);
    }
  }

  // Broad fetch, same "everything up front" pattern as the rest of
  // this page — grouped client-side into a Map keyed by
  // lead_history_id so the drill-down can look a specific lead's
  // remarks up in O(1) without a per-row query.
  async function loadRemarks() {
    const { data, error } = await supabase
      .from("no_contact_click_remarks")
      .select("id, lead_history_id, remark, created_at, logger:employees!no_contact_click_remarks_logged_by_fkey(name)")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("coordinator: loadRemarks failed:", error.message);
      return;
    }

    const map = new Map<string, { id: string; remark: string; created_at: string; loggerName: string }[]>();
    (data || []).forEach((row: any) => {
      const list = map.get(row.lead_history_id) || [];
      list.push({ id: row.id, remark: row.remark, created_at: row.created_at, loggerName: row.logger?.name || "—" });
      map.set(row.lead_history_id, list);
    });
    setRemarksByLeadHistoryId(map);
  }

  async function loadLeads() {
    const { data, error } = await supabase
      .from("leads")
      .select(
        `
        id, name, mobile, project, source, catcher_name, status, priority, board_stage, board_stage_changed_at,
        sla_deadline, recycle_count, created_at, current_owner_id, lead_type,
        employees ( name ),
        lead_history (
          id, assigned_at, is_active, first_call_at, first_whatsapp_at, assigned_by_type, call_count,
          last_activity_at, paused_until, pause_reason, outcome_at,
          assigned_by:employees!lead_history_assigned_by_employee_id_fkey(name)
        )
        `
      )
      .eq("lead_history.is_active", true)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("coordinator: loadLeads failed:", error.message);
      return;
    }
    if (data) setLeads(data);
  }

  async function loadEmployees() {
    const { data, error } = await supabase
      .from("employees")
      .select("id, name, is_active, team_id")
      .order("name");

    if (error) {
      console.error("coordinator: loadEmployees failed:", error.message);
      return;
    }
    if (data) setEmployees(data);
  }

  async function loadTeams() {
    const { data, error } = await supabase.from("teams").select("id, name").order("name");

    if (error) {
      console.error("coordinator: loadTeams failed:", error.message);
      return;
    }
    if (data) setTeams(data);
  }

  // Fetched once, unfiltered (pending + verified + denied) — the
  // Verify tab's default "Pending" view is just this list filtered
  // client-side, and the Summary tab's visit counts read from the
  // same array. One fetch, one source.
  async function loadSiteVisits() {
    const { data, error } = await supabase
      .from("site_visits")
      .select(
        `
        id, event_type, created_at, verified_at, denied_at, deny_reason, employee_id,
        employees!site_visits_employee_id_fkey ( name ),
        verifier:employees!site_visits_verified_by_fkey ( name ),
        denier:employees!site_visits_denied_by_fkey ( name ),
        leads ( name, project )
        `
      )
      .order("created_at", { ascending: false });

    if (error) {
      console.error("coordinator: loadSiteVisits failed:", error.message);
      return;
    }
    if (data) setSiteVisits(data as any);
  }

  async function loadSnoozeLog() {
    const { data, error } = await supabase
      .from("lead_snooze_log")
      .select(
        `
        id, snoozed_at, duration_months, snoozed_until, reason, cancelled_at, employee_id,
        employees!lead_snooze_log_employee_id_fkey ( name ),
        leads ( name )
        `
      )
      .order("snoozed_at", { ascending: false })
      .limit(500);

    if (error) {
      console.error("coordinator: loadSnoozeLog failed:", error.message);
      return;
    }
    if (data) setSnoozeLog(data as any);
  }

  async function verifyVisit(siteVisitId: string) {
    setVerifying(siteVisitId);

    const { error } = await supabase.rpc("verify_site_visit_atomic", { p_site_visit_id: siteVisitId });

    if (error) {
      toast.error(error.message || "Could not verify this visit.");
      setVerifying(null);
      return;
    }

    toast.success("Visit verified — Client-Lock applied for 1 month.");
    setVerifying(null);
    loadSiteVisits();
    loadLeads();
  }

  async function submitDeny(siteVisitId: string) {
    if (!denyReason.trim()) {
      toast.error("A reason is required to deny a visit.");
      return;
    }

    setDenySubmitting(true);

    const { error } = await supabase.rpc("deny_site_visit_atomic", {
      p_site_visit_id: siteVisitId,
      p_reason: denyReason.trim()
    });

    if (error) {
      toast.error(error.message || "Could not deny this visit.");
      setDenySubmitting(false);
      return;
    }

    toast.success("Visit denied — lead moved back to Follow-up.");
    setDenyingVisitId(null);
    setDenyReason("");
    setDenySubmitting(false);
    loadSiteVisits();
    loadLeads();
  }

  const employeeTeamMap = useMemo(() => {
    const map = new Map<string, string | null>();
    employees.forEach((e) => map.set(e.id, e.team_id));
    return map;
  }, [employees]);

  const teamNameMap = useMemo(() => {
    const map = new Map<string, string>();
    teams.forEach((t) => map.set(t.id, t.name));
    return map;
  }, [teams]);

  const employeeOptions = useMemo(
    () => employees.map((e) => ({ id: e.id, name: e.name })),
    [employees]
  );

  const projectOptions = useMemo(
    () => Array.from(new Set(leads.map((l) => l.project).filter(Boolean))) as string[],
    [leads]
  );

  const sourceOptions = useMemo(
    () => Array.from(new Set(leads.map((l) => l.source).filter(Boolean))) as string[],
    [leads]
  );

  // ============================================================
  // LEADS TAB
  // ============================================================

  const visibleLeads = useMemo(() => {

    let result = leads;

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (lead) =>
          lead.name?.toLowerCase().includes(q) ||
          lead.mobile?.toLowerCase().includes(q) ||
          lead.project?.toLowerCase().includes(q)
      );
    }

    if (employeeFilter) {
      result = result.filter((lead) => lead.current_owner_id === employeeFilter);
    }

    if (teamFilter) {
      result = result.filter((lead) => employeeTeamMap.get(lead.current_owner_id) === teamFilter);
    }

    if (projectFilter) {
      result = result.filter((lead) => lead.project === projectFilter);
    }

    if (sourceFilter) {
      result = result.filter((lead) => lead.source === sourceFilter);
    }

    if (boardStageFilter) {
      result = result.filter((lead) => (lead.board_stage || "LEADS") === boardStageFilter);
    }

    if (statusFilter) {
      result = result.filter((lead) => lead.status === statusFilter);
    }

    if (typeFilter) {
      result = result.filter((lead) => (lead.lead_type || "LEAD") === typeFilter);
    }

    if (dateRangeFilter !== "ALL") {
      result = result.filter((lead) =>
        isWithinDateRange(lead.lead_history?.[0]?.assigned_at, dateRangeFilter, customStart, customEnd)
      );
    }

    result = [...result].sort((a, b) => {

      if (sortBy === "SLA_URGENCY") {
        const aDeadline = a.sla_deadline ? new Date(a.sla_deadline).getTime() : Infinity;
        const bDeadline = b.sla_deadline ? new Date(b.sla_deadline).getTime() : Infinity;
        return aDeadline - bDeadline;
      }

      const aAssigned = new Date(a.lead_history?.[0]?.assigned_at || a.created_at).getTime();
      const bAssigned = new Date(b.lead_history?.[0]?.assigned_at || b.created_at).getTime();

      return sortBy === "OLDEST" ? aAssigned - bAssigned : bAssigned - aAssigned;
    });

    return result;

  }, [
    leads,
    searchQuery,
    employeeFilter,
    teamFilter,
    employeeTeamMap,
    projectFilter,
    sourceFilter,
    boardStageFilter,
    statusFilter,
    typeFilter,
    dateRangeFilter,
    customStart,
    customEnd,
    sortBy
  ]);

  const leadsReportMeta = useMemo(() => {
    const employeeLabel = employeeFilter
      ? employeeOptions.find((e) => e.id === employeeFilter)?.name ?? null
      : null;

    const otherFilters: { label: string; value: string }[] = [];

    if (teamFilter) otherFilters.push({ label: "Team", value: teamNameMap.get(teamFilter) || teamFilter });
    if (projectFilter) otherFilters.push({ label: "Project", value: projectFilter });
    if (sourceFilter) otherFilters.push({ label: "Source", value: sourceFilter });

    if (boardStageFilter) {
      otherFilters.push({
        label: "Board Stage",
        value: BOARD_STAGES.find((b) => b.stage === boardStageFilter)?.label || boardStageFilter
      });
    }

    if (statusFilter) {
      otherFilters.push({
        label: "Status",
        value: LEAD_STATUS_DISPLAY[statusFilter as keyof typeof LEAD_STATUS_DISPLAY]?.label || statusFilter
      });
    }

    if (typeFilter) otherFilters.push({ label: "Type", value: typeFilter === "DATA" ? "Data" : "Leads" });

    const dateLabel = dateRangeFilterLabel(dateRangeFilter, customStart, customEnd);
    if (dateLabel) otherFilters.push({ label: "Date", value: dateLabel });

    return { employeeLabel, otherFilters, scopeLabel: "Sales Coordinator" };
  }, [employeeFilter, teamFilter, teamNameMap, projectFilter, sourceFilter, boardStageFilter, statusFilter, typeFilter, dateRangeFilter, customStart, customEnd, employeeOptions]);

  async function handleExportLeads(format: "excel" | "pdf") {
    if (visibleLeads.length === 0 || exporting) return;
    setExporting(true);
    try {
      if (format === "excel") await exportLeadsToExcel(visibleLeads, leadsReportMeta);
      else await exportLeadsToPDF(visibleLeads, leadsReportMeta);
    } catch (err) {
      console.error(err);
      toast.error("Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  // ============================================================
  // EMPLOYEE SUMMARY TAB
  // ============================================================

  // Scopes both leads and site-visit events to the same period before
  // any of the Summary tab's counting happens — a date-range filter
  // that only touched one of the two would leave the tab's own
  // numbers internally inconsistent (e.g. "Total Leads" from one
  // period, "Visits Verified" from all-time).
  const summaryScopedLeads = useMemo(
    () => leads.filter((lead: any) => isWithinDateRange(lead.created_at, summaryDateRangeFilter, summaryCustomStart, summaryCustomEnd)),
    [leads, summaryDateRangeFilter, summaryCustomStart, summaryCustomEnd]
  );

  const summaryScopedVisits = useMemo(
    () => siteVisits.filter((v) => isWithinDateRange(v.created_at, summaryDateRangeFilter, summaryCustomStart, summaryCustomEnd)),
    [siteVisits, summaryDateRangeFilter, summaryCustomStart, summaryCustomEnd]
  );

  const employeeSummary = useMemo(() => {

    const map = new Map<
      string,
      {
        id: string;
        name: string;
        teamId: string | null;
        isActive: boolean;
        totalLeads: number;
        followUp: number;
        inVisitStage: number;
        bookings: number;
        visits: number;
        verifiedVisits: number;
        noContactClickUpdates: number;
        noContactClickLeads: { id: string; leadHistoryId: string | null; name: string; mobile: string; status: string; action: string; evidenceAt: string | null; employeeName: string; employeeId: string }[];
        responseTimes: number[];
      }
    >();

    employees.forEach((e) =>
      map.set(e.id, {
        id: e.id,
        name: e.name,
        teamId: e.team_id,
        isActive: e.is_active,
        totalLeads: 0,
        followUp: 0,
        inVisitStage: 0,
        bookings: 0,
        visits: 0,
        verifiedVisits: 0,
        noContactClickUpdates: 0,
        noContactClickLeads: [],
        responseTimes: []
      })
    );

    summaryScopedLeads.forEach((lead: any) => {
      if (!lead.current_owner_id) return;
      const entry = map.get(lead.current_owner_id);
      if (!entry) return;

      entry.totalLeads++;

      const stage = lead.board_stage || "LEADS";
      // Kept as two distinct counters — Follow-up and Visit are
      // different stages of the funnel, and merging them into one
      // number made it impossible to tell "lots of follow-ups, no
      // visits yet" apart from the reverse.
      if (stage === "FOLLOW_UP") entry.followUp++;
      if (stage === "VISIT") entry.inVisitStage++;
      if (stage === "BOOKING") entry.bookings++;

      const history = lead.lead_history?.[0];
      if (history?.assigned_at && history?.first_call_at) {
        entry.responseTimes.push(
          new Date(history.first_call_at).getTime() - new Date(history.assigned_at).getTime()
        );
      }

      // Reporting-transparency, not a block — this lead shows genuine
      // engagement evidence (status moved past NEW, or the board was
      // moved past LEADS — either way, some real progress was made)
      // but neither the Call nor WhatsApp link was ever clicked for
      // this assignment. Whole-lifecycle by design: covers a plain
      // status/note log (log_lead_update_atomic) AND a board move
      // (move_lead_to_followup_atomic) the same way, since both are
      // "genuine progress with no tracked contact-click" the same
      // way. Deliberately does NOT special-case VISIT — Visit already
      // has its own, stronger oversight (Sales Coordinator Verify/
      // Deny against the WhatsApp photo), so this signal would be
      // redundant there specifically for the real-time notification
      // (skipped in log_site_visit_atomic on purpose) — but it still
      // stays IN this aggregate metric/drill-down, since it's still a
      // genuinely useful thing for a Coordinator to see at a glance.
      // Not proof of anything on its own (a click doesn't prove a
      // real call either — see calculateSLAStatus.ts's own reasoning
      // for the same point), but a repeating pattern is worth a look.
      // Scoped to the CURRENTLY-active assignment only, same as every
      // other metric on this tab.
      const hasEngagementEvidence = lead.status !== "NEW" || stage !== "LEADS";

      if (hasEngagementEvidence && !history?.first_call_at && !history?.first_whatsapp_at) {
        entry.noContactClickUpdates++;

        // Latest of the two applicable timestamps — whichever
        // happened more recently is the more relevant "when" to show,
        // rather than an arbitrary fallback-chain pick.
        const candidates = [history?.outcome_at, lead.board_stage_changed_at, history?.last_activity_at]
          .filter(Boolean)
          .map((d: string) => new Date(d).getTime());
        const evidenceAt = candidates.length > 0 ? new Date(Math.max(...candidates)).toISOString() : null;

        entry.noContactClickLeads.push({
          id: lead.id,
          leadHistoryId: history?.id ?? null,
          name: lead.name,
          mobile: lead.mobile,
          status: lead.status,
          action: describeNoContactAction(lead.status, lead.board_stage || "LEADS"),
          evidenceAt,
          // Carried explicitly (not inferred from the containing
          // row) so it survives the Team rollup below — a team-mode
          // summary row's own `name` is the TEAM's name, but each
          // lead in this array still belongs to one specific person.
          employeeName: entry.name,
          employeeId: entry.id
        });
      }
    });

    summaryScopedVisits.forEach((v) => {
      const entry = map.get(v.employee_id);
      if (!entry) return;
      entry.visits++;
      if (v.verified_at) entry.verifiedVisits++;
    });

    return Array.from(map.values()).map((e) => ({
      ...e,
      avgResponseMs:
        e.responseTimes.length > 0
          ? e.responseTimes.reduce((a, b) => a + b, 0) / e.responseTimes.length
          : null
    }));

  }, [summaryScopedLeads, employees, summaryScopedVisits]);

  const teamSummary = useMemo(() => {

    const map = new Map<
      string,
      {
        id: string;
        name: string;
        totalLeads: number;
        followUp: number;
        inVisitStage: number;
        bookings: number;
        visits: number;
        verifiedVisits: number;
        noContactClickUpdates: number;
        noContactClickLeads: { id: string; leadHistoryId: string | null; name: string; mobile: string; status: string; action: string; evidenceAt: string | null; employeeName: string; employeeId: string }[];
        responseTimes: number[];
      }
    >();

    teams.forEach((t) =>
      map.set(t.id, { id: t.id, name: t.name, totalLeads: 0, followUp: 0, inVisitStage: 0, bookings: 0, visits: 0, verifiedVisits: 0, noContactClickUpdates: 0, noContactClickLeads: [], responseTimes: [] })
    );

    employeeSummary.forEach((emp) => {
      if (!emp.teamId) return;
      const entry = map.get(emp.teamId);
      if (!entry) return;
      entry.totalLeads += emp.totalLeads;
      entry.followUp += emp.followUp;
      entry.inVisitStage += emp.inVisitStage;
      entry.bookings += emp.bookings;
      entry.visits += emp.visits;
      entry.verifiedVisits += emp.verifiedVisits;
      entry.noContactClickUpdates += emp.noContactClickUpdates;
      entry.noContactClickLeads.push(...emp.noContactClickLeads);
      entry.responseTimes.push(...emp.responseTimes);
    });

    return Array.from(map.values()).map((t) => ({
      ...t,
      avgResponseMs: t.responseTimes.length > 0 ? t.responseTimes.reduce((a, b) => a + b, 0) / t.responseTimes.length : null
    }));

  }, [employeeSummary, teams]);

  const visibleSummaryRows = useMemo(() => {
    if (summaryGroupBy === "TEAM") {
      return [...teamSummary].sort((a, b) => b.totalLeads - a.totalLeads);
    }
    let rows = employeeSummary;
    if (summaryTeamFilter) rows = rows.filter((e) => e.teamId === summaryTeamFilter);
    return [...rows].sort((a, b) => b.totalLeads - a.totalLeads);
  }, [summaryGroupBy, summaryTeamFilter, employeeSummary, teamSummary]);

  async function handleExportSummary(format: "excel" | "pdf") {
    if (visibleSummaryRows.length === 0 || exporting) return;
    setExporting(true);
    try {
      const rows: SummaryExportRow[] = visibleSummaryRows.map((r: any) => ({
        name: r.name,
        team: summaryGroupBy === "TEAM" ? r.name : (r.teamId ? teamNameMap.get(r.teamId) || "—" : "—"),
        totalLeads: r.totalLeads,
        followUp: r.followUp,
        inVisitStage: r.inVisitStage,
        bookings: r.bookings,
        visits: r.visits,
        verifiedVisits: r.verifiedVisits,
        avgResponseMs: r.avgResponseMs,
        noContactClickUpdates: r.noContactClickUpdates
      }));
      // Flattened across whatever's currently visible (By Employee/By
      // Team, Team-filter) — same scope as the Summary rows above, so
      // the Detail sheet never shows more (or less) than what the
      // Summary sheet's counts actually represent.
      const detailRows: NoContactDetailExportRow[] = visibleSummaryRows.flatMap((r: any) =>
        r.noContactClickLeads.map((l: any) => ({
          employeeName: l.employeeName,
          leadName: l.name,
          mobile: l.mobile,
          action: l.action,
          evidenceAt: l.evidenceAt
        }))
      );
      const summaryOtherFilters: { label: string; value: string }[] = [];
      if (summaryTeamFilter && summaryGroupBy === "EMPLOYEE") {
        summaryOtherFilters.push({ label: "Team", value: teamNameMap.get(summaryTeamFilter) || summaryTeamFilter });
      }
      const summaryDateLabel = dateRangeFilterLabel(summaryDateRangeFilter, summaryCustomStart, summaryCustomEnd);
      if (summaryDateLabel) summaryOtherFilters.push({ label: "Date", value: summaryDateLabel });

      const meta = {
        employeeLabel: null,
        otherFilters: summaryOtherFilters,
        scopeLabel: "Sales Coordinator"
      };
      if (format === "excel") await exportEmployeeSummaryToExcel(rows, detailRows, meta, summaryGroupBy);
      else await exportEmployeeSummaryToPDF(rows, detailRows, meta, summaryGroupBy);
    } catch (err) {
      console.error(err);
      toast.error("Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  // Coordinator (or Admin) permanently logs what the employee told
  // them offline, against this specific no-contact-click entry — no
  // escalation, no "invalid" flagging, just a visible record.
  async function handleLogRemark(leadHistoryId: string) {
    const text = (remarkDraft[leadHistoryId] || "").trim();
    if (!text || remarkSubmittingId) return;

    setRemarkSubmittingId(leadHistoryId);
    try {
      const { error } = await supabase.rpc("log_no_contact_remark_atomic", {
        p_lead_history_id: leadHistoryId,
        p_remark: text
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      setRemarkDraft((prev) => ({ ...prev, [leadHistoryId]: "" }));
      await loadRemarks();
      toast.success("Remark logged");
    } catch (err) {
      console.error(err);
      toast.error("Failed to log remark. Please try again.");
    } finally {
      setRemarkSubmittingId(null);
    }
  }

  // Admin-only universal reassign — any team, any board_stage. Also
  // permanently bans the old employee from ever getting this lead
  // back through automatic recycling (recycle-stale-leads honors
  // lead_forced_removals; manual Team-Leader/Admin assignment is
  // deliberately unaffected by it).
  async function handleForceReassign(leadId: string) {
    if (!reassignTargetEmployeeId || !reassignReason.trim() || reassignSubmitting) return;

    setReassignSubmitting(true);
    try {
      const { error } = await supabase.rpc("force_reassign_lead_atomic", {
        p_lead_id: leadId,
        p_new_employee_id: reassignTargetEmployeeId,
        p_reason: reassignReason.trim()
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      setReassignOpenLeadId(null);
      setReassignTargetEmployeeId("");
      setReassignReason("");
      await loadLeads();
      toast.success("Lead force-reassigned");
    } catch (err) {
      console.error(err);
      toast.error("Failed to reassign. Please try again.");
    } finally {
      setReassignSubmitting(false);
    }
  }

  // ============================================================
  // VISIT VERIFICATION TAB
  // ============================================================

  function visitStatus(v: SiteVisitRow): "Pending" | "Verified" | "Denied" {
    if (v.verified_at) return "Verified";
    if (v.denied_at) return "Denied";
    return "Pending";
  }

  const visibleVisits = useMemo(() => {
    let result = siteVisits;

    if (visitStatusFilter !== "ALL") {
      const target = visitStatusFilter === "PENDING" ? "Pending" : visitStatusFilter === "VERIFIED" ? "Verified" : "Denied";
      result = result.filter((v) => visitStatus(v) === target);
    }

    if (visitEmployeeFilter) {
      result = result.filter((v) => v.employee_id === visitEmployeeFilter);
    }

    if (visitTeamFilter) {
      result = result.filter((v) => employeeTeamMap.get(v.employee_id) === visitTeamFilter);
    }

    if (visitDateRangeFilter !== "ALL") {
      result = result.filter((v) => isWithinDateRange(v.created_at, visitDateRangeFilter, visitCustomStart, visitCustomEnd));
    }

    return result;
  }, [siteVisits, visitStatusFilter, visitEmployeeFilter, visitTeamFilter, employeeTeamMap, visitDateRangeFilter, visitCustomStart, visitCustomEnd]);

  const pendingVisitsCount = useMemo(() => siteVisits.filter((v) => visitStatus(v) === "Pending").length, [siteVisits]);

  async function handleExportVisits(format: "excel" | "pdf") {
    if (visibleVisits.length === 0 || exporting) return;
    setExporting(true);
    try {
      const rows: VisitExportRow[] = visibleVisits.map((v) => {
        const status = visitStatus(v);
        return {
          leadName: v.leads?.name || "Unknown lead",
          project: v.leads?.project || null,
          employeeName: v.employees?.name || "Unknown",
          teamName: teamNameMap.get(employeeTeamMap.get(v.employee_id) || "") || "—",
          eventType: v.event_type,
          visitDate: v.created_at,
          status,
          actionByName: status === "Verified" ? v.verifier?.name || null : status === "Denied" ? v.denier?.name || null : null,
          actionDate: status === "Verified" ? v.verified_at : status === "Denied" ? v.denied_at : null,
          denyReason: v.deny_reason
        };
      });
      const meta = {
        employeeLabel: visitEmployeeFilter ? employeeOptions.find((e) => e.id === visitEmployeeFilter)?.name ?? null : null,
        otherFilters: [
          ...(visitTeamFilter ? [{ label: "Team", value: teamNameMap.get(visitTeamFilter) || visitTeamFilter }] : []),
          { label: "Status", value: visitStatusFilter },
          ...(dateRangeFilterLabel(visitDateRangeFilter, visitCustomStart, visitCustomEnd)
            ? [{ label: "Date", value: dateRangeFilterLabel(visitDateRangeFilter, visitCustomStart, visitCustomEnd)! }]
            : [])
        ],
        scopeLabel: "Sales Coordinator"
      };
      if (format === "excel") await exportVisitsToExcel(rows, meta);
      else await exportVisitsToPDF(rows, meta);
    } catch (err) {
      console.error(err);
      toast.error("Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  // ============================================================
  // SNOOZE ACTIVITY TAB
  // ============================================================

  function snoozeStatus(row: SnoozeLogRow): "Active" | "Expired" | "Cancelled" {
    if (row.cancelled_at) return "Cancelled";
    return new Date(row.snoozed_until) > new Date() ? "Active" : "Expired";
  }

  const visibleSnoozeLog = useMemo(() => {
    let result = snoozeLog;

    if (snoozeStatusFilter !== "ALL") {
      const target = snoozeStatusFilter === "ACTIVE" ? "Active" : snoozeStatusFilter === "EXPIRED" ? "Expired" : "Cancelled";
      result = result.filter((row) => snoozeStatus(row) === target);
    }

    if (snoozeEmployeeFilter) {
      result = result.filter((row) => row.employee_id === snoozeEmployeeFilter);
    }

    if (snoozeTeamFilter) {
      result = result.filter((row) => employeeTeamMap.get(row.employee_id) === snoozeTeamFilter);
    }

    if (snoozeDateRangeFilter !== "ALL") {
      result = result.filter((row) => isWithinDateRange(row.snoozed_at, snoozeDateRangeFilter, snoozeCustomStart, snoozeCustomEnd));
    }

    return result;
  }, [snoozeLog, snoozeStatusFilter, snoozeEmployeeFilter, snoozeTeamFilter, employeeTeamMap, snoozeDateRangeFilter, snoozeCustomStart, snoozeCustomEnd]);

  async function handleExportSnoozes(format: "excel" | "pdf") {
    if (visibleSnoozeLog.length === 0 || exporting) return;
    setExporting(true);
    try {
      const rows: SnoozeExportRow[] = visibleSnoozeLog.map((row) => ({
        leadName: row.leads?.name || "Unknown lead",
        employeeName: row.employees?.name || "Unknown",
        teamName: teamNameMap.get(employeeTeamMap.get(row.employee_id) || "") || "—",
        snoozedAt: row.snoozed_at,
        durationMonths: row.duration_months,
        snoozedUntil: row.snoozed_until,
        reason: row.reason,
        status: snoozeStatus(row),
        cancelledAt: row.cancelled_at
      }));
      const meta = {
        employeeLabel: snoozeEmployeeFilter ? employeeOptions.find((e) => e.id === snoozeEmployeeFilter)?.name ?? null : null,
        otherFilters: [
          ...(snoozeTeamFilter ? [{ label: "Team", value: teamNameMap.get(snoozeTeamFilter) || snoozeTeamFilter }] : []),
          { label: "Status", value: snoozeStatusFilter },
          ...(dateRangeFilterLabel(snoozeDateRangeFilter, snoozeCustomStart, snoozeCustomEnd)
            ? [{ label: "Date", value: dateRangeFilterLabel(snoozeDateRangeFilter, snoozeCustomStart, snoozeCustomEnd)! }]
            : [])
        ],
        scopeLabel: "Sales Coordinator"
      };
      if (format === "excel") await exportSnoozesToExcel(rows, meta);
      else await exportSnoozesToPDF(rows, meta);
    } catch (err) {
      console.error(err);
      toast.error("Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  // count is optional — LEADERBOARD has no "pending items" number the
  // way the other tabs do (it's a ranked view, not a queue), so its
  // badge is omitted entirely below rather than showing a misleading
  // "0".
  const tabs: { key: ActiveTab; label: string; count?: number }[] = [
    { key: "LEADS", label: "🎯 All Leads", count: leads.length },
    { key: "SUMMARY", label: "📊 Employee Summary", count: employeeSummary.length },
    { key: "VERIFY", label: "✅ Visit Verification", count: pendingVisitsCount },
    { key: "SNOOZE", label: "😴 Snooze Activity", count: snoozeLog.length },
    { key: "LEADERBOARD", label: "🏆 Leaderboard" },
    { key: "TICKETS", label: "🎫 Tickets" }
  ];

  if (loading) {
    return <div className="text-center text-sm text-slate-400 mt-10">Loading...</div>;
  }

  return (
    <div>
      <div className="flex gap-2 overflow-x-auto pb-1 mb-5">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 shrink-0 px-4 py-2.5 rounded-xl text-sm font-bold transition ${
              activeTab === tab.key
                ? "bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-[0_4px_12px_rgba(37,99,235,0.3)]"
                : "bg-white text-slate-600 border border-slate-200"
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${
                  activeTab === tab.key ? "bg-white/20" : "bg-slate-100 text-slate-500"
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeTab === "LEADS" && (
        <div className="space-y-4">
          <div className="bg-white rounded-[24px] border border-slate-100 shadow-md p-6 space-y-4">
            <div className="relative">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search name, mobile, or project..."
                className="w-full h-12 rounded-xl bg-slate-50 border border-slate-200 pl-10 pr-3 text-sm outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300 transition"
              />
            </div>

            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <FilterSelect value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)}>
                <option value="">All Employees</option>
                {employeeOptions.map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.name}</option>
                ))}
              </FilterSelect>

              <FilterSelect value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
                <option value="">All Teams</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </FilterSelect>

              <FilterSelect value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
                <option value="">All Projects</option>
                {projectOptions.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </FilterSelect>

              <FilterSelect value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
                <option value="">All Sources</option>
                {sourceOptions.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </FilterSelect>

              <FilterSelect value={boardStageFilter} onChange={(e) => setBoardStageFilter(e.target.value)}>
                <option value="">All Board Stages</option>
                {BOARD_STAGES.map((stage) => (
                  <option key={stage.stage} value={stage.stage}>{stage.emoji} {stage.label}</option>
                ))}
              </FilterSelect>

              <FilterSelect value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All Statuses</option>
                {ALL_STATUSES.map((status) => (
                  <option key={status} value={status}>{LEAD_STATUS_DISPLAY[status as keyof typeof LEAD_STATUS_DISPLAY].label}</option>
                ))}
              </FilterSelect>

              <FilterSelect value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="">All Types</option>
                <option value="LEAD">Leads</option>
                <option value="DATA">Data</option>
              </FilterSelect>

              <FilterSelect value={dateRangeFilter} onChange={(e) => setDateRangeFilter(e.target.value as DateRangeOption)}>
                <option value="ALL">Any Time</option>
                <option value="THIS_WEEK">This Week</option>
                <option value="THIS_MONTH">This Month</option>
                <option value="CUSTOM">Custom</option>
              </FilterSelect>

              <FilterSelect value={sortBy} onChange={(e) => setSortBy(e.target.value as SortOption)}>
                <option value="NEWEST">Newest First</option>
                <option value="OLDEST">Oldest First</option>
                <option value="SLA_URGENCY">SLA Urgency</option>
              </FilterSelect>

              <div className="col-span-2 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setManualEntryOpen(true)}
                  className="flex items-center gap-1.5 h-10 px-3 rounded-lg bg-amber-50 text-amber-700 text-xs font-bold hover:bg-amber-100 transition"
                >
                  🎣 Add Manual Lead
                </button>

                <button
                  onClick={() => setShowPreviewTable((v) => !v)}
                  disabled={visibleLeads.length === 0}
                  className={`flex items-center gap-1.5 h-10 px-3 rounded-lg text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed transition ${
                    showPreviewTable ? "bg-blue-600 text-white" : "bg-blue-50 text-blue-700 hover:bg-blue-100"
                  }`}
                >
                  <Table2 size={14} />
                  {showPreviewTable ? "Hide Table" : "View Report"}
                </button>

                <button
                  onClick={() => handleExportLeads("excel")}
                  disabled={visibleLeads.length === 0 || exporting}
                  className="flex items-center gap-1.5 h-10 px-3 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-emerald-100 transition"
                >
                  <FileSpreadsheet size={14} />
                  Excel
                </button>

                <button
                  onClick={() => handleExportLeads("pdf")}
                  disabled={visibleLeads.length === 0 || exporting}
                  className="flex items-center gap-1.5 h-10 px-3 rounded-lg bg-red-50 text-red-700 text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-red-100 transition"
                >
                  <FileText size={14} />
                  PDF
                </button>
              </div>

              {dateRangeFilter === "CUSTOM" && (
                <div className="col-span-2 flex gap-2">
                  <input
                    type="date"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                    className="flex-1 h-11 sm:h-10 rounded-lg bg-slate-50 border border-slate-200 px-3 text-xs text-slate-600 outline-none appearance-none"
                  />
                  <input
                    type="date"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="flex-1 h-11 sm:h-10 rounded-lg bg-slate-50 border border-slate-200 px-3 text-xs text-slate-600 outline-none appearance-none"
                  />
                </div>
              )}
            </div>
          </div>

          {showPreviewTable && (
            <div className="bg-white rounded-[24px] border border-slate-100 shadow-md p-6">
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-bold mb-3">
                Report Table — {visibleLeads.length} lead{visibleLeads.length === 1 ? "" : "s"}
              </p>
              <ExportPreviewTable leads={visibleLeads} />
            </div>
          )}

          {visibleLeads.length === 0 ? (
            <EmptyState emoji="🎯" text="No leads match these filters." />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {visibleLeads.map((lead: any, index: number) => (
                <AdminLeadCard
                  key={lead.id}
                  index={index}
                  teams={[]}
                  onReserveTeam={() => {}}
                  readOnly
                  lead={{
                    id: lead.id,
                    name: lead.name,
                    mobile: lead.mobile,
                    project: lead.project,
                    source: lead.source,
                    catcherName: lead.catcher_name ?? null,
                    status: lead.status,
                    priority: lead.priority,
                    boardStage: lead.board_stage || "LEADS",
                    recycleCount: lead.recycle_count,
                    ownerName: lead.employees?.name ?? null,
                    assignedAt: lead.lead_history?.[0]?.assigned_at ?? null,
                    pendingTeamId: null,
                    pendingTeamName: null,
                    leadType: lead.lead_type || "LEAD",
                    callCount: lead.lead_history?.[0]?.call_count ?? 0,
                    pausedUntil: lead.lead_history?.[0]?.paused_until ?? null,
                    pauseReason: lead.lead_history?.[0]?.pause_reason ?? null,
                    lastActivityAt: lead.lead_history?.[0]?.last_activity_at ?? null
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "SUMMARY" && (
        <div className="space-y-4">
          <div className="bg-white rounded-[24px] border border-slate-100 shadow-md p-4 flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-slate-200 overflow-hidden">
              <button
                onClick={() => {
                  setSummaryGroupBy("EMPLOYEE");
                  setExpandedSummaryRowId(null);
                }}
                className={`px-3 h-9 text-xs font-bold transition ${
                  summaryGroupBy === "EMPLOYEE" ? "bg-blue-600 text-white" : "bg-white text-slate-600"
                }`}
              >
                By Employee
              </button>
              <button
                onClick={() => {
                  setSummaryGroupBy("TEAM");
                  setExpandedSummaryRowId(null);
                }}
                className={`px-3 h-9 text-xs font-bold transition ${
                  summaryGroupBy === "TEAM" ? "bg-blue-600 text-white" : "bg-white text-slate-600"
                }`}
              >
                By Team
              </button>
            </div>

            {summaryGroupBy === "EMPLOYEE" && (
              <FilterSelect value={summaryTeamFilter} onChange={(e) => setSummaryTeamFilter(e.target.value)} className="w-40">
                <option value="">All Teams</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </FilterSelect>
            )}

            <FilterSelect value={summaryDateRangeFilter} onChange={(e) => setSummaryDateRangeFilter(e.target.value as DateRangeOption)} className="w-36">
              <option value="ALL">Any Time</option>
              <option value="THIS_WEEK">This Week</option>
              <option value="THIS_MONTH">This Month</option>
              <option value="CUSTOM">Custom</option>
            </FilterSelect>

            {summaryDateRangeFilter === "CUSTOM" && (
              <>
                <input
                  type="date"
                  value={summaryCustomStart}
                  onChange={(e) => setSummaryCustomStart(e.target.value)}
                  className="h-10 rounded-lg bg-slate-50 border border-slate-200 px-3 text-xs text-slate-600 outline-none appearance-none"
                />
                <input
                  type="date"
                  value={summaryCustomEnd}
                  onChange={(e) => setSummaryCustomEnd(e.target.value)}
                  className="h-10 rounded-lg bg-slate-50 border border-slate-200 px-3 text-xs text-slate-600 outline-none appearance-none"
                />
              </>
            )}

            <div className="flex items-center gap-2">
              <button
                onClick={() => handleExportSummary("excel")}
                disabled={visibleSummaryRows.length === 0 || exporting}
                className="flex items-center gap-1.5 h-10 px-3 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-emerald-100 transition"
              >
                <FileSpreadsheet size={14} />
                Excel
              </button>
              <button
                onClick={() => handleExportSummary("pdf")}
                disabled={visibleSummaryRows.length === 0 || exporting}
                className="flex items-center gap-1.5 h-10 px-3 rounded-lg bg-red-50 text-red-700 text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-red-100 transition"
              >
                <FileText size={14} />
                PDF
              </button>
            </div>
          </div>

          <div className="bg-white rounded-[24px] border border-slate-100 shadow-md overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500 divide-x divide-slate-200 border-b border-slate-200">
                    <th className="px-4 py-3 font-bold">{summaryGroupBy === "TEAM" ? "Team" : "Employee"}</th>
                    <th className="px-4 py-3 font-bold text-center">Total Leads</th>
                    <th className="px-4 py-3 font-bold text-center">Follow-up</th>
                    <th className="px-4 py-3 font-bold text-center" title="Leads currently in the Visit board-stage — distinct from Site Visits Logged, which counts actual visit events.">
                      In Visit Stage
                    </th>
                    <th className="px-4 py-3 font-bold text-center">Bookings</th>
                    <th className="px-4 py-3 font-bold text-center" title="Actual site-visit events logged (via the employee's Log Visit action), not the same as In Visit Stage above.">
                      Site Visits (Verified)
                    </th>
                    <th className="px-4 py-3 font-bold text-center">Avg. Response Time</th>
                    <th className="px-4 py-3 font-bold text-center" title="Status/note logged with no Call or WhatsApp click ever recorded for that assignment — not proof of anything on its own, just a pattern worth a look.">
                      Updates w/o Contact-Click
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSummaryRows.map((row: any) => {
                    const isExpanded = expandedSummaryRowId === row.id;
                    return (
                      <Fragment key={row.id}>
                        <tr className="border-t border-slate-100 divide-x divide-slate-100">
                          <td className="px-4 py-3 font-semibold text-slate-800">
                            {row.name}
                            {summaryGroupBy === "EMPLOYEE" && !row.isActive && (
                              <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-50 text-red-600">
                                Inactive
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center text-slate-700">{row.totalLeads}</td>
                          <td className="px-4 py-3 text-center text-slate-700">{row.followUp}</td>
                          <td className="px-4 py-3 text-center text-slate-700">{row.inVisitStage}</td>
                          <td className="px-4 py-3 text-center text-slate-700">{row.bookings}</td>
                          <td className="px-4 py-3 text-center text-slate-700">
                            {row.visits} <span className="text-slate-400">({row.verifiedVisits} verified)</span>
                          </td>
                          <td className="px-4 py-3 text-center text-slate-700">{formatDurationMs(row.avgResponseMs)}</td>
                          <td className="px-4 py-3 text-center">
                            {row.noContactClickUpdates > 0 ? (
                              <button
                                onClick={() => setExpandedSummaryRowId(isExpanded ? null : row.id)}
                                className={`text-[11px] font-bold px-2 py-0.5 rounded-full transition ${
                                  isExpanded ? "bg-amber-600 text-white" : "bg-amber-50 text-amber-700 hover:bg-amber-100"
                                }`}
                              >
                                {row.noContactClickUpdates} {isExpanded ? "▲" : "▼"}
                              </button>
                            ) : (
                              <span className="text-slate-300">0</span>
                            )}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-amber-50/40">
                            <td colSpan={8} className="px-4 py-3">
                              <p className="text-[10px] uppercase tracking-wide text-amber-700 font-bold mb-2">
                                Updates logged without a Call/WhatsApp click — {row.name}
                              </p>
                              <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="text-left text-slate-500">
                                      <th className="pr-4 py-1.5 font-semibold">Lead</th>
                                      <th className="pr-4 py-1.5 font-semibold">Mobile</th>
                                      <th className="pr-4 py-1.5 font-semibold">Action</th>
                                      <th className="pr-4 py-1.5 font-semibold">When</th>
                                      <th className="pr-4 py-1.5 font-semibold">Notes</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {row.noContactClickLeads.map((l: any) => {
                                      const leadRemarks = l.leadHistoryId ? remarksByLeadHistoryId.get(l.leadHistoryId) || [] : [];
                                      const isLeadExpanded = expandedLeadDetailId === l.id;
                                      const isReassignOpen = reassignOpenLeadId === l.id;
                                      return (
                                        <Fragment key={l.id}>
                                          <tr className="border-t border-amber-100">
                                            <td className="pr-4 py-1.5 text-slate-800 font-medium">{l.name}</td>
                                            <td className="pr-4 py-1.5 text-slate-600">{l.mobile}</td>
                                            <td className="pr-4 py-1.5 text-slate-600">{l.action}</td>
                                            <td className="pr-4 py-1.5 text-slate-600">
                                              {l.evidenceAt ? new Date(l.evidenceAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                                            </td>
                                            <td className="pr-4 py-1.5">
                                              <button
                                                onClick={() => setExpandedLeadDetailId(isLeadExpanded ? null : l.id)}
                                                className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition ${
                                                  isLeadExpanded ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                                                }`}
                                              >
                                                {leadRemarks.length > 0 ? `${leadRemarks.length} remark${leadRemarks.length > 1 ? "s" : ""}` : "Add note"}{" "}
                                                {isLeadExpanded ? "▲" : "▼"}
                                              </button>
                                            </td>
                                          </tr>
                                          {isLeadExpanded && (
                                            <tr className="bg-white">
                                              <td colSpan={5} className="px-3 py-3 border-t border-amber-100">
                                                <div className="space-y-3">
                                                  {leadRemarks.length > 0 && (
                                                    <div className="space-y-1.5">
                                                      {leadRemarks.map((r) => (
                                                        <div key={r.id} className="rounded-lg bg-slate-50 border border-slate-100 px-2.5 py-1.5">
                                                          <p className="text-slate-700">{r.remark}</p>
                                                          <p className="text-[10px] text-slate-400 mt-0.5">
                                                            {r.loggerName} ·{" "}
                                                            {new Date(r.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                                          </p>
                                                        </div>
                                                      ))}
                                                    </div>
                                                  )}

                                                  {l.leadHistoryId && (
                                                    <div className="flex items-start gap-2">
                                                      <textarea
                                                        value={remarkDraft[l.leadHistoryId] || ""}
                                                        onChange={(e) =>
                                                          setRemarkDraft((prev) => ({ ...prev, [l.leadHistoryId]: e.target.value }))
                                                        }
                                                        placeholder="What did the employee tell you about this lead?"
                                                        rows={2}
                                                        className="flex-1 rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-200"
                                                      />
                                                      <button
                                                        onClick={() => handleLogRemark(l.leadHistoryId)}
                                                        disabled={!(remarkDraft[l.leadHistoryId] || "").trim() || remarkSubmittingId === l.leadHistoryId}
                                                        className="shrink-0 h-10 px-3 rounded-lg bg-blue-600 text-white text-[11px] font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-700 transition"
                                                      >
                                                        {remarkSubmittingId === l.leadHistoryId ? "Saving..." : "Log Remark"}
                                                      </button>
                                                    </div>
                                                  )}

                                                  {viewerRole === "admin" && (
                                                    <div className="pt-2 border-t border-slate-100">
                                                      {!isReassignOpen ? (
                                                        <button
                                                          onClick={() => {
                                                            setReassignOpenLeadId(l.id);
                                                            setReassignTargetEmployeeId("");
                                                            setReassignReason("");
                                                          }}
                                                          className="text-[11px] font-bold text-red-600 hover:text-red-700"
                                                        >
                                                          🔁 Force Reassign this lead
                                                        </button>
                                                      ) : (
                                                        <div className="space-y-2">
                                                          <p className="text-[10px] uppercase tracking-wide text-red-600 font-bold">
                                                            Force Reassign — takes this lead from {l.employeeName}, any team, any board stage
                                                          </p>
                                                          <div className="flex flex-wrap items-start gap-2">
                                                            <FilterSelect
                                                              value={reassignTargetEmployeeId}
                                                              onChange={(e) => setReassignTargetEmployeeId(e.target.value)}
                                                              className="w-48"
                                                            >
                                                              <option value="">Select employee...</option>
                                                              {employees
                                                                .filter((e) => e.is_active && e.id !== l.employeeId)
                                                                .map((e) => (
                                                                  <option key={e.id} value={e.id}>
                                                                    {e.name}
                                                                  </option>
                                                                ))}
                                                            </FilterSelect>
                                                            <textarea
                                                              value={reassignReason}
                                                              onChange={(e) => setReassignReason(e.target.value)}
                                                              placeholder="Reason (mandatory)"
                                                              rows={1}
                                                              className="flex-1 min-w-[160px] rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-red-200"
                                                            />
                                                          </div>
                                                          <div className="flex items-center gap-2">
                                                            <button
                                                              onClick={() => handleForceReassign(l.id)}
                                                              disabled={!reassignTargetEmployeeId || !reassignReason.trim() || reassignSubmitting}
                                                              className="h-10 px-3 rounded-lg bg-red-600 text-white text-[11px] font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-red-700 transition"
                                                            >
                                                              {reassignSubmitting ? "Reassigning..." : "Confirm Reassign"}
                                                            </button>
                                                            <button
                                                              onClick={() => setReassignOpenLeadId(null)}
                                                              className="h-10 px-3 rounded-lg bg-slate-100 text-slate-600 text-[11px] font-bold hover:bg-slate-200 transition"
                                                            >
                                                              Cancel
                                                            </button>
                                                          </div>
                                                        </div>
                                                      )}
                                                    </div>
                                                  )}
                                                </div>
                                              </td>
                                            </tr>
                                          )}
                                        </Fragment>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === "VERIFY" && (
        <div className="space-y-4">
          <div className="bg-white rounded-[24px] border border-slate-100 shadow-md p-4 space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <FilterSelect value={visitStatusFilter} onChange={(e) => setVisitStatusFilter(e.target.value as VisitStatusFilter)}>
                <option value="PENDING">Pending</option>
                <option value="VERIFIED">Verified</option>
                <option value="DENIED">Denied</option>
                <option value="ALL">All</option>
              </FilterSelect>

              <FilterSelect value={visitEmployeeFilter} onChange={(e) => setVisitEmployeeFilter(e.target.value)}>
                <option value="">All Employees</option>
                {employeeOptions.map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.name}</option>
                ))}
              </FilterSelect>

              <FilterSelect value={visitTeamFilter} onChange={(e) => setVisitTeamFilter(e.target.value)}>
                <option value="">All Teams</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </FilterSelect>

              <FilterSelect value={visitDateRangeFilter} onChange={(e) => setVisitDateRangeFilter(e.target.value as DateRangeOption)}>
                <option value="ALL">Any Time</option>
                <option value="THIS_WEEK">This Week</option>
                <option value="THIS_MONTH">This Month</option>
                <option value="CUSTOM">Custom</option>
              </FilterSelect>

              <div className="col-span-2 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => handleExportVisits("excel")}
                  disabled={visibleVisits.length === 0 || exporting}
                  className="flex items-center gap-1.5 h-10 px-3 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-emerald-100 transition"
                >
                  <FileSpreadsheet size={14} />
                  Excel
                </button>
                <button
                  onClick={() => handleExportVisits("pdf")}
                  disabled={visibleVisits.length === 0 || exporting}
                  className="flex items-center gap-1.5 h-10 px-3 rounded-lg bg-red-50 text-red-700 text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-red-100 transition"
                >
                  <FileText size={14} />
                  PDF
                </button>
              </div>

              {visitDateRangeFilter === "CUSTOM" && (
                <div className="col-span-2 flex gap-2">
                  <input
                    type="date"
                    value={visitCustomStart}
                    onChange={(e) => setVisitCustomStart(e.target.value)}
                    className="flex-1 h-11 sm:h-10 rounded-lg bg-slate-50 border border-slate-200 px-3 text-xs text-slate-600 outline-none appearance-none"
                  />
                  <input
                    type="date"
                    value={visitCustomEnd}
                    onChange={(e) => setVisitCustomEnd(e.target.value)}
                    className="flex-1 h-11 sm:h-10 rounded-lg bg-slate-50 border border-slate-200 px-3 text-xs text-slate-600 outline-none appearance-none"
                  />
                </div>
              )}
            </div>
          </div>

          {visibleVisits.length === 0 ? (
            <EmptyState emoji="✅" text="No visits match these filters." />
          ) : (
            <div className="space-y-3">
              {visibleVisits.map((visit, index) => {
                const status = visitStatus(visit);
                return (
                  <motion.div
                    key={visit.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: Math.min(index, 10) * 0.03 }}
                    className="rounded-2xl bg-white border border-slate-100 shadow-[0_4px_16px_rgba(15,23,42,0.06)] p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                            {visit.event_type === "REVISIT" ? "Revisit" : "First Visit"}
                          </span>
                          <span
                            className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                              status === "Verified"
                                ? "bg-emerald-50 text-emerald-700"
                                : status === "Denied"
                                ? "bg-red-50 text-red-600"
                                : "bg-amber-50 text-amber-700"
                            }`}
                          >
                            {status}
                          </span>
                          <p className="text-sm font-bold text-slate-800 truncate">{visit.leads?.name || "Unknown lead"}</p>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">
                          {visit.leads?.project ? `${visit.leads.project} · ` : ""}
                          by {visit.employees?.name || "Unknown"}
                          {employeeTeamMap.get(visit.employee_id) && ` (${teamNameMap.get(employeeTeamMap.get(visit.employee_id)!) || ""})`}
                          {" · "}{daysAgoLabel(visit.created_at)}
                        </p>

                        {status === "Verified" && (
                          <p className="text-[11px] text-emerald-700 mt-1">
                            ✓ Verified by {visit.verifier?.name || "—"} on {shortDate(visit.verified_at)}
                          </p>
                        )}
                        {status === "Denied" && (
                          <p className="text-[11px] text-red-600 mt-1">
                            ✗ Denied by {visit.denier?.name || "—"} on {shortDate(visit.denied_at)} — &ldquo;{visit.deny_reason}&rdquo;
                          </p>
                        )}
                        {status === "Pending" && (
                          <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
                            <Clock size={11} />
                            Check the WhatsApp group for the client photo + name/mobile before deciding.
                          </p>
                        )}
                      </div>

                      {status === "Pending" && denyingVisitId !== visit.id && (
                        <div className="shrink-0 flex items-center gap-2">
                          <button
                            disabled={verifying === visit.id}
                            onClick={() => verifyVisit(visit.id)}
                            className="flex items-center gap-1.5 h-10 px-4 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-emerald-500 to-emerald-600 shadow-[0_4px_12px_rgba(16,185,129,0.3)] disabled:opacity-60"
                          >
                            <CheckCircle2 size={15} />
                            {verifying === visit.id ? "Verifying..." : "Verify"}
                          </button>
                          <button
                            onClick={() => {
                              setDenyingVisitId(visit.id);
                              setDenyReason("");
                            }}
                            className="flex items-center gap-1.5 h-10 px-4 rounded-xl text-sm font-bold text-red-700 bg-red-50 hover:bg-red-100 transition"
                          >
                            <XCircle size={15} />
                            Deny
                          </button>
                        </div>
                      )}
                    </div>

                    {denyingVisitId === visit.id && (
                      <div className="mt-3 pt-3 border-t border-slate-100">
                        <textarea
                          value={denyReason}
                          onChange={(e) => setDenyReason(e.target.value)}
                          placeholder="Reason (required) — e.g. No photo posted in WhatsApp group"
                          rows={2}
                          className="w-full rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-sm outline-none resize-none"
                        />
                        <div className="flex gap-2 mt-2">
                          <button
                            disabled={denySubmitting}
                            onClick={() => submitDeny(visit.id)}
                            className="flex-1 h-10 rounded-xl text-sm font-semibold bg-red-600 text-white disabled:opacity-60"
                          >
                            {denySubmitting ? "Denying..." : "Confirm Deny"}
                          </button>
                          <button
                            disabled={denySubmitting}
                            onClick={() => {
                              setDenyingVisitId(null);
                              setDenyReason("");
                            }}
                            className="flex-1 h-10 rounded-xl text-sm font-semibold bg-slate-100 text-slate-700 disabled:opacity-60"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === "SNOOZE" && (
        <div className="space-y-4">
          <div className="bg-white rounded-[24px] border border-slate-100 shadow-md p-4 space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <FilterSelect value={snoozeStatusFilter} onChange={(e) => setSnoozeStatusFilter(e.target.value as SnoozeStatusFilter)}>
                <option value="ALL">All</option>
                <option value="ACTIVE">Active</option>
                <option value="EXPIRED">Expired</option>
                <option value="CANCELLED">Cancelled</option>
              </FilterSelect>

              <FilterSelect value={snoozeEmployeeFilter} onChange={(e) => setSnoozeEmployeeFilter(e.target.value)}>
                <option value="">All Employees</option>
                {employeeOptions.map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.name}</option>
                ))}
              </FilterSelect>

              <FilterSelect value={snoozeTeamFilter} onChange={(e) => setSnoozeTeamFilter(e.target.value)}>
                <option value="">All Teams</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </FilterSelect>

              <FilterSelect value={snoozeDateRangeFilter} onChange={(e) => setSnoozeDateRangeFilter(e.target.value as DateRangeOption)}>
                <option value="ALL">Any Time</option>
                <option value="THIS_WEEK">This Week</option>
                <option value="THIS_MONTH">This Month</option>
                <option value="CUSTOM">Custom</option>
              </FilterSelect>

              <div className="col-span-2 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => handleExportSnoozes("excel")}
                  disabled={visibleSnoozeLog.length === 0 || exporting}
                  className="flex items-center gap-1.5 h-10 px-3 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-emerald-100 transition"
                >
                  <FileSpreadsheet size={14} />
                  Excel
                </button>
                <button
                  onClick={() => handleExportSnoozes("pdf")}
                  disabled={visibleSnoozeLog.length === 0 || exporting}
                  className="flex items-center gap-1.5 h-10 px-3 rounded-lg bg-red-50 text-red-700 text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-red-100 transition"
                >
                  <FileText size={14} />
                  PDF
                </button>
              </div>

              {snoozeDateRangeFilter === "CUSTOM" && (
                <div className="col-span-2 flex gap-2">
                  <input
                    type="date"
                    value={snoozeCustomStart}
                    onChange={(e) => setSnoozeCustomStart(e.target.value)}
                    className="flex-1 h-11 sm:h-10 rounded-lg bg-slate-50 border border-slate-200 px-3 text-xs text-slate-600 outline-none appearance-none"
                  />
                  <input
                    type="date"
                    value={snoozeCustomEnd}
                    onChange={(e) => setSnoozeCustomEnd(e.target.value)}
                    className="flex-1 h-11 sm:h-10 rounded-lg bg-slate-50 border border-slate-200 px-3 text-xs text-slate-600 outline-none appearance-none"
                  />
                </div>
              )}
            </div>
          </div>

          {visibleSnoozeLog.length === 0 ? (
            <EmptyState emoji="😴" text="No snoozes match these filters." />
          ) : (
            <div className="space-y-2.5">
              {visibleSnoozeLog.map((row) => {
                const status = snoozeStatus(row);
                return (
                  <div
                    key={row.id}
                    className="flex items-start justify-between gap-3 rounded-xl bg-white border border-slate-100 p-3.5"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">
                        {row.leads?.name || "Unknown lead"}{" "}
                        <span className="text-slate-400 font-normal">
                          by {row.employees?.name || "Unknown"}
                          {employeeTeamMap.get(row.employee_id) && ` (${teamNameMap.get(employeeTeamMap.get(row.employee_id)!) || ""})`}
                        </span>
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5 italic">&ldquo;{row.reason}&rdquo;</p>
                      <p className="text-[11px] text-slate-400 mt-1">
                        {row.duration_months}mo · snoozed {shortDate(row.snoozed_at)} · until{" "}
                        {shortDate(row.snoozed_until)}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 text-[11px] font-bold px-2 py-1 rounded-full ${
                        status === "Cancelled"
                          ? "bg-slate-100 text-slate-500"
                          : status === "Active"
                          ? "bg-indigo-50 text-indigo-700"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {status}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Reuses the exact same WeeklyLeaderboardView the employee-
          facing /leaderboard route uses (Golden Rule — no separate
          coordinator-flavored view) — canExport=true and
          canFilter=true (Sales Coordinator gets full Search +
          Custom Range + Export power, same as Admin), myEmployeeId=
          null (Coordinator isn't a ranked participant, so no row
          highlights as "You"). Padding-free (no wrapping px-4/mt-4
          div) since Coordinator's own page body already provides
          that spacing for every tab. */}
      {activeTab === "LEADERBOARD" && (
        <WeeklyLeaderboardView myEmployeeId={null} canExport={true} canFilter={true} />
      )}

      {/* Reuses the exact same TicketsView every other surface uses
          (Golden Rule) — viewerEmployeeId (Admin-or-Coordinator,
          whoever's viewing this shared page) so their own raised
          tickets land in "My Tickets", not "To Resolve". */}
      {activeTab === "TICKETS" && (
        <TicketsView myEmployeeId={viewerEmployeeId} />
      )}

      {manualEntryOpen && (
        <ManualLeadEntryModal
          employees={employees}
          onClose={() => setManualEntryOpen(false)}
          onCreated={loadLeads}
        />
      )}
    </div>
  );
}
