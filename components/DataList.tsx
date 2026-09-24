"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Search, ChevronDown } from "lucide-react";
import { supabase } from "@/lib/supabase";
import DataCard from "./DataCard";
import DataDetailModal from "./DataDetailModal";
import { LeadStatus } from "@/lib/getValidNextLeadStatuses";
import { BOARD_STAGES, BoardStage } from "@/lib/leadBoardStageDisplay";
import { consumeRecentlyCalledCardId, scrollToAndHighlightCard } from "@/lib/lastCalledLead";
import { normalizeMobile } from "@/lib/normalizeMobile";

interface DataListProps {
  employeeId: string;
}

type SortOption = "NEWEST" | "OLDEST";
type DateRangeOption = "ALL" | "THIS_WEEK" | "THIS_MONTH" | "CUSTOM";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

// Same stripped-native-<select> wrapper as LeadList.tsx's own
// FilterSelect — duplicated rather than shared/extracted for now
// (small, stateless, zero-risk to touch either file independently;
// not worth coupling two already-working screens together just to
// dedupe ~15 lines).
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

// Employee-facing Data view. Previously a flat, unfiltered list with
// no search/sort at all — added Search/Source/Date-range/Sort here to
// match LeadList.tsx's filter bar (Point 3, 2026-08-19 live-production
// review). Deliberately NOT a Project filter: a live check found 0 of
// 341 current DATA rows have `project` populated (100% have `source`)
// — a Project dropdown here would just be a permanently-empty no-op
// control, so it's left out. Board-stage tabs added 2026-09-16 (bug
// fix — DataDetailModal's Move-to-Follow-up/Visit/Booking already
// worked server-side, this list just never grew the tabs to show it).
// Still no SLA-Urgency sort (Data has no SLA deadline).
//
// `.eq("lead_type", "DATA")` here is the other half of the fix that
// also went into LeadList.tsx (`.eq("lead_type", "LEAD")` there) —
// together the two queries partition an employee's current_owner_id
// leads cleanly, with no overlap and no gap between the two tabs.
export default function DataList({ employeeId }: DataListProps) {

  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Board-stage tabs (2026-09-16 bug fix) — DataDetailModal's Move-to-
  // Follow-up/Visit/Booking actions genuinely worked server-side all
  // along (verified live: board_stage really does update in the DB),
  // but this list never got the corresponding tabs to show a moved
  // lead anywhere — it shipped later than the "no workflow yet" state
  // this file's own top comment still described, and this side was
  // never completed to match. Mirrors LeadList.tsx's identical tabs
  // exactly (same BOARD_STAGES, same filter-first-in-visibleLeads
  // shape) — no History tab, Data has no SLA-breach concept.
  const [activeTab, setActiveTab] = useState<BoardStage>("LEADS");

  const [searchQuery, setSearchQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [dateRangeFilter, setDateRangeFilter] = useState<DateRangeOption>("ALL");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("NEWEST");

  useEffect(() => {
    loadLeads();
  }, [employeeId]);

  // Scroll-to-called-lead (2026-09-16) — same as LeadList.tsx's own,
  // see lib/lastCalledLead.ts for why. Fires once the list has
  // actually rendered (loading -> false).
  useEffect(() => {
    if (loading) return;
    const id = consumeRecentlyCalledCardId();
    if (id) scrollToAndHighlightCard(`data-card-${id}`);
  }, [loading]);

  // Notification-Call-Action "View Lead" (2026-09-23) — same shape as
  // LeadList.tsx's own identical effect (DATA_ASSIGNED notifications
  // route here via /data?openLead=..., LEAD_* types route to /leads).
  useEffect(() => {
    if (loading) return;
    const openLeadId = searchParams.get("openLead");
    if (openLeadId) {
      setSelectedLeadId(openLeadId);
      router.replace("/data");
    }
  }, [loading, searchParams, router]);

  async function loadLeads() {
    setLoading(true);

    const { data, error } = await supabase
      .from("leads")
      .select(
        `
        id,
        name,
        mobile,
        source,
        status,
        board_stage,
        created_at,
        lead_history!inner (
          id,
          call_count,
          assigned_at
        )
      `
      )
      .eq("current_owner_id", employeeId)
      .eq("lead_type", "DATA")
      .eq("lead_history.employee_id", employeeId)
      .eq("lead_history.is_active", true)
      .order("created_at", { ascending: false });

    if (!error && data) {
      setLeads(data);
    }

    setLoading(false);
  }

  const sourceOptions = useMemo(
    () => Array.from(new Set(leads.map((l) => l.source).filter(Boolean))) as string[],
    [leads]
  );

  // Same filter/sort shape as LeadList.tsx's visibleLeads: search on
  // name/mobile (no project — Data rows don't carry one), optional
  // Source filter, a rolling-window Date-range against assigned_at
  // (This Week/This Month are the last 7/30 days, not calendar
  // boundaries — same simplification LeadList already makes), then
  // sort. No SLA-Urgency option here — Data has no sla_deadline.
  const tabCounts = useMemo(() => {
    const counts: Record<BoardStage, number> = { LEADS: 0, FOLLOW_UP: 0, VISIT: 0, BOOKING: 0 };
    leads.forEach((lead) => {
      const stage = (lead.board_stage as BoardStage) || "LEADS";
      counts[stage] = (counts[stage] || 0) + 1;
    });
    return counts;
  }, [leads]);

  const visibleLeads = useMemo(() => {

    // Same fix as LeadList.tsx (2026-09-21) — search runs across ALL
    // of this employee's own Data leads, not just the active
    // board-stage tab, so a lead that's progressed to a later stage
    // is still findable from the default tab. Empty-search tab
    // browsing is unchanged.
    let result = searchQuery.trim() ? leads : leads.filter((lead) => (lead.board_stage || "LEADS") === activeTab);

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      // Same mobile-format-mismatch fix as LeadList.tsx (2026-09-24) —
      // see that file's own comment for the full root-cause writeup.
      const qDigits = normalizeMobile(q);
      result = result.filter(
        (lead) =>
          lead.name?.toLowerCase().includes(q) ||
          lead.mobile?.toLowerCase().includes(q) ||
          (qDigits.length > 0 && normalizeMobile(lead.mobile).includes(qDigits))
      );
    }

    if (sourceFilter) {
      result = result.filter((lead) => lead.source === sourceFilter);
    }

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
      const aAssigned = new Date(a.lead_history[0]?.assigned_at || a.created_at).getTime();
      const bAssigned = new Date(b.lead_history[0]?.assigned_at || b.created_at).getTime();
      return sortBy === "OLDEST" ? aAssigned - bAssigned : bAssigned - aAssigned;
    });

    return result;

  }, [leads, activeTab, searchQuery, sourceFilter, dateRangeFilter, customStart, customEnd, sortBy]);

  // Same fix as LeadList.tsx/app/admin/leads/page.tsx (2026-09-18 perf
  // audit) — DataCard had NO re-render protection at all before this
  // (not even a memo() to defeat), so every DataList state change
  // (search, filter, tab switch) re-rendered every visible card
  // unconditionally. Now paired with DataCard's new memo() wrap: a
  // stable per-card lead object here plus a stable onOpen callback
  // below means an unrelated state change no longer touches cards
  // whose own data hasn't changed.
  const cardLeads = useMemo(
    () =>
      visibleLeads.map((lead: any) => ({
        id: lead.id,
        leadHistoryId: lead.lead_history[0]?.id,
        name: lead.name,
        mobile: lead.mobile,
        source: lead.source,
        status: lead.status,
        board_stage: lead.board_stage,
        call_count: lead.lead_history[0]?.call_count ?? 0
      })),
    [visibleLeads]
  );

  const handleOpenLead = useCallback((id: string) => setSelectedLeadId(id), []);

  // Optimistic local patch after a successful log_lead_update_atomic
  // call — same idea as LeadList's handleLeadUpdated, no full refetch
  // needed since the RPC already tells us exactly what changed.
  function handleLeadUpdated(leadId: string, updates: { status?: LeadStatus; callCount: number }) {
    setLeads((prev) =>
      prev.map((lead) => {
        if (lead.id !== leadId) return lead;

        const currentHistory = lead.lead_history[0] ?? {};

        return {
          ...lead,
          status: updates.status ?? lead.status,
          lead_history: [{ ...currentHistory, call_count: updates.callCount }]
        };
      })
    );
  }

  // Same idea as LeadList's handleBoardStageChanged. Booking also
  // flips status to CONVERTED locally (log_booking_atomic does this
  // server-side too), matching LeadList's identical handler.
  function handleBoardStageChanged(leadId: string, boardStage: BoardStage) {
    setLeads((prev) =>
      prev.map((lead) =>
        lead.id === leadId
          ? { ...lead, board_stage: boardStage, status: boardStage === "BOOKING" ? "CONVERTED" : lead.status }
          : lead
      )
    );
  }

  if (loading) {
    return (
      <div className="mx-4 mt-6 text-center text-sm text-slate-400">
        Loading your Data...
      </div>
    );
  }

  const selectedLead = leads.find((lead) => lead.id === selectedLeadId);

  return (
    <>
      {leads.length === 0 ? (
        <div className="flex flex-col items-center justify-center mt-16 text-center px-4">
          <div className="text-5xl mb-3">🗂️</div>
          <h2 className="text-lg font-semibold text-gray-700">No Data assigned to you yet</h2>
          <p className="text-sm text-gray-500 mt-1">
            Data an Admin sends you directly will show up here.
          </p>
        </div>
      ) : (
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
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="mx-4 mt-4 relative"
          >
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search name or mobile..."
              className="w-full h-12 rounded-2xl bg-white border border-slate-200 pl-10 pr-3 text-sm outline-none shadow-[0_2px_10px_rgba(15,23,42,0.04)] focus:ring-2 focus:ring-amber-200 focus:border-amber-300 transition"
            />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.05 }}
            className="mx-4 mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap"
          >
            <FilterSelect value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
              <option value="">All Sources</option>
              {sourceOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
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

          {visibleLeads.length === 0 ? (
            <div className="flex flex-col items-center justify-center mt-16 text-center px-4">
              <div className="text-5xl mb-3">🔍</div>
              <h2 className="text-lg font-semibold text-gray-700">No Data matches these filters</h2>
              <p className="text-sm text-gray-500 mt-1">Try clearing the search or filters above.</p>
            </div>
          ) : (
            <div className="mx-4 mt-4 space-y-3 pb-6">
              {cardLeads.map((cardLead, index) => (
                <DataCard
                  key={cardLead.id}
                  index={index}
                  onOpen={handleOpenLead}
                  lead={cardLead}
                />
              ))}
            </div>
          )}
        </>
      )}

      {selectedLead && (
        <DataDetailModal
          lead={{
            id: selectedLead.id,
            leadHistoryId: selectedLead.lead_history[0]?.id,
            name: selectedLead.name,
            mobile: selectedLead.mobile,
            status: selectedLead.status,
            boardStage: (selectedLead.board_stage as BoardStage) || "LEADS",
            callCount: selectedLead.lead_history[0]?.call_count ?? 0
          }}
          onClose={() => setSelectedLeadId(null)}
          onUpdated={(updates) => handleLeadUpdated(selectedLead.id, updates)}
          onBoardStageChanged={(stage) => handleBoardStageChanged(selectedLead.id, stage)}
        />
      )}
    </>
  );
}
