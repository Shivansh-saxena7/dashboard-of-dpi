"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Copy, Send } from "lucide-react";
import { supabase } from "@/lib/supabase";
import toast from "react-hot-toast";
import { buildWorkReportMessage } from "@/lib/buildWorkReportMessage";

interface DetailEntry {
  leadName: string;
  time: string;
}

interface WorkReportData {
  calls: number;
  callDetails: DetailEntry[];
  connected: number;
  connectedDetails: DetailEntry[];
  notConnected: number;
  notConnectedDetails: DetailEntry[];
  switchedOff: number;
  switchedOffDetails: DetailEntry[];
  notInterested: number;
  notInterestedDetails: DetailEntry[];
  converted: number;
  convertedDetails: DetailEntry[];
  followUps: number;
  followUpDetails: DetailEntry[];
  visits: number;
  visitDetails: DetailEntry[];
  bookings: number;
  bookingDetails: DetailEntry[];
}

interface WorkReportViewProps {
  employeeId: string;
  employeeName: string;
  date: string; // YYYY-MM-DD, IST calendar day
  whatsappGroupLabel?: string | null;
}

type MetricKey =
  | "calls"
  | "connected"
  | "notConnected"
  | "switchedOff"
  | "notInterested"
  | "converted"
  | "followUps"
  | "visits"
  | "bookings";

// 2026-08-22 gap audit: Connected/Not Connected/Switched Off/Converted
// were already being logged to lead_activity_log (Point 4's
// STATUS_UPDATE tracking) but never surfaced here — only Not
// Interested was. All 5 EMPLOYEE_SELECTABLE_STATUSES (see
// lib/getValidNextLeadStatuses.ts) are now covered, alongside the 3
// board-stage moves that were already complete (Follow-up/Visit/
// Booking). Ordered as call-outcomes first, then pipeline progression
// — matches how an employee actually narrates their day.
const METRICS: {
  key: MetricKey;
  detailKey: keyof WorkReportData;
  label: string;
  emoji: string;
}[] = [
  { key: "calls", detailKey: "callDetails", label: "Calls", emoji: "📞" },
  { key: "connected", detailKey: "connectedDetails", label: "Connected", emoji: "✅" },
  { key: "notConnected", detailKey: "notConnectedDetails", label: "Not Connected", emoji: "📵" },
  { key: "switchedOff", detailKey: "switchedOffDetails", label: "Switched Off", emoji: "📴" },
  { key: "notInterested", detailKey: "notInterestedDetails", label: "Not Interested", emoji: "❌" },
  { key: "converted", detailKey: "convertedDetails", label: "Converted", emoji: "🤝" },
  { key: "followUps", detailKey: "followUpDetails", label: "Follow-up", emoji: "➡️" },
  { key: "visits", detailKey: "visitDetails", label: "Visits", emoji: "🏠" },
  { key: "bookings", detailKey: "bookingDetails", label: "Bookings", emoji: "🎉" }
];

