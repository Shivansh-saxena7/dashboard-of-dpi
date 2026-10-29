"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { CallQualityDetails, isCallQualityMissing, istDayKey } from "@/lib/callQuality";
import CallQualityDispute from "@/components/CallQualityDispute";

// Dispute view (Call Quality, 2026-10-29): one employee, one day, call by call — one clean page
// to print or screenshot when an employee questions their numbers (body: CallQualityDispute).
// Gated by admin/layout.tsx like every /admin page; the RPC itself checks the role again.
export default function DisputePage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-400">Loading...</p>}>
      <Dispute />
    </Suspense>
  );
}

function Dispute() {
  const params = useSearchParams();
  const employeeId = params.get("employee") ?? "";
  const [date, setDate] = useState(params.get("date") ?? istDayKey(0));
  const [result, setResult] = useState<{ key: string; data: CallQualityDetails | null; error: string | null } | null>(null);
  const key = `${employeeId}|${date}`;

  useEffect(() => {
    if (!employeeId) return;
    let cancelled = false;
    supabase.rpc("get_call_quality_details", { p_employee_id: employeeId, p_from: date, p_to: date }).then(({ data, error }) => {
      if (cancelled) return;
      setResult({ key, data: error ? null : (data as CallQualityDetails), error: error ? (isCallQualityMissing(error) ? "Call Quality is not switched on yet." : error.message) : null });
    });
    return () => {
      cancelled = true;
    };
  }, [key, employeeId, date]);

  if (!employeeId) return <p className="text-sm text-slate-500">Open this page from Work Reports → Call Quality → an employee → Open dispute view.</p>;
  if (!result || result.key !== key) return <p className="text-sm text-slate-400">Loading...</p>;
  if (result.error || !result.data) return <p className="text-sm text-red-600">{result.error}</p>;
  return <CallQualityDispute data={result.data} date={date} onDateChange={setDate} />;
}
