"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { X, Phone, Loader2, Send } from "lucide-react";
import { supabase } from "@/lib/supabase";
import toast from "react-hot-toast";
import { getValidNextLeadStatuses, LeadStatus } from "@/lib/getValidNextLeadStatuses";
import { LEAD_STATUS_DISPLAY } from "@/lib/leadStatusDisplay";
import { BoardStage } from "@/lib/leadBoardStageDisplay";
import { LEAD_POINTS } from "@/lib/calculateLeadPoints";

export interface LeadDetailLead {
  id: string;
  leadHistoryId: string;
  name: string;
  mobile: string;
  project: string | null;
  status: LeadStatus;
  callCount: number;
  boardStage: BoardStage;
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
export default function LeadDetailModal({ lead, onClose, onUpdated, onBoardStageChanged }: LeadDetailModalProps) {

  const [notes, setNotes] = useState<LeadNote[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(true);
  const [selectedStatus, setSelectedStatus] = useState<LeadStatus | null>(null);
  const [noteText, setNoteText] = useState("");
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

  const validNextStatuses = getValidNextLeadStatuses(lead.status);
  const isTerminal = validNextStatuses.length === 0;

  // Board moves stop once a lead is Booked (terminal) or its status
  // is otherwise terminal (JUNK) — same reasoning as Log Update.
  const boardMovesDisabled = isTerminal || lead.boardStage === "BOOKING";

  async function submitUpdate() {
    setSubmitting(true);

    try {

      const { error } = await supabase.rpc("log_lead_update_atomic", {
        p_lead_id: lead.id,
        p_lead_history_id: lead.leadHistoryId,
        p_new_status: selectedStatus,
        p_note: noteText.trim() || null
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

      const { error } = await supabase
        .from("leads")
        .update({ board_stage: "FOLLOW_UP" })
        .eq("id", lead.id);

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

          <span
            className={`inline-block mt-3 text-[11px] font-semibold px-2.5 py-1 rounded-full ${LEAD_STATUS_DISPLAY[lead.status].badgeClassName}`}
          >
            {LEAD_STATUS_DISPLAY[lead.status].label}
          </span>

          <a
            href={`tel:${lead.mobile}`}
            className="mt-4 flex items-center justify-center gap-2 h-11 rounded-xl bg-gradient-to-r from-yellow-400 to-amber-500 text-slate-900 text-sm font-semibold shadow-[0_8px_20px_rgba(217,119,6,0.3)]"
          >
            <Phone size={15} />
            Call {lead.mobile}
          </a>
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
                  {lead.boardStage !== "VISIT" && (
                    <button
                      disabled={moving}
                      onClick={() => setVisitPromptOpen(true)}
                      className="text-xs font-semibold px-3 py-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-60"
                    >
                      🏠 Move to Visit
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
