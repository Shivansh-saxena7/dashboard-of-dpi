"use client";
// Employee Home (2026-11-18): the data behind the new Home. Read-only.
//   * My leads: the same rows /leads loads (current owner, LEAD, the employee's active assignment), only the columns the
//     Home needs, through fetchAllRows (no 1000-row ceiling). Counted by lib/employeeHome.ts, the rules /leads uses.
//   * Today: get_employee_work_report for today (IST), the same function /report shows.
//   * Phase 2: reminders today (lib/todayReminders.ts, one bounded read), Needs attention counts and Up next, from the
//     shared predicates /leads uses for ?filter=followup-overdue / reminders-today / visits-today.
//   * Phase 3: the queue length (queueOrder, the same order /leads?queue=1 walks), and the data-only variant: when the
//     employee has no LEAD leads, their DATA leads are read (DataList's filters) and counted as /data's cards do.
//   * Refresh: one realtime channel (leads + lead_history of this employee, as /leads listens; a saved result with a
//     reminder writes lead_history too) and a refetch when the app comes back to the foreground (at most once a
//     minute). No interval polling.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { istDateYmd } from "@/lib/ownerLeave";
import { useWorkingCalendar } from "@/lib/useWorkingCalendar";
import { fetchTodayReminders } from "@/lib/todayReminders";
import { reportClientError } from "@/lib/reportClientError";
import { useGivenLeadContext } from "@/lib/useGivenLeadContext";
import { givenFilterLeads } from "@/lib/givenLeadContext";
import {
  attentionCounts,
  dataCounts,
  dataQueueOrder,
  homeFilterLeads,
  myLeadCounts,
  queueOrder,
  queueSummary,
  type DataCounts,
  type DataLead,
  type AttentionCounts,
  type HomeLead,
  type MyLeadCounts,
  type UpNextItem
} from "@/lib/employeeHome";

export interface HomeToday {
  calls: number;
  connected: number;
  results_saved: number;
  followUps: number;
  visits: number;
}

export interface EmployeeHomeData {
  counts: MyLeadCounts | null;
  attention: AttentionCounts | null;
  upNext: UpNextItem[];
  queueLength: number;
  // E4: "5 due now · 60 total" on the Start button (queueSummary), and the "Called, no result" leads (row link).
  queueUrgent: number;
  pendingIds: string[];
  // E6: leads an admin gave (the /leads "Given by admin" filter set), the earliest protection end, and the DATA count
  // for an employee who has both LEAD and DATA leads (null when not known or data-only).
  given: { count: number; protectedUntil: string | null } | null;
  dataTotal: number | null;
  // Data-only employee (no LEAD leads, some DATA leads): their DATA counts; null otherwise.
  data: DataCounts | null;
  dataQueueLength: number;
  today: HomeToday | null;
  leadsError: boolean;
  todayError: boolean;
  remindersError: boolean;
  loading: boolean;
  reload: () => void;
  // Home v3 (2026-11-29, additive): the whole queue and today's / yesterday's reminder times (lead id -> ms), same data.
  queue?: UpNextItem[]; reminderAt?: Map<string, number> | null; missedAt?: Map<string, number> | null;
}

const HOME_LEAD_COLUMNS = `
  id,
  name,
  mobile,
  project,
  status,
  board_stage,
  sla_deadline,
  recycle_count,
  is_personal_lead,
  lead_history!inner (
    id,
    call_count,
    outcome_at,
    assigned_at,
    first_call_at,
    first_whatsapp_at,
    last_activity_at,
    paused_until,
    pause_reason,
    last_call_click_at
  )
`;

const DATA_COLUMNS = `
  id,
  status,
  board_stage,
  lead_history!inner (
    call_count,
    outcome_at,
    assigned_at,
    first_call_at,
    first_whatsapp_at,
    last_activity_at,
    last_call_click_at
  )
`;

