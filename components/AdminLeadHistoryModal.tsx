"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { X, User, Bookmark, Share2, Phone, MessageCircle, StickyNote, MapPin, Moon, ArrowRightCircle, TrendingUp } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { ENDED_REASON_TEXT } from "@/lib/endedReasonDisplay";
import { assignedByLabel } from "@/lib/assignedByDisplay";
import { isLeadTerminal } from "@/lib/isLeadTerminal";

interface AdminLeadHistoryModalProps {
  leadId: string;
  leadName: string;
  leadType?: string;
  leadStatus?: string;
  leadBoardStage?: string;
  catcherName?: string | null;
  onClose: () => void;
}

interface HistoryEntry {
  id: string;
  employee_id: string;
  assigned_at: string;
  is_active: boolean;
  ended_reason: string | null;
  reassign_note: string | null;
  outcome: string | null;
  call_count: number;
  assigned_by_type: "SYSTEM" | "ADMIN" | "TEAM_LEADER" | "SALES_COORDINATOR" | "SELF";
  employees: { name: string } | null;
  assigned_by: { name: string } | null;
}

interface ReservationEntry {
  id: string;
  reserved_at: string;
  team: { name: string } | null;
  reserved_by: { name: string } | null;
}

interface AssetSnapshotItem {
  asset_id: string;
  label: string;
  asset_type: "VIDEO" | "FILE";
  group_label: string;
  url: string;
}

// COST_SHEET entries store a genuinely different shape in the same
// assets_snapshot jsonb column — there's no project_assets row behind
// a generated cost sheet, so log_cost_sheet_share_atomic (Part 2)
// writes the full calculation snapshot directly instead of an
// asset-item array. Only the fields this modal actually displays are
// typed here (the real snapshot carries the full breakdown too, for
// historical-accuracy reasons — see CostSheetModal.tsx).
interface CostSheetSnapshot {
  project: string;
  size: string;
  totalFlatCost: number;
  govtChargePct: number;
  grandTotal: number;
  pdfUrl: string;
}

interface AssetShareEntry {
  id: string;
  shared_at: string;
  entry_type: "ASSETS" | "COST_SHEET";
  assets_snapshot: AssetSnapshotItem[] | CostSheetSnapshot;
  employees: { name: string } | null;
}

interface NoteEntry {
  id: string;
  note: string;
  created_at: string;
  employees: { name: string } | null;
}

interface VisitEntry {
  id: string;
  event_type: "VISIT" | "REVISIT" | "BOOKED";
  created_at: string;
  verified_at: string | null;
  denied_at: string | null;
  deny_reason: string | null;
  employees: { name: string } | null;
}

interface SnoozeEntry {
  id: string;
  snoozed_at: string;
  duration_months: number;
  snoozed_until: string;
  reason: string | null;
  cancelled_at: string | null;
  employees: { name: string } | null;
}

// The two entry shapes below come from get_lead_activity_log_atomic,
// not a direct table query — contact_click_log/lead_activity_log both
// have RLS enabled with ZERO policies (deliberate, same posture
// get_employee_work_report's own comment documents: "Authorization
// gate lives HERE, not in RLS"), so a bare supabase.from() on either
// returns nothing for anyone regardless of role. This RPC is the one
// authorized read path for these two specifically.
interface CallClickEntry {
  id: string;
  clickType: "CALL" | "WHATSAPP";
  clickedAt: string;
  employeeName: string | null;
}

interface ActivityLogEntry {
  id: string;
  activityType: "STATUS_UPDATE" | "BOARD_STAGE_MOVE";
  detail: string;
  createdAt: string;
  employeeName: string | null;
}

