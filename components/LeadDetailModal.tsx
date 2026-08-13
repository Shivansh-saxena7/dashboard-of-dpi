"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { X, Phone, Loader2, Send, Repeat, MessageCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import toast from "react-hot-toast";
import { getValidNextLeadStatuses, LeadStatus } from "@/lib/getValidNextLeadStatuses";
import { LEAD_STATUS_DISPLAY } from "@/lib/leadStatusDisplay";
import { BoardStage } from "@/lib/leadBoardStageDisplay";
import { LEAD_POINTS } from "@/lib/calculateLeadPoints";
import { AssignedBySource } from "@/lib/assignedByDisplay";
import { buildWhatsAppLink } from "@/lib/buildWhatsAppLink";

export interface LeadDetailLead {
  id: string;
  leadHistoryId: string;
  name: string;
  mobile: string;
  project: string | null;
  catcherName: string | null;
  status: LeadStatus;
  callCount: number;
  boardStage: BoardStage;
  assignedByType: AssignedBySource["assigned_by_type"] | null;
  assignedBy: { name: string } | null;
  reassignNote: string | null;
  pausedUntil: string | null;
  pauseReason: "SNOOZE" | "VISIT_LOCK" | "VISIT_PENDING_VERIFICATION" | null;
  pauseNote: string | null;
  pauseVerifiedByName: string | null;
  pauseVerifiedAt: string | null;
}

interface LeadNote {
  id: string;
  note: string;
  created_at: string;
}

interface LeadDetailModalProps {
  lead: LeadDetailLead;
  onClose: () => void;
  onUpdated: (updates: { status?: LeadStatus; callCount: number }) => void;
  onBoardStageChanged: (boardStage: BoardStage) => void;
  onPauseChanged: (pause: { pausedUntil: string | null; pauseReason: string | null; pauseNote: string | null }) => void;
}

