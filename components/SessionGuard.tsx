"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import toast from "react-hot-toast";

export default function SessionGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    let channel: any;
    let cancelled = false;

    const setup = async () => {
      const {
        data: { user }
      } = await supabase.auth.getUser();

      if (!user || cancelled) return;

      const { data: employee } = await supabase
        .from("employees")
        .select("id, role, is_active")
        .eq("auth_user_id", user.id)
        .single();

      if (!employee || cancelled) return;

      // ✅ agar isi naam ka channel pehle se maujood hai (Strict Mode double-run se), pehle usko hatao
      const existing = supabase.getChannels().find((ch) => ch.topic === `realtime:session-guard-${employee.id}`);

      if (existing) {
        await supabase.removeChannel(existing);
      }

      if (cancelled) return;

      channel = supabase
        .channel(`session-guard-${employee.id}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "employees",
            filter: `id=eq.${employee.id}`
          },
          async (payload) => {
            const updated = payload.new as any;

            if (updated.role !== "admin" && employee.role === "admin") {
              toast.error("Your admin access has been removed.");
              await supabase.auth.signOut();
              router.replace("/login");
              return;
            }

            if (updated.is_active === false) {
              toast.error("Your account has been deactivated.");
              await supabase.auth.signOut();
              router.replace("/login");
              return;
            }
          }
        )
        .subscribe();
    };

    setup();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [router]);

  return <>{children}</>;
}