// @ts-nocheck

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.0";
import { calculateSLAStatus, FOLLOWUP_INACTIVITY_WARNING_DAYS } from "../../../lib/calculateSLAStatus.ts";
import { calculateLeadAssignment } from "../../../lib/calculateLeadAssignment.ts";
import { isLeadTerminal } from "../../../lib/isLeadTerminal.ts";

// Scheduled sweep (pg_cron, every 15 min — modeled on
// mark-missed-posts). No CORS, no caller-identity resolution: this
// is a system job, never invoked from the browser, same posture as
// mark-missed-posts itself.
//
// For each non-terminal lead (has an active lead_history row):
//   - JUNK_ELIGIBLE (max recycles OR repeat NOT_INTERESTED — either
//     trigger, regardless of Project Rule status) -> mark_lead_junk_atomic.
//   - SLA_BREACHED / RECYCLE_READY on a Project-Rule lead -> a single
//     SLA_WARNING notification to that fixed employee; ownership
//     never changes, since Project Rules are a hard override (per
//     the approved design) — guarded by lead_history.sla_warning_sent_at
//     so this never repeats for the same assignment.
//   - SLA_BREACHED / RECYCLE_READY on everything else -> reassign via
//     calculateLeadAssignment (current owner excluded from the
//     eligible pool, so a non-responsive employee doesn't just get
//     the same lead back) + recycle_lead_atomic.
//
// pointerEmployeeId is threaded through the loop in memory (not
// re-read from settings per lead), so multiple recycles within the
// same sweep run correctly advance round robin instead of all
// landing on the same "next" employee computed from a now-stale
// value. This assumes sweeps don't overlap (15-min schedule, runs
// should finish well under that) — no extra locking added for that.
//
// diagnostics[] records exactly what happened (or didn't) for every
// lead checked, including RPC failures that would otherwise be
// silently swallowed by a bare `continue`. Always included in the
// response, not just on error — this was added after the first real
// debugging session showed "succeeded" cron status is not enough to
// tell whether anything meaningful happened.

