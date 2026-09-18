"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Search, ChevronDown, Target, FileSpreadsheet, FileText, Upload, Table2 } from "lucide-react";
import Link from "next/link";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";
import AdminLeadCard from "@/components/AdminLeadCard";
import ExportPreviewTable from "@/components/ExportPreviewTable";
import ManualLeadEntryModal from "@/components/ManualLeadEntryModal";
import ManualBookingEntryModal from "@/components/ManualBookingEntryModal";
import { LEAD_STATUS_DISPLAY } from "@/lib/leadStatusDisplay";
import { BOARD_STAGES } from "@/lib/leadBoardStageDisplay";
import { exportLeadsToExcel, exportLeadsToPDF } from "@/lib/exportLeadsReport";
import { DateRangeOption, isWithinDateRange, dateRangeFilterLabel } from "@/lib/dateRangeFilter";
import { getRecycleCutoff } from "@/lib/calculateSLAStatus";
import { isLeadTerminal } from "@/lib/isLeadTerminal";

type SortOption = "NEWEST" | "OLDEST" | "SLA_URGENCY";

const ALL_STATUSES = Object.keys(LEAD_STATUS_DISPLAY);

// Card-grid page size (2026-09-18 perf fix) — this page has no upper
// bound on how many leads it can match (unlike the employee-side
// LeadList, which is naturally capped to one employee's own leads via
// RLS). Rendering every matching lead as a full AdminLeadCard at once
// is the real bottleneck measured on this page (confirmed: ~1,900
// leads today, zero pagination anywhere in the fetch/render path,
// unlike admin/teams and admin/backup-status which already paginate).
// This ONLY caps what's mounted in the grid — filtering, search, sort,
// Select-All-Filtered, and the Excel/PDF/Report-Table export all keep
// operating on the full filtered set (visibleLeads/cardLeads), exactly
// as before. Matches admin/backup-status's own .limit(60) convention.
const LEADS_PAGE_SIZE = 60;

// Same appearance-none + overlaid chevron treatment as the
// employee-side LeadList — native <select> underneath (best mobile
// picker UX), just stripped of default browser chrome.
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

