"use client";

// Personal lead → Visit report (2026-10-08, Personal lead v2). Personal
// (self-added) leads whose first visit was logged within 24h / 72h of the
// lead being created — the pattern worth a second look (on 04-05 Oct both
// personal-lead visits were logged within a minute of creating the lead).
// Read-only. Deliberately shows no client name or mobile: lead id (short),
// employee, timing and verification status only.

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import PageHeader from "@/components/PageHeader";

interface Row {
  leadId: string;
  employee: string;
  createdAt: string;
  visitAt: string;
  hours: number;
  status: "Verified" | "Denied" | "Pending";
  note: string | null;
}

const istDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const gap = (hours: number) => (hours < 1 ? `${Math.round(hours * 60)} min` : `${Math.round(hours * 10) / 10} h`);

export default function PersonalVisitsReportPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      // Personal leads are few (single digits per week); .limit keeps the
      // query bounded regardless.
      const { data } = await supabase
        .from("leads")
        .select(
          `id, created_at,
           site_visits ( event_type, created_at, verified_at, denied_at, note ),
           lead_history ( assigned_at, employee:employees!lead_history_employee_id_fkey ( name ) )`
        )
        .eq("is_personal_lead", true)
        .order("created_at", { ascending: false })
        .limit(500);

      type Raw = {
        id: string;
        created_at: string;
        site_visits: { event_type: string; created_at: string; verified_at: string | null; denied_at: string | null; note: string | null }[] | null;
        lead_history: { assigned_at: string; employee: { name: string | null } | null }[] | null;
      };

      const out: Row[] = [];
      for (const lead of (data as unknown as Raw[]) || []) {
        const firstVisit = (lead.site_visits || [])
          .filter((v) => v.event_type === "VISIT")
          .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))[0];
        if (!firstVisit) continue;
        const hours = (Date.parse(firstVisit.created_at) - Date.parse(lead.created_at)) / 3600000;
        if (hours > 72) continue;
        const creator = (lead.lead_history || []).sort((a, b) => Date.parse(a.assigned_at) - Date.parse(b.assigned_at))[0];
        out.push({
          leadId: lead.id.slice(0, 8),
          employee: creator?.employee?.name || "—",
          createdAt: lead.created_at,
          visitAt: firstVisit.created_at,
          hours,
          status: firstVisit.verified_at ? "Verified" : firstVisit.denied_at ? "Denied" : "Pending",
          note: firstVisit.note
        });
      }
      setRows(out.sort((a, b) => a.hours - b.hours));
      setLoading(false);
    })();
  }, []);

  const byEmployee = useMemo(() => {
    const map = new Map<string, { within24: number; within72: number; pending: number }>();
    for (const r of rows) {
      const e = map.get(r.employee) || { within24: 0, within72: 0, pending: 0 };
      if (r.hours <= 24) e.within24++;
      e.within72++;
      if (r.status === "Pending") e.pending++;
      map.set(r.employee, e);
    }
    return [...map.entries()].sort((a, b) => b[1].within72 - a[1].within72);
  }, [rows]);

  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader
        eyebrow="Leads"
        title="Personal Lead Visits"
        description="Personal (self-added) leads whose first visit was logged within 72 hours of the lead being created. Names and mobile numbers are not shown — only lead ID, employee and timing."
      />

      {loading ? (
        <Loader2 size={18} className="animate-spin text-slate-400" />
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-slate-100 shadow-md p-5">
            <p className="text-sm font-bold text-slate-800 mb-3">Employee-wise</p>
            {byEmployee.length === 0 ? (
              <p className="text-xs text-slate-400">No personal-lead visits within 72h.</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-400">
                    <th className="py-1.5 pr-3 font-semibold">Employee</th>
                    <th className="py-1.5 pr-3 font-semibold">Within 24h</th>
                    <th className="py-1.5 pr-3 font-semibold">Within 72h</th>
                    <th className="py-1.5 pr-3 font-semibold">Pending verification</th>
                  </tr>
                </thead>
                <tbody>
                  {byEmployee.map(([name, e]) => (
                    <tr key={name} className="border-t border-slate-100 text-slate-600">
                      <td className="py-1.5 pr-3 font-semibold">{name}</td>
                      <td className="py-1.5 pr-3">{e.within24}</td>
                      <td className="py-1.5 pr-3">{e.within72}</td>
                      <td className="py-1.5 pr-3">{e.pending}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 shadow-md p-5">
            <p className="text-sm font-bold text-slate-800 mb-3">Visits (fastest first)</p>
            {rows.length === 0 ? (
              <p className="text-xs text-slate-400">None.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-400">
                      <th className="py-1.5 pr-3 font-semibold">Lead</th>
                      <th className="py-1.5 pr-3 font-semibold">Employee</th>
                      <th className="py-1.5 pr-3 font-semibold">Lead created</th>
                      <th className="py-1.5 pr-3 font-semibold">Visit logged</th>
                      <th className="py-1.5 pr-3 font-semibold">Time to visit</th>
                      <th className="py-1.5 pr-3 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.leadId + r.visitAt} className="border-t border-slate-100 text-slate-600 align-top">
                        <td className="py-1.5 pr-3 font-mono">{r.leadId}</td>
                        <td className="py-1.5 pr-3">{r.employee}</td>
                        <td className="py-1.5 pr-3 whitespace-nowrap">{istDateTime(r.createdAt)}</td>
                        <td className="py-1.5 pr-3 whitespace-nowrap">{istDateTime(r.visitAt)}</td>
                        <td className={`py-1.5 pr-3 font-bold ${r.hours < 2 ? "text-red-600" : r.hours <= 24 ? "text-amber-600" : "text-slate-600"}`}>{gap(r.hours)}</td>
                        <td className="py-1.5 pr-3">
                          {r.status}
                          {r.note && <span className="block text-slate-400">📝 {r.note}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
