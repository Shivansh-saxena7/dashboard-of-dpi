"use client";
// The signed-in employee's role, asked once per page load (one bounded read) and shared by every caller.
import { supabase } from "@/lib/supabase";

let pending: Promise<string | null> | null = null;

export function viewerRole(): Promise<string | null> {
  if (!pending) {
    pending = (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth?.user?.id;
        if (!uid) return null;
        const { data } = await supabase.from("employees").select("role").eq("auth_user_id", uid).maybeSingle();
        return ((data as { role?: string } | null)?.role ?? null) as string | null;
      } catch {
        return null;
      }
    })();
    // A failed answer is not kept, so the next open asks again.
    pending.then((r) => { if (r === null) pending = null; });
  }
  return pending;
}

export const isAdminRole = (r: string | null | undefined) => r === "admin" || r === "super_admin";