// Reservations (Admin -> team, before anyone owns the lead),
// assignments (lead_history rows), asset shares (Project Assets /
// Cost-Sheet WhatsApp sends), notes, site visits, snoozes, call/
// WhatsApp clicks, and individual status/board-stage transitions are
// nine structurally different event types — merged here into one
// timestamp-sorted timeline so the drawer reads as a single
// continuous story, even though they live in seven separate tables
// (2026-09-23 — extended from the original 3-source version to cover
// the full per-employee activity trail: exactly what call was made
// when, every note, every status/stage transition, not just each
// assignment period's final outcome).
type TimelineEntry =
  | { kind: "ASSIGNMENT"; timestamp: string; data: HistoryEntry }
  | { kind: "RESERVATION"; timestamp: string; data: ReservationEntry }
  | { kind: "ASSET_SHARE"; timestamp: string; data: AssetShareEntry }
  | { kind: "NOTE"; timestamp: string; data: NoteEntry }
  | { kind: "SITE_VISIT"; timestamp: string; data: VisitEntry }
  | { kind: "SNOOZE"; timestamp: string; data: SnoozeEntry }
  | { kind: "CALL_CLICK"; timestamp: string; data: CallClickEntry }
  | { kind: "STATUS_CHANGE"; timestamp: string; data: ActivityLogEntry }
  | { kind: "BOARD_STAGE_MOVE"; timestamp: string; data: ActivityLogEntry };

