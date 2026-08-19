"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { X, Phone, Loader2, Send, MessageCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import toast from "react-hot-toast";
import { getValidNextLeadStatuses, LeadStatus } from "@/lib/getValidNextLeadStatuses";
import { LEAD_STATUS_DISPLAY } from "@/lib/leadStatusDisplay";
import { BoardStage } from "@/lib/leadBoardStageDisplay";
import { LEAD_POINTS } from "@/lib/calculateLeadPoints";
import { buildWhatsAppLink } from "@/lib/buildWhatsAppLink";

export interface DataDetailLead {
  id: string;
  leadHistoryId: string;
  name: string;
  mobile: string;
  status: LeadStatus;
  callCount: number;
  boardStage: BoardStage;
}

interface LeadNote {
  id: string;
  note: string;
  created_at: string;
}

interface DataDetailModalProps {
  lead: DataDetailLead;
  onClose: () => void;
  onUpdated: (updates: { status?: LeadStatus; callCount: number }) => void;
  onBoardStageChanged: (boardStage: BoardStage) => void;
}

// The Data-tab counterpart to LeadDetailModal. Previously had no
// "Move Lead" section at all (comment here used to say Data has no
// board_stage workflow) — that was a UI-scope decision, not a real
// technical limit: `leads.board_stage`'s CHECK constraint and
// move_lead_to_followup_atomic/log_site_visit_atomic/log_booking_atomic
// never actually checked lead_type, and a live re-verification of
// calculateSLAStatus.ts + recycle-stale-leads (2026-08-19, Point 2 of
// the live-production review) confirmed the whole staleness/recycling
// engine already keys off board_stage generically, not lead_type — so
// this now reuses the exact same three RPCs LeadDetailModal uses, zero
// new RPCs, zero changes to the recycling engine. Deliberately still
// NOT adding Snooze here — that wasn't part of what was asked for, and
// keeping this addition scoped to exactly Follow-up/Visit/Booking
// keeps the diff reviewable.
//
// A genuine client Data-to-Booking conversion now also counts toward
// the same Weekly Visits / Monthly Bookings Leaderboard a Lead-sourced
// one does (visits_leaderboard has no lead_type filter) — a deliberate
// choice, confirmed with the user before implementing, not an
// oversight: a booking is real revenue either way.
//
// submitUpdate calls log_lead_update_atomic with the SAME full
// 6-named-param shape LeadDetailModal already uses (p_lead_id,
// p_lead_history_id, p_new_status, p_note, p_reminder_value,
// p_reminder_unit), even though this drawer could in theory omit the
// reminder params when unused — the DB currently has multiple
// overloads of this function (accumulated across the Call-Later-
// reminder phases: 4/5/6-param versions all still exist), and always
// matching the exact shape already proven in production avoids any
// risk of PostgREST resolving to the wrong overload.
export default function DataDetailModal({ lead, onClose, onUpdated, onBoardStageChanged }: DataDetailModalProps) {

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

  // Now passes the real board_stage (previously always undefined,
  // back when Data had no board_stage workflow at all — see the
  // file-level comment above). isLeadTerminal correctly locks this
  // once board_stage reaches BOOKING, same as a Lead.
  const validNextStatuses = getValidNextLeadStatuses(lead.status, lead.boardStage);
  const isTerminal = validNextStatuses.length === 0;

  // Same gating LeadDetailModal uses — board moves stop once
  // genuinely Booked or otherwise terminal (JUNK).
  const boardMovesDisabled = isTerminal || lead.boardStage === "BOOKING";

  async function moveToFollowUp() {
    setMoving(true);

    try {

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
            Data Detail
          </p>
          <h2 className="text-xl font-bold text-slate-800 pr-10">{lead.name}</h2>

          <div className="flex items-center gap-1.5 flex-wrap mt-3">
            <span
              className={`inline-block text-[11px] font-semibold px-2.5 py-1 rounded-full ${LEAD_STATUS_DISPLAY[lead.status].badgeClassName}`}
            >
              {LEAD_STATUS_DISPLAY[lead.status].label}
            </span>
            {lead.boardStage !== "LEADS" && (
              <span className="inline-block text-[11px] font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">
                {lead.boardStage === "FOLLOW_UP" ? "📞 Follow-up" : lead.boardStage === "VISIT" ? "🏠 Visit" : "✅ Booked"}
              </span>
            )}
          </div>

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
                    // Same reasoning as LeadDetailModal's identical
                    // branch — once already in Visit, every further
                    // visit here IS a revisit by definition.
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

          {isTerminal ? (
            <div className="rounded-2xl bg-slate-100 p-4 text-sm text-slate-500 text-center">
              This is closed — no further updates possible.
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
