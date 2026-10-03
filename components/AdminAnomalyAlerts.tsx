"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";

const ANOMALY_TYPES = ["SYSTEM_ANOMALY_ERROR", "SYSTEM_ANOMALY_WARNING"];

// Live system-failure alerts for the admin panel (2026-10-03). The
// admin layout has no notification bell (Header.tsx's bell is only on
// employee pages), so this is how Admin actually hears about a new
// system_anomaly_log entry without visiting /admin/system-health.
//
// The notification rows themselves are created by ONE DB trigger
// (notify_admins_of_anomaly — errors immediately, warnings on their
// 5th repeat within an hour); this component only displays them:
// errors as a persistent red toast, warnings as a normal toast, plus a
// pill with the unread count that opens System Health.
export default function AdminAnomalyAlerts() {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [unreadIds, setUnreadIds] = useState<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function setup() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || cancelled) return;

      const { data: employee } = await supabase
        .from("employees")
        .select("id")
        .eq("auth_user_id", session.user.id)
        .single();
      if (!employee || cancelled) return;

      setEmployeeId(employee.id);

      const { data: unread } = await supabase
        .from("notification")
        .select("id")
        .eq("employee_id", employee.id)
        .in("type", ANOMALY_TYPES)
        .eq("is_read", false)
        .limit(100);
      if (!cancelled) setUnreadIds((unread || []).map((n) => n.id));

      channel = supabase
        .channel(`admin-anomalies-${employee.id}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notification", filter: `employee_id=eq.${employee.id}` },
          (payload) => {
            const n = payload.new as { id: number; type: string; title: string; message: string };
            if (!ANOMALY_TYPES.includes(n.type)) return;

            setUnreadIds((prev) => [...prev, n.id]);

            const text = `${n.title}\n${n.message}`;
            if (n.type === "SYSTEM_ANOMALY_ERROR") {
              toast.error(text, { id: `anomaly-${n.id}`, duration: Infinity });
            } else {
              toast(text, { id: `anomaly-${n.id}`, icon: "🟠", duration: 10000 });
            }
          }
        )
        .subscribe();
    }

    setup();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  async function openSystemHealth() {
    if (employeeId && unreadIds.length > 0) {
      await supabase
        .from("notification")
        .update({ is_read: true, read_at: new Date().toISOString() })
        .in("id", unreadIds);
    }
    setUnreadIds([]);
    toast.dismiss();
    router.push("/admin/system-health");
  }

  if (unreadIds.length === 0) return null;

  return (
    <button
      onClick={openSystemHealth}
      className="fixed top-4 right-4 z-[90] rounded-full bg-red-600 text-white text-sm font-semibold px-4 py-2 shadow-lg hover:bg-red-700 transition"
    >
      ⚠ {unreadIds.length} system alert{unreadIds.length === 1 ? "" : "s"}
    </button>
  );
}
