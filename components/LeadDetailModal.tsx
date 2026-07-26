"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { X, Phone, Loader2, Send } from "lucide-react";
import { supabase } from "@/lib/supabase";
import toast from "react-hot-toast";
import { getValidNextLeadStatuses, LeadStatus } from "@/lib/getValidNextLeadStatuses";
import { LEAD_STATUS_DISPLAY } from "@/lib/leadStatusDisplay";

export interface LeadDetailLead {
  id: string;
  leadHistoryId: string;
  name: string;
  mobile: string;
  project: string | null;
  status: LeadStatus;
  callCount: number;
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
}

// The write-side counterpart to LeadCard — status change, optional
// note, and call-count all logged in one action via
// log_lead_update_atomic (one RPC call = one transaction). Status
// options come from getValidNextLeadStatuses, so this component
// never re-implements the transition rules inline. Only ever shows
// this employee's own notes (lead_notes RLS scopes that already —
// see LeadList's "Always New" note), which is exactly what should
// happen: this lead is theirs right now, its history before them
// (if any) is invisible by design.
export default function LeadDetailModal({ lead, onClose, onUpdated }: LeadDetailModalProps) {

  const [notes, setNotes] = useState<LeadNote[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(true);
  const [selectedStatus, setSelectedStatus] = useState<LeadStatus | null>(null);
  const [noteText, setNoteText] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