// Single shared render for both the employee's own "My Report" tab
// (app/report/page.tsx) and Admin's Work Reports page
// (app/admin/work-reports/page.tsx) — one component, one RPC call
// (get_employee_work_report), parameterized purely by props. Admin's
// page owns the Employee-selector/Date-picker state and just passes
// whichever employeeId/date is currently selected; this component has
// no "admin mode" branching of its own, so there is exactly one
// rendering code path to ever get wrong or drift between the two
// surfaces.
export default function WorkReportView({ employeeId, employeeName, date, whatsappGroupLabel }: WorkReportViewProps) {

  const [report, setReport] = useState<WorkReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<MetricKey | null>(null);

  useEffect(() => {
    loadReport();
  }, [employeeId, date]);

  async function loadReport() {
    setLoading(true);
    setExpanded(null);

    const { data, error } = await supabase.rpc("get_employee_work_report", {
      p_employee_id: employeeId,
      p_date: date
    });

    if (!error && data) {
      setReport(data as WorkReportData);
    } else if (error) {
      toast.error(error.message || "Could not load the work report.");
      setReport(null);
    }

    setLoading(false);
  }

  function currentMessage(): string {
    if (!report) return "";
    return buildWorkReportMessage({
      employeeName,
      date: new Date(`${date}T00:00:00`),
      calls: report.calls,
      connected: report.connected,
      notConnected: report.notConnected,
      switchedOff: report.switchedOff,
      notInterested: report.notInterested,
      converted: report.converted,
      followUps: report.followUps,
      visits: report.visits,
      bookings: report.bookings
    });
  }

  function handleCopy() {
    const message = currentMessage();
    if (!message) return;
    navigator.clipboard.writeText(message);
    toast.success("Report copied — paste it in the group.");
  }

  // No specific target — WhatsApp's own web scheme has no mechanism to
  // pre-select a specific GROUP with pre-filled text (only a 1:1
  // wa.me/<number> chat can be pre-targeted, see buildWhatsAppLink.ts
  // and shareAssetsViaWhatsApp.ts's own comments on this exact
  // limitation). This opens WhatsApp with the message fully ready; the
  // employee picks their own destination chat from their own chat
  // list — one unavoidable extra tap, not a gap in this
  // implementation. whatsappGroupLabel (set by Admin in Settings) is
  // just an on-screen reminder of which chat to pick, not a real link
  // target.
  function handleSendWhatsApp() {
    const message = currentMessage();
    if (!message) return;
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`, "_blank");
  }

  if (loading) {
    return (
      <div className="mt-6 text-center text-sm text-slate-400">
        Loading work report...
      </div>
    );
  }

  if (!report) {
    return (
      <div className="mt-6 text-center text-sm text-slate-400">
        Could not load this report.
      </div>
    );
  }

  const expandedMetric = METRICS.find((m) => m.key === expanded);
  const expandedDetails = expandedMetric ? (report[expandedMetric.detailKey] as DetailEntry[]) : [];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {METRICS.map((m) => {
          const count = report[m.key] as number;
          const isExpanded = expanded === m.key;
          return (
            <motion.button
              key={m.key}
              whileTap={{ scale: 0.97 }}
              onClick={() => setExpanded(isExpanded ? null : m.key)}
              className={`rounded-2xl border p-3 text-left transition shadow-[0_2px_10px_rgba(15,23,42,0.04)] ${
                isExpanded ? "border-amber-300 bg-amber-50/60" : "border-slate-100 bg-white hover:border-slate-200"
              }`}
            >
              {/* min-h reserves 2 lines' worth of space unconditionally
                  — without it, a short label (e.g. "Visits") sits in a
                  shorter tile than its longer row-mate (e.g. "Follow-up
                  mein gaye", which wraps at narrow widths), and CSS
                  Grid's default row-stretch then leaves that shorter
                  tile with awkward empty space at the bottom. Reserving
                  the same height on every tile regardless of which row
                  it lands in keeps the whole grid visually even —
                  confirmed via screenshot at 320/360/375px (mobile-
                  responsiveness audit, 2026-08-19). */}
              <p className="text-[11px] font-semibold text-slate-500 flex items-center gap-1 min-h-[28px]">
                <span>{m.emoji}</span> {m.label}
              </p>
              <p className="text-2xl font-bold text-slate-800 mt-1">{count}</p>
            </motion.button>
          );
        })}
      </div>

      {expandedMetric && (
        <div className="rounded-2xl bg-white border border-slate-100 shadow-md p-4">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
            {expandedMetric.label} — detail
          </p>
          {expandedDetails.length === 0 ? (
            <p className="text-sm text-slate-400">Nothing here for this day.</p>
          ) : (
            <div className="space-y-2">
              {expandedDetails.map((entry, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between text-sm border-b border-slate-50 last:border-0 pb-2 last:pb-0"
                >
                  <span className="text-slate-700 font-medium truncate">{entry.leadName}</span>
                  <span className="text-slate-400 text-xs shrink-0 ml-2">
                    {new Date(entry.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="rounded-2xl bg-white border border-slate-100 shadow-md p-4">
        <p className="text-sm font-bold text-slate-800 mb-1">Share this report</p>
        {whatsappGroupLabel && (
          <p className="text-xs text-slate-500 mb-3">
            Post this in: <span className="font-semibold">{whatsappGroupLabel}</span>
          </p>
        )}
        {/* whitespace-nowrap on both — without it, "Send via WhatsApp"
            genuinely wraps to 2 lines at real narrow widths (confirmed
            via screenshot at 320/360/375px, mobile-responsiveness
            audit, 2026-08-19), which silently grows that button taller
            than "Copy" next to it (h-11 doesn't clip overflowing
            content) and throws the icon off-center relative to the
            now-2-line label. "Send via " is hidden below sm — "WhatsApp"
            alone, right next to a paper-plane send-icon inside a "Share
            this report" card, reads exactly as clearly, and reliably
            fits on one line at every real phone width tested. */}
        <div className="flex gap-2 mt-2">
          <button
            onClick={handleCopy}
            className="flex-1 flex items-center justify-center gap-2 h-11 rounded-xl text-sm font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 whitespace-nowrap"
          >
            <Copy size={15} />
            Copy
          </button>
          <button
            onClick={handleSendWhatsApp}
            className="flex-1 flex items-center justify-center gap-2 h-11 rounded-xl text-sm font-semibold bg-emerald-500 text-white hover:opacity-90 whitespace-nowrap"
          >
            <Send size={15} />
            <span className="hidden sm:inline">Send via </span>WhatsApp
          </button>
        </div>
      </div>
    </div>
  );
}
