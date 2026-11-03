import { supabase } from "@/lib/supabase";

// fetch() to this app's own API routes with the logged-in user's token, for routes that check the
// caller (the session lives in the browser, not in a cookie, so it has to be sent by hand).
export async function authedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`);
  return fetch(input, { ...init, headers });
}
