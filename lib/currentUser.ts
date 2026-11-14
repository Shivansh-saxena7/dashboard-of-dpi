// Who is logged in, without being thrown out by a bad network (2026-11-14).
//
// supabase.auth.getUser() asks the server. On a weak connection, or when a request is cut off (page reload, the app
// coming back from the background), that call fails for network reasons and returns no user, and the page then sent a
// logged-in employee to /login. Now: a network failure gets one more try after AUTH_RETRY_DELAY_MS; if the phone is
// still offline, the session stored on the phone is used. That is safe: the database still checks the login on every
// request (RLS), so an expired or revoked login cannot read anything; it only means the page does not bounce the
// employee to /login. A real "not logged in" answer (no session, invalid or expired token) still returns null.
// isAuthNetworkError is pure and known-answer tested in scripts/check-current-user.js.

import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export const AUTH_RETRY_DELAY_MS = 1500;

export function isAuthNetworkError(error: { name?: string; status?: number; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.name === "AuthRetryableFetchError") return true;
  if (typeof error.status === "number" && error.status > 0) return false;
  return /failed to fetch|load failed|networkerror|network request failed|fetch failed|the network connection was lost/i.test(error.message || "");
}

export async function getCurrentUser(): Promise<User | null> {
  const first = await supabase.auth.getUser();
  if (first.data.user) return first.data.user;
  if (!isAuthNetworkError(first.error)) return null;

  await new Promise((resolve) => setTimeout(resolve, AUTH_RETRY_DELAY_MS));
  const second = await supabase.auth.getUser();
  if (second.data.user) return second.data.user;
  if (!isAuthNetworkError(second.error)) return null;

  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.user ?? null;
}
