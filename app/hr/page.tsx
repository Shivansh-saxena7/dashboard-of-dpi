"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Clock, GraduationCap, FileText, IndianRupee, Smartphone, Users, UserPlus, AlertTriangle, Cake, ArrowRight } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface Stats {
  activeEmployees: number;
  candidatesInPipeline: number;
  missingBasicPay: number;
  missingDob: number;
}

const QUICK_LINKS = [
  { name: "Attendance", href: "/hr/attendance", icon: Clock, color: "text-blue-600 bg-blue-50", description: "Daily tracking, manual overrides" },
  { name: "Candidates", href: "/hr/candidates", icon: GraduationCap, color: "text-violet-600 bg-violet-50", description: "Pipeline, interviews, offers" },
  { name: "Documents", href: "/hr/documents", icon: FileText, color: "text-amber-600 bg-amber-50", description: "Templates, generated letters" },
  { name: "Salary", href: "/hr/salary", icon: IndianRupee, color: "text-emerald-600 bg-emerald-50", description: "Pay policy, employee setup" },
  { name: "SIM / Email", href: "/hr/sim-assignments", icon: Smartphone, color: "text-cyan-600 bg-cyan-50", description: "Company SIM & email assignment" }
];

// HR's landing screen -- previously login sent HR straight into
// Attendance with no orientation. This gives a quick "what needs my
// attention" glance (real, simple COUNT queries only -- no
// re-derivation of attendance-status logic, which stays owned solely
// by app/hr/attendance/page.tsx per this codebase's one-owner rule)
// plus a card per section for anyone unsure where to click.
export default function HrHomePage() {
  const [hrName, setHrName] = useState("");
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
    if (data) setHrName(data.name);
  }

  async function loadStats() {
    const [{ count: activeEmployees }, { count: candidatesInPipeline }, { data: employees }, { data: compRows }, { data: dobRows }] = await Promise.all([
      supabase.from("employees").select("id", { count: "exact", head: true }).eq("is_active", true),
      supabase.from("candidates").select("id", { count: "exact", head: true }).not("status", "in", "(CONVERTED,REJECTED)"),
      supabase.from("employees").select("id").eq("is_active", true),
      supabase.from("employee_compensation").select("employee_id"),
      supabase.from("employee_payroll_details").select("employee_id, date_of_birth")
    ]);

    const compensatedIds = new Set((compRows || []).map((r) => r.employee_id));
    const dobIds = new Set((dobRows || []).filter((r) => r.date_of_birth).map((r) => r.employee_id));
    const activeIds = (employees || []).map((e) => e.id);

    setStats({
      activeEmployees: activeEmployees || 0,
      candidatesInPipeline: candidatesInPipeline || 0,
      missingBasicPay: activeIds.filter((id) => !compensatedIds.has(id)).length,
      missingDob: activeIds.filter((id) => !dobIds.has(id)).length
    });
  }

  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-800">{hrName ? `Welcome back, ${hrName.split(" ")[0]}` : "Welcome back"}</h1>
        <p className="text-sm text-slate-500">{today}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={Users} label="Active Employees" value={stats?.activeEmployees} color="text-blue-600 bg-blue-50" />
        <StatCard icon={UserPlus} label="Candidates in Pipeline" value={stats?.candidatesInPipeline} color="text-violet-600 bg-violet-50" />
        <StatCard
          icon={AlertTriangle}
          label="Missing Basic Pay"
          value={stats?.missingBasicPay}
          color="text-amber-600 bg-amber-50"
          href={stats && stats.missingBasicPay > 0 ? "/hr/salary" : undefined}
        />
        <StatCard
          icon={Cake}
          label="Missing Date of Birth"
          value={stats?.missingDob}
          color="text-pink-600 bg-pink-50"
          href={stats && stats.missingDob > 0 ? "/hr/salary" : undefined}
        />
      </div>

      <div>
        <p className="text-sm font-bold text-slate-800 mb-3">Go to</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
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
  value: number | undefined;
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