const FOCUS_REFRESH_MS = 60_000;
const REALTIME_DEBOUNCE_MS = 1500;
export const UP_NEXT_LIMIT = 5;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function useEmployeeHome(employeeId: string | null | undefined): EmployeeHomeData {
  const calendar = useWorkingCalendar();
  const [leads, setLeads] = useState<HomeLead[] | null>(null);
  const [dataLeads, setDataLeads] = useState<DataLead[] | null>(null);
  const [dataTotal, setDataTotal] = useState<number | null>(null);
  const givenContext = useGivenLeadContext(employeeId);
  const [reminders, setReminders] = useState<Map<string, number> | null>(null);
  const [missed, setMissed] = useState<Map<string, number> | null>(null);
  const [today, setToday] = useState<HomeToday | null>(null);
  const [leadsError, setLeadsError] = useState(false);
  const [todayError, setTodayError] = useState(false);
  const [remindersError, setRemindersError] = useState(false);
  const [loading, setLoading] = useState(true);
  const lastLoad = useRef(0);
  const alive = useRef(true);

  const load = useCallback(async () => {
    if (!employeeId) return;
    lastLoad.current = Date.now();
    const [leadsRes, reportRes, remindersRes] = await Promise.all([
      fetchAllRows(() =>
        supabase
          .from("leads")
          .select(HOME_LEAD_COLUMNS)
          .eq("current_owner_id", employeeId)
          .eq("lead_type", "LEAD")
          .eq("lead_history.employee_id", employeeId)
          .eq("lead_history.is_active", true)
          .order("id", { ascending: true })
      ),
      supabase.rpc("get_employee_work_report", { p_employee_id: employeeId, p_date: istDateYmd() }),
      fetchTodayReminders(employeeId)
    ]);
    if (!alive.current) return;
    // E5: a card that cannot load says so in its own words, and the failure is reported (throttled, never throws).
    if (leadsRes.error) reportClientError("home:leads", leadsRes.error?.message ?? leadsRes.error, "warning");
    if (reportRes.error) reportClientError("home:today", reportRes.error?.message ?? reportRes.error, "warning");
    if (remindersRes.error) reportClientError("home:reminders", "reminders could not be read", "warning");
    if (leadsRes.error) {
      setLeadsError(true);
    } else {
      setLeadsError(false);
      setLeads((leadsRes.data || []) as HomeLead[]);
      // Data-only variant: asked only when there is no LEAD lead at all.
      if ((leadsRes.data || []).length === 0) {
        const dataRes = await fetchAllRows(() =>
          supabase
            .from("leads")
            .select(DATA_COLUMNS)
            .eq("current_owner_id", employeeId)
            .eq("lead_type", "DATA")
            .eq("lead_history.employee_id", employeeId)
            .eq("lead_history.is_active", true)
            .order("id", { ascending: true })
        );
        if (!alive.current) return;
        setDataLeads(dataRes.error ? null : ((dataRes.data || []) as DataLead[]));
      } else {
        setDataLeads(null);
        // E6: someone with LEAD and DATA leads: just the DATA count (/data's own filters), one HEAD request.
        const { count, error: countError } = await supabase
          .from("leads")
          .select("id, lead_history!inner(id)", { count: "exact", head: true })
          .eq("current_owner_id", employeeId)
          .eq("lead_type", "DATA")
          .eq("lead_history.employee_id", employeeId)
          .eq("lead_history.is_active", true)
          .limit(1);
        if (!alive.current) return;
        setDataTotal(countError || typeof count !== "number" ? null : count);
      }
    }
    setRemindersError(remindersRes.error);
    if (!remindersRes.error) {
      setReminders(remindersRes.byLead);
      setMissed(remindersRes.missed);
    }
    const report = reportRes.data as Record<string, unknown> | null;
    if (reportRes.error || !report || typeof report !== "object" || Array.isArray(report)) {
      setTodayError(true);
    } else {
      setTodayError(false);
      setToday({
        calls: num(report.calls),
        connected: num(report.connected),
        results_saved: num(report.results_saved),
        followUps: num(report.followUps),
        visits: num(report.visits)
      });
    }
    setLoading(false);
  }, [employeeId]);

  useEffect(() => {
    alive.current = true;
    load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  // One channel, same filters as /leads. A burst of changes (a save writes leads + lead_history) is one reload.
  useEffect(() => {
    if (!employeeId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const topic = `employee-home-${employeeId}`;
    const existing = supabase.getChannels().find((ch) => ch.topic === `realtime:${topic}`);
    if (existing) supabase.removeChannel(existing);
    const later = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => load(), REALTIME_DEBOUNCE_MS);
    };
    // E7 (2026-11-19): the employee's own lead_notes (reminders) on the same channel. lead_notes has to be in the
    // supabase_realtime publication for that binding to be accepted; if the server refuses the join (CHANNEL_ERROR /
    // TIMED_OUT) the channel joins again once without it, so leads + lead_history keep updating as before and reminders
    // fall back to the old refresh (after a save, or when the app comes back). Still one channel at a time.
    let cancelled = false;
    let withNotes = true;
    const make = (): ReturnType<typeof supabase.channel> => {
      let ch = supabase
        .channel(topic)
        .on("postgres_changes", { event: "*", schema: "public", table: "leads", filter: `current_owner_id=eq.${employeeId}` }, later)
        .on("postgres_changes", { event: "*", schema: "public", table: "lead_history", filter: `employee_id=eq.${employeeId}` }, later);
      const dropNotes = () => {
        if (cancelled || !withNotes) return;
        withNotes = false;
        supabase.removeChannel(ch);
        channel = make();
      };
      if (withNotes) {
        ch = ch.on("postgres_changes", { event: "*", schema: "public", table: "lead_notes", filter: `employee_id=eq.${employeeId}` }, later);
        // The server may accept the join and then report the postgres_changes subscription as failed in a system
        // message (e.g. a table that is not published); that must not stop the leads / lead_history updates either.
        ch = ch.on("system", {}, (payload: { extension?: string; status?: string }) => {
          if (payload?.extension === "postgres_changes" && payload?.status === "error") dropNotes();
        });
      }
      ch.subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") dropNotes();
      });
      return ch;
    };
    let channel = make();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [employeeId, load]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastLoad.current >= FOCUS_REFRESH_MS) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  const counts = useMemo(() => (leads ? myLeadCounts(leads, calendar) : null), [leads, calendar]);
  // Reminders that failed to load count as none (the row says so) rather than hiding the other numbers.
  const givenLeads = useMemo(
    () => (leads && givenContext.enabled ? givenFilterLeads(leads, givenContext.byLeadId) : []),
    [leads, givenContext.enabled, givenContext.byLeadId]
  );
  const ctx = useMemo(
    () => ({
      calendar,
      reminders: reminders ?? new Map<string, number>(),
      missed: missed ?? new Map<string, number>(),
      given: new Set(givenLeads.map((l) => l.id))
    }),
    [calendar, reminders, missed, givenLeads]
  );
  const given = useMemo(() => {
    if (!givenContext.enabled || !leads) return null;
    const until = givenLeads
      .map((l) => givenContext.byLeadId.get(l.id)?.protected_until)
      .filter((x): x is string => Boolean(x))
      .sort()[0];
    return { count: givenLeads.length, protectedUntil: until ?? null };
  }, [givenContext.enabled, givenContext.byLeadId, givenLeads, leads]);
  const attention = useMemo(() => (leads ? attentionCounts(leads, ctx) : null), [leads, ctx]);
  const queue = useMemo(() => (leads ? queueOrder(leads, ctx) : []), [leads, ctx]);
  const next = useMemo(() => queue.slice(0, UP_NEXT_LIMIT), [queue]);
  const summary = useMemo(() => queueSummary(queue), [queue]);
  const pendingIds = useMemo(() => (leads ? homeFilterLeads(leads, "pending-result", ctx).map((l) => l.id) : []), [leads, ctx]);
  const data = useMemo(() => (leads && leads.length === 0 && dataLeads && dataLeads.length > 0 ? dataCounts(dataLeads) : null), [leads, dataLeads]);

  const dataQueueLength = useMemo(() => (data && dataLeads ? dataQueueOrder(dataLeads).length : 0), [data, dataLeads]);

  return { counts, attention, upNext: next, queueLength: queue.length, queueUrgent: summary.urgent, pendingIds, given, dataTotal, data, dataQueueLength, today, leadsError, todayError, remindersError, loading, reload: load, queue, reminderAt: reminders, missedAt: missed };
}
