"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Menu, X, Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import SessionGuard from "@/components/SessionGuard";
import Footer from "@/components/Footer";
import NotificationModal from "@/components/NotificationModal";

// Sales Coordinator's own area — deliberately a SEPARATE route tree
// from /admin (same precedent Team Leader already set with /team),
// not a role-gated variant of the Admin pages. This keeps every
// existing /admin page's guard and RLS-backed data untouched — a new
// role only ever adds new, narrowly-scoped read access (see the
// Phase 0 RLS policies), never widens what the existing Admin
// surface exposes. Admin can also reach this area (their role passes
// the guard below too) rather than a second copy of this UI living
// inside /admin as well — one owner for this dashboard.
export default function CoordinatorLayout({
  children
}: {
  children: React.ReactNode;
}) {

  const [name, setName] = useState("Coordinator");
  const [menuOpen, setMenuOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const router = useRouter();

  useEffect(() => {
    loadCoordinator();
  }, []);

  // Same realtime pattern already proven in components/Header.tsx
  // (Employee/Team-Leader side) — a filtered postgres_changes
  // subscription on notification INSERTs for this employee, with the
  // "remove any existing channel with the same topic first" guard
  // that pattern already carries (handles React Strict-Mode's
  // double-mount in dev without leaking a duplicate channel).
  useEffect(() => {
    if (!employeeId) return;

    let cancelled = false;

    const existing = supabase.getChannels().find((ch) => ch.topic === `realtime:coordinator-${employeeId}`);
    if (existing) {
      supabase.removeChannel(existing);
    }

    const channel = supabase
      .channel(`coordinator-${employeeId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notification", filter: `employee_id=eq.${employeeId}` },
        (payload) => {
          if (cancelled || payload.new?.employee_id !== employeeId) return;
          setUnreadCount((prev) => prev + 1);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [employeeId]);

  async function loadUnreadCount(id: string) {
    const { count } = await supabase
      .from("notification")
      .select("*", { count: "exact", head: true })
      .eq("employee_id", id)
      .eq("is_read", false);

    setUnreadCount(count || 0);
  }

  async function loadNotifications(id: string) {
    const { data } = await supabase
      .from("notification")
      .select("*")
      .eq("employee_id", id)
      .order("created_at", { ascending: false })
      .limit(50);

    setNotifications(data || []);
  }

  async function handleBellClick() {
    if (!employeeId) return;

    await loadNotifications(employeeId);

    await supabase
      .from("notification")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq("employee_id", employeeId)
      .eq("is_read", false);

    setUnreadCount(0);
    setShowNotifications(true);
  }

  const loadCoordinator = async () => {

    const {
      data: { session }
    } = await supabase.auth.getSession();

    if (!session) {
      router.replace("/login");
      return;
    }

    const { data } = await supabase
      .from("employees")
      .select("id, name, role, is_active")
      .eq("auth_user_id", session.user.id)
      .single();

    if (!data) {
      router.replace("/login");
      return;
    }

    if (!data.is_active) {
      await supabase.auth.signOut();
      router.replace("/login");
      return;
    }

    if (data.role !== "admin" && data.role !== "sales_coordinator") {
      router.replace("/");
      return;
    }

    setName(data.name);
    setEmployeeId(data.id);
    loadUnreadCount(data.id);

  };

  const menu = [
    { name: "Dashboard", href: "/coordinator", icon: "📊" }
  ];

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <SessionGuard>
      <div className="min-h-screen bg-[#f4f8fc] flex">

        {menuOpen && (
          <div
            onClick={() => setMenuOpen(false)}
            className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          />
        )}

        <div
          className={`fixed top-0 left-0 z-50 h-screen w-[230px] bg-white border-r border-slate-200 transition-all duration-300 shadow-xl flex flex-col ${
            menuOpen ? "translate-x-0" : "-translate-x-full"
          } lg:translate-x-0`}
        >
          <div className="p-3 lg:p-5">
            <div className="flex items-center gap-4">
              <div className="relative w-16 h-16 rounded-2xl bg-white shadow-lg overflow-hidden">
                <Image src="/dpilogo.png" alt="logo" fill className="object-contain scale-150" />
              </div>
              <div>
                <h2 className="font-bold text-slate-800">{name}</h2>
                <p className="text-sm text-slate-500">Sales Coordinator</p>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 space-y-2">
            {menu.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-4 px-4 py-4 rounded-2xl hover:bg-gradient-to-r hover:from-cyan-500 hover:to-blue-600 hover:text-white transition-all font-medium text-slate-700"
              >
                <span>{item.icon}</span>
                {item.name}
              </Link>
            ))}

            <div className="p-4 border-t border-slate-200">
              <button
                onClick={handleLogout}
                className="w-full rounded-xl bg-red-500 text-white py-3 font-medium hover:bg-red-600 transition"
              >
                Logout
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 lg:ml-[230px] w-full">
          <div className="sticky top-0 z-30 bg-white/90 backdrop-blur-xl border-b border-slate-200 px-5 h-[60px] flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button onClick={() => setMenuOpen(true)} className="lg:hidden">
                <Menu size={30} />
              </button>
              <div>
                <h1 className="font-bold text-xl lg:text-xl text-slate-800">Coordinator Dashboard</h1>
                <p className="text-slate-500 text-xs">Welcome back, {name}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleBellClick}
                className="relative p-2 rounded-lg bg-white border border-slate-200 shadow-sm hover:bg-slate-50 transition"
              >
                <Bell size={18} className="text-slate-600" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-bold animate-pulse">
                    {unreadCount}
                  </span>
                )}
              </button>

              <div className="h-10 w-10 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 flex items-center justify-center text-white font-bold shadow-lg">
                {name.charAt(0)}
              </div>
            </div>
          </div>

          <div className="p-3 lg:p-5">
            {children}
            <Footer />
          </div>
        </div>

      </div>

      {showNotifications && (
        <NotificationModal notifications={notifications} onClose={() => setShowNotifications(false)} />
      )}
    </SessionGuard>
  );
}
