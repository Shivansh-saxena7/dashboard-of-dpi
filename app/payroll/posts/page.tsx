"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import PostsTrackingView from "@/components/PostsTrackingView";

// Payroll's own view of the same universal social-media post tracking
// every employee gets -- read/mark-done only, via PostsTrackingView
// (shared with app/page.tsx and app/hr/posts). No post creation/
// assignment here or anywhere outside app/admin/posts/page.tsx.
export default function PayrollPostsPage() {
  const [me, setMe] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    async function load() {
      const {
        data: { user }
      } = await supabase.auth.getUser();

      if (!user) return;

      const { data } = await supabase
        .from("employees")
        .select("id, name")
        .eq("auth_user_id", user.id)
        .single();

      if (data) setMe(data);
    }

    load();
  }, []);

  if (!me) return null;

  return <PostsTrackingView employeeId={me.id} employeeName={me.name} />;
}
