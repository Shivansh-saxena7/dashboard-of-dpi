"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { DateRangeOption, dateRangeFilterLabel } from "@/lib/dateRangeFilter";
import { getRecycleCutoff } from "@/lib/calculateSLAStatus";
import { isLeadTerminal } from "@/lib/isLeadTerminal";

type SortOption = "NEWEST" | "OLDEST" | "SLA_URGENCY";

const ALL_STATUSES = Object.keys(LEAD_STATUS_DISPLAY);

// Server-side pagination + filtering (2026-09-20 rework, 4 pieces,
// all landed) — replaces the old "fetch everything, filter/sort/
// paginate in the browser" design entirely. That approach silently
// capped at PostgREST's default 1000-row response limit (the critical
// bug fixed just before this rework), and even once corrected to fetch
// everything via a .range() loop, it meant downloading the ENTIRE
// company-wide leads table on every single page load — fine at ~2,200
// rows, genuinely bad at the 50,000-100,000 this table is expected to
// reach. Every filter below is now a real SQL condition (see
// applyLeadFilters), and only the current PAGE_SIZE-row page is ever
// fetched, with a `{ count: "exact" }` riding along on the SAME
// request (not a second one) for the "Showing X-Y of Z" total.
//
// recyclingSoonFilter is the one deliberate, permanent exception, kept
// client-side (see cardLeads below) — getRecycleCutoff() is
// time-dependent, multi-branch business logic already shared with the
// live SLA-countdown display; reimplementing it in SQL risks it
// drifting out of sync with the TS version. When this toggle is on, it
// filters only the current page's already-fetched rows, so the "of Z"
// total isn't authoritative and Select-All/Export/Preview all fall
// back to page-scoped for that one view specifically (labeled "(This
// Page)"/"(Page)" in the UI) — there's no server-side "full matching
// set" to fetch for a condition that's never sent as a query.
//
// Select-All-Filtered and Excel/PDF export/Report-Table fetch the full
// matching set via fetchAllMatching (a .range()-loop scoped through
// applyLeadFilters, same idiom as the emergency fix that started this
// rework, just scoped to the — usually much smaller — filtered result
// instead of the whole table) rather than just the visible page.
// project/source filter options come from dedicated
// leads_distinct_projects/leads_distinct_sources DB views, independent
// of pagination and filters entirely.
const PAGE_SIZE = 60;
const SEARCH_DEBOUNCE_MS = 300;

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
  // Full active-employee roster — used both as the JUNK-recovery
  // reassign-target picker and (via employeeOptions below) the
  // Employee filter dropdown.
  const [employees, setEmployees] = useState<{ id: string; name: string; is_active: boolean }[]>([]);
  const [projectOptions, setProjectOptions] = useState<string[]>([]);
  const [sourceOptions, setSourceOptions] = useState<string[]>([]);
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
  // Current page of the SERVER-side filtered+paginated result set —
  // changing this now triggers a real refetch (see the loadLeads
  // effect below), not a client-side slice of an already-loaded array.
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [bulkTargetEmployeeId, setBulkTargetEmployeeId] = useState("");
  const [bulkReason, setBulkReason] = useState("");
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  // Debounced separately from searchQuery itself so every keystroke
  // doesn't fire a server query — same setTimeout/clearTimeout-in-a-
  // useEffect idiom, same 300ms, already proven in
  // ManualBookingEntryModal.tsx's own lead search.
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
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

  // Piece 2 — lazily-fetched full matching id list, cached so a second
  // "Select All Filtered" click (or the toggle back to "Deselect All
  // Filtered") doesn't re-fetch. null = not fetched yet for the
  // current filters. Invalidated (set back to null) whenever the
  // filters actually change, and after a bulk action that could shrink
  // the true matching set (see handleBulkReassign/handleUnjunkReassign)
  // — never used stale across either of those.
  const [fullMatchingIds, setFullMatchingIds] = useState<string[] | null>(null);
  const [selectAllFetching, setSelectAllFetching] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchQuery(searchQuery.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Any filter/sort change should snap back to page 1 (a stale page 3
  // under a new, narrower filter could be empty even though matches
  // exist on page 1) — adjusted during render, same established idiom
  // this page already used for its old client-side pagination reset
  // (see the git history), so the corrected page is what the fetch
  // effect below actually sees, not one paint behind.
  const filtersSignature = JSON.stringify([
    debouncedSearchQuery,
    employeeFilter,
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
  const [prevFiltersSignature, setPrevFiltersSignature] = useState(filtersSignature);
  if (filtersSignature !== prevFiltersSignature) {
    setPrevFiltersSignature(filtersSignature);
    if (page !== 1) setPage(1);
    if (fullMatchingIds !== null) setFullMatchingIds(null);
  }

  useEffect(() => {
    loadTeams();
    loadEmployees();
    loadAdminEmployeeId();
    loadOnLeaveEmployees();
    loadFilterOptions();
  }, []);

  async function loadFilterOptions() {
    const [{ data: projects, error: projectsError }, { data: sources, error: sourcesError }] = await Promise.all([
      supabase.from("leads_distinct_projects").select("project").order("project"),
      supabase.from("leads_distinct_sources").select("source").order("source")
    ]);

    if (!projectsError && projects) {
      setProjectOptions(projects.map((r) => r.project).filter(Boolean));
    }
    if (!sourcesError && sources) {
      setSourceOptions(sources.map((r) => r.source).filter(Boolean));
    }
  }

  useEffect(() => {
    loadLeads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filtersSignature]);

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

  const LEADS_SELECT = `
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
      `;

  // Every filter is now a real SQL condition, applied identically here
  // and in the (usually much smaller, post-filter) full-set fetches
  // piece 2 adds for Select-All/export — one function, so the two can
  // never drift into showing/exporting different rows than what's
  // actually on screen.
  //
  // board_stage/lead_type default handling: existing rows use NULL to
  // mean "LEADS"/"LEAD" respectively (never backfilled), so selecting
  // the default option in either filter must match NULL too, not just
  // the literal string — same shape the old client-side
  // `lead.board_stage || "LEADS"` fallback used to paper over.
  //
  // Search reuses ManualBookingEntryModal.tsx's exact `.or(ilike)`
  // shape (including not bothering to escape commas/parens in the
  // term) — an already-shipped precedent in this codebase, not a new
  // pattern.
  function applyLeadFilters(query: any) {
    let q = query.eq("lead_history.is_active", true);

    if (debouncedSearchQuery) {
      q = q.or(`name.ilike.%${debouncedSearchQuery}%,mobile.ilike.%${debouncedSearchQuery}%,project.ilike.%${debouncedSearchQuery}%`);
    }

    if (employeeFilter) q = q.eq("current_owner_id", employeeFilter);
    if (projectFilter) q = q.eq("project", projectFilter);
    if (sourceFilter) q = q.eq("source", sourceFilter);

    if (boardStageFilter) {
      q = boardStageFilter === "LEADS" ? q.or("board_stage.eq.LEADS,board_stage.is.null") : q.eq("board_stage", boardStageFilter);
    }

    if (statusFilter) q = q.eq("status", statusFilter);

    if (typeFilter) {
      q = typeFilter === "LEAD" ? q.or("lead_type.eq.LEAD,lead_type.is.null") : q.eq("lead_type", typeFilter);
    }

    if (dateRangeFilter === "THIS_WEEK") {
      q = q.gte("lead_history.assigned_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
    } else if (dateRangeFilter === "THIS_MONTH") {
      q = q.gte("lead_history.assigned_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
    } else if (dateRangeFilter === "CUSTOM" && customStart && customEnd) {
      q = q
        .gte("lead_history.assigned_at", new Date(customStart).toISOString())
        .lte("lead_history.assigned_at", new Date(new Date(customEnd).getTime() + 24 * 60 * 60 * 1000 - 1).toISOString());
    }

    return q;
  }

  // Sort maps straight to .order() on the real column now instead of
  // a client-side Array.sort. "id" is always appended as a final
  // tiebreaker — without it, rows sharing the same sort value (e.g.
  // several leads assigned in the same second, or several with no
  // sla_deadline) could shuffle between adjacent pages as new rows
  // are inserted between fetches, silently duplicating or skipping a
  // row across a Next click.
  function applySort(query: any) {
    if (sortBy === "SLA_URGENCY") {
      return query.order("sla_deadline", { ascending: true, nullsFirst: false }).order("id", { ascending: true });
    }
    return query
      .order("assigned_at", { ascending: sortBy === "OLDEST", foreignTable: "lead_history" })
      .order("id", { ascending: true });
  }

  // Piece 2 — the full matching set, for Select-All-Filtered and
  // Excel/PDF/Report-Table, which genuinely need every row (not just
  // the visible page). Same .range()-loop idiom as the emergency fix
  // that started this whole rework, just scoped through
  // applyLeadFilters now instead of the unbounded whole table — safe
  // precisely because a filtered/searched set is, in the overwhelming
  // majority of real use, far smaller than the full ~2,200-100,000+
  // row table. FETCH_ALL_PAGE_SIZE matches PostgREST's own per-request
  // row cap, minimizing round-trips.
  const FETCH_ALL_PAGE_SIZE = 1000;

  async function fetchAllMatching(selectString: string): Promise<any[]> {
    let all: any[] = [];
    let from = 0;

    while (true) {
      let query = supabase.from("leads").select(selectString);
      query = applyLeadFilters(query);
      query = applySort(query);
      query = query.range(from, from + FETCH_ALL_PAGE_SIZE - 1);

      const { data, error } = await query;
      if (error || !data || data.length === 0) break;

      all = all.concat(data);

      if (data.length < FETCH_ALL_PAGE_SIZE) break;
      from += FETCH_ALL_PAGE_SIZE;
    }

    return all;
  }

  async function loadLeads() {
    setLoading(true);

    let query = supabase.from("leads").select(LEADS_SELECT, { count: "exact" });
    query = applyLeadFilters(query);
    query = applySort(query);
    query = query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

    const { data, error, count } = await query;

    if (!error && data) {
      setLeads(data);
      setTotalCount(count ?? 0);
    }

    setLoading(false);
  }

  // loadLeads now closes over page/filter state (it didn't before this
  // rework — the old version had no dependency on any component state
  // at all). handleUnjunkReassign below is deliberately stable
  // (useCallback([]) — AdminLeadCard is memo()'d, see its own 2026-09-18
  // perf comment) so it can't itself depend on loadLeads directly
  // without capturing a stale mount-time closure (page 1, no filters)
  // forever. A ref updated every render sidesteps that — the callback
  // stays stable, but always calls whichever loadLeads closure is
  // actually current.
  const loadLeadsRef = useRef(loadLeads);
  loadLeadsRef.current = loadLeads;

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
    setFullMatchingIds(null);
    loadLeadsRef.current();
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
      setFullMatchingIds(null);
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

  // Simplified (piece 1) — the full active employee roster, already
  // loaded via loadEmployees(), rather than deriving "employees who
  // currently own a lead" from whatever's on the loaded page. Arguably
  // more correct besides: an employee with zero current leads is still
  // a meaningful thing to filter by ("confirm they truly have none"),
  // and this removes a dependency on the full leads set being in
  // memory at all.
  const employeeOptions = useMemo(() => employees.filter((e) => e.is_active), [employees]);

  // Piece 3 — loaded once on mount from dedicated leads_distinct_projects/
  // leads_distinct_sources views (security_invoker=true, same convention
  // as employee_sla_breach_history/employee_advances_with_balance),
  // independent of both pagination and any filter. Real distinct-at-the-
  // database-level values (34 projects / 5 sources today) rather than
  // "whatever happens to be on the current page" — replaces piece 1's
  // deliberately-flagged-incomplete stopgap.

  // recyclingSoonFilter stays client-side by design (see the top-of-
  // file comment) — applied here, after the server has already
  // returned the current page, never sent as a query condition.
  const recyclingFilteredLeads = useMemo(() => {
    if (!recyclingSoonFilter) return leads;
    return leads.filter((lead: any) => {
      const h = lead.lead_history?.[0];
      return (
        getRecycleCutoff(
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
        ) !== null
      );
    });
  }, [leads, recyclingSoonFilter]);

  // Piece 2 — current page's selectable ids (used as-is when
  // recyclingSoonFilter is active, since that condition can't be
  // evaluated server-side — see the top-of-file comment — so the true
  // full matching set genuinely can't be known in that case; Select-
  // All stays page-scoped there, same as piece 1). Otherwise this is
  // just the fallback shown before the full set has been fetched.
  const pageSelectableIds = useMemo(
    () => recyclingFilteredLeads.filter((lead: any) => !isLeadTerminal(lead.status, lead.board_stage || "LEADS")).map((lead: any) => lead.id),
    [recyclingFilteredLeads]
  );

  const selectAllIsFullSet = !recyclingSoonFilter;
  const selectableIds = selectAllIsFullSet ? fullMatchingIds ?? pageSelectableIds : pageSelectableIds;

  // Deliberately NOT inferred from the current page alone when the
  // full set applies but hasn't been fetched yet — otherwise a page
  // that happens to be fully (individually) selected would show
  // "Deselect All Filtered" even though other pages have unselected
  // matches. Only true once fullMatchingIds is actually known.
  const allVisibleSelected = selectAllIsFullSet
    ? fullMatchingIds !== null && fullMatchingIds.length > 0 && fullMatchingIds.every((id) => selectedLeadIds.has(id))
    : pageSelectableIds.length > 0 && pageSelectableIds.every((id) => selectedLeadIds.has(id));

  // Same perf-motivated hoist as before (2026-09-18) — only now
  // rebuilt when the current PAGE's data changes, not a client-side
  // filtered view of the whole table.
  const cardLeads = useMemo(
    () =>
      recyclingFilteredLeads.map((lead: any) => ({
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
    [recyclingFilteredLeads]
  );

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // Toggle, not just "add all" — lets Admin flip a full filtered batch
  // back off in one click too. Not useCallback-wrapped: unlike
  // handleUnjunkReassign/handleReserveTeam/handleToggleSelect, this is
  // only ever used directly in this page's own JSX below, never passed
  // into memo()'d AdminLeadCard, so it doesn't need a stable identity
  // — and it needs to do an async fetch + see fresh state every call.
  //
  // Lazily fetches the full matching id list on first use (cached in
  // fullMatchingIds after), rather than eagerly on every filter change
  // — most filter changes are never followed by a Select-All click, so
  // fetching up front would waste bandwidth on ids nobody asked for.
  async function handleToggleSelectAll() {
    let ids = selectableIds;

    if (selectAllIsFullSet && fullMatchingIds === null) {
      setSelectAllFetching(true);
      try {
        const rows = await fetchAllMatching("id, status, board_stage");
        const fetchedIds = rows.filter((r: any) => !isLeadTerminal(r.status, r.board_stage || "LEADS")).map((r: any) => r.id);
        setFullMatchingIds(fetchedIds);
        ids = fetchedIds;
      } finally {
        setSelectAllFetching(false);
      }
    }

    setSelectedLeadIds((prev) => {
      const next = new Set(prev);
      const allSelected = ids.length > 0 && ids.every((id) => next.has(id));
      for (const id of ids) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  // Report-header content — Employee gets its own labeled line (per
  // spec), the other four filters bundle into one "Filters: ..."
  // line. Built from the same filter state driving the server query,
  // so the report header can never drift out of sync with what's
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

  // Piece 2 — exports the full server-side-filtered set via
  // fetchAllMatching, not just the current page. recyclingSoonFilter
  // is the one exception (same reasoning as Select-All above): it's
  // client-only, so there's no server-side "full matching set" to
  // fetch when it's active — export falls back to the already-visible,
  // already-client-filtered current page in that case (also a real
  // fix over piece 1, which exported `leads` directly there, ignoring
  // this toggle entirely). Both exceljs and jspdf are dynamically
  // imported inside lib/exportLeadsReport.ts, so their weight only
  // loads once one of these is actually clicked.
  const exportIsEmpty = recyclingSoonFilter ? recyclingFilteredLeads.length === 0 : totalCount === 0;

  async function handleExport(format: "excel" | "pdf") {
    if (exportIsEmpty || exporting) return;

    setExporting(true);
    try {
      const rows = recyclingSoonFilter ? recyclingFilteredLeads : await fetchAllMatching(LEADS_SELECT);
      if (rows.length === 0) {
        toast.error("No leads match these filters.");
        return;
      }
      if (format === "excel") {
        await exportLeadsToExcel(rows, reportMeta);
      } else {
        await exportLeadsToPDF(rows, reportMeta);
      }
    } catch (err) {
      console.error(err);
      toast.error("Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  // Same full-set-vs-recyclingSoonFilter split as export, for the
  // Report Table preview — fetched once on toggle-open (not kept in
  // sync live while open; toggling off and back on refetches).
  const [previewRows, setPreviewRows] = useState<any[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  async function handleTogglePreview() {
    if (showPreviewTable) {
      setShowPreviewTable(false);
      setPreviewRows(null);
      return;
    }

    setShowPreviewTable(true);
    if (recyclingSoonFilter) {
      setPreviewRows(recyclingFilteredLeads);
      return;
    }

    setPreviewLoading(true);
    try {
      const rows = await fetchAllMatching(LEADS_SELECT);
      setPreviewRows(rows);
    } finally {
      setPreviewLoading(false);
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
              {recyclingSoonFilter
                ? `Every lead, across every employee — ${cardLeads.length} matching on this page (Recycling Soon total isn't server-computed)`
                : `Every lead, across every employee — ${totalCount} matching`}
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
              onClick={handleTogglePreview}
              disabled={exportIsEmpty || previewLoading}
              className={`flex items-center gap-1.5 h-10 px-3 rounded-lg text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed transition ${
                showPreviewTable ? "bg-blue-600 text-white" : "bg-blue-50 text-blue-700 hover:bg-blue-100"
              }`}
            >
              <Table2 size={14} />
              {previewLoading ? "Loading..." : showPreviewTable ? "Hide Table" : `View Report${recyclingSoonFilter ? " (Page)" : ""}`}
            </button>

            <button
              onClick={() => handleExport("excel")}
              disabled={exportIsEmpty || exporting}
              className="flex items-center gap-1.5 h-10 px-3 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-emerald-100 transition"
            >
              <FileSpreadsheet size={14} />
              {exporting ? "Exporting..." : `Excel${recyclingSoonFilter ? " (Page)" : ""}`}
            </button>

            <button
              onClick={() => handleExport("pdf")}
              disabled={exportIsEmpty || exporting}
              className="flex items-center gap-1.5 h-10 px-3 rounded-lg bg-red-50 text-red-700 text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-red-100 transition"
            >
              <FileText size={14} />
              {exporting ? "Exporting..." : `PDF${recyclingSoonFilter ? " (Page)" : ""}`}
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

      {showPreviewTable && previewRows && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-[24px] border border-slate-100 shadow-md p-6"
        >
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-bold mb-3">
            Report Table{recyclingSoonFilter ? " (This Page)" : ""} — {previewRows.length} lead{previewRows.length === 1 ? "" : "s"}
          </p>
          <ExportPreviewTable leads={previewRows} />
        </motion.div>
      )}

      {loading ? (
        <div className="text-center text-sm text-slate-400 py-10">Loading leads...</div>
      ) : cardLeads.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="text-5xl mb-3">🎯</div>
          <h2 className="text-lg font-semibold text-gray-700">No leads match these filters</h2>
        </div>
      ) : (
        <>
          {(selectAllIsFullSet ? totalCount > 0 : pageSelectableIds.length > 0) && (
            <div className="flex items-center justify-between">
              <button
                onClick={handleToggleSelectAll}
                disabled={selectAllFetching}
                className="text-xs font-bold text-blue-700 hover:text-blue-900 disabled:opacity-50 disabled:cursor-wait"
              >
                {selectAllFetching
                  ? "Fetching all matching leads..."
                  : allVisibleSelected
                    ? `Deselect All${selectAllIsFullSet ? " Filtered" : " (This Page)"} (${selectableIds.length})`
                    : selectAllIsFullSet
                      ? `Select All Filtered (${totalCount})`
                      : `Select All (This Page) (${pageSelectableIds.length})`}
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {cardLeads.map((cardLead, index) => (
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
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1 || loading}
                className="h-9 px-4 rounded-lg text-xs font-bold bg-white border border-slate-200 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition"
              >
                Previous
              </button>
              <span className="text-xs font-semibold text-slate-500">
                Page {page} of {totalPages} — showing{" "}
                {(page - 1) * PAGE_SIZE + 1}
                {"–"}
                {Math.min(page * PAGE_SIZE, totalCount)} of {totalCount}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages || loading}
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