serve(async () => {
  try {

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: settings, error: settingsError } = await supabase
      .from("lead_engine_settings")
      .select("*")
      .eq("id", 1)
      .single();

    if (settingsError || !settings) {
      return new Response(
        JSON.stringify({ success: false, message: "lead_engine_settings row not found" }),
        { headers: { "Content-Type": "application/json" }, status: 500 }
      );
    }

    // employees(is_active) joined so the multi-employee group-recycle
    // branch below can skip a deactivated member's turn without a
    // second round-trip.
    const { data: projectRulesRaw, error: rulesError } = await supabase
      .from("project_assignment_rules")
      .select("project, assigned_employee_id, employees(is_active)");

    if (rulesError) {
      return new Response(
        JSON.stringify({ success: false, step: "FETCH_PROJECT_RULES", error: rulesError.message }),
        { headers: { "Content-Type": "application/json" }, status: 500 }
      );
    }

    const projectRules = (projectRulesRaw || []).map((row) => ({
      project: row.project,
      assigned_employee_id: row.assigned_employee_id,
      employee_is_active: row.employees?.is_active ?? false
    }));

    // "This employee should never get round-robin leads for this
    // project" — consulted below only in the general (non-Project-
    // Rule) recycle branch, which is the ROUND_ROBIN half of
    // calculateLeadAssignment. The INCLUDE-rule matching this file
    // does inline (allMatchedEmployeeIds, further down) is entirely
    // separate and unaffected — exclusions never apply to a project
    // that already has a fixed-employee rule.
    const { data: projectExclusions, error: exclusionsError } = await supabase
      .from("project_exclusion_rules")
      .select("project, excluded_employee_id");

    if (exclusionsError) {
      return new Response(
        JSON.stringify({ success: false, step: "FETCH_PROJECT_EXCLUSIONS", error: exclusionsError.message }),
        { headers: { "Content-Type": "application/json" }, status: 500 }
      );
    }

    // Admin's force_reassign_lead_atomic permanently bans a
    // (lead, employee) pairing from ever coming back together via
    // automatic recycling — fetched once here, consulted below in
    // both the project-rule-group and general round-robin branches.
    // Deliberately does NOT apply to manual assignment paths
    // (Team-Leader assign/reassign, Admin Data-assign) — a human
    // consciously re-picking that employee is a different thing from
    // this lead silently cycling back to them on its own.
    const { data: forcedRemovalsRaw, error: forcedRemovalsError } = await supabase
      .from("lead_forced_removals")
      .select("lead_id, removed_employee_id");

    if (forcedRemovalsError) {
      return new Response(
        JSON.stringify({ success: false, step: "FETCH_FORCED_REMOVALS", error: forcedRemovalsError.message }),
        { headers: { "Content-Type": "application/json" }, status: 500 }
      );
    }

    const forcedRemovalsByLead = new Map<string, Set<string>>();
    (forcedRemovalsRaw || []).forEach((row) => {
      if (!forcedRemovalsByLead.has(row.lead_id)) {
        forcedRemovalsByLead.set(row.lead_id, new Set());
      }
      forcedRemovalsByLead.get(row.lead_id)!.add(row.removed_employee_id);
    });

    // For multi-employee project rules — round robin position within
    // just that project's fixed-employee group, entirely separate
    // from the company-wide pointer.
    const { data: projectPointerRows, error: projectPointerError } = await supabase
      .from("project_rule_pointers")
      .select("project, last_assigned_employee_id");

    if (projectPointerError) {
      return new Response(
        JSON.stringify({ success: false, step: "FETCH_PROJECT_POINTERS", error: projectPointerError.message }),
        { headers: { "Content-Type": "application/json" }, status: 500 }
      );
    }

    const projectPointers: Record<string, string | null> = {};
    (projectPointerRows || []).forEach((row) => {
      projectPointers[row.project] = row.last_assigned_employee_id;
    });

    const today = new Date().toISOString().split("T")[0];

    const { data: todaysAttendance, error: attendanceError } = await supabase
      .from("attendance")
      .select("employee_id")
      .eq("date", today)
      .is("shift_end_at", null);

    if (attendanceError) {
      return new Response(
        JSON.stringify({ success: false, step: "FETCH_TODAYS_ATTENDANCE", error: attendanceError.message }),
        { headers: { "Content-Type": "application/json" }, status: 500 }
      );
    }

    const shiftStartedEmployeeIds = new Set((todaysAttendance || []).map((row) => row.employee_id));

    const { data: allActiveEmployees, error: employeesError } = await supabase
      .from("employees")
      .select("id, team_id")
      .eq("is_active", true)
      .eq("rr_eligible", true)
      .order("id", { ascending: true });

    if (employeesError) {
      return new Response(
        JSON.stringify({ success: false, step: "FETCH_ELIGIBLE_EMPLOYEES", error: employeesError.message }),
        { headers: { "Content-Type": "application/json" }, status: 500 }
      );
    }

    const shiftActiveEmployees = (allActiveEmployees || []).filter((employee) =>
      shiftStartedEmployeeIds.has(employee.id)
    );

    // Team-scoping lookup for recycling a Team-Leader-assigned lead
    // (see below): keyed by the CURRENT OWNER's team, not the
    // assigner's — the assigner could change teams later, but the
    // current owner's team is what "this lead belongs to this team's
    // pool" actually means at recycle time. A separate, unfiltered
    // fetch because the current owner themselves might not be
    // is_active/rr_eligible/shift-started (and so wouldn't appear in
    // allActiveEmployees at all), but we still need to know their
    // team to scope the pool correctly. Also carries is_active/name
    // now — the single/multi-employee Project Rule branches below
    // need to know whether a fixed employee is still active, and (for
    // the single-employee case) their name for the Admin-redirect
    // alert when they're not.
    const { data: allEmployeesForTeamLookup, error: teamLookupError } = await supabase
      .from("employees")
      .select("id, team_id, is_active, name");

    if (teamLookupError) {
      return new Response(
        JSON.stringify({ success: false, step: "FETCH_TEAM_LOOKUP", error: teamLookupError.message }),
        { headers: { "Content-Type": "application/json" }, status: 500 }
      );
    }

    const teamIdByEmployeeId = new Map<string, string | null>();
    const isActiveByEmployeeId = new Map<string, boolean>();
    const nameByEmployeeId = new Map<string, string>();
    (allEmployeesForTeamLookup || []).forEach((e) => {
      teamIdByEmployeeId.set(e.id, e.team_id);
      isActiveByEmployeeId.set(e.id, e.is_active);
      nameByEmployeeId.set(e.id, e.name);
    });

    // Fetched once, outside the per-lead loop below — the admin
    // roster doesn't change mid-sweep, and this is the redirect
    // target when a single-fixed-employee Project Rule's employee has
    // been deactivated (see that branch's own comment).
    const { data: activeAdmins } = await supabase
      .from("employees")
      .select("id, name")
      .eq("role", "admin")
      .eq("is_active", true);

    // Separate from activeAdmins on purpose — this is the
    // Follow-up-Stale-Recycling oversight roster (Admin + Sales
    // Coordinator both need to see a stuck-in-verification visit),
    // not the Project-Rule-stale-alert target above. Keeping them
    // apart means extending this one never silently changes who gets
    // the unrelated Project Rule notification.
    const { data: oversightStaff } = await supabase
      .from("employees")
      .select("id, name")
      .in("role", ["admin", "sales_coordinator"])
      .eq("is_active", true);

    const { data: leads, error: leadsError } = await supabase
      .from("leads")
      .select(
        `
        id,
        project,
        status,
        sla_deadline,
        recycle_count,
        current_owner_id,
        lead_type,
        board_stage,
        last_unjunked_at,
        lead_history!inner (
          id,
          assigned_at,
          outcome_at,
          is_active,
          sla_warning_sent_at,
          assigned_by_type,
          call_count,
          last_activity_at,
          paused_until,
          pause_reason,
          pause_expiry_warning_sent_at,
          pause_expired_notified_at
        )
      `
      )
      // Only JUNK is excluded at the query level — CONVERTED is NOT,
      // deliberately. status='CONVERTED' alone doesn't mean genuinely
      // booked (see lib/isLeadTerminal.ts); a lead an employee marked
      // CONVERTED as a plain call-outcome, without ever reaching
      // board_stage='BOOKING', is still active and needs the same
      // staleness/recycling sweep as anything else. The real terminal
      // check (which needs board_stage, not expressible as a simple
      // PostgREST .not() filter) happens per-row in the loop below via
      // isLeadTerminal — this used to blanket-exclude CONVERTED here,
      // making the whole safety net structurally blind to a
      // premature/mistaken CONVERTED mark: that lead would never be
      // flagged or recovered, forever, even if abandoned right after.
      .neq("status", "JUNK")
      .eq("lead_history.is_active", true);

    if (leadsError) {
      return new Response(
        JSON.stringify({ success: false, step: "FETCH_LEADS", error: leadsError.message }),
        { headers: { "Content-Type": "application/json" }, status: 500 }
      );
    }

    let recycledCount = 0;
    let junkedCount = 0;
    let warnedCount = 0;
    let pointerEmployeeId = settings.round_robin_pointer_employee_id;
    const diagnostics: any[] = [];

    for (const lead of leads || []) {

      const activeHistory = lead.lead_history[0];

      if (!activeHistory) {
        diagnostics.push({ leadId: lead.id, action: "SKIPPED", reason: "no active lead_history row" });
        continue;
      }

      // Genuinely-terminal check — JUNK is already excluded at the
      // query level above, this only needs to catch a genuinely-
      // Booked lead (status=CONVERTED AND board_stage=BOOKING) now
      // that the query intentionally lets CONVERTED-but-not-booked
      // leads through. A real Booking is done, nothing left to sweep.
      if (isLeadTerminal(lead.status, lead.board_stage)) {
        diagnostics.push({ leadId: lead.id, action: "SKIPPED", reason: "genuinely terminal (booked or junked)" });
        continue;
      }

      // Pause-expiry notifications (Snooze / Visit-Lock /
      // Visit-Pending-Verification) — runs independently of the
      // slaStatus branching below. A lead that's still PAUSED
      // (paused_until in the future) still needs its heads-up here,
      // and a lead whose pause just lapsed needs its expired-notice
      // regardless of what the rest of this sweep decides to do with
      // it.
      if (activeHistory.paused_until) {

        const pausedUntilDate = new Date(activeHistory.paused_until);
        const isVisitLock = activeHistory.pause_reason === "VISIT_LOCK";
        const isPendingVerification = activeHistory.pause_reason === "VISIT_PENDING_VERIFICATION";
        const reasonLabel = isVisitLock ? "Visit-lock" : "Snooze";
        const msUntilExpiry = pausedUntilDate.getTime() - Date.now();
        const threeDaysMs = 3 * 24 * 60 * 60 * 1000;

        // The "3 days before" heads-up doesn't make sense for
        // Pending-Verification — its whole window IS 3 days, so
        // "3 days before expiry" is effectively "right now, at
        // creation." Only the SNOOZE/VISIT_LOCK reasons get a
        // heads-up; Pending-Verification only ever fires its
        // "expired, go act on it" notice below.
        if (
          !isPendingVerification &&
          msUntilExpiry > 0 &&
          msUntilExpiry <= threeDaysMs &&
          !activeHistory.pause_expiry_warning_sent_at
        ) {

          const { data: employee } = await supabase
            .from("employees")
            .select("name")
            .eq("id", lead.current_owner_id)
            .single();

          await supabase.from("notification").insert({
            employee_id: lead.current_owner_id,
            employee_name: employee?.name || "",
            title: `${reasonLabel} ending soon`,
            message: isVisitLock
              ? `Your Visit-lock on a lead is ending soon (${pausedUntilDate.toDateString()}) — schedule a revisit before then or it may be reassigned to another team member.`
              : `Your Snooze on a lead is ending soon (${pausedUntilDate.toDateString()}) — follow up before then.`,
            type: "PAUSE_EXPIRY_WARNING",
            is_read: false
          });

          await supabase
            .from("lead_history")
            .update({ pause_expiry_warning_sent_at: new Date().toISOString() })
            .eq("id", activeHistory.id);

          diagnostics.push({ leadId: lead.id, action: "PAUSE_EXPIRY_WARNED", pauseReason: activeHistory.pause_reason });

        } else if (msUntilExpiry <= 0 && !activeHistory.pause_expired_notified_at) {

          if (isPendingVerification) {

            // The employee already did their part (marked the visit)
            // — nudging them again would be the wrong signal. The
            // actionable party here is Admin/Sales Coordinator, who
            // haven't verified (or denied) it in 3 days.
            const { data: owner } = await supabase
              .from("employees")
              .select("name")
              .eq("id", lead.current_owner_id)
              .single();

            for (const staff of oversightStaff || []) {
              await supabase.from("notification").insert({
                employee_id: staff.id,
                employee_name: staff.name || "",
                title: "Visit pending verification",
                message: `A visit for "${lead.project || lead.id}" by ${owner?.name || "an employee"} has been pending verification for 3+ days — please verify or deny it.`,
                type: "VISIT_VERIFICATION_OVERDUE",
                is_read: false
              });
            }

          } else {

            const { data: employee } = await supabase
              .from("employees")
              .select("name")
              .eq("id", lead.current_owner_id)
              .single();

            await supabase.from("notification").insert({
              employee_id: lead.current_owner_id,
              employee_name: employee?.name || "",
              title: `${reasonLabel} ended`,
              message: isVisitLock
                ? "Your Visit-lock on a lead has ended — follow up today or it may be reassigned to another team member."
                : "Your Snooze on a lead has ended — follow up today.",
              type: "PAUSE_EXPIRED",
              is_read: false
            });

          }

          // last_activity_at reset right here, at the exact moment a
          // pause's expiry is first noticed — without this, a
          // VISIT_LOCK/SNOOZE that ran its full duration with zero
          // further employee activity (the normal case — that's the
          // whole point of a pause) would carry a last_activity_at
          // from whenever the pause STARTED, weeks/months stale by
          // the time it ends. calculateSLAStatus would then see that
          // huge gap the instant PAUSED stops applying and jump
          // straight to FOLLOWUP_INACTIVITY_RECYCLE_READY, skipping
          // the 3-day warning phase entirely. Resetting here gives
          // the inactivity clock a fresh, fair start from the actual
          // expiry moment instead.
          await supabase
            .from("lead_history")
            .update({
              pause_expired_notified_at: new Date().toISOString(),
              last_activity_at: new Date().toISOString()
            })
            .eq("id", activeHistory.id);

          diagnostics.push({ leadId: lead.id, action: "PAUSE_EXPIRED_NOTIFIED", pauseReason: activeHistory.pause_reason });

        }

      }

      // Bounded to lead_history rows created at-or-after the lead's
      // most recent unjunk_and_reassign_lead_atomic recovery (if
      // any) — a manual recovery is a deliberate "this deserves a
      // genuine fresh start" decision, and without this bound, a
      // lead junked partly for repeat-NOT_INTERESTED would just
      // immediately re-trigger JUNK_ELIGIBLE on the very next sweep,
      // defeating the whole recovery feature. Nothing in lead_history
      // itself is altered or deleted — the full audit trail (including
      // pre-recovery NOT_INTERESTED outcomes) stays exactly as it was.
      let notInterestedQuery = supabase
        .from("lead_history")
        .select("*", { count: "exact", head: true })
        .eq("lead_id", lead.id)
        .eq("outcome", "NOT_INTERESTED");

      if (lead.last_unjunked_at) {
        notInterestedQuery = notInterestedQuery.gt("assigned_at", lead.last_unjunked_at);
      }

      const { count: notInterestedCount } = await notInterestedQuery;

      const slaStatus = calculateSLAStatus(
        {
          status: lead.status,
          sla_deadline: lead.sla_deadline,
          recycle_count: lead.recycle_count,
          lead_type: lead.lead_type,
          call_count: activeHistory.call_count,
          board_stage: lead.board_stage,
          paused_until: activeHistory.paused_until,
          last_activity_at: activeHistory.last_activity_at,
          pause_reason: activeHistory.pause_reason,
          assigned_at: activeHistory.assigned_at
        },
        activeHistory.outcome_at,
        notInterestedCount || 0
      );

      if (slaStatus === "JUNK_ELIGIBLE") {

        const { error: junkError } = await supabase.rpc("mark_lead_junk_atomic", {
          p_lead_id: lead.id,
          p_lead_history_id: activeHistory.id,
          p_reason: lead.recycle_count >= 3 ? "max recycles reached" : "repeat NOT_INTERESTED"
        });

        if (junkError) {
          diagnostics.push({
            leadId: lead.id,
            action: "JUNK_FAILED",
            slaStatus,
            notInterestedCount: notInterestedCount || 0,
            error: junkError.message
          });
        } else {
          junkedCount++;
          diagnostics.push({
            leadId: lead.id,
            action: "JUNKED",
            slaStatus,
            notInterestedCount: notInterestedCount || 0
          });
        }

        continue;

      }

      if (slaStatus === "PAUSED") {
        diagnostics.push({
          leadId: lead.id,
          action: "SKIPPED",
          reason: "paused",
          pauseReason: activeHistory.pause_reason,
          pausedUntil: activeHistory.paused_until
        });
        continue;
      }

      // Follow-up-Stale-Recycling day-3 mark — a flat notify-only
      // step, deliberately NOT routed through the project-rule/
      // round-robin branches below (those only matter for the actual
      // day-6 RECYCLE decision). Applies uniformly regardless of how
      // this lead was assigned. Reuses sla_warning_sent_at — safe
      // because a lead only ever reaches exactly one of this branch,
      // the single-fixed-Project-Rule branch, or neither, per sweep
      // (mutually exclusive via `continue`), so there's no double
      // meaning collision on the same lead_history row.
      if (slaStatus === "FOLLOWUP_INACTIVITY_WARNING") {

        if (!activeHistory.sla_warning_sent_at) {

          const { data: employee } = await supabase
            .from("employees")
            .select("name")
            .eq("id", lead.current_owner_id)
            .single();

          await supabase.from("notification").insert({
            employee_id: lead.current_owner_id,
            employee_name: employee?.name || "",
            title: "Follow-up needs attention",
            message: `A lead in your Follow-up/Visit list hasn't had any activity in ${FOLLOWUP_INACTIVITY_WARNING_DAYS} days — follow up soon or it may be reassigned to another team member.`,
            type: "SLA_WARNING",
            is_read: false
          });

          await supabase
            .from("lead_history")
            .update({ sla_warning_sent_at: new Date().toISOString() })
            .eq("id", activeHistory.id);

          warnedCount++;
          diagnostics.push({ leadId: lead.id, action: "WARNED", slaStatus, scope: "FOLLOWUP_INACTIVITY" });

        } else {
          diagnostics.push({ leadId: lead.id, action: "SKIPPED", reason: "follow-up inactivity, already warned" });
        }

        continue;

      }

      if (
        slaStatus !== "SLA_BREACHED" &&
        slaStatus !== "RECYCLE_READY" &&
        slaStatus !== "DATA_MAX_ATTEMPTS_REACHED" &&
        slaStatus !== "FOLLOWUP_INACTIVITY_RECYCLE_READY"
      ) {
        diagnostics.push({ leadId: lead.id, action: "SKIPPED", reason: `slaStatus=${slaStatus}` });
        continue;
      }

      // sla_deadline itself is computed inside recycle_lead_atomic now
      // (working-hours-aware, via compute_working_hours_sla_deadline;
      // stays null for lead_type='DATA', same as before — DATA leads
      // recycle on attempt-count, not time, see calculateSLAStatus) —
      // this Edge Function doesn't compute or pass it anymore.

      const normalizedProject = String(lead.project || "").trim().toLowerCase();

      const allMatchedEmployeeIds = Array.from(
        new Set(
          (projectRules || [])
            .filter((rule) => String(rule.project || "").trim().toLowerCase() === normalizedProject)
            .map((rule) => rule.assigned_employee_id)
        )
      );

      if (allMatchedEmployeeIds.length === 1) {

        // Single fixed employee — hard override, never reassigned
        // away, unchanged from the original design. Escalate once,
        // never repeat for this same assignment. Notifies
        // lead.current_owner_id (not the rule row's employee id
        // directly) — in this single-employee case they're always the
        // same in practice, but this is the actually-correct signal:
        // whoever currently holds the lead is who needs the nudge —
        // UNLESS that employee has since been deactivated, in which
        // case they can't log in to ever see it, and this lead would
        // just sit stuck forever with nobody able to act (ownership
        // never auto-reassigns away from a single-fixed-employee
        // rule, by design). The alert goes to Admin(s) instead in
        // that case — they're the ones who can actually fix the stale
        // Project Rule.
        const fixedEmployeeIsActive = isActiveByEmployeeId.get(lead.current_owner_id) ?? false;

        if (!activeHistory.sla_warning_sent_at) {

          await supabase
            .from("lead_history")
            .update({ sla_warning_sent_at: new Date().toISOString() })
            .eq("id", activeHistory.id);

          if (fixedEmployeeIsActive) {

            const { data: employee } = await supabase
              .from("employees")
              .select("name")
              .eq("id", lead.current_owner_id)
              .single();

            await supabase.from("notification").insert({
              employee_id: lead.current_owner_id,
              employee_name: employee?.name || "",
              title: "Lead needs follow-up",
              message: "A lead assigned to you via a Project Rule is past its SLA window — please follow up.",
              type: "SLA_WARNING",
              is_read: false
            });

          } else {

            const employeeName = nameByEmployeeId.get(lead.current_owner_id) || "Unknown";

            for (const admin of activeAdmins || []) {
              await supabase.from("notification").insert({
                employee_id: admin.id,
                employee_name: admin.name || "",
                title: "Project Rule points to a deactivated employee",
                message: `"${lead.project}"'s fixed employee (${employeeName}) is deactivated — a lead is stuck past its SLA window. Update or remove the Project Rule to unstick it.`,
                type: "PROJECT_RULE_STALE",
                is_read: false
              });
            }

          }

          warnedCount++;
          diagnostics.push({
            leadId: lead.id,
            action: "WARNED",
            slaStatus,
            project: lead.project,
            notifiedAdminInstead: !fixedEmployeeIsActive
          });

        } else {
          diagnostics.push({ leadId: lead.id, action: "SKIPPED", reason: "project rule, already warned" });
        }

        continue;

      }

      if (allMatchedEmployeeIds.length > 1) {

        // Multiple fixed employees for this project — SLA breach
        // rotates within just this group (current/non-responsive
        // owner excluded, only currently shift-active members
        // considered — a project rule bypasses the rr_eligible pool
        // gate entirely by design, but someone who hasn't clocked in
        // still can't realistically respond right now — and a
        // deactivated member never can, regardless of shift). Never
        // escapes to the system-wide pool. Mirrors team-scoped
        // recycling's shape exactly.
        const groupPoolEmployees = allMatchedEmployeeIds.filter(
          (id) =>
            id !== lead.current_owner_id &&
            shiftStartedEmployeeIds.has(id) &&
            (isActiveByEmployeeId.get(id) ?? false) &&
            !(forcedRemovalsByLead.get(lead.id)?.has(id))
        );

        if (groupPoolEmployees.length === 0) {
          diagnostics.push({
            leadId: lead.id,
            action: "SKIPPED",
            reason: "PROJECT_RULE_GROUP_NO_ELIGIBLE_EMPLOYEE",
            slaStatus,
            project: lead.project
          });
          continue;
        }

        const lastProjectPointer = projectPointers[normalizedProject] ?? null;
        const lastIndex = groupPoolEmployees.findIndex((id) => id === lastProjectPointer);
        const nextIndex = lastIndex === -1 ? 0 : (lastIndex + 1) % groupPoolEmployees.length;
        const nextEmployeeId = groupPoolEmployees[nextIndex];

        const { error: projectRecycleError } = await supabase.rpc("recycle_lead_atomic", {
          p_lead_id: lead.id,
          p_old_lead_history_id: activeHistory.id,
          p_new_employee_id: nextEmployeeId,
          // Global pointer untouched — this lead was never part of the
          // company-wide rotation to begin with.
          p_next_pointer_employee_id: pointerEmployeeId,
          p_recycle_reason: slaStatus
        });

        if (projectRecycleError) {
          diagnostics.push({
            leadId: lead.id,
            action: "RECYCLE_FAILED",
            slaStatus,
            assignedEmployeeId: nextEmployeeId,
            error: projectRecycleError.message
          });
        } else {
          recycledCount++;
          projectPointers[normalizedProject] = nextEmployeeId;

          const { error: projectPointerUpsertError } = await supabase
            .from("project_rule_pointers")
            .upsert({ project: normalizedProject, last_assigned_employee_id: nextEmployeeId });

          if (projectPointerUpsertError) {
            console.error("project_rule_pointers upsert failed:", projectPointerUpsertError.message);
          }

          diagnostics.push({
            leadId: lead.id,
            action: "RECYCLED",
            slaStatus,
            assignedEmployeeId: nextEmployeeId,
            scope: "PROJECT_RULE_GROUP"
          });
        }

        continue;

      }

      // Round robin: exclude the current owner so a non-responsive
      // employee doesn't just get the same lead back — and exclude
      // anyone Admin has permanently force-removed from this specific
      // lead (see forcedRemovalsByLead above).
      let eligibleEmployees = shiftActiveEmployees.filter(
        (employee) =>
          employee.id !== lead.current_owner_id &&
          !(forcedRemovalsByLead.get(lead.id)?.has(employee.id))
      );

      // A Team-Leader-assigned lead was that team's own resource, not
      // part of the company-wide round-robin rotation to begin with —
      // recycling it stays inside the current owner's team rather
      // than falling back to the system-wide pool. If the team has
      // nobody else eligible right now, this is skipped (retried next
      // sweep) rather than silently escaping team scope.
      const isTeamLeaderAssigned = activeHistory.assigned_by_type === "TEAM_LEADER";
      let scopedTeamId: string | null = null;

      if (isTeamLeaderAssigned) {
        scopedTeamId = teamIdByEmployeeId.get(lead.current_owner_id) ?? null;

        eligibleEmployees = scopedTeamId
          ? eligibleEmployees.filter((employee) => employee.team_id === scopedTeamId)
          : [];

        if (eligibleEmployees.length === 0) {
          diagnostics.push({
            leadId: lead.id,
            action: "SKIPPED",
            reason: "TEAM_SCOPED_NO_ELIGIBLE_EMPLOYEE",
            slaStatus,
            teamId: scopedTeamId
          });
          continue;
        }
      }

      const result = calculateLeadAssignment(
        lead.project,
        [], // Project Rules already ruled out for this lead above
        eligibleEmployees,
        pointerEmployeeId,
        {},
        projectExclusions || []
      );

      if (!result.assignedEmployeeId) {
        // Nobody eligible right now — leave it, retry next sweep.
        diagnostics.push({
          leadId: lead.id,
          action: "SKIPPED",
          reason: "NO_ELIGIBLE_EMPLOYEE",
          slaStatus,
          eligiblePoolSize: eligibleEmployees.length
        });
        continue;
      }

      const { error: recycleError } = await supabase.rpc("recycle_lead_atomic", {
        p_lead_id: lead.id,
        p_old_lead_history_id: activeHistory.id,
        p_new_employee_id: result.assignedEmployeeId,
        // Team-scoped recycles never advance the system-wide pointer
        // — that pointer tracks company-wide rotation, which this
        // lead was never part of (same "bypasses round-robin"
        // principle the manual-assign/reassign RPCs follow).
        p_next_pointer_employee_id: isTeamLeaderAssigned ? pointerEmployeeId : result.nextGlobalPointerEmployeeId,
        p_recycle_reason: slaStatus
      });

      if (recycleError) {
        diagnostics.push({
          leadId: lead.id,
          action: "RECYCLE_FAILED",
          slaStatus,
          assignedEmployeeId: result.assignedEmployeeId,
          error: recycleError.message
        });
      } else {
        recycledCount++;
        if (!isTeamLeaderAssigned) {
          pointerEmployeeId = result.nextGlobalPointerEmployeeId;
        }
        diagnostics.push({
          leadId: lead.id,
          action: "RECYCLED",
          slaStatus,
          assignedEmployeeId: result.assignedEmployeeId,
          scope: isTeamLeaderAssigned ? "TEAM" : "SYSTEM_WIDE"
        });
      }

    }

    return new Response(
      JSON.stringify({
        success: true,
        recycledCount,
        junkedCount,
        warnedCount,
        totalChecked: (leads || []).length,
        diagnostics
      }),
      { headers: { "Content-Type": "application/json" } }
    );

  } catch (err) {

    console.error("recycle-stale-leads: unhandled error:", err.message, err.stack);

    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { headers: { "Content-Type": "application/json" }, status: 500 }
    );

  }
});
