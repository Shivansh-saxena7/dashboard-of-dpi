"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import TicketsView from "@/components/TicketsView";

// Admin's own Tickets view — no separate admin-flavored component
// (Golden Rule): reuses the exact same TicketsView every other
// surface uses. Admin's RLS already returns every ticket regardless
// of category, and Admin is a universal resolver override in
// update_ticket_status_atomic — so this "just works" without any
// admin-specific branching in TicketsView itself. myEmployeeId is
// still needed (not null) since Admin can also raise tickets
// ("koi-bhi-employee" includes Admin) and needs their own raised
// tickets to land in "My Tickets", not "To Resolve". No auth-check
// needed here — admin/layout.tsx already gates on role === "admin"
// before children render.
export default function AdminTicketsPage() {
  const [employeeId, setEmployeeId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const {
        data: { user }
      } = await supabase.auth.getUser();

      if (!user) return;

      const { data } = await supabase
        .from("employees")
        .select("id")
        .eq("auth_user_id", user.id)
        .single();

      if (data) setEmployeeId(data.id);
    }

    load();
  }, []);

  return <TicketsView myEmployeeId={employeeId} />;
}
