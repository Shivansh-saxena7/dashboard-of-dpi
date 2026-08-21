"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Search, ChevronDown } from "lucide-react";
import { supabase } from "@/lib/supabase";
import LeadCard from "./LeadCard";
import LeadDetailModal from "./LeadDetailModal";
import SLABreachHistoryCard from "./SLABreachHistoryCard";
import { LeadStatus, EMPLOYEE_SELECTABLE_STATUSES } from "@/lib/getValidNextLeadStatuses";
import { LEAD_STATUS_DISPLAY } from "@/lib/leadStatusDisplay";
import { BOARD_STAGES, BoardStage } from "@/lib/leadBoardStageDisplay";

interface LeadListProps {
  employeeId: string;
}

type ActiveTab = BoardStage | "HISTORY";
type SortOption = "NEWEST" | "OLDEST" | "SLA_URGENCY";
type DateRangeOption = "ALL" | "THIS_WEEK" | "THIS_MONTH" | "CUSTOM";

const SLA_RECHECK_INTERVAL_MS = 30000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

// Custom-styled wrapper around a native <select> — appearance-none +
// an overlaid chevron, rather than a fully custom listbox. Native
// <select> still opens the OS picker on mobile (the best mobile
// filter UX there is), this just strips the default flat browser
// chrome so it matches the rest of the design system.
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
        className="appearance-none w-full h-11 sm:h-10 rounded-xl bg-white border border-slate-200 pl-3 pr-8 text-xs font-semibold text-slate-600 outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-300 transition"
      >
        {children}
      </select>
      <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
    </div>
  );
}

