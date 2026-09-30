"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { IndianRupee, Receipt, ClipboardCheck, AlertTriangle, Briefcase, ArrowRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/fetchAllRows";

interface Stats {
  computedThisMonth: number;
  activeEmployees: number;
  missingBasicPay: number;
  missingSaleValue: number;
  pendingExpenses: number;
}

const QUICK_LINKS = [
  { name: "Salary", href: "/payroll/salary", icon: IndianRupee, color: "text-emerald-600 bg-emerald-50", description: "Compute, generate & issue slips" },
  { name: "Expenses", href: "/payroll/expenses", icon: Receipt, color: "text-amber-600 bg-amber-50", description: "Review & approve employee expenses" }
];

// Payroll's landing screen -- previously login sent Payroll straight
// into the Salary page's long form stack with no orientation. Real,
// simple COUNT queries only (Compute Completion reuses the exact same
// pay_period-count shape already used in app/payroll/salary/page.tsx,
// not a re-derivation of anything).
export default function PayrollHomePage() {
  const [payrollName, setPayrollName] = useState("");
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    loadName();
    loadStats();
  }, []);

  async function loadName() {
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from("employees").select("name").eq("auth_user_id", user.id).single();
    if (data) setPayrollName(data.name);
  }

  async function loadStats() {
    const now = new Date();
    const payPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

    const [{ data: employees }, { data: compRows }, { data: computedRows }, { data: bookedLeads }, { data: bookingRows }, { count: pendingExpenses }] =
      await Promise.all([
        supabase.from("employees").select("id").eq("is_active", true),
        supabase.from("employee_compensation").select("employee_id"),
        supabase.from("employee_monthly_attendance_deduction_results").select("employee_id").eq("pay_period", payPeriod),
        fetchAllRows(
          () => supabase.from("leads").select("id", { count: "exact" }).eq("status", "CONVERTED").eq("board_stage", "BOOKING").order("id"),
          { anomalyContext: { supabase, source: "payroll_home_missing_sale_value" } }
        ),
        supabase.from("bookings").select("lead_id"),
        supabase.from("expenses").select("id", { count: "exact", head: true }).eq("status", "PENDING")
      ]);

    const compensatedIds = new Set((compRows || []).map((r) => r.employee_id));
    const activeIds = (employees || []).map((e) => e.id);
    const loggedLeadIds = new Set((bookingRows || []).map((b) => b.lead_id));

    setStats({
      computedThisMonth: new Set((computedRows || []).map((r) => r.employee_id)).size,
      activeEmployees: activeIds.length,
      missingBasicPay: activeIds.filter((id) => !compensatedIds.has(id)).length,
      missingSaleValue: (bookedLeads || []).filter((l) => !loggedLeadIds.has(l.id)).length,
      pendingExpenses: pendingExpenses || 0
    });
  }

  const monthLabel = new Date().toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-800">{payrollName ? `Welcome back, ${payrollName.split(" ")[0]}` : "Welcome back"}</h1>
        <p className="text-sm text-slate-500">{monthLabel}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={ClipboardCheck}
          label={`Computed — ${monthLabel}`}
          value={stats ? `${stats.computedThisMonth}/${stats.activeEmployees}` : undefined}
          color="text-violet-600 bg-violet-50"
          href="/payroll/salary"
        />
        <StatCard
          icon={AlertTriangle}
          label="Missing Basic Pay"
          value={stats?.missingBasicPay}
          color="text-amber-600 bg-amber-50"
          href={stats && stats.missingBasicPay > 0 ? "/payroll/salary" : undefined}
        />
        <StatCard
          icon={Briefcase}
          label="Bookings Missing Sale Value"
          value={stats?.missingSaleValue}
          color="text-rose-600 bg-rose-50"
          href={stats && stats.missingSaleValue > 0 ? "/hr/salary" : undefined}
        />
        <StatCard
          icon={Receipt}
          label="Pending Expenses"
          value={stats?.pendingExpenses}
          color="text-cyan-600 bg-cyan-50"
          href={stats && stats.pendingExpenses > 0 ? "/payroll/expenses" : undefined}
        />
      </div>

      <div>
        <p className="text-sm font-bold text-slate-800 mb-3">Go to</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {QUICK_LINKS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm hover:shadow-md hover:border-slate-300 transition flex items-center gap-3 group"
            >
              <div className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 ${item.color}`}>
                <item.icon size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-800">{item.name}</p>
                <p className="text-xs text-slate-500 truncate">{item.description}</p>
              </div>
              <ArrowRight size={16} className="text-slate-300 group-hover:text-slate-500 group-hover:translate-x-0.5 transition shrink-0" />
            </Link>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  href
}: {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  value: number | string | undefined;
  color: string;
  href?: string;
}) {
  const content = (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm h-full">
      <div className={`h-9 w-9 rounded-lg flex items-center justify-center mb-3 ${color}`}>
        <Icon size={17} />
      </div>
      <p className="text-2xl font-bold text-slate-800 tabular-nums">{value === undefined ? "—" : value}</p>
      <p className="text-xs font-semibold text-slate-500 mt-0.5">{label}</p>
    </div>
  );
  if (href) {
    return (
      <Link href={href} className="block hover:shadow-md hover:border-slate-300 transition rounded-2xl">
        {content}
      </Link>
    );
  }
  return content;
}
