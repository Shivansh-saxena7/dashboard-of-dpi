"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import PageHeader from "@/components/PageHeader";
import PositiveJunkBrowser from "@/components/PositiveJunkBrowser";
import { PositiveJunkData } from "@/lib/positiveJunk";

// Positive-history junk (2026-10-29): every JUNK lead that once had a real conversation
// (Connected, Follow-up, Visit, Booking, Converted), so an admin can give it back to an
// employee. Admin-only like every /admin page (admin/layout.tsx); the RPCs check again.
export default function PositiveJunkPage() {
  const [data, setData] = useState<PositiveJunkData | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing" | "error">("loading");
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setState("loading");
    const { data, error } = await supabase.rpc("get_positive_junk_leads");
    if (error) {
      setState(error.code === "PGRST202" || error.code === "42883" ? "missing" : "error");
      setError(error.message);
      return;
    }
    setData(data as PositiveJunkData);
    setVersion((v) => v + 1);
    setState("ok");
  }

  return (
    <div className="max-w-6xl pb-24">
      <div className="mb-5">
        <PageHeader
          eyebrow="Leads"
          title="Positive-history junk"
          description="Leads the system junked although someone once had a real conversation with them. Pick leads and give them back to an employee."
        />
      </div>
      {state === "loading" && <p className="text-sm text-slate-400">Loading...</p>}
      {state === "missing" && <p className="text-sm text-slate-400">This page is not switched on yet.</p>}
      {state === "error" && <p className="text-sm text-red-600">Could not load: {error}</p>}
      {/* key: a reload starts with a clean selection */}
      {state === "ok" && data && <PositiveJunkBrowser key={version} data={data} onReload={load} />}
    </div>
  );
}