// Admin-only, full audit trail — queries lead_history DIRECTLY (never
// employee_sla_breach_history, which is deliberately scoped/masked
// for the employee-facing SLA Breach tab and wrong for this use
// case). Admin already has full RLS access via lead_history_admin_all
// and leads_admin_all, so this feature needed zero new backend/
// security work — purely additive UI.
//
// Blue-cyan themed (not gold) — matches AdminLeadCard and the rest
// of the Admin app shell, per Section 2.7's Admin/Employee visual
// split. Reuses the same slide-in drawer motion pattern as
// LeadDetailModal/TeamMemberDetailModal, just restyled.
//
// Portaled to document.body: AdminLeadCard (the caller) is itself an
// animated motion.div, and Framer Motion implements its y-animation
// via a CSS transform. A transformed ancestor becomes the containing
// block for any `position: fixed` descendant, so without the portal
// this modal's "fixed" backdrop/drawer would resolve against that
// one card's box instead of the viewport — different size/position
// depending on which card in the grid triggered it. Portaling out to
// document.body sidesteps that entirely while keeping open/close
// state self-contained in AdminLeadCard (see its own comment).
// AnimatePresence for the exit animation lives in AdminLeadCard, at
// the point where the {historyOpen && ...} conditional actually is —
// portals change DOM output, not React parent/unmount timing, so
// AnimatePresence still needs to sit there to see the removal coming.
export default function AdminLeadHistoryModal({ leadId, leadName, leadType, leadStatus, leadBoardStage, catcherName, onClose }: AdminLeadHistoryModalProps) {

  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // A genuinely-Booked (status=CONVERTED AND board_stage=BOOKING) or
  // JUNK lead is permanently closed — "Current" on its still-
  // is_active=true row implies ongoing/active work that isn't there
  // anymore (same terminal condition as AdminLeadCard's own
  // isTerminal check, now both sourced from lib/isLeadTerminal.ts).
  // status='CONVERTED' ALONE used to be treated as terminal here —
  // wrong, since an employee can mark CONVERTED as a plain call-
  // outcome (verbal yes) without the lead ever reaching board_stage=
  // BOOKING, at which point the lead is still very much active and
  // "Current" is the correct, accurate label. "Final Owner" reads
  // correctly for either genuine terminal outcome (Booked or Junked)
  // without needing separate wording per outcome.
  const isTerminal = isLeadTerminal(leadStatus, leadBoardStage);

  useEffect(() => {
    loadHistory();
  }, [leadId]);

  async function loadHistory() {
    setLoading(true);

    const [
      { data: historyData, error: historyError },
      { data: reservationData, error: reservationError },
      { data: assetShareData, error: assetShareError },
      { data: noteData, error: noteError },
      { data: visitData, error: visitError },
      { data: snoozeData, error: snoozeError },
      { data: activityData, error: activityError }
    ] = await Promise.all([
        supabase
          .from("lead_history")
          .select(
            `
            id, employee_id, assigned_at, is_active, ended_reason, reassign_note, outcome, call_count,
            assigned_by_type, assigned_by_employee_id,
            employees!lead_history_employee_id_fkey(name),
            assigned_by:employees!lead_history_assigned_by_employee_id_fkey(name)
            `
          )
          .eq("lead_id", leadId),
        supabase
          .from("lead_team_reservations")
          .select("id, reserved_at, team:teams(name), reserved_by:employees(name)")
          .eq("lead_id", leadId),
        supabase
          .from("asset_share_log")
          .select("id, shared_at, entry_type, assets_snapshot, employees(name)")
          .eq("lead_id", leadId),
        supabase
          .from("lead_notes")
          .select("id, note, created_at, employees(name)")
          .eq("lead_id", leadId),
        supabase
          .from("site_visits")
          .select("id, event_type, created_at, verified_at, denied_at, deny_reason, employees(name)")
          .eq("lead_id", leadId),
        supabase
          .from("lead_snooze_log")
          .select("id, snoozed_at, duration_months, snoozed_until, reason, cancelled_at, employees(name)")
          .eq("lead_id", leadId),
        // The one RPC call (not a direct table query) — see
        // CallClickEntry/ActivityLogEntry's own comment for why
        // contact_click_log/lead_activity_log can't be read directly.
        supabase.rpc("get_lead_activity_log_atomic", { p_lead_id: leadId })
      ]);

    const merged: TimelineEntry[] = [];

    if (!historyError && historyData) {
      (historyData as unknown as HistoryEntry[]).forEach((entry) =>
        merged.push({ kind: "ASSIGNMENT", timestamp: entry.assigned_at, data: entry })
      );
    }

    if (!reservationError && reservationData) {
      (reservationData as unknown as ReservationEntry[]).forEach((entry) =>
        merged.push({ kind: "RESERVATION", timestamp: entry.reserved_at, data: entry })
      );
    }

    if (!assetShareError && assetShareData) {
      (assetShareData as unknown as AssetShareEntry[]).forEach((entry) =>
        merged.push({ kind: "ASSET_SHARE", timestamp: entry.shared_at, data: entry })
      );
    }

    if (!noteError && noteData) {
      (noteData as unknown as NoteEntry[]).forEach((entry) =>
        merged.push({ kind: "NOTE", timestamp: entry.created_at, data: entry })
      );
    }

    if (!visitError && visitData) {
      (visitData as unknown as VisitEntry[]).forEach((entry) =>
        merged.push({ kind: "SITE_VISIT", timestamp: entry.created_at, data: entry })
      );
    }

    if (!snoozeError && snoozeData) {
      (snoozeData as unknown as SnoozeEntry[]).forEach((entry) =>
        merged.push({ kind: "SNOOZE", timestamp: entry.snoozed_at, data: entry })
      );
    }

    if (!activityError && activityData) {
      const parsed = activityData as unknown as { callClicks: CallClickEntry[]; activityLog: ActivityLogEntry[] };

      (parsed.callClicks || []).forEach((entry) =>
        merged.push({ kind: "CALL_CLICK", timestamp: entry.clickedAt, data: entry })
      );

      (parsed.activityLog || []).forEach((entry) => {
        merged.push({
          kind: entry.activityType === "BOARD_STAGE_MOVE" ? "BOARD_STAGE_MOVE" : "STATUS_CHANGE",
          timestamp: entry.createdAt,
          data: entry
        });
      });
    }

    merged.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    setTimeline(merged);
    setLoading(false);
  }

  const assignmentCount = timeline.filter((t) => t.kind === "ASSIGNMENT").length;

  return createPortal(
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.45 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black z-40"
      />

      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 120, damping: 18 }}
        className="fixed top-0 right-0 h-full w-full sm:w-[420px] z-50 bg-white shadow-2xl flex flex-col overflow-hidden"
      >
        {/* shrink-0: this header (and the close button in it) must
            NEVER scroll away with the timeline below — it used to sit
            inside the same overflow-y-auto box as the content, so on
            any lead with a long enough history to actually need
            scrolling, scrolling down carried the close button off-
            screen with it. Real bug this fixes: the close button
            "sometimes" not working — it always worked, it just wasn't
            there anymore once you'd scrolled. Every ASSET_SHARE/
            COST_SHEET entry added an extra timeline row, making that
            far more likely to happen than before. Same sticky-header/
            sticky-footer fix as CostSheetModal.tsx. */}
        <div className="relative pt-6 pb-6 px-6 bg-gradient-to-br from-[#0f172a] via-[#1d4ed8] to-[#06b6d4] text-white overflow-hidden shrink-0">
          <div className="absolute top-[-40px] right-[-40px] w-[120px] h-[120px] rounded-full bg-white/10 blur-3xl pointer-events-none" />

          <button
            onClick={onClose}
            className="absolute top-5 right-5 h-8 w-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition"
          >
            <X size={16} />
          </button>

          <p className="relative text-[10px] font-semibold tracking-[0.2em] text-cyan-200 uppercase mb-2">
            {leadType === "DATA" ? "Data History" : "Lead History"}
          </p>
          <h2 className="relative text-xl font-bold pr-10">{leadName}</h2>
          <p className="relative text-sm text-white/70 mt-1">
            {assignmentCount} assignment{assignmentCount === 1 ? "" : "s"}
          </p>
          {catcherName && (
            <p className="relative text-sm text-amber-200 mt-1 font-semibold">
              🎣 Caught by: {catcherName}
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">

          {loading ? (
            <p className="text-sm text-slate-400">Loading...</p>
          ) : timeline.length === 0 ? (
            <p className="text-sm text-slate-400">No history found.</p>
          ) : (
            <div>
              {timeline.map((item, index) => (
                <div key={`${item.kind}-${item.data.id}`} className="relative pl-8 pb-6 last:pb-0">

                  {index < timeline.length - 1 && (
                    <div className="absolute left-[9px] top-6 bottom-0 w-px bg-slate-200" />
                  )}

                  {item.kind === "RESERVATION" ? (
                    <>
                      <div className="absolute left-0 top-0.5 h-5 w-5 rounded-full flex items-center justify-center bg-gradient-to-br from-amber-400 to-orange-500">
                        <Bookmark size={11} className="text-white" />
                      </div>

                      <div className="rounded-xl bg-amber-50 border border-amber-100 p-3">
                        <p className="text-sm font-bold text-amber-800">
                          Reserved for Team {item.data.team?.name || "Unknown"}
                        </p>
                        <p className="text-[11px] text-amber-700/80 mt-1">
                          By {item.data.reserved_by?.name || "Admin"} ·{" "}
                          {new Date(item.data.reserved_at).toLocaleString([], {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit"
                          })}
                        </p>
                      </div>
                    </>
                  ) : item.kind === "ASSET_SHARE" ? (
                    <>
                      <div className="absolute left-0 top-0.5 h-5 w-5 rounded-full flex items-center justify-center bg-gradient-to-br from-emerald-500 to-emerald-600">
                        <Share2 size={11} className="text-white" />
                      </div>

                      <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3">
                        <p className="text-sm font-bold text-emerald-800">
                          {item.data.entry_type === "COST_SHEET" ? "Cost Sheet sent" : "Assets sent"} via WhatsApp
                        </p>
                        <p className="text-[11px] text-emerald-700/80 mt-1">
                          By {item.data.employees?.name || "Unknown"} ·{" "}
                          {new Date(item.data.shared_at).toLocaleString([], {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit"
                          })}
                        </p>
                        {item.data.entry_type === "COST_SHEET" ? (
                          (() => {
                            const snapshot = item.data.assets_snapshot as CostSheetSnapshot;
                            return (
                              <div className="mt-2 space-y-0.5">
                                <p className="text-xs text-emerald-800/90">
                                  📎 {snapshot.project} — {snapshot.size}
                                </p>
                                <p className="text-xs text-emerald-800/90">
                                  Total Flat Cost: Rs. {snapshot.totalFlatCost.toLocaleString("en-IN", { maximumFractionDigits: 0 })} + Govt Charge ({snapshot.govtChargePct}%)
                                </p>
                                <p className="text-xs font-bold text-emerald-800/90">
                                  Grand Total: Rs. {snapshot.grandTotal.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                                </p>
                                {snapshot.pdfUrl && (
                                  <a
                                    href={snapshot.pdfUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-block text-xs font-semibold text-emerald-700 underline"
                                  >
                                    View PDF
                                  </a>
                                )}
                              </div>
                            );
                          })()
                        ) : (
                          <ul className="mt-2 space-y-0.5">
                            {(item.data.assets_snapshot as AssetSnapshotItem[]).map((a) => (
                              <li key={a.asset_id} className="text-xs text-emerald-800/90">
                                {a.asset_type === "VIDEO" ? "🎥" : "📎"} {a.group_label} — {a.label}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </>
                  ) : item.kind === "NOTE" ? (
                    <>
                      <div className="absolute left-0 top-0.5 h-5 w-5 rounded-full flex items-center justify-center bg-gradient-to-br from-slate-400 to-slate-500">
                        <StickyNote size={11} className="text-white" />
                      </div>

                      <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                        <p className="text-sm text-slate-700">{item.data.note}</p>
                        <p className="text-[11px] text-slate-400 mt-1">
                          {item.data.employees?.name || "Unknown"} ·{" "}
                          {new Date(item.data.created_at).toLocaleString([], {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit"
                          })}
                        </p>
                      </div>
                    </>
                  ) : item.kind === "SITE_VISIT" ? (
                    <>
                      <div className="absolute left-0 top-0.5 h-5 w-5 rounded-full flex items-center justify-center bg-gradient-to-br from-purple-500 to-violet-600">
                        <MapPin size={11} className="text-white" />
                      </div>

                      <div className="rounded-xl bg-purple-50 border border-purple-100 p-3">
                        <p className="text-sm font-bold text-purple-800">
                          {item.data.event_type === "BOOKED" ? "Booked" : item.data.event_type === "REVISIT" ? "Revisit" : "Site Visit"}
                          {item.data.denied_at ? " — Denied" : item.data.verified_at ? " — Verified" : ""}
                        </p>
                        <p className="text-[11px] text-purple-700/80 mt-1">
                          {item.data.employees?.name || "Unknown"} ·{" "}
                          {new Date(item.data.created_at).toLocaleString([], {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit"
                          })}
                        </p>
                        {item.data.deny_reason && (
                          <p className="text-xs text-purple-700/90 mt-1">Reason: {item.data.deny_reason}</p>
                        )}
                      </div>
                    </>
                  ) : item.kind === "SNOOZE" ? (
                    <>
                      <div className="absolute left-0 top-0.5 h-5 w-5 rounded-full flex items-center justify-center bg-gradient-to-br from-indigo-500 to-indigo-600">
                        <Moon size={11} className="text-white" />
                      </div>

                      <div className="rounded-xl bg-indigo-50 border border-indigo-100 p-3">
                        <p className="text-sm font-bold text-indigo-800">
                          Snoozed {item.data.duration_months} month{item.data.duration_months === 1 ? "" : "s"}
                          {item.data.cancelled_at ? " — Cancelled" : ""}
                        </p>
                        <p className="text-[11px] text-indigo-700/80 mt-1">
                          {item.data.employees?.name || "Unknown"} ·{" "}
                          {new Date(item.data.snoozed_at).toLocaleString([], {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit"
                          })}
                        </p>
                        {item.data.reason && (
                          <p className="text-xs text-indigo-700/90 mt-1">Reason: {item.data.reason}</p>
                        )}
                      </div>
                    </>
                  ) : item.kind === "CALL_CLICK" ? (
                    <>
                      <div className="absolute left-0 top-0.5 h-5 w-5 rounded-full flex items-center justify-center bg-gradient-to-br from-teal-500 to-teal-600">
                        {item.data.clickType === "WHATSAPP" ? (
                          <MessageCircle size={11} className="text-white" />
                        ) : (
                          <Phone size={11} className="text-white" />
                        )}
                      </div>

                      <div className="rounded-xl bg-teal-50 border border-teal-100 p-3">
                        <p className="text-sm font-bold text-teal-800">
                          {item.data.clickType === "WHATSAPP" ? "WhatsApp clicked" : "Call clicked"}
                        </p>
                        <p className="text-[11px] text-teal-700/80 mt-1">
                          {item.data.employeeName || "Unknown"} ·{" "}
                          {new Date(item.data.clickedAt).toLocaleString([], {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit"
                          })}
                        </p>
                      </div>
                    </>
                  ) : item.kind === "STATUS_CHANGE" ? (
                    <>
                      <div className="absolute left-0 top-0.5 h-5 w-5 rounded-full flex items-center justify-center bg-gradient-to-br from-blue-500 to-blue-600">
                        <ArrowRightCircle size={11} className="text-white" />
                      </div>

                      <div className="rounded-xl bg-blue-50 border border-blue-100 p-3">
                        <p className="text-sm font-bold text-blue-800">Status → {item.data.detail}</p>
                        <p className="text-[11px] text-blue-700/80 mt-1">
                          {item.data.employeeName || "Unknown"} ·{" "}
                          {new Date(item.data.createdAt).toLocaleString([], {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit"
                          })}
                        </p>
                      </div>
                    </>
                  ) : item.kind === "BOARD_STAGE_MOVE" ? (
                    <>
                      <div className="absolute left-0 top-0.5 h-5 w-5 rounded-full flex items-center justify-center bg-gradient-to-br from-rose-500 to-rose-600">
                        <TrendingUp size={11} className="text-white" />
                      </div>

                      <div className="rounded-xl bg-rose-50 border border-rose-100 p-3">
                        <p className="text-sm font-bold text-rose-800">Moved to {item.data.detail}</p>
                        <p className="text-[11px] text-rose-700/80 mt-1">
                          {item.data.employeeName || "Unknown"} ·{" "}
                          {new Date(item.data.createdAt).toLocaleString([], {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit"
                          })}
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div
                        className={`absolute left-0 top-0.5 h-5 w-5 rounded-full flex items-center justify-center ${
                          item.data.is_active
                            ? "bg-gradient-to-br from-cyan-500 to-blue-600"
                            : "bg-slate-300"
                        }`}
                      >
                        <User size={11} className="text-white" />
                      </div>

                      <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-bold text-slate-800">
                            {item.data.employees?.name || "Unknown employee"}
                          </p>
                          {item.data.is_active && (
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                                isTerminal ? "bg-slate-200 text-slate-600" : "bg-blue-100 text-blue-700"
                              }`}
                            >
                              {isTerminal ? "Final Owner" : "Current"}
                            </span>
                          )}
                        </div>

                        <p className="text-[11px] text-slate-400 mt-1">
                          Assigned{" "}
                          {new Date(item.data.assigned_at).toLocaleString([], {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit"
                          })}
                        </p>

                        <p className="text-[11px] text-slate-500 mt-0.5 font-medium">
                          {assignedByLabel(item.data)}
                        </p>

                        {item.data.call_count > 0 && (
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            Called {item.data.call_count}x
                          </p>
                        )}

                        {item.data.outcome && (
                          <p className="text-xs text-slate-600 mt-2">
                            Outcome logged: <span className="font-semibold">{item.data.outcome}</span>
                          </p>
                        )}

                        {!item.data.is_active && item.data.ended_reason && (
                          <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                            {ENDED_REASON_TEXT[item.data.ended_reason] || item.data.ended_reason}
                          </p>
                        )}

                        {item.data.reassign_note && (
                          <p className="text-xs text-slate-600 mt-2">
                            Reason: <span className="font-semibold">{item.data.reassign_note}</span>
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

        </div>
      </motion.div>
    </>,
    document.body
  );
}
