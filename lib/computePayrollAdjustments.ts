import { supabase } from "./supabase";
import { calculateDailyHrmsStatus, applyMonthlyLateComingRule, DailyHrmsStatus } from "./calculateHrmsAttendanceStatus";

// Three independent monthly-close computations, one per system built in
// this payroll phase. Each is a pure "read inputs, upsert one result"
// function called on demand (HR clicks Compute for a given employee +
// month, reviews the numbers, can re-click to recompute right up until
// the slip is generated -- see the unique constraints added alongside
// this file for why upsert, not insert-only, is correct here specifically).
// None of these write to the Salary Slip itself; wiring the results in
// is a separate step.

function monthBounds(yyyyMm: string) {
  const [y, m] = yyyyMm.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  return {
    y,
    m,
    daysInMonth,
    startDate: `${yyyyMm}-01`,
    endDate: `${yyyyMm}-${String(daysInMonth).padStart(2, "0")}`,
    payPeriod: `${yyyyMm}-01`
  };
}

// Resolves Basic Pay as of a given date -- same as-of pattern already
// used by Generate Slip in app/payroll/salary/page.tsx, duplicated here (not
// imported) because that logic lives inline in a client component and
// this runs standalone.
async function resolveBasicPayAsOf(employeeId: string, asOfDate: string): Promise<number> {
  const { data } = await supabase
    .from("employee_compensation")
    .select("basic_pay")
    .eq("employee_id", employeeId)
    .lte("effective_from", asOfDate)
    .order("effective_from", { ascending: false })
    .limit(1);
  return data?.[0]?.basic_pay ?? 0;
}

export interface CommissionComputeResult {
  skipped: string | null;
  bookingsCount: number;
  commissionAmount: number;
}

// Bookings are rated in chronological order within the month against a
// running position (1st booking, 2nd booking, ...), each taking the
// highest tier whose min_bookings is at or below its own position --
// the standard marginal-tier sales-commission model, and the natural
// fit for commission_ledger's one-row-per-booking shape (vs. a single
// whole-month total, which wouldn't map onto per-booking rows at all).
export async function computeCommissionForMonth(
  employeeId: string,
  yyyyMm: string,
  computedByEmployeeId: string
): Promise<CommissionComputeResult> {
  const { startDate, endDate, payPeriod } = monthBounds(yyyyMm);

  const { data: assignments } = await supabase
    .from("employee_commission_plan_assignments")
    .select("plan_id")
    .eq("employee_id", employeeId)
    .lte("effective_from", endDate)
    .order("effective_from", { ascending: false })
    .limit(1);

  const planId = assignments?.[0]?.plan_id;
  if (!planId) return { skipped: "No commission plan assigned as of this month.", bookingsCount: 0, commissionAmount: 0 };

  const [{ data: tiers }, { data: bookings }] = await Promise.all([
    supabase.from("commission_plan_tiers").select("min_bookings, rate_type, rate_value").eq("plan_id", planId),
    supabase
      .from("bookings")
      .select("id, sale_value, booked_at")
      .eq("employee_id", employeeId)
      .gte("booked_at", `${startDate}T00:00:00`)
      .lte("booked_at", `${endDate}T23:59:59`)
      .order("booked_at", { ascending: true })
  ]);

  const sortedTiers = (tiers || []).slice().sort((a, b) => a.min_bookings - b.min_bookings);
  const rows: { booking_id: string; amount: number }[] = [];
  let total = 0;

  (bookings || []).forEach((b, idx) => {
    const position = idx + 1;
    const tier = sortedTiers.filter((t) => t.min_bookings <= position).pop();
    if (!tier) return;
    const amount = tier.rate_type === "FLAT_PER_BOOKING" ? tier.rate_value : (tier.rate_value / 100) * Number(b.sale_value);
    rows.push({ booking_id: b.id, amount });
    total += amount;
  });

  if (rows.length > 0) {
    await supabase.from("commission_ledger").upsert(
      rows.map((r) => ({
        employee_id: employeeId,
        booking_id: r.booking_id,
        plan_id: planId,
        amount: r.amount,
        pay_period: payPeriod,
        computed_by_employee_id: computedByEmployeeId
      })),
      { onConflict: "booking_id" }
    );
  }

  return { skipped: null, bookingsCount: bookings?.length || 0, commissionAmount: total };
}