// The write-side counterpart to LeadCard. Two independent action
// groups:
//   1. Log Update — status change + optional note + call-count, via
//      log_lead_update_atomic (unchanged from before the Lead Board).
//   2. Move Lead — board_stage changes (Follow-up is a plain column
//      update; Visit/Booking go through their own atomic RPCs since
//      they have side effects — a site_visits row, and for Booking,
//      status -> CONVERTED plus a company-wide notification).
// status and board_stage are deliberately independent state, per the
// approved design — Log Update never touches board_stage, and Move
// Lead never touches status except the one explicit case (Booking).
export default function LeadDetailModal({ lead, onClose, onUpdated, onBoardStageChanged, onPauseChanged }: LeadDetailModalProps) {

  const [notes, setNotes] = useState<LeadNote[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(true);
  const [selectedStatus, setSelectedStatus] = useState<LeadStatus | null>(null);
  const [noteText, setNoteText] = useState("");
  const [reminderValue, setReminderValue] = useState("");
  const [reminderUnit, setReminderUnit] = useState<"hours" | "days" | "months">("days");
  const [submitting, setSubmitting] = useState(false);

  const [visitPromptOpen, setVisitPromptOpen] = useState(false);
  const [bookingConfirmOpen, setBookingConfirmOpen] = useState(false);
  const [moving, setMoving] = useState(false);

  // Snooze — see the "Pause" card below the Move Lead section. A
  // planned client-hold, employee-initiated, always requires a reason
  // (snooze_lead_atomic rejects without one — this isn't just a UI
  // nicety, it's genuinely enforced server-side, same "structurally
  // impossible to skip" posture the rest of this app uses). Distinct
  // from VISIT_LOCK, which is never started from here — that's set
  // automatically once a Sales Coordinator/Admin verifies a visit.
  const [snoozeFormOpen, setSnoozeFormOpen] = useState(false);
  const [snoozeMonths, setSnoozeMonths] = useState("3");
  const [snoozeReason, setSnoozeReason] = useState("");
  const [snoozing, setSnoozing] = useState(false);
  const [cancellingSnooze, setCancellingSnooze] = useState(false);

  useEffect(() => {
    loadNotes();
  }, [lead.leadHistoryId]);

  async function loadNotes() {
    setLoadingNotes(true);

    const { data, error } = await supabase
      .from("lead_notes")
      .select("id, note, created_at")
      .eq("lead_history_id", lead.leadHistoryId)
      .order("created_at", { ascending: false });

    if (!error && data) {
      setNotes(data);
    }

    setLoadingNotes(false);
  }

  // Same fire-and-forget pattern LeadCard uses — this drawer's own
  // Call/WhatsApp links previously had no tracking at all, meaning a
  // click from here (rather than the card) never recorded
  // first_call_at/first_whatsapp_at.
  function handleCallClick() {
    supabase
      .rpc("log_call_click_atomic", { p_lead_history_id: lead.leadHistoryId })
      .then(({ error }) => {
        if (error) console.error("log_call_click_atomic failed:", error.message);
      });
  }

  function handleWhatsAppClick() {
    supabase
      .rpc("log_whatsapp_click_atomic", { p_lead_history_id: lead.leadHistoryId })
      .then(({ error }) => {
        if (error) console.error("log_whatsapp_click_atomic failed:", error.message);
      });
  }

  const validNextStatuses = getValidNextLeadStatuses(lead.status, lead.boardStage);
  const isTerminal = validNextStatuses.length === 0;

  // Board moves stop once a lead is Booked (terminal) or its status
  // is otherwise terminal (JUNK) — same reasoning as Log Update. The
  // boardStage==='BOOKING' half is redundant with isTerminal now that
  // it factors board_stage in too, kept explicit anyway since it
  // costs nothing and makes the intent obvious without tracing into
  // isLeadTerminal.
  const boardMovesDisabled = isTerminal || lead.boardStage === "BOOKING";

  async function submitUpdate() {
    setSubmitting(true);

    try {

      const { error } = await supabase.rpc("log_lead_update_atomic", {
        p_lead_id: lead.id,
        p_lead_history_id: lead.leadHistoryId,
        p_new_status: selectedStatus,
        p_note: noteText.trim() || null,
        p_reminder_value: reminderValue ? parseInt(reminderValue, 10) : null,
        p_reminder_unit: reminderValue ? reminderUnit : null
      });

      if (error) {
        toast.error(error.message || "Could not log this update.");
        return;
      }

      toast.success("Update logged.");

      onUpdated({
        status: selectedStatus || undefined,
        callCount: lead.callCount + 1
      });

      setNoteText("");
      setReminderValue("");
      setReminderUnit("days");
      setSelectedStatus(null);
      loadNotes();

    } catch (err) {
      console.log(err);
      toast.error("Something went wrong logging this update.");
    } finally {
      setSubmitting(false);
    }
  }

  async function moveToFollowUp() {
    setMoving(true);

    try {

      // RPC, not a raw table update — the RLS policy that used to
      // allow this (leads_owner_update) was column-unrestricted, so
      // an employee could in principle have directly PATCHed any
      // column on their own owned lead (status, sla_deadline, etc.)
      // via a raw API call, not just board_stage. This RPC only ever
      // touches board_stage/board_stage_changed_at server-side.
      const { error } = await supabase.rpc("move_lead_to_followup_atomic", {
        p_lead_id: lead.id
      });

      if (error) {
        toast.error(error.message || "Could not move this lead.");
        return;
      }

      toast.success("Moved to Follow-up.");
      onBoardStageChanged("FOLLOW_UP");

    } catch (err) {
      console.log(err);
      toast.error("Something went wrong.");
    } finally {
      setMoving(false);
    }
  }

  async function moveToVisit(visitType: "VISIT" | "REVISIT") {
    setMoving(true);

    try {

      const points = visitType === "VISIT" ? LEAD_POINTS.VISIT : LEAD_POINTS.REVISIT;

      const { error } = await supabase.rpc("log_site_visit_atomic", {
        p_lead_id: lead.id,
        p_event_type: visitType,
        p_points: points
      });

      if (error) {
        toast.error(error.message || "Could not log this visit.");
        return;
      }

      toast.success(visitType === "VISIT" ? "First visit logged." : "Revisit logged.");
      setVisitPromptOpen(false);
      onBoardStageChanged("VISIT");

    } catch (err) {
      console.log(err);
      toast.error("Something went wrong.");
    } finally {
      setMoving(false);
    }
  }

  async function confirmBooking() {
    setMoving(true);

    try {

      const { error } = await supabase.rpc("log_booking_atomic", {
        p_lead_id: lead.id,
        p_points: LEAD_POINTS.BOOKED
      });

      if (error) {
        toast.error(error.message || "Could not log this booking.");
        return;
      }

      toast.success("🎉 Booking logged!");
      setBookingConfirmOpen(false);
      onBoardStageChanged("BOOKING");

    } catch (err) {
      console.log(err);
      toast.error("Something went wrong.");
    } finally {
      setMoving(false);
    }
  }

  async function submitSnooze() {

    if (!snoozeReason.trim()) {
      toast.error("A reason is required to snooze this lead.");
      return;
    }

    setSnoozing(true);

    try {

      const { error } = await supabase.rpc("snooze_lead_atomic", {
        p_lead_history_id: lead.leadHistoryId,
        p_duration_months: parseInt(snoozeMonths, 10),
        p_reason: snoozeReason.trim()
      });

      if (error) {
        toast.error(error.message || "Could not snooze this lead.");
        return;
      }

      const snoozedUntil = new Date();
      snoozedUntil.setMonth(snoozedUntil.getMonth() + parseInt(snoozeMonths, 10));

      toast.success("Lead snoozed.");
      setSnoozeFormOpen(false);
      setSnoozeReason("");
      onPauseChanged({
        pausedUntil: snoozedUntil.toISOString(),
        pauseReason: "SNOOZE",
        pauseNote: snoozeReason.trim()
      });

    } catch (err) {
      console.log(err);
      toast.error("Something went wrong snoozing this lead.");
    } finally {
      setSnoozing(false);
    }
  }

  async function cancelSnooze() {
    setCancellingSnooze(true);

    try {

      const { error } = await supabase.rpc("cancel_snooze_atomic", {
        p_lead_history_id: lead.leadHistoryId
      });

      if (error) {
        toast.error(error.message || "Could not cancel the snooze.");
        return;
      }

      toast.success("Snooze cancelled.");
      onPauseChanged({ pausedUntil: null, pauseReason: null, pauseNote: null });

    } catch (err) {
      console.log(err);
      toast.error("Something went wrong.");
    } finally {
      setCancellingSnooze(false);
    }
  }

  const isPaused = Boolean(lead.pausedUntil && new Date(lead.pausedUntil) > new Date());

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.45 }}
        onClick={onClose}
        className="fixed inset-0 bg-black z-40"
      />

      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        transition={{ type: "spring", stiffness: 120, damping: 18 }}
        className="fixed top-0 right-0 h-full w-full sm:w-[420px] z-50 bg-[#FBF9F4] shadow-2xl overflow-y-auto"
      >
        <div className="relative pt-6 pb-6 px-6 bg-gradient-to-br from-[#FFFDF8] to-[#F3ECDA]">
          <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-[#B8860B] via-[#E8C766] to-[#B8860B]" />

          <button
            onClick={onClose}
            className="absolute top-5 right-5 h-8 w-8 flex items-center justify-center rounded-full border border-[#D4AF37]/40 text-slate-500 hover:text-slate-800 hover:border-[#D4AF37] bg-white/60 transition"
          >
            <X size={16} />
          </button>

          <p className="text-[10px] font-semibold tracking-[0.2em] text-amber-600 uppercase mb-2">
            Lead Detail
          </p>
          <h2 className="text-xl font-bold text-slate-800 pr-10">{lead.name}</h2>
          {lead.project && <p className="text-sm text-slate-500 mt-0.5">{lead.project}</p>}
          {lead.catcherName && (
            <p className="text-sm text-amber-700 font-semibold mt-1">🎣 Caught by: {lead.catcherName}</p>
          )}

          <span
            className={`inline-block mt-3 text-[11px] font-semibold px-2.5 py-1 rounded-full ${LEAD_STATUS_DISPLAY[lead.status].badgeClassName}`}
          >
            {LEAD_STATUS_DISPLAY[lead.status].label}
          </span>

          {lead.assignedByType === "TEAM_LEADER" && (
            <div className="flex items-start gap-1.5 mt-3 rounded-xl bg-amber-50 border border-amber-100 px-2.5 py-2">
              <Repeat size={12} className="text-amber-600 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-800 leading-relaxed">
                {lead.assignedBy?.name || "Your Team Leader"} reassigned this lead to you
                {lead.reassignNote && (
                  <>
                    {" "}— <span className="font-semibold">{lead.reassignNote}</span>
                  </>
                )}
              </p>
            </div>
          )}

          <div className="mt-4 flex items-center gap-2">
            <a
              href={`tel:${lead.mobile}`}
              onClick={handleCallClick}
              className="flex-1 flex items-center justify-center gap-2 h-11 rounded-xl bg-gradient-to-r from-yellow-400 to-amber-500 text-slate-900 text-sm font-semibold shadow-[0_8px_20px_rgba(217,119,6,0.3)]"
            >
              <Phone size={15} />
              Call
            </a>

            <a
              href={buildWhatsAppLink(lead.mobile)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleWhatsAppClick}
              className="flex-1 flex items-center justify-center gap-2 h-11 rounded-xl bg-emerald-500 text-white text-sm font-semibold shadow-[0_8px_20px_rgba(16,185,129,0.3)]"
            >
              <MessageCircle size={15} />
              WhatsApp
            </a>
          </div>
        </div>

        <div className="px-6 py-6 space-y-6">

          {!boardMovesDisabled && (
            <div className="rounded-2xl bg-white border border-slate-100 shadow-md p-5">
              <p className="text-sm font-bold text-slate-800 mb-3">Move Lead</p>

              {visitPromptOpen ? (
                <div>
                  <p className="text-xs text-slate-500 mb-2">Pehli Visit hai ya Revisit?</p>
                  <div className="flex gap-2">
                    <button
                      disabled={moving}
                      onClick={() => moveToVisit("VISIT")}
                      className="flex-1 h-10 rounded-xl text-sm font-semibold bg-slate-800 text-white disabled:opacity-60"
                    >
                      First Visit
                    </button>
                    <button
                      disabled={moving}
                      onClick={() => moveToVisit("REVISIT")}
                      className="flex-1 h-10 rounded-xl text-sm font-semibold bg-slate-100 text-slate-700 disabled:opacity-60"
                    >
                      Revisit
                    </button>
                  </div>
                  <button
                    onClick={() => setVisitPromptOpen(false)}
                    className="text-xs text-slate-400 mt-2"
                  >
                    Cancel
                  </button>
                </div>
              ) : bookingConfirmOpen ? (
                <div>
                  <p className="text-xs text-slate-500 mb-3">
                    Confirm booking? This closes the lead and notifies the whole team.
                  </p>
                  <div className="flex gap-2">
                    <button
                      disabled={moving}
                      onClick={confirmBooking}
                      className="flex-1 h-10 rounded-xl text-sm font-semibold bg-green-600 text-white disabled:opacity-60"
                    >
                      {moving ? "Logging..." : "Confirm Booking"}
                    </button>
                    <button
                      disabled={moving}
                      onClick={() => setBookingConfirmOpen(false)}
                      className="flex-1 h-10 rounded-xl text-sm font-semibold bg-slate-100 text-slate-700 disabled:opacity-60"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {lead.boardStage !== "FOLLOW_UP" && (
                    <button
                      disabled={moving}
                      onClick={moveToFollowUp}
                      className="text-xs font-semibold px-3 py-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-60"
                    >
                      📞 Move to Follow-up
                    </button>
                  )}
                  {lead.boardStage !== "VISIT" ? (
                    <button
                      disabled={moving}
                      onClick={() => setVisitPromptOpen(true)}
                      className="text-xs font-semibold px-3 py-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-60"
                    >
                      🏠 Move to Visit
                    </button>
                  ) : (
                    // Once already in the Visit column, "Move to
                    // Visit" (which asks First Visit vs Revisit) no
                    // longer applies — every further visit here IS a
                    // revisit by definition, so this logs it directly
                    // rather than via a button that would otherwise
                    // never reappear. Without this, Revisit was
                    // structurally unreachable after the first visit —
                    // the whole point of a revisit resetting the
                    // Client-Lock could never actually be triggered.
                    <button
                      disabled={moving}
                      onClick={() => moveToVisit("REVISIT")}
                      className="text-xs font-semibold px-3 py-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-60"
                    >
                      🔄 Log Revisit
                    </button>
                  )}
                  <button
                    disabled={moving}
                    onClick={() => setBookingConfirmOpen(true)}
                    className="text-xs font-semibold px-3 py-2 rounded-xl bg-gradient-to-r from-yellow-400 to-amber-500 text-slate-900 hover:opacity-90 disabled:opacity-60"
                  >
                    ✅ Move to Booking
                  </button>
                </div>
              )}
            </div>
          )}

          {!isTerminal && (
            isPaused ? (
              <div
                className={`rounded-2xl border p-5 ${
                  lead.pauseReason === "VISIT_LOCK"
                    ? "bg-emerald-50 border-emerald-100"
                    : lead.pauseReason === "VISIT_PENDING_VERIFICATION"
                    ? "bg-amber-50 border-amber-100"
                    : "bg-indigo-50 border-indigo-100"
                }`}
              >
                <p className="text-sm font-bold text-slate-800">
                  {lead.pauseReason === "VISIT_LOCK"
                    ? "🔒 Visit-Locked"
                    : lead.pauseReason === "VISIT_PENDING_VERIFICATION"
                    ? "⏳ Visit Pending Verification"
                    : "😴 Snoozed"}
                </p>
                <p className="text-sm text-slate-700 mt-1.5 leading-relaxed">
                  {lead.pauseReason === "VISIT_LOCK" ? (
                    <>
                      {lead.pauseVerifiedByName && (
                        <>
                          Your visit was verified by{" "}
                          <span className="font-semibold">{lead.pauseVerifiedByName}</span>
                          {lead.pauseVerifiedAt && (
                            <>
                              {" "}on{" "}
                              <span className="font-semibold">
                                {new Date(lead.pauseVerifiedAt).toLocaleDateString([], {
                                  month: "long",
                                  day: "numeric",
                                  year: "numeric"
                                })}
                              </span>
                            </>
                          )}
                          .{" "}
                        </>
                      )}
                      This lead is locked to you until{" "}
                      <span className="font-semibold">
                        {new Date(lead.pausedUntil!).toLocaleDateString([], {
                          month: "long",
                          day: "numeric",
                          year: "numeric"
                        })}
                      </span>
                      . If you don&apos;t bring them back for a revisit before then, this lead may be
                      reassigned to another team member.
                    </>
                  ) : lead.pauseReason === "VISIT_PENDING_VERIFICATION" ? (
                    <>
                      Your visit is being reviewed by the Sales Coordinator — once verified, this lead
                      will be locked to you for 1 month. No action needed, check back soon. (Review
                      window ends{" "}
                      <span className="font-semibold">
                        {new Date(lead.pausedUntil!).toLocaleDateString([], {
                          month: "long",
                          day: "numeric",
                          year: "numeric"
                        })}
                      </span>
                      .)
                    </>
                  ) : (
                    <>
                      Snoozed until{" "}
                      <span className="font-semibold">
                        {new Date(lead.pausedUntil!).toLocaleDateString([], {
                          month: "long",
                          day: "numeric",
                          year: "numeric"
                        })}
                      </span>
                      . This lead won&apos;t be reassigned while snoozed.
                      {lead.pauseNote && (
                        <>
                          {" "}— <span className="italic">&ldquo;{lead.pauseNote}&rdquo;</span>
                        </>
                      )}
                    </>
                  )}
                </p>

                {lead.pauseReason === "SNOOZE" && (
                  <button
                    disabled={cancellingSnooze}
                    onClick={cancelSnooze}
                    className="mt-3 text-xs font-semibold text-indigo-700 hover:text-indigo-900 disabled:opacity-60"
                  >
                    {cancellingSnooze ? "Cancelling..." : "Cancel snooze"}
                  </button>
                )}
              </div>
            ) : (
              <div className="rounded-2xl bg-white border border-slate-100 shadow-md p-5">
                {snoozeFormOpen ? (
                  <div>
                    <p className="text-sm font-bold text-slate-800 mb-3">Snooze this lead</p>

                    <div className="flex items-center gap-2 mb-3">
                      <label className="text-xs text-slate-500 shrink-0">For</label>
                      <select
                        value={snoozeMonths}
                        onChange={(e) => setSnoozeMonths(e.target.value)}
                        className="h-9 rounded-lg bg-slate-50 border border-slate-200 px-2 text-sm outline-none"
                      >
                        <option value="1">1 month</option>
                        <option value="3">3 months</option>
                        <option value="6">6 months</option>
                      </select>
                    </div>

                    <textarea
                      value={snoozeReason}
                      onChange={(e) => setSnoozeReason(e.target.value)}
                      placeholder="Reason (required) — e.g. Client asked to be contacted after 3 months"
                      rows={2}
                      className="w-full rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-sm outline-none resize-none"
                    />

                    <div className="flex gap-2 mt-3">
                      <button
                        disabled={snoozing}
                        onClick={submitSnooze}
                        className="flex-1 h-10 rounded-xl text-sm font-semibold bg-slate-800 text-white disabled:opacity-60"
                      >
                        {snoozing ? "Snoozing..." : "Confirm Snooze"}
                      </button>
                      <button
                        disabled={snoozing}
                        onClick={() => {
                          setSnoozeFormOpen(false);
                          setSnoozeReason("");
                        }}
                        className="flex-1 h-10 rounded-xl text-sm font-semibold bg-slate-100 text-slate-700 disabled:opacity-60"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setSnoozeFormOpen(true)}
                    className="w-full flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200"
                  >
                    😴 Snooze this lead
                  </button>
                )}
              </div>
            )
          )}

          {isTerminal ? (
            <div className="rounded-2xl bg-slate-100 p-4 text-sm text-slate-500 text-center">
              This lead is closed — no further updates possible.
            </div>
          ) : (
            <div className="rounded-2xl bg-white border border-slate-100 shadow-md p-5">
              <p className="text-sm font-bold text-slate-800 mb-3">Log Update</p>

              <div className="flex flex-wrap gap-2 mb-4">
                {validNextStatuses.map((status) => (
                  <button
                    key={status}
                    onClick={() => setSelectedStatus(status === selectedStatus ? null : status)}
                    className={`text-[12px] font-semibold px-3 py-1.5 rounded-full border transition ${
                      selectedStatus === status
                        ? "bg-slate-800 text-white border-slate-800"
                        : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
                    }`}
                  >
                    {LEAD_STATUS_DISPLAY[status].label}
                  </button>
                ))}
              </div>

              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add a note (optional)..."
                rows={3}
                className="w-full rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-sm outline-none resize-none"
              />

              {noteText.trim() && (
                <div className="flex items-center gap-2 mt-2">
                  <label className="text-xs text-slate-500 shrink-0">Remind me in</label>
                  <input
                    type="number"
                    min={1}
                    value={reminderValue}
                    onChange={(e) => setReminderValue(e.target.value)}
                    placeholder="—"
                    className="w-16 h-8 rounded-lg bg-slate-50 border border-slate-200 px-2 text-sm outline-none text-center"
                  />
                  <select
                    value={reminderUnit}
                    onChange={(e) => setReminderUnit(e.target.value as "hours" | "days" | "months")}
                    className="h-8 rounded-lg bg-slate-50 border border-slate-200 px-2 text-xs outline-none"
                  >
                    <option value="hours">Hours</option>
                    <option value="days">Days</option>
                    <option value="months">Months</option>
                  </select>
                </div>
              )}

              <motion.button
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
                disabled={submitting}
                onClick={submitUpdate}
                className="mt-4 w-full flex items-center justify-center gap-2 h-11 rounded-xl font-semibold text-slate-900 bg-gradient-to-r from-yellow-400 to-amber-500 shadow-[0_8px_20px_rgba(217,119,6,0.3)] disabled:opacity-60"
              >
                {submitting ? <Loader2 className="animate-spin" size={16} /> : <Send size={15} />}
                {submitting ? "Logging..." : "Log Update"}
              </motion.button>
            </div>
          )}

          <div>
            <p className="text-[10.5px] uppercase tracking-[0.25em] text-slate-400 font-bold mb-3">
              Your Notes
            </p>

            {loadingNotes ? (
              <p className="text-sm text-slate-400">Loading...</p>
            ) : notes.length === 0 ? (
              <p className="text-sm text-slate-400">No notes yet.</p>
            ) : (
              <div className="space-y-2.5">
                {notes.map((n) => (
                  <div key={n.id} className="rounded-xl bg-white border border-slate-100 p-3">
                    <p className="text-sm text-slate-700">{n.note}</p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      {new Date(n.created_at).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit"
                      })}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </motion.div>
    </>
  );
}