// Admin-wide lead visibility — across ALL employees, not scoped to
// one owner. Relies entirely on the existing leads_admin_all RLS
// policy (Phase 1) for the read; no new backend needed. Unlike the
// employee-side query, lead_history is embedded WITHOUT !inner, so
// leads with no assignment at all (e.g. assign-lead found nobody
// eligible) still show up here — that's exactly the kind of gap
// Admin needs visibility into, and exactly what an employee's own
// list should never show.
export default function AdminLeadsPage() {

  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  // Full active-employee roster — separate from employeeOptions below
  // (which only lists employees who currently OWN a lead, fine for
  // filtering but useless as a JUNK-recovery reassign-target picker,
  // since the whole point is picking someone who doesn't own this
  // lead yet).
  const [employees, setEmployees] = useState<{ id: string; name: string; is_active: boolean }[]>([]);
  // Employee Leave/Holiday gap (2026-08-23, Point A) — who's currently
  // on leave, fetched once per page load (not per card) and looked up
  // by current_owner_id when rendering each AdminLeadCard below. Same
  // "still on leave" definition recycle-stale-leads uses:
  // start_date <= today AND (end_date IS NULL OR end_date >= today).
  const [onLeaveEmployeeIds, setOnLeaveEmployeeIds] = useState<Set<string>>(new Set());
  const [adminEmployeeId, setAdminEmployeeId] = useState<string | null>(null);
  const [showPreviewTable, setShowPreviewTable] = useState(false);
  const [manualEntryOpen, setManualEntryOpen] = useState(false);
  const [manualBookingOpen, setManualBookingOpen] = useState(false);

  // Bulk Reassign — selection lives here (parent), same split as every
  // other cross-card state on this page (see AdminLeadCard's own
  // comment). Selected IDs persist across filter changes on purpose —
  // a lead scrolled out of view by a filter is still a deliberate
  // choice Admin made, not a stale artifact. The bar's always-visible
  // "N selected" count + Clear button is what surfaces that instead.
  // Cleared automatically only after a successful bulk action.
  // Which page of the (already filtered) card grid is currently
  // rendered — independent of selection, filters, or export, all of
  // which still see the complete filtered set regardless of this.
  const [visiblePage, setVisiblePage] = useState(1);

  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [bulkTargetEmployeeId, setBulkTargetEmployeeId] = useState("");
  const [bulkReason, setBulkReason] = useState("");
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [boardStageFilter, setBoardStageFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [recyclingSoonFilter, setRecyclingSoonFilter] = useState(false);
  const [typeFilter, setTypeFilter] = useState("");
  const [dateRangeFilter, setDateRangeFilter] = useState<DateRangeOption>("ALL");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("NEWEST");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    loadLeads();
    loadTeams();
    loadEmployees();
    loadAdminEmployeeId();
    loadOnLeaveEmployees();
  }, []);

  async function loadOnLeaveEmployees() {
    const today = new Date().toISOString().slice(0, 10);

    const { data } = await supabase
      .from("employee_leave_periods")
      .select("employee_id")
      .lte("start_date", today)
      .or(`end_date.is.null,end_date.gte.${today}`);

    if (data) {
      setOnLeaveEmployeeIds(new Set(data.map((r) => r.employee_id)));
    }
  }

  // Needed as reserved_by_employee_id when logging a team reservation
  // — this page's own layout only tracks the admin's display name
  // locally, not their employees.id, so it's fetched here directly.
  async function loadAdminEmployeeId() {
    const {
      data: { session }
    } = await supabase.auth.getSession();

    if (!session) return;

    const { data } = await supabase
      .from("employees")
      .select("id")
      .eq("auth_user_id", session.user.id)
      .single();

    if (data) {
      setAdminEmployeeId(data.id);
    }
  }

  async function loadLeads() {
    setLoading(true);

    const { data, error } = await supabase
      .from("leads")
      .select(
        `
        id,
        name,
        mobile,
        project,
        source,
        catcher_name,
        status,
        priority,
        board_stage,
        sla_deadline,
        recycle_count,
        created_at,
        current_owner_id,
        pending_team_id,
        lead_type,
        employees ( name ),
        pending_team:teams ( name ),
        lead_history (
          assigned_at, is_active, first_call_at, first_whatsapp_at, assigned_by_type, call_count,
          last_activity_at, paused_until, pause_reason, pause_note, outcome_at,
          assigned_by:employees!lead_history_assigned_by_employee_id_fkey(name)
        )
      `
      )
      .eq("lead_history.is_active", true)
      .order("created_at", { ascending: false });

    if (!error && data) {
      setLeads(data);
    }

    setLoading(false);
  }

  async function loadTeams() {
    const { data, error } = await supabase.from("teams").select("id, name").order("name");
    if (!error && data) {
      setTeams(data);
    }
  }

  async function loadEmployees() {
    const { data, error } = await supabase
      .from("employees")
      .select("id, name, is_active")
      .order("name");
    if (!error && data) {
      setEmployees(data);
    }
  }

  // JUNK-recovery — Admin manually decides a specific JUNK lead is
  // worth another shot and hands it to a specific employee.
  // unjunk_and_reassign_lead_atomic does the actual work (fresh NEW/
  // LEADS status, recycle_count reset, working-hours-aware SLA
  // deadline, full lead_history audit trail preserved) — this just
  // calls it and refetches so the card reflects the new state.
  const handleUnjunkReassign = useCallback(async (leadId: string, employeeId: string, reason: string) => {
    const { error } = await supabase.rpc("unjunk_and_reassign_lead_atomic", {
      p_lead_id: leadId,
      p_new_employee_id: employeeId,
      p_reason: reason
    });

    if (error) {
      toast.error(error.message || "Could not reassign this lead.");
      return;
    }

    toast.success("Lead recovered and reassigned.");
    loadLeads();
  }, []);

  const handleToggleSelect = useCallback((leadId: string) => {
    setSelectedLeadIds((prev) => {
      const next = new Set(prev);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
  }, []);

  // One RPC call for the whole batch (bulk_reassign_leads_atomic),
  // not a client-side loop — it does its own per-lead try/catch
  // internally (a real Postgres savepoint per lead), so one bad lead
  // in the batch can't abort the others. The per-lead results it
  // returns are surfaced as a single summary toast rather than one
  // toast per lead, which would be noise for a 50-lead batch.
  async function handleBulkReassign() {
    if (selectedLeadIds.size === 0 || !bulkTargetEmployeeId || !bulkReason.trim()) return;

    setBulkSubmitting(true);
    try {
      const { data, error } = await supabase.rpc("bulk_reassign_leads_atomic", {
        p_lead_ids: Array.from(selectedLeadIds),
        p_new_employee_id: bulkTargetEmployeeId,
        p_reason: bulkReason.trim()
      });

      if (error) {
        toast.error(error.message || "Could not bulk-reassign these leads.");
        return;
      }

      const results = (data || []) as { lead_id: string; success: boolean; error?: string }[];
      const failed = results.filter((r) => !r.success);

      if (failed.length === 0) {
        toast.success(`Reassigned ${results.length} lead${results.length === 1 ? "" : "s"}.`);
      } else {
        toast.error(
          `${results.length - failed.length} reassigned, ${failed.length} failed: ${failed
            .map((f) => f.error)
            .join("; ")}`,
          { duration: 8000 }
        );
      }

      setSelectedLeadIds(new Set());
      setBulkTargetEmployeeId("");
      setBulkReason("");
      loadLeads();
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong bulk-reassigning these leads.");
    } finally {
      setBulkSubmitting(false);
    }
  }

  // Reserving a lead for a team is a plain client-side update (not an
  // RPC) — same precedent as the rest of app/admin/teams/page.tsx:
  // Admin already has full RLS access to `leads`, and this is one
  // trusted column, not a multi-table transaction. Optimistic local
  // patch avoids a full refetch for a single-field change.
  //
  // The reservation itself is also logged to lead_team_reservations —
  // this is a genuinely separate event from an assignment (nobody
  // owns the lead yet), so it can't be a lead_history row (employee_id
  // there is NOT NULL, by design, on every existing write path).
  // AdminLeadHistoryModal merges both tables into one timeline. Only
  // logged when actually reserving for a team, not when clearing back
  // to "No team reserved" — there's no assignment-shaped event to
  // record in that direction.
  // Wrapped in useCallback (2026-09-18 perf fix) -- AdminLeadCard is
  // memo()'d, but a plain function declaration here is a NEW reference
  // every render, which defeats that memo entirely: every card was
  // re-rendering on every single checkbox click (confirmed root cause
  // of the reported click lag -- this page had no useCallback usage at
  // all before this). Stable references here mean only the one card
  // whose own props actually changed re-renders.
  const handleReserveTeam = useCallback(async (leadId: string, teamId: string | null) => {
    const { error } = await supabase
      .from("leads")
      .update({ pending_team_id: teamId })
      .eq("id", leadId);

    if (error) {
      toast.error(error.message || "Could not update team reservation.");
      return;
    }

    if (teamId && adminEmployeeId) {
      await supabase.from("lead_team_reservations").insert({
        lead_id: leadId,
        team_id: teamId,
        reserved_by_employee_id: adminEmployeeId
      });
    }

    const teamName = teamId ? teams.find((t) => t.id === teamId)?.name ?? null : null;

    setLeads((prev) =>
      prev.map((lead) =>
        lead.id === leadId
          ? { ...lead, pending_team_id: teamId, pending_team: teamName ? { name: teamName } : null }
          : lead
      )
    );
  }, [adminEmployeeId, teams]);

  const employeeOptions = useMemo(() => {
    const map = new Map<string, string>();
    leads.forEach((lead) => {
      if (lead.current_owner_id && lead.employees?.name) {
        map.set(lead.current_owner_id, lead.employees.name);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [leads]);

  const projectOptions = useMemo(
    () => Array.from(new Set(leads.map((l) => l.project).filter(Boolean))) as string[],
    [leads]
  );

  const sourceOptions = useMemo(
    () => Array.from(new Set(leads.map((l) => l.source).filter(Boolean))) as string[],
    [leads]
  );

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

    if (recyclingSoonFilter) {
      result = result.filter((lead) => {
        const h = lead.lead_history?.[0];
        return getRecycleCutoff(
          {
            status: lead.status,
            sla_deadline: null,
            recycle_count: lead.recycle_count,
            board_stage: lead.board_stage,
            paused_until: h?.paused_until ?? null,
            last_activity_at: h?.last_activity_at ?? null,
            pause_reason: h?.pause_reason ?? null,
            assigned_at: h?.assigned_at ?? null,
            lead_type: lead.lead_type
          },
          h?.outcome_at ?? null
        ) !== null;
      });
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
    projectFilter,
    sourceFilter,
    boardStageFilter,
    statusFilter,
    recyclingSoonFilter,
    typeFilter,
    dateRangeFilter,
    customStart,
    customEnd,
    sortBy
  ]);

  // Select All (Filtered) — exactly the ids visibleLeads would already
  // render a checkbox for (same isLeadTerminal exclusion AdminLeadCard
  // itself uses, single source of truth, not reimplemented). Recomputes
  // whenever the filters change visibleLeads, so "Select All" always
  // means "all of what's on screen right now under the current filters"
  // — never a stale set from a previous filter combination.
  const selectableVisibleIds = useMemo(
    () => visibleLeads.filter((lead) => !isLeadTerminal(lead.status, lead.board_stage || "LEADS")).map((lead) => lead.id),
    [visibleLeads]
  );

  const allVisibleSelected =
    selectableVisibleIds.length > 0 && selectableVisibleIds.every((id) => selectedLeadIds.has(id));

  // The actual remaining re-render culprit (2026-09-18 perf follow-up):
  // even after handleReserveTeam/handleUnjunkReassign/handleToggleSelect
  // became stable via useCallback, every card below still received a
  // BRAND NEW `lead={{ ...inline object literal... }}` on every single
  // render of this page — a fresh object reference every time,
  // regardless of whether that specific lead's data actually changed.
  // AdminLeadCard's memo() shallow-compares props by reference, so a
  // new object every render defeats it exactly as badly as the unstable
  // callbacks did — every card was still re-rendering on every checkbox
  // click even after the previous fix. Hoisting the transform here
  // means each card's `lead` object is only rebuilt when visibleLeads
  // itself changes (a real data/filter change), not on every keystroke
  // in the bulk-reassign reason box or every other click on the page.
  const cardLeads = useMemo(
    () =>
      visibleLeads.map((lead: any) => ({
        id: lead.id,
        name: lead.name,
        mobile: lead.mobile,
        project: lead.project,
        source: lead.source,
        status: lead.status,
        priority: lead.priority,
        boardStage: lead.board_stage || "LEADS",
        recycleCount: lead.recycle_count,
        ownerName: lead.employees?.name ?? null,
        currentOwnerId: lead.current_owner_id ?? null,
        catcherName: lead.catcher_name ?? null,
        assignedAt: lead.lead_history?.[0]?.assigned_at ?? null,
        pendingTeamId: lead.pending_team_id ?? null,
        pendingTeamName: lead.pending_team?.name ?? null,
        leadType: lead.lead_type || "LEAD",
        callCount: lead.lead_history?.[0]?.call_count ?? 0,
        pausedUntil: lead.lead_history?.[0]?.paused_until ?? null,
        pauseReason: lead.lead_history?.[0]?.pause_reason ?? null,
        lastActivityAt: lead.lead_history?.[0]?.last_activity_at ?? null,
        outcomeAt: lead.lead_history?.[0]?.outcome_at ?? null
      })),
    [visibleLeads]
  );

  const totalPages = Math.max(1, Math.ceil(cardLeads.length / LEADS_PAGE_SIZE));

  // Snap back to page 1 whenever the underlying filtered set changes
  // (a filter/search/sort edit, or a reload after an admin action) —
  // cardLeads only gets a new reference on those events (loadLeads is
  // called just 3 times in this file: mount, after unjunk-reassign,
  // after bulk-reassign), never on an interval/realtime tick, so this
  // can't fight with normal browsing. Without it, narrowing a filter
  // while on page 5 could land Admin on an empty page even though
  // matching leads exist on page 1. Adjusted during render (React's own
  // documented pattern for "reset state when a value changes"), not via
  // a useEffect -- an effect would run one paint late, letting page 5's
  // stale grid flash briefly before snapping to page 1.
  const [prevCardLeads, setPrevCardLeads] = useState(cardLeads);
  if (cardLeads !== prevCardLeads) {
    setPrevCardLeads(cardLeads);
    setVisiblePage(1);
  }

  const paginatedCardLeads = useMemo(
    () => cardLeads.slice((visiblePage - 1) * LEADS_PAGE_SIZE, visiblePage * LEADS_PAGE_SIZE),
    [cardLeads, visiblePage]
  );

  // Toggle, not just "add all" — lets Admin flip a full filtered batch
  // back off in one click too. Only ever touches the currently-visible
  // selectable ids; any selection made under a different filter (see
  // the "persists across filters" comment above) is left untouched.
  const handleToggleSelectAll = useCallback(() => {
    setSelectedLeadIds((prev) => {
      const next = new Set(prev);
      const allSelected = selectableVisibleIds.length > 0 && selectableVisibleIds.every((id) => next.has(id));
      for (const id of selectableVisibleIds) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, [selectableVisibleIds]);

  // Report-header content — Employee gets its own labeled line (per
  // spec), the other four filters bundle into one "Filters: ..."
  // line. Built from the same filter state driving visibleLeads, so
  // the report header can never drift out of sync with what's
  // actually in the export.
  const reportMeta = useMemo(() => {
    const employeeLabel = employeeFilter
      ? employeeOptions.find((e) => e.id === employeeFilter)?.name ?? null
      : null;

    const otherFilters: { label: string; value: string }[] = [];

    if (projectFilter) {
      otherFilters.push({ label: "Project", value: projectFilter });
    }

    if (sourceFilter) {
      otherFilters.push({ label: "Source", value: sourceFilter });
    }

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

    if (typeFilter) {
      otherFilters.push({ label: "Type", value: typeFilter === "DATA" ? "Data" : "Leads" });
    }

    const dateLabel = dateRangeFilterLabel(dateRangeFilter, customStart, customEnd);
    if (dateLabel) {
      otherFilters.push({ label: "Date", value: dateLabel });
    }

    return { employeeLabel, otherFilters };
  }, [
    employeeFilter,
    projectFilter,
    sourceFilter,
    boardStageFilter,
    statusFilter,
    typeFilter,
    dateRangeFilter,
    customStart,
    customEnd,
    employeeOptions
  ]);

  // Exports exactly visibleLeads (already filtered/searched/sorted
  // above) — never the full leads array. Both exceljs and jspdf are
  // dynamically imported inside lib/exportLeadsReport.ts, so their
  // weight only loads once one of these is actually clicked, not on
  // every Admin Leads page load.
  async function handleExport(format: "excel" | "pdf") {
    if (visibleLeads.length === 0 || exporting) return;

    setExporting(true);
    try {
      if (format === "excel") {
        await exportLeadsToExcel(visibleLeads, reportMeta);
      } else {
        await exportLeadsToPDF(visibleLeads, reportMeta);
      }
    } catch (err) {
      console.error(err);
      toast.error("Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-[24px] bg-gradient-to-br from-[#0f172a] via-[#1d4ed8] to-[#06b6d4] p-6 text-white shadow-[0_15px_50px_rgba(37,99,235,0.2)]"
      >
        <div className="absolute top-[-60px] right-[-60px] w-[150px] h-[150px] rounded-full bg-white/10 blur-3xl" />
        <Target size={140} strokeWidth={1} className="absolute -bottom-8 -right-4 text-white/10 pointer-events-none" />

        <div className="relative flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">Leads</h1>
            <p className="mt-2 text-white/80 text-sm">
              Every lead, across every employee — {leads.length} total
            </p>
          </div>

          {/* Two buttons now (was one, before Manual-Lead-Entry) —
              flex-wrap is the safety net on the narrowest phones where
              even a stacked-below row can't fit both side-by-side;
              sm:shrink-0 stops them competing with the title for width
              once the row goes horizontal again at sm+. */}
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
            <button
              onClick={() => setManualEntryOpen(true)}
              className="flex items-center gap-1.5 h-10 px-4 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-sm font-semibold transition"
            >
              🎣 Add Manual Lead
            </button>

            <button
              onClick={() => setManualBookingOpen(true)}
              className="flex items-center gap-1.5 h-10 px-4 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-sm font-semibold transition"
            >
              🏆 Manual Booking Entry
            </button>

            <Link
              href="/admin/leads/import"
              className="flex items-center gap-1.5 h-10 px-4 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-sm font-semibold transition"
            >
              <Upload size={14} />
              Import CSV
            </Link>
          </div>
        </div>
      </motion.div>

      {manualEntryOpen && (
        <ManualLeadEntryModal
          employees={employees}
          onClose={() => setManualEntryOpen(false)}
          onCreated={loadLeads}
        />
      )}

      {manualBookingOpen && (
        <ManualBookingEntryModal
          employees={employees}
          onClose={() => setManualBookingOpen(false)}
          onCreated={loadLeads}
        />
      )}

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-[24px] border border-slate-100 shadow-md p-6 space-y-4"
      >
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

          <button
            type="button"
            onClick={() => setRecyclingSoonFilter((v) => !v)}
            className={`h-10 rounded-lg px-3 text-xs font-semibold border transition ${
              recyclingSoonFilter
                ? "bg-amber-100 border-amber-300 text-amber-700"
                : "bg-slate-50 border-slate-200 text-slate-600"
            }`}
          >
            ⚠️ Recycling Soon
          </button>

          <FilterSelect value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All Types</option>
            <option value="LEAD">Leads</option>
            <option value="DATA">Data</option>
          </FilterSelect>

          <FilterSelect
            value={dateRangeFilter}
            onChange={(e) => setDateRangeFilter(e.target.value as DateRangeOption)}
          >
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

          {/* col-span-2: on the mobile 2-col grid this row needs the
              FULL card width, not one half-width cell — 3 buttons
              ("View Report"/"Excel"/"PDF") don't fit ~150px. flex-wrap
              is a safety net under that even on the smallest phones
              (~320px) — same col-span-2 escape hatch already used
              below for the custom date-range inputs. */}
          <div className="col-span-2 flex flex-wrap items-center gap-2">
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
              onClick={() => handleExport("excel")}
              disabled={visibleLeads.length === 0 || exporting}
              className="flex items-center gap-1.5 h-10 px-3 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-emerald-100 transition"
            >
              <FileSpreadsheet size={14} />
              Excel
            </button>

            <button
              onClick={() => handleExport("pdf")}
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
      </motion.div>

      {!loading && showPreviewTable && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-[24px] border border-slate-100 shadow-md p-6"
        >
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-bold mb-3">
            Report Table — {visibleLeads.length} lead{visibleLeads.length === 1 ? "" : "s"}
          </p>
          <ExportPreviewTable leads={visibleLeads} />
        </motion.div>
      )}

      {loading ? (
        <div className="text-center text-sm text-slate-400 py-10">Loading leads...</div>
      ) : visibleLeads.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="text-5xl mb-3">🎯</div>
          <h2 className="text-lg font-semibold text-gray-700">No leads match these filters</h2>
        </div>
      ) : (
        <>
          {selectableVisibleIds.length > 0 && (
            <div className="flex items-center justify-between">
              <button
                onClick={handleToggleSelectAll}
                className="text-xs font-bold text-blue-700 hover:text-blue-900"
              >
                {allVisibleSelected
                  ? `Deselect All (${selectableVisibleIds.length})`
                  : `Select All Filtered (${selectableVisibleIds.length})`}
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {paginatedCardLeads.map((cardLead, index) => (
            <AdminLeadCard
              key={cardLead.id}
              index={index}
              teams={teams}
              employees={employees}
              onReserveTeam={handleReserveTeam}
              onUnjunkReassign={handleUnjunkReassign}
              isOwnerOnLeave={cardLead.currentOwnerId ? onLeaveEmployeeIds.has(cardLead.currentOwnerId) : false}
              selectable
              selected={selectedLeadIds.has(cardLead.id)}
              onToggleSelect={handleToggleSelect}
              lead={cardLead}
            />
          ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 pt-2">
              <button
                onClick={() => setVisiblePage((p) => Math.max(1, p - 1))}
                disabled={visiblePage === 1}
                className="h-9 px-4 rounded-lg text-xs font-bold bg-white border border-slate-200 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition"
              >
                Previous
              </button>
              <span className="text-xs font-semibold text-slate-500">
                Page {visiblePage} of {totalPages} — showing{" "}
                {(visiblePage - 1) * LEADS_PAGE_SIZE + 1}
                {"–"}
                {Math.min(visiblePage * LEADS_PAGE_SIZE, cardLeads.length)} of {cardLeads.length}
              </span>
              <button
                onClick={() => setVisiblePage((p) => Math.min(totalPages, p + 1))}
                disabled={visiblePage === totalPages}
                className="h-9 px-4 rounded-lg text-xs font-bold bg-white border border-slate-200 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      {selectedLeadIds.size > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 w-[min(640px,calc(100vw-2rem))] rounded-2xl bg-white border border-slate-200 shadow-[0_12px_36px_rgba(15,23,42,0.18)] p-4"
        >
          <div className="flex items-center justify-between gap-3 mb-3">
            <p className="text-sm font-bold text-slate-800">
              {selectedLeadIds.size} lead{selectedLeadIds.size === 1 ? "" : "s"} selected
            </p>
            <button
              onClick={() => setSelectedLeadIds(new Set())}
              className="text-xs font-semibold text-slate-400 hover:text-slate-600"
            >
              Clear
            </button>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <FilterSelect
              value={bulkTargetEmployeeId}
              onChange={(e) => setBulkTargetEmployeeId(e.target.value)}
              className="sm:w-48"
            >
              <option value="">Assign to...</option>
              {employees
                .filter((e) => e.is_active)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
            </FilterSelect>

            <input
              value={bulkReason}
              onChange={(e) => setBulkReason(e.target.value)}
              placeholder="Reason (required)"
              className="flex-1 h-10 rounded-lg bg-slate-50 border border-slate-200 px-3 text-xs outline-none"
            />

            <button
              onClick={handleBulkReassign}
              disabled={bulkSubmitting || !bulkTargetEmployeeId || !bulkReason.trim()}
              className="h-10 px-4 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition shrink-0"
            >
              {bulkSubmitting ? "Reassigning..." : `Reassign (${selectedLeadIds.size})`}
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
