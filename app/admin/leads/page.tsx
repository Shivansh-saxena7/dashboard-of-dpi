"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Search, ChevronDown, Target, FileSpreadsheet, FileText, Upload, Table2 } from "lucide-react";
import Link from "next/link";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";
import AdminLeadCard from "@/components/AdminLeadCard";
import ExportPreviewTable from "@/components/ExportPreviewTable";
import { LEAD_STATUS_DISPLAY } from "@/lib/leadStatusDisplay";
import { BOARD_STAGES } from "@/lib/leadBoardStageDisplay";
import { exportLeadsToExcel, exportLeadsToPDF } from "@/lib/exportLeadsReport";
import { DateRangeOption, isWithinDateRange, dateRangeFilterLabel } from "@/lib/dateRangeFilter";

type SortOption = "NEWEST" | "OLDEST" | "SLA_URGENCY";

const ALL_STATUSES = Object.keys(LEAD_STATUS_DISPLAY);

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
  const [adminEmployeeId, setAdminEmployeeId] = useState<string | null>(null);
  const [showPreviewTable, setShowPreviewTable] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [boardStageFilter, setBoardStageFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [dateRangeFilter, setDateRangeFilter] = useState<DateRangeOption>("ALL");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("NEWEST");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    loadLeads();
    loadTeams();
    loadAdminEmployeeId();
  }, []);

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
          last_activity_at, paused_until, pause_reason, pause_note,
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
  async function handleReserveTeam(leadId: string, teamId: string | null) {
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
  }

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
    typeFilter,
    dateRangeFilter,
    customStart,
    customEnd,
    sortBy
  ]);

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

        <div className="relative flex items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">Leads</h1>
            <p className="mt-2 text-white/80 text-sm">
              Every lead, across every employee — {leads.length} total
            </p>
          </div>

          <Link
            href="/admin/leads/import"
            className="shrink-0 flex items-center gap-1.5 h-10 px-4 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-sm font-semibold transition"
          >
            <Upload size={14} />
            Import CSV
          </Link>
        </div>
      </motion.div>

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

          <FilterSelect value={sortBy} onChange={(e) => setSortBy(e.target.value as SortOption)} className="sm:ml-auto">
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
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visibleLeads.map((lead: any, index: number) => (
            <AdminLeadCard
              key={lead.id}
              index={index}
              teams={teams}
              onReserveTeam={handleReserveTeam}
              lead={{
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
                assignedAt: lead.lead_history?.[0]?.assigned_at ?? null,
                pendingTeamId: lead.pending_team_id ?? null,
                pendingTeamName: lead.pending_team?.name ?? null,
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
  );
}
