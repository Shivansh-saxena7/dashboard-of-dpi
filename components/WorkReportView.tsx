"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Copy, Send, Phone } from "lucide-react";
import { supabase } from "@/lib/supabase";
import toast from "react-hot-toast";
import { buildWorkReportMessage } from "@/lib/buildWorkReportMessage";

interface DetailEntry {
  leadName: string;
  time: string;
}

interface StuckLeadEntry {
  leadName: string;
  mobile: string | null;
  callCount: number;
  daysSinceLastAttempt: number;
  leadId: string;
  leadHistoryId: string;
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
  stuckLeads: number;
  stuckLeadsDetails: StuckLeadEntry[];
  personalLeads: number;
  personalLeadDetails: DetailEntry[];
}

interface WorkReportViewProps {
  employeeId: string;
  employeeName: string;
  date: string; // YYYY-MM-DD, IST calendar day
  whatsappGroupLabel?: string | null;
  // Call-and-open-detail actions on Stuck Leads rows (2026-10-01) only
  // make sense when the viewer IS this report's own employee -- Admin
  // viewing someone else's report has no reason to dial on their
  // behalf, and /leads?openLead=X would try to open a lead that isn't
  // the Admin's own in the Admin's own /leads view anyway. Defaults
  // false (Admin's work-reports page doesn't pass it); app/report/page.tsx
  // (the employee's own report) passes true.
  canTakeAction?: boolean;
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
  | "bookings"
  | "personalLeads";

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
  { key: "bookings", detailKey: "bookingDetails", label: "Bookings", emoji: "🎉" },
  // Personal Numbers (2026-10-01) — leads this employee self-added via
  // Quick Dial's "Add as Personal Lead?" flow (create_personal_lead_atomic),
  // created within this report's day. Fits the exact same day-bound
  // count+detail shape every metric above already has — no special
  // rendering needed, unlike Stuck Leads below. Deliberately excluded
  // from buildWorkReportMessage (on-screen only), same as Stuck Leads.
  { key: "personalLeads", detailKey: "personalLeadDetails", label: "Personal Numbers", emoji: "📱" }
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
export default function WorkReportView({ employeeId, employeeName, date, whatsappGroupLabel, canTakeAction = false }: WorkReportViewProps) {

  const router = useRouter();
  const [report, setReport] = useState<WorkReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<MetricKey | null>(null);
  const [stuckExpanded, setStuckExpanded] = useState(false);

  useEffect(() => {
    loadReport();
  }, [employeeId, date]);

  // Realtime (2026-09-21) — same proven pattern already used by
  // LeadList.tsx's own channel (lead-list-${employeeId}), so a call
  // click's effect on Stuck Leads shows up here without a manual
  // page refresh. A full loadReport() refetch (not a partial patch)
  // is deliberate, same reasoning as LeadList.tsx: the realtime
  // payload is the raw changed row only, missing the joins this RPC's
  // JSON actually returns. Safe to fire regardless of which date is
  // selected — the day-bound metrics (Calls, Connected, etc.) for a
  // past date are immutable and simply refetch identically; only the
  // Stuck Leads snapshot (deliberately not date-scoped) can actually
  // change from this.
  useEffect(() => {
    if (!employeeId) return;

    let cancelled = false;

    const existing = supabase.getChannels().find((ch) => ch.topic === `realtime:work-report-${employeeId}`);
    if (existing) {
      supabase.removeChannel(existing);
    }

    const channel = supabase
      .channel(`work-report-${employeeId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "lead_history", filter: `employee_id=eq.${employeeId}` },
        () => {
          if (cancelled) return;
          loadReport();
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [employeeId]);

  async function loadReport() {
    setLoading(true);
    setExpanded(null);
    setStuckExpanded(false);

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
      bookings: report.bookings,
      personalLeads: report.personalLeads,
      stuckLeads: report.stuckLeads
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

  // Stuck-lead Call action (2026-10-01) — same fire-and-forget
  // log_call_click_atomic pattern every other Call button in the app
  // uses (see LeadCard.tsx's own handleCallClick), keyed by this row's
  // lead_history_id so it shows up correctly in future reports/Admin
  // response-time stats. The tel: href fires the real call via its own
  // default anchor behavior (not prevented here); router.push to
  // /leads?openLead=<id> runs in the same click, reusing the auto-open-
  // modal effect LeadList.tsx already has (built for the Personal Lead
  // creation flow) rather than duplicating LeadDetailModal here.
  function handleStuckLeadCallClick(entry: StuckLeadEntry) {
    supabase
      .rpc("log_call_click_atomic", { p_lead_history_id: entry.leadHistoryId })
      .then(({ error }) => {
        if (error) console.error("log_call_click_atomic failed:", error.message);
      });
    router.push(`/leads?openLead=${entry.leadId}`);
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

        {/* Stuck Leads (2026-09-21) — deliberately outside the METRICS
            array/generic map above: it's a live current-state
            snapshot (identical regardless of which day's report this
            is), not a day-bound event count like every other tile, and
            its detail shape (callCount/daysSinceLastAttempt) doesn't
            match DetailEntry's (leadName/time) — genuinely different
            data, not worth forcing into the shared shape. Its count
            DOES go into currentMessage()/buildWorkReportMessage
            (2026-10-02) — only the detail list stays screen-only, same
            as every other metric's detail breakdown. Red/amber tone
            (not the neutral grid styling) when count > 0 — this tile is
            specifically an attention-needed signal, not a neutral
            daily stat. */}
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => setStuckExpanded((v) => !v)}
          className={`rounded-2xl border p-3 text-left transition shadow-[0_2px_10px_rgba(15,23,42,0.04)] ${
            stuckExpanded
              ? "border-red-300 bg-red-50/60"
              : report.stuckLeads > 0
                ? "border-red-200 bg-red-50/30 hover:border-red-300"
                : "border-slate-100 bg-white hover:border-slate-200"
          }`}
        >
          {/* "Not Connected, No Follow-up" (2026-09-23 — narrowed from
              "Called Once, No Follow-up") -- the underlying stuck_leads
              view now filters to status='NOT_CONNECTED' specifically
              (was any status with call_count=1), so the label naming
              that one status is accurate again, not a misdescription
              like it would have been against the broader definition
              this replaced. */}
          <p className="text-[11px] font-semibold text-slate-500 flex items-center gap-1 min-h-[28px]">
            <span>⚠️</span> Not Connected, No Follow-up
          </p>
          <p className={`text-2xl font-bold mt-1 ${report.stuckLeads > 0 ? "text-red-600" : "text-slate-800"}`}>
            {report.stuckLeads}
          </p>
          <p className="text-[10px] text-slate-400 mt-0.5">3+ days, no re-call yet</p>
        </motion.button>
      </div>

      {stuckExpanded && (
        <div className="rounded-2xl bg-white border border-red-100 shadow-md p-4">
          <p className="text-xs font-bold text-red-600 uppercase tracking-wide mb-1">
            Not Connected, No Follow-up
          </p>
          <p className="text-xs text-slate-500 mb-2">
            Leads marked "Not Connected" on your one call, with no follow-up call in 3+ days.
          </p>
          {report.stuckLeadsDetails.length === 0 ? (
            <p className="text-sm text-slate-400">None right now.</p>
          ) : (
            <div className="space-y-2">
              {report.stuckLeadsDetails.map((entry, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between text-sm border-b border-slate-50 last:border-0 pb-2 last:pb-0 gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-slate-700 font-medium truncate">{entry.leadName}</p>
                    {entry.mobile && <p className="text-xs text-slate-400">{entry.mobile}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-red-600 text-xs font-semibold">
                      {entry.daysSinceLastAttempt}d ago
                    </span>
                    {canTakeAction && entry.mobile && (
                      <motion.a
                        href={`tel:${entry.mobile}`}
                        onClick={() => handleStuckLeadCallClick(entry)}
                        whileTap={{ scale: 0.95 }}
                        className="flex items-center gap-1 h-8 px-2.5 rounded-lg bg-gradient-to-r from-yellow-400 to-amber-500 text-slate-900 text-xs font-bold"
                      >
                        <Phone size={12} />
                        Call
                      </motion.a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
