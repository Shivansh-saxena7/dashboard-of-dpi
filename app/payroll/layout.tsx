"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Menu, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import SessionGuard from "@/components/SessionGuard";
import Footer from "@/components/Footer";

// Own top-level route section, completely separate from /hr -- Payroll
// and HR are deliberately distinct roles with zero shared UI/navigation.
// Admin also gets full access here (same "Admin is universal" pattern
// used everywhere else in this app).
// Nav items are added incrementally as each Payroll piece lands (same
// discipline used for /hr -- e.g. the SIM/Email nav entry was only
// added once that page actually existed).
const menu = [{ name: "Expenses", href: "/payroll/expenses", icon: "🧾" }];

// Sidebar is off-canvas on mobile and pinned on desktop (lg:) -- ported
// verbatim from app/admin/layout.tsx's own proven mechanism (menuOpen
// state, translate-x toggle, dismissible overlay, lg:hidden hamburger),
// same fix as app/hr/layout.tsx. Before this, the sidebar was
// unconditionally `fixed w-[230px]` with content at an unconditional
// `ml-[230px]` -- on a ~375px phone that's ~61% of the screen
// permanently occupied by the sidebar, with no way to hide it.
export default function PayrollLayout({ children }: { children: React.ReactNode }) {
  const [payrollName, setPayrollName] = useState("Payroll");
  const [menuOpen, setMenuOpen] = useState(false);
  const router = useRouter();

  async function loadPayroll() {
    const {
      data: { session }
    } = await supabase.auth.getSession();

    if (!session) {
      router.replace("/login");
      return;
    }

    const { data } = await supabase
      .from("employees")
      .select("name, role, is_active")
      .eq("auth_user_id", session.user.id)
      .single();

    if (!data || !data.is_active) {
      if (data && !data.is_active) await supabase.auth.signOut();
      router.replace("/login");
      return;
    }

    if (data.role !== "payroll" && data.role !== "admin") {
      router.replace("/");
      return;
    }

    setPayrollName(data.name);
  }

  useEffect(() => {
    loadPayroll();
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <SessionGuard>
      <div className="min-h-screen bg-[#f4f8fc] flex">
        {menuOpen && (
          <div onClick={() => setMenuOpen(false)} className="fixed inset-0 bg-black/40 z-40 lg:hidden" />
        )}

        <div
          className={`fixed top-0 left-0 z-50 h-screen w-[230px] bg-white border-r border-slate-200 shadow-xl flex flex-col transition-transform duration-300 ${
            menuOpen ? "translate-x-0" : "-translate-x-full"
          } lg:translate-x-0`}
        >
          <div className="p-5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="relative w-12 h-12 rounded-2xl bg-white shadow-lg overflow-hidden shrink-0">
                <Image src="/dpilogo.png" alt="logo" fill className="object-contain scale-150" />
              </div>
              <div className="min-w-0">
                <h2 className="font-bold text-slate-800 truncate">{payrollName}</h2>
                <p className="text-[10px] font-semibold tracking-[0.15em] text-slate-400 uppercase">Payroll Portal</p>
              </div>
            </div>
            <button onClick={() => setMenuOpen(false)} className="lg:hidden shrink-0 text-slate-400">
              <X size={22} />
            </button>
          </div>

          <nav className="flex-1 px-3 space-y-1">
            {menu.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50 transition"
              >
                <span>{item.icon}</span>
                {item.name}
              </Link>
            ))}
          </nav>

          <div className="p-3">
            <button
              onClick={handleLogout}
              className="w-full flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-semibold bg-red-50 text-red-600 hover:bg-red-100 transition"
            >
              Log Out
            </button>
          </div>
        </div>

        {/* min-w-0: same fix as app/admin/layout.tsx -- without it, a
            wide descendant many levels down (e.g. /payroll/expenses'
            filter row) pushes this flex item wider than its allotted
            space and the whole page goes into horizontal overflow. */}
        <div className="flex-1 lg:ml-[230px] w-full min-w-0">
          <div className="lg:hidden sticky top-0 z-30 bg-white/90 backdrop-blur-xl border-b border-slate-200 px-5 h-[60px] flex items-center gap-4">
            <button onClick={() => setMenuOpen(true)}>
              <Menu size={26} />
            </button>
            <p className="font-bold text-slate-800">Payroll Portal</p>
          </div>

          <div className="p-6">
            {children}
            <Footer />
          </div>
        </div>
      </div>
    </SessionGuard>
  );
}