// Employee-facing lead list — "Always shows New" is enforced simply
// by what this query does NOT touch: it never selects from
// lead_history beyond the caller's own single active row (via
// !inner + is_active=true), never exposes recycle_count to any
// visual element, and never joins lead_notes from a prior owner
// (impossible anyway — lead_notes RLS only returns each employee's
// own authored rows). There is no "recycled" badge to accidentally
// render because the query simply has no path to that data.
//
// .eq("lead_type", "LEAD") is what keeps Data (see app/data/page.tsx
// + components/DataList.tsx, its own separate view) from leaking in
// here — this board's SLA countdown/board-stage UI would be actively
// confusing on a Data row, which has neither.
//
// The 5th tab (History) is a different data source entirely —
// employee_sla_breach_history (a security_invoker view over
// lead_history) rather than `leads`. The view's name still says
// "sla_breach" (renaming the DB object was judged riskier than the
// value it'd add — grants/security_invoker would need to be
// re-verified for no real benefit), but its WHERE clause now covers
// every ended_reason, not just SLA_BREACHED, so the tab itself
// covers any way a lead has left this employee's hands (SLA
// recycling or a Team Leader's manual reassignment). It's
// deliberately queried with NO employee_id filter here: the view's
// own RLS passthrough is what scopes it to "my rows only," not app
// code. Adding a redundant .eq("employee_id", ...) here would blur
// that — the guarantee lives entirely in the database, and the
// query is written to make that visible rather than implying app
// code is doing the real work.
//
// Search/filter/sort apply uniformly across the 4 board tabs (the
// Lead Board spec named Follow-up/Visit/Booking specifically, but
// one reusable bar is simpler than three separate ones and strictly
// more capable, never less, for the Leads tab too) — they're hidden
// entirely on the History tab, since there's no project/source/
// name on that data to filter or search by.
//
// Mobile-first throughout (~95% of real usage): tabs scroll
// horizontally, filters collapse to a 2-column grid below `sm`
// rather than wrapping unpredictably, every tap target is
// comfortably sized.
export default function LeadList({ employeeId }: LeadListProps) {

  const [leads, setLeads] = useState<any[]>([]);
  const [slaBreachHistory, setSlaBreachHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(new Date());
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<ActiveTab>("LEADS");
  const [searchQuery, setSearchQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateRangeFilter, setDateRangeFilter] = useState<DateRangeOption>("ALL");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("NEWEST");

  useEffect(() => {
    loadLeads();
    loadSlaBreachHistory();
  }, [employeeId]);

  // Realtime — same proven pattern already used by Header.tsx
  // (notification bell) and SessionGuard.tsx (live deactivation),
  // extended here so this screen itself live-updates too: a new
  // assignment, a Coordinator's Verify/Deny, a recycle-away, a Snooze
  // lapsing — none of these should need a manual page refresh to
  // show up. Two tables are watched (not just `leads`) because a
  // Coordinator's Verify/Deny writes to `lead_history` (paused_until,
  // pause_reason, pause_verified_by) without necessarily touching
  // `leads` beyond board_stage — either table changing means this
  // employee's view is stale. A full refetch (not a partial-payload
  // patch) is deliberate: the realtime payload is the raw changed
  // row only, missing the joins (assigned_by name, etc.) the list
  // actually renders — same reasoning recycle-stale-leads and every
  // other consumer of this data already has to re-derive it via a
  // real query, not reconstruct it from a bare row.
  useEffect(() => {
    if (!employeeId) return;

    let cancelled = false;

    const existing = supabase.getChannels().find((ch) => ch.topic === `realtime:lead-list-${employeeId}`);
    if (existing) {
      supabase.removeChannel(existing);
    }

    const channel = supabase
      .channel(`lead-list-${employeeId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "leads", filter: `current_owner_id=eq.${employeeId}` },
        () => {
          if (cancelled) return;
          loadLeads();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "lead_history", filter: `employee_id=eq.${employeeId}` },
        () => {
          if (cancelled) return;
          loadLeads();
          loadSlaBreachHistory();
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [employeeId]);

  // Single shared clock for all cards' SLA countdowns, rather than
  // each LeadCard running its own interval.
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), SLA_RECHECK_INTERVAL_MS);
    return () => clearInterval(interval);
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
        catcher_name,
        status,
        priority,
        board_stage,
        sla_deadline,
        recycle_count,
        created_at,
        lead_history!inner (
          id,
          call_count,
          outcome_at,
          assigned_at,
          first_call_at,
          first_whatsapp_at,
          assigned_by_type,
          reassign_note,
          last_activity_at,
          paused_until,
          pause_reason,
          pause_note,
          pause_verified_at,
          assigned_by:employees!lead_history_assigned_by_employee_id_fkey(name),
          pause_verified_by:employees!lead_history_pause_verified_by_fkey(name)
        )
      `
      )
      .eq("current_owner_id", employeeId)
      .eq("lead_type", "LEAD")
      .eq("lead_history.employee_id", employeeId)
      .eq("lead_history.is_active", true)
      .order("created_at", { ascending: false });

    if (!error && data) {
      setLeads(data);
    }

    setLoading(false);
  }

  async function loadSlaBreachHistory() {
    // Explicit employee_id filter — the view itself has none, and for
    // a team_leader, lead_history's RLS scope is "my whole team," not
    // "just me" (lead_history_team_leader_select), so without this the
    // view silently widens to the team for a team_leader session and
    // this "my own History" tab leaks teammates' ended rows in with
    // blank name/project (lead_project_source's own, stricter
    // ownership check then correctly refuses to reveal a lead the
    // viewer never personally owned).
    const { data, error } = await supabase
      .from("employee_sla_breach_history")
      .select("lead_history_id, assigned_at, ended_reason, reassign_note, project, source, name, mobile_last4")
      .eq("employee_id", employeeId)
      .order("assigned_at", { ascending: false });

    if (!error && data) {
      setSlaBreachHistory(data);
    }
  }

  // Optimistic local patch after a successful log_lead_update_atomic
  // call — no full refetch needed, since the RPC already tells us
  // exactly what changed.
  function handleLeadUpdated(leadId: string, updates: { status?: LeadStatus; callCount: number }) {
    setLeads((prev) =>
      prev.map((lead) => {
        if (lead.id !== leadId) return lead;

        const currentHistory = lead.lead_history[0] ?? {};

        return {
          ...lead,
          status: updates.status ?? lead.status,
          lead_history: [
            {
              ...currentHistory,
              call_count: updates.callCount,
              outcome_at: updates.status ? new Date().toISOString() : currentHistory.outcome_at
            }
          ]
        };
      })
    );
  }

  // Same optimistic-patch idea for board moves. Booking also flips
  // status to CONVERTED locally (log_booking_atomic does this
  // server-side too), so the status badge/terminal-state UI updates
  // immediately without a refetch.
  function handleBoardStageChanged(leadId: string, boardStage: BoardStage) {
    setLeads((prev) =>
      prev.map((lead) =>
        lead.id === leadId
          ? {
              ...lead,
              board_stage: boardStage,
              status: boardStage === "BOOKING" ? "CONVERTED" : lead.status
            }
          : lead
      )
    );
  }

  // Optimistic local patch after a successful snooze_lead_atomic /
  // cancel_snooze_atomic call — same idea as handleLeadUpdated/
  // handleBoardStageChanged, no full refetch needed since the caller
  // already knows exactly what changed.
  function handlePauseChanged(
    leadId: string,
    pause: { pausedUntil: string | null; pauseReason: string | null; pauseNote: string | null }
  ) {
    setLeads((prev) =>
      prev.map((lead) => {
        if (lead.id !== leadId) return lead;

        const currentHistory = lead.lead_history[0] ?? {};

        return {
          ...lead,
          lead_history: [
            {
              ...currentHistory,
              paused_until: pause.pausedUntil,
              pause_reason: pause.pauseReason,
              pause_note: pause.pauseNote,
              // Both callers (snooze_lead_atomic / cancel_snooze_atomic)
              // always result in a state with no verify-stamp — a fresh
              // Snooze clears it server-side, cancelling clears the
              // pause entirely. Kept in sync here so a stale VISIT_LOCK
              // verifier name never lingers into a new pause state.
              pause_verified_by: null,
              pause_verified_at: null
            }
          ]
        };
      })
    );
  }

  const tabCounts = useMemo(() => {
    const counts: Record<BoardStage, number> = { LEADS: 0, FOLLOW_UP: 0, VISIT: 0, BOOKING: 0 };

    leads.forEach((lead) => {
      const stage = (lead.board_stage as BoardStage) || "LEADS";
      counts[stage] = (counts[stage] || 0) + 1;
    });

    return counts;
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

    if (activeTab === "HISTORY") {
      return [];
    }

    let result = leads.filter((lead) => (lead.board_stage || "LEADS") === activeTab);

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (lead) =>
          lead.name?.toLowerCase().includes(q) ||
          lead.mobile?.toLowerCase().includes(q) ||
          lead.project?.toLowerCase().includes(q)
      );
    }

    if (projectFilter) {
      result = result.filter((lead) => lead.project === projectFilter);
    }

    if (sourceFilter) {
      result = result.filter((lead) => lead.source === sourceFilter);
    }

    if (statusFilter) {
      result = result.filter((lead) => lead.status === statusFilter);
    }

    // This Week / This Month are simple rolling windows (last 7 / 30
    // days from now), not calendar-week/month boundaries — a
    // deliberate simplification, not a calendar-aware filter.
    if (dateRangeFilter !== "ALL") {
      const nowMs = Date.now();

      result = result.filter((lead) => {
        const assignedAt = lead.lead_history[0]?.assigned_at;

        if (!assignedAt) return false;

        const assignedMs = new Date(assignedAt).getTime();

        if (dateRangeFilter === "THIS_WEEK") {
          return nowMs - assignedMs <= WEEK_MS;
        }

        if (dateRangeFilter === "THIS_MONTH") {
          return nowMs - assignedMs <= MONTH_MS;
        }

        if (dateRangeFilter === "CUSTOM" && customStart && customEnd) {
          const startMs = new Date(customStart).getTime();
          const endMs = new Date(customEnd).getTime() + 24 * 60 * 60 * 1000 - 1;
          return assignedMs >= startMs && assignedMs <= endMs;
        }

        return true;
      });
    }

    result = [...result].sort((a, b) => {

      if (sortBy === "SLA_URGENCY") {
        const aDeadline = a.sla_deadline ? new Date(a.sla_deadline).getTime() : Infinity;
        const bDeadline = b.sla_deadline ? new Date(b.sla_deadline).getTime() : Infinity;
        return aDeadline - bDeadline;
      }

      const aAssigned = new Date(a.lead_history[0]?.assigned_at || a.created_at).getTime();
      const bAssigned = new Date(b.lead_history[0]?.assigned_at || b.created_at).getTime();

      return sortBy === "OLDEST" ? aAssigned - bAssigned : bAssigned - aAssigned;
    });

    return result;

  }, [leads, activeTab, searchQuery, projectFilter, sourceFilter, statusFilter, dateRangeFilter, customStart, customEnd, sortBy]);

  if (loading) {
    return (
      <div className="mx-4 mt-6 text-center text-sm text-slate-400">
        Loading your leads...
      </div>
    );
  }

  const selectedLead = leads.find((lead) => lead.id === selectedLeadId);
  const onHistoryTab = activeTab === "HISTORY";

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mx-4 mt-4 flex gap-2 overflow-x-auto pb-1"
      >
        {BOARD_STAGES.map((tab) => {
          const active = activeTab === tab.stage;

          return (
            <button
              key={tab.stage}
              onClick={() => setActiveTab(tab.stage)}
              className={`flex items-center gap-1.5 shrink-0 px-3.5 py-2.5 sm:py-2 rounded-xl text-sm font-bold transition ${
                active
                  ? "bg-gradient-to-r from-yellow-400 to-amber-500 text-slate-900 shadow-[0_4px_12px_rgba(217,119,6,0.3)]"
                  : "bg-white text-slate-600 border border-slate-200"
              }`}
            >
              <span>{tab.emoji}</span>
              {tab.label}
              <span
                className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${
                  active ? "bg-black/10 text-slate-900" : "bg-slate-100 text-slate-500"
                }`}
              >
                {tabCounts[tab.stage]}
              </span>
            </button>
          );
        })}

        <button
          onClick={() => setActiveTab("HISTORY")}
          className={`flex items-center gap-1.5 shrink-0 px-3.5 py-2.5 sm:py-2 rounded-xl text-sm font-bold transition ${
            onHistoryTab
              ? "bg-gradient-to-r from-slate-600 to-slate-800 text-white shadow-[0_4px_12px_rgba(30,41,59,0.3)]"
              : "bg-white text-slate-600 border border-slate-200"
          }`}
        >
          <span>📋</span>
          History
          <span
            className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${
              onHistoryTab ? "bg-white/20" : "bg-slate-100 text-slate-500"
            }`}
          >
            {slaBreachHistory.length}
          </span>
        </button>
      </motion.div>

      {!onHistoryTab && (
        <>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.05 }}
            className="mx-4 mt-3 relative"
          >
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search name, mobile, or project..."
              className="w-full h-12 rounded-2xl bg-white border border-slate-200 pl-10 pr-3 text-sm outline-none shadow-[0_2px_10px_rgba(15,23,42,0.04)] focus:ring-2 focus:ring-amber-200 focus:border-amber-300 transition"
            />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="mx-4 mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap"
          >
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

            <FilterSelect value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All Statuses</option>
              {EMPLOYEE_SELECTABLE_STATUSES.map((status) => (
                <option key={status} value={status}>{LEAD_STATUS_DISPLAY[status].label}</option>
              ))}
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

            {dateRangeFilter === "CUSTOM" && (
              <div className="col-span-2 flex gap-2">
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="flex-1 h-11 sm:h-10 rounded-xl bg-white border border-slate-200 px-3 text-xs text-slate-600 outline-none appearance-none"
                />
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="flex-1 h-11 sm:h-10 rounded-xl bg-white border border-slate-200 px-3 text-xs text-slate-600 outline-none appearance-none"
                />
              </div>
            )}
          </motion.div>
        </>
      )}

      {onHistoryTab ? (
        slaBreachHistory.length === 0 ? (
          <div className="flex flex-col items-center justify-center mt-16 text-center px-4">
            <div className="text-5xl mb-3">📋</div>
            <h2 className="text-lg font-semibold text-gray-700">No history yet</h2>
            <p className="text-sm text-gray-500 mt-1">
              Leads that get reassigned away from you (by SLA breach or a Team Leader) will show up here.
            </p>
          </div>
        ) : (
          <div className="mx-4 mt-4 space-y-3 pb-6">
            {slaBreachHistory.map((entry: any, index: number) => (
              <SLABreachHistoryCard key={entry.lead_history_id} entry={entry} index={index} />
            ))}
          </div>
        )
      ) : visibleLeads.length === 0 ? (
        <div className="flex flex-col items-center justify-center mt-16 text-center px-4">
          <div className="text-5xl mb-3">
            {BOARD_STAGES.find((t) => t.stage === activeTab)?.emoji || "📋"}
          </div>
          <h2 className="text-lg font-semibold text-gray-700">No leads here</h2>
          <p className="text-sm text-gray-500 mt-1">
            {activeTab === "LEADS"
              ? "New leads assigned to you will show up here."
              : "Move leads here from the Lead Detail screen as you work them."}
          </p>
        </div>
      ) : (
        <div className="mx-4 mt-4 space-y-3 pb-6">
          {visibleLeads.map((lead: any, index: number) => (
            <LeadCard
              key={lead.id}
              now={now}
              index={index}
              onOpen={() => setSelectedLeadId(lead.id)}
              lead={{
                id: lead.id,
                leadHistoryId: lead.lead_history[0]?.id,
                name: lead.name,
                mobile: lead.mobile,
                project: lead.project,
                source: lead.source,
                catcher_name: lead.catcher_name,
                status: lead.status,
                priority: lead.priority,
                board_stage: lead.board_stage,
                sla_deadline: lead.sla_deadline,
                recycle_count: lead.recycle_count,
                call_count: lead.lead_history[0]?.call_count ?? 0,
                outcome_at: lead.lead_history[0]?.outcome_at ?? null,
                assigned_at: lead.lead_history[0]?.assigned_at ?? null,
                assigned_by_type: lead.lead_history[0]?.assigned_by_type ?? null,
                assigned_by: lead.lead_history[0]?.assigned_by ?? null,
                reassign_note: lead.lead_history[0]?.reassign_note ?? null,
                last_activity_at: lead.lead_history[0]?.last_activity_at ?? null,
                paused_until: lead.lead_history[0]?.paused_until ?? null,
                pause_reason: lead.lead_history[0]?.pause_reason ?? null
              }}
            />
          ))}
        </div>
      )}

      {selectedLead && (
        <LeadDetailModal
          lead={{
            id: selectedLead.id,
            leadHistoryId: selectedLead.lead_history[0]?.id,
            name: selectedLead.name,
            mobile: selectedLead.mobile,
            project: selectedLead.project,
            catcherName: selectedLead.catcher_name ?? null,
            status: selectedLead.status,
            callCount: selectedLead.lead_history[0]?.call_count ?? 0,
            boardStage: (selectedLead.board_stage as BoardStage) || "LEADS",
            assignedByType: selectedLead.lead_history[0]?.assigned_by_type ?? null,
            assignedBy: selectedLead.lead_history[0]?.assigned_by ?? null,
            reassignNote: selectedLead.lead_history[0]?.reassign_note ?? null,
            pausedUntil: selectedLead.lead_history[0]?.paused_until ?? null,
            pauseReason: selectedLead.lead_history[0]?.pause_reason ?? null,
            pauseNote: selectedLead.lead_history[0]?.pause_note ?? null,
            pauseVerifiedByName: selectedLead.lead_history[0]?.pause_verified_by?.name ?? null,
            pauseVerifiedAt: selectedLead.lead_history[0]?.pause_verified_at ?? null
          }}
          onClose={() => setSelectedLeadId(null)}
          onUpdated={(updates) => handleLeadUpdated(selectedLead.id, updates)}
          onBoardStageChanged={(stage) => handleBoardStageChanged(selectedLead.id, stage)}
          onPauseChanged={(pause) => handlePauseChanged(selectedLead.id, pause)}
        />
      )}
    </>
  );
}