export interface ConditionRuleComputeResult {
  skipped: string | null;
  metricValue: number;
  salaryPercentApplied: number;
  baseCutAmount: number;
  refundAppliedAmount: number;
}

// Metric (booking count) is read straight from leads, deliberately NOT
// from the bookings table -- an employee can be on a condition rule
// without ever being on a commission plan, and forcing a sale-value-
// bearing bookings row just to get a raw count would be unnecessary
// friction for them. See computeCommissionForMonth for the (separate)
// bookings-table-based flow.
export async function computeConditionRuleForMonth(
  employeeId: string,
  yyyyMm: string,
  computedByEmployeeId: string
): Promise<ConditionRuleComputeResult> {
  const { startDate, endDate, payPeriod } = monthBounds(yyyyMm);

  const { data: assignments } = await supabase
    .from("employee_payroll_rule_assignments")
    .select("rule_id")
    .eq("employee_id", employeeId)
    .lte("effective_from", endDate)
    .order("effective_from", { ascending: false })
    .limit(1);

  const ruleId = assignments?.[0]?.rule_id;
  if (!ruleId)
    return { skipped: "No payroll condition rule assigned as of this month.", metricValue: 0, salaryPercentApplied: 100, baseCutAmount: 0, refundAppliedAmount: 0 };

  const [{ data: rule }, { data: tiers }, { count: bookingsCount }] = await Promise.all([
    supabase.from("payroll_condition_rules").select("refund_on_recovery").eq("id", ruleId).single(),
    supabase.from("payroll_condition_rule_tiers").select("min_metric_value, salary_percent").eq("rule_id", ruleId),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("current_owner_id", employeeId)
      .eq("status", "CONVERTED")
      .eq("board_stage", "BOOKING")
      .gte("board_stage_changed_at", `${startDate}T00:00:00`)
      .lte("board_stage_changed_at", `${endDate}T23:59:59`)
  ]);

  const metricValue = bookingsCount || 0;
  const sortedTiers = (tiers || []).slice().sort((a, b) => a.min_metric_value - b.min_metric_value);
  const matchedTier = sortedTiers.filter((t) => t.min_metric_value <= metricValue).pop();
  // No tier matches (e.g. metric below the lowest tier's threshold) is
  // treated as full pay, not a silent 0% cut -- a rule with gaps in its
  // tiers should never produce a worse-than-defined outcome.
  const salaryPercentApplied = matchedTier?.salary_percent ?? 100;
  const topTierPercent = sortedTiers.length > 0 ? sortedTiers[sortedTiers.length - 1].salary_percent : 100;

  const basicPay = await resolveBasicPayAsOf(employeeId, endDate);
  const baseCutAmount = salaryPercentApplied < 100 ? basicPay * (1 - salaryPercentApplied / 100) : 0;

  // Refund-on-recovery: only ever looks at the LITERAL immediately-
  // preceding calendar month's stored row for this employee+rule -- a
  // gap (no row, or a row that wasn't itself a cut) breaks the chain
  // with no extra branching needed, by construction.
  let refundAppliedAmount = 0;
  if (rule?.refund_on_recovery && salaryPercentApplied >= topTierPercent) {
    const [py, pm] = yyyyMm.split("-").map(Number);
    const prevDate = new Date(py, pm - 2, 1);
    const prevPayPeriod = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}-01`;

    const { data: prevResult } = await supabase
      .from("employee_monthly_performance_results")
      .select("base_cut_amount")
      .eq("employee_id", employeeId)
      .eq("rule_id", ruleId)
      .eq("pay_period", prevPayPeriod)
      .maybeSingle();

    if (prevResult && Number(prevResult.base_cut_amount) > 0) {
      refundAppliedAmount = Number(prevResult.base_cut_amount);
    }
  }

  await supabase.from("employee_monthly_performance_results").upsert(
    {
      employee_id: employeeId,
      rule_id: ruleId,
      pay_period: payPeriod,
      metric_value: metricValue,
      salary_percent_applied: salaryPercentApplied,
      base_cut_amount: baseCutAmount,
      refund_applied_amount: refundAppliedAmount,
      computed_by_employee_id: computedByEmployeeId
    },
    { onConflict: "employee_id,rule_id,pay_period" }
  );

  return { skipped: null, metricValue, salaryPercentApplied, baseCutAmount, refundAppliedAmount };
}

export interface AttendanceDeductionComputeResult {
  skipped: string | null;
  absenceLopDays: number;
  lateComingLopDays: number;
  sandwichLeaveLopDays: number;
  totalLopDays: number;
}

// Plain-absence LOP (2026-09-28) -- runs for EVERY employee unconditionally,
// no rule assignment needed: a working day (non-weekly-off) with no
// attendance row at all is a full, unexplained absence, and this project
// has no leave-balance/approved-leave concept to distinguish that from
// anything else (see SalarySlipInput's own note on this) -- so "no
// attendance = no pay for that day" is the simplest default the existing
// data actually supports, not a new policy being invented. Explicit
// judgment call, flagged rather than silently assumed: there is no
// opt-out for this: HR's manual LOP Days override on the slip (never
// silently forced) is the only escape hatch for a case that shouldn't
// count (e.g. a flat-retainer contractor). Late Coming and Sandwich
// Leave stay opt-in-only below, unchanged -- those convert a specific,
// deliberate HR policy into LOP, not a universal absence fact, so they
// don't belong in this default.
//
// Late Coming reuses calculateDailyHrmsStatus + applyMonthlyLateComingRule
// verbatim -- the exact same functions and weekly-off exclusion the
// Monthly Summary attendance view already uses (lib/calculateHrmsAttendanceStatus.ts),
// never reimplemented. Sandwich Leave is new logic: a weekly-off day
// with an ABSENT day immediately before AND after it becomes +1 LOP day,
// since otherwise that off-day is a "free" day in the middle of an
// extended, undeclared absence.
export async function computeAttendanceDeductionForMonth(
  employeeId: string,
  yyyyMm: string,
  computedByEmployeeId: string
): Promise<AttendanceDeductionComputeResult> {
  const { y, m, daysInMonth, startDate, endDate, payPeriod } = monthBounds(yyyyMm);

  const { data: assignmentsRaw } = await supabase
    .from("employee_attendance_deduction_rule_assignments")
    .select("rule_id, rule:attendance_deduction_rules(rule_type)")
    .eq("employee_id", employeeId)
    .lte("effective_from", endDate)
    .order("effective_from", { ascending: false });

  const assignments = (assignmentsRaw || []) as unknown as { rule_id: string | null; rule: { rule_type: string } | null }[];

  // Same conservative per-type resolution as currentAttRuleForType() in
  // app/hr/salary/page.tsx: latest row among {unassign rows} union
  // {rows of this type} -- fails toward "not active" rather than a
  // stale "active" if an unassign row's type is ambiguous.
  function isActive(type: string): boolean {
    const relevant = assignments.filter((a) => a.rule_id === null || a.rule?.rule_type === type);
    return relevant.length > 0 && relevant[0].rule_id !== null;
  }

  const lateActive = isActive("LATE_COMING_THRESHOLD");
  const sandwichActive = isActive("SANDWICH_LEAVE");

  const { data: settings } = await supabase.from("hrms_settings").select("first_half_ontime_cutoff, second_half_ontime_cutoff").eq("id", 1).single();
  const { data: les } = await supabase.from("lead_engine_settings").select("sla_weekly_off_day").eq("id", 1).single();
  const weeklyOffDay = les?.sla_weekly_off_day ?? 0;

  const { data: monthAttendance } = await supabase
    .from("attendance")
    .select("date, shift_start_at, attendance_type")
    .eq("employee_id", employeeId)
    .gte("date", startDate)
    .lte("date", endDate);

  const workingDates: string[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    if (new Date(y, m - 1, d).getDay() === weeklyOffDay) continue;
    workingDates.push(`${yyyyMm}-${String(d).padStart(2, "0")}`);
  }

  const daily: DailyHrmsStatus[] = settings
    ? workingDates.map((date) => {
        const row = (monthAttendance || []).find((a) => a.date === date) || null;
        return calculateDailyHrmsStatus(row as any, settings as any);
      })
    : [];

  const absenceLopDays = daily.filter((s) => s === "ABSENT").length;

  let lateComingLopDays = 0;
  if (lateActive && settings) {
    const monthly = applyMonthlyLateComingRule(daily);
    lateComingLopDays = monthly.filter((s) => s === "HALF_DAY").length * 0.5;
  }

  let sandwichLeaveLopDays = 0;
  if (sandwichActive) {
    // Buffered window so a weekly-off on the 1st/last day of the month
    // can still see the adjacent day in the prior/next month.
    const bufferStart = new Date(y, m - 2, daysInMonth - 1).toISOString().slice(0, 10);
    const bufferEnd = new Date(y, m, 2).toISOString().slice(0, 10);

    const { data: bufferAttendance } = await supabase
      .from("attendance")
      .select("date")
      .eq("employee_id", employeeId)
      .gte("date", bufferStart)
      .lte("date", bufferEnd);

    const isAbsent = (dateStr: string) => !(bufferAttendance || []).some((a) => a.date === dateStr);

    for (let d = 1; d <= daysInMonth; d++) {
      if (new Date(y, m - 1, d).getDay() !== weeklyOffDay) continue;
      const before = new Date(y, m - 1, d - 1).toISOString().slice(0, 10);
      const after = new Date(y, m - 1, d + 1).toISOString().slice(0, 10);
      if (isAbsent(before) && isAbsent(after)) sandwichLeaveLopDays += 1;
    }
  }

  const totalLopDays = absenceLopDays + lateComingLopDays + sandwichLeaveLopDays;

  await supabase.from("employee_monthly_attendance_deduction_results").upsert(
    {
      employee_id: employeeId,
      pay_period: payPeriod,
      absence_lop_days: absenceLopDays,
      late_coming_lop_days: lateComingLopDays,
      sandwich_leave_lop_days: sandwichLeaveLopDays,
      total_lop_days: totalLopDays,
      computed_by_employee_id: computedByEmployeeId
    },
    { onConflict: "employee_id,pay_period" }
  );

  return { skipped: null, absenceLopDays, lateComingLopDays, sandwichLeaveLopDays, totalLopDays };
}

export interface ReimbursementComputeResult {
  skipped: string | null;
  reimbursementAmount: number;
  expenseCount: number;
}

// Reimbursements -- deliberately NOT a compute-and-persist function like
// the three above: expenses.status='PAID' rows are already the final,
// authoritative source of truth (Payroll itself sets that status when
// marking an expense paid, on app/payroll/expenses/page.tsx), so there's
// no calculation to freeze -- a fresh SUM every time is strictly correct
// and avoids one more table to keep in sync. Filtered by paid_date (not
// expense_date): a reimbursement belongs to the pay period it's actually
// disbursed in, not the period the expense was originally incurred --
// same reasoning as any other payroll reimbursement timing.
export async function computeReimbursementForMonth(employeeId: string, yyyyMm: string): Promise<ReimbursementComputeResult> {
  const { startDate, endDate } = monthBounds(yyyyMm);

  const { data, error } = await supabase
    .from("expenses")
    .select("amount")
    .eq("employee_id", employeeId)
    .eq("status", "PAID")
    .gte("paid_date", startDate)
    .lte("paid_date", endDate);

  if (error || !data || data.length === 0) {
    return { skipped: "No paid reimbursements for this month.", reimbursementAmount: 0, expenseCount: 0 };
  }

  const reimbursementAmount = data.reduce((sum, row) => sum + Number(row.amount), 0);
  return { skipped: null, reimbursementAmount, expenseCount: data.length };
}
