"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Search, ChevronDown, Target } from "lucide-react";
import { supabase } from "@/lib/supabase";
import AdminLeadCard from "@/components/AdminLeadCard";
import { LEAD_STATUS_DISPLAY } from "@/lib/leadStatusDisplay";
import { BOARD_STAGES } from "@/lib/leadBoardStageDisplay";

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

  const [searchQuery, setSearchQuery] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [boardStageFilter, setBoardStageFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("NEWEST");

  useEffect(() => {
    loadLeads();
  }, []);

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
        employees ( name ),
        lead_history ( assigned_at, is_active )
      `
      )
      .eq("lead_history.is_active", true)
      .order("created_at", { ascending: false });

    if (!error && data) {
      setLeads(data);
    }

    setLoading(false);
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

  }, [leads, searchQuery, employeeFilter, projectFilter, sourceFilter, boardStageFilter, statusFilter, sortBy]);

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-[24px] bg-gradient-to-br from-[#0f172a] via-[#1d4ed8] to-[#06b6d4] p-6 text-white shadow-[0_15px_50px_rgba(37,99,235,0.2)]"
      >
        <div className="absolute top-[-60px] right-[-60px] w-[150px] h-[150px] rounded-full bg-white/10 blur-3xl" />
        <Target size={140} strokeWidth={1} className="absolute -bottom-8 -right-4 text-white/10 pointer-events-none" />

        <h1 className="text-3xl font-bold">Leads</h1>
        <p className="mt-2 text-white/80 text-sm">
          Every lead, across every employee — {leads.length} total
        </p>
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

          <FilterSelect value={sortBy} onChange={(e) => setSortBy(e.target.value as SortOption)} className="sm:ml-auto">
            <option value="NEWEST">Newest First</option>
            <option value="OLDEST">Oldest First</option>
            <option value="SLA_URGENCY">SLA Urgency</option>
          </FilterSelect>
        </div>
      </motion.div>

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
                assignedAt: lead.lead_history?.[0]?.assigned_at ?? null
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
