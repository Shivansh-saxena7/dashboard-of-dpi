"use client";
// "My team today" (2026-11-18, Employee Home Phase 3): the team leader's card on the new Home. Only for role
// team_leader with a team; every read is the team leader's own client under RLS (the same tables and filters /team
// uses: employees by team_id, attendance by member ids, leads reserved for the team, leads of the members), so it
// cannot show another team. Calls / results per member are not shown: get_employee_work_report refuses a team leader
// for another employee, and widening it would be a DB change.
//   * On shift: members with a shift start today (IST date) / members (as /team's roster).
//   * Waiting to assign: leads reserved for the team with no owner (as /team's pending list), capped at 500.
//   * Follow-ups at risk: the members' Follow-up leads the card would mark "Needs follow-up" / "Going stale"
//     (isFollowUpOverdue, the same rule as the Home's own number), read through fetchAllRows.
// Loaded once and when the app comes back to the foreground (at most once a minute). No polling, no realtime channel.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { istDateYmd } from "@/lib/ownerLeave";
import { useWorkingCalendar } from "@/lib/useWorkingCalendar";
import { reportClientError } from "@/lib/reportClientError";
import { isFollowUpOverdue, type HomeLead } from "@/lib/employeeHome";

export interface TeamToday {
  members: number;
  onShift: number;
  waiting: number;
  atRisk: number;
}

export const TEAM_WAITING_LIMIT = 500;
const FOCUS_REFRESH_MS = 60_000;

export function useTeamToday(teamId: string | null | undefined, enabled: boolean) {
  const calendar = useWorkingCalendar();
  const [rows, setRows] = useState<{ members: number; onShift: number; waiting: number; followUps: HomeLead[] } | null>(null);
  const [error, setError] = useState(false);
  const lastLoad = useRef(0);

  const load = useCallback(async () => {
    if (!enabled || !teamId) return;
    lastLoad.current = Date.now();
    const { data: memberRows, error: memberError } = await supabase.from("employees").select("id").eq("team_id", teamId);
    if (memberError) {
      reportClientError("home:team", memberError.message, "warning");
      setError(true);
      return;
    }
    const ids = (memberRows || []).map((m: { id: string }) => m.id);
    if (ids.length === 0) {
      setError(false);
      setRows({ members: 0, onShift: 0, waiting: 0, followUps: [] });
      return;
    }
    const [shiftRes, waitingRes, followRes] = await Promise.all([
      supabase.from("attendance").select("employee_id, shift_start_at").eq("date", istDateYmd()).in("employee_id", ids),
      supabase
        .from("leads")
        .select("id")
        .eq("pending_team_id", teamId)
        .is("current_owner_id", null)
        .limit(TEAM_WAITING_LIMIT),
      fetchAllRows(() =>
        supabase
          .from("leads")
          .select(
            "id, status, board_stage, sla_deadline, recycle_count, is_personal_lead, lead_history!inner(outcome_at, assigned_at, last_activity_at, paused_until, pause_reason)"
          )
          .in("current_owner_id", ids)
          .eq("lead_type", "LEAD")
          .eq("board_stage", "FOLLOW_UP")
          .eq("lead_history.is_active", true)
          .order("id", { ascending: true })
      )
    ]);
    if (shiftRes.error || waitingRes.error || followRes.error) {
      reportClientError("home:team", (shiftRes.error || waitingRes.error || followRes.error)?.message ?? "team read failed", "warning");
      setError(true);
      return;
    }
    setError(false);
    setRows({
      members: ids.length,
      onShift: new Set((shiftRes.data || []).filter((a: { shift_start_at: string | null }) => a.shift_start_at).map((a: { employee_id: string }) => a.employee_id)).size,
      waiting: (waitingRes.data || []).length,
      followUps: (followRes.data || []) as HomeLead[]
    });
  }, [enabled, teamId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastLoad.current >= FOCUS_REFRESH_MS) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [enabled, load]);

  const team: TeamToday | null = rows
    ? { members: rows.members, onShift: rows.onShift, waiting: rows.waiting, atRisk: rows.followUps.filter((l) => isFollowUpOverdue(l, calendar)).length }
    : null;
  return { team, error, reload: load };
}
