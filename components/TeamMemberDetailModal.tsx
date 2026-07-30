"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { X, Send, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import toast from "react-hot-toast";
import { LEAD_STATUS_DISPLAY } from "@/lib/leadStatusDisplay";
import { BOARD_STAGES } from "@/lib/leadBoardStageDisplay";
import { MemberAttendanceStatus } from "./TeamMemberCard";

interface TeamMemberDetailModalProps {
  member: { id: string; name: string };
  teamLeaderId: string;
  attendanceStatus: MemberAttendanceStatus;
  onClose: () => void;
}

interface MemberLead {
  id: string;
  name: string;
  project: string | null;
  status: string;
  board_stage: string | null;
}

interface TeamNote {
  id: string;
  note: string;
  created_at: string;
}

const ATTENDANCE_LABEL: Record<MemberAttendanceStatus, string> = {
  NOT_STARTED: "Not Started",
  ACTIVE: "Shift Active",
  ENDED: "Shift Ended"
};

// View-only — no status/board_stage change controls at all, unlike
// LeadDetailModal (which this reuses the drawer motion pattern from).
// Team Notes are the one thing this screen can WRITE, and even that
// write is scoped by RLS (team_notes_team_leader_insert) to notes
// about this leader's own team members only — the noted employee
// themselves has no policy that could ever surface these rows to
// them, enforced at the database level (see the Phase 5 SQL).
export default function TeamMemberDetailModal({ member, teamLeaderId, attendanceStatus, onClose }: TeamMemberDetailModalProps) {

  const [leads, setLeads] = useState<MemberLead[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(true);

  const [notes, setNotes] = useState<TeamNote[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(true);

  const [noteText, setNoteText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadLeads();
    loadNotes();
  }, [member.id]);

  async function loadLeads() {
    setLoadingLeads(true);

    const { data, error } = await supabase
      .from("leads")
      .select("id, name, project, status, board_stage")
      .eq("current_owner_id", member.id)
      .order("created_at", { ascending: false });

    if (!error && data) {
      setLeads(data);
    }

    setLoadingLeads(false);
  }

  async function loadNotes() {
    setLoadingNotes(true);

    const { data, error } = await supabase
      .from("team_notes")
      .select("id, note, created_at")
      .eq("about_employee_id", member.id)
      .order("created_at", { ascending: false });

    if (!error && data) {
      setNotes(data);
    }

    setLoadingNotes(false);
  }

  async function submitNote() {
    if (!noteText.trim()) return;

    setSubmitting(true);

    try {

      const { error } = await supabase.from("team_notes").insert({
        team_leader_id: teamLeaderId,
        about_employee_id: member.id,
        note: noteText.trim()
      });

      if (error) {
        toast.error(error.message || "Could not save this note.");
        return;
      }

      toast.success("Note added.");
      setNoteText("");
      loadNotes();

    } catch (err) {
      console.log(err);
      toast.error("Something went wrong.");
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
            Team Member
          </p>
          <h2 className="text-xl font-bold text-slate-800 pr-10">{member.name}</h2>

          <span className="inline-block mt-3 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-white/70 text-slate-700">
            {ATTENDANCE_LABEL[attendanceStatus]}
          </span>
        </div>

        <div className="px-6 py-6 space-y-6">

          <div>
            <p className="text-[10.5px] uppercase tracking-[0.25em] text-slate-400 font-bold mb-3">
              Leads ({leads.length})
            </p>

            {loadingLeads ? (
              <p className="text-sm text-slate-400">Loading...</p>
            ) : leads.length === 0 ? (
              <p className="text-sm text-slate-400">No leads assigned.</p>
            ) : (
              <div className="space-y-2">
                {leads.map((lead) => {
                  const statusDisplay = LEAD_STATUS_DISPLAY[lead.status as keyof typeof LEAD_STATUS_DISPLAY];
                  const boardStageDisplay = BOARD_STAGES.find((b) => b.stage === (lead.board_stage || "LEADS"));

                  return (
                    <div key={lead.id} className="rounded-xl bg-white border border-slate-100 p-3">
                      <p className="text-sm font-semibold text-slate-700">{lead.name}</p>
                      {lead.project && <p className="text-xs text-slate-500">{lead.project}</p>}
                      <div className="flex items-center gap-1.5 mt-1.5">
                        {statusDisplay && (
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusDisplay.badgeClassName}`}>
                            {statusDisplay.label}
                          </span>
                        )}
                        {boardStageDisplay && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                            {boardStageDisplay.emoji} {boardStageDisplay.label}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-2xl bg-white border border-slate-100 shadow-md p-5">
            <p className="text-sm font-bold text-slate-800 mb-3">Add Coaching Note</p>
            <p className="text-[11px] text-slate-400 mb-3">
              Only you and Admin can see these — never visible to {member.name.split(" ")[0]}.
            </p>

            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Write a coaching note..."
              rows={3}
              className="w-full rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-sm outline-none resize-none"
            />

            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              disabled={submitting || !noteText.trim()}
              onClick={submitNote}
              className="mt-3 w-full flex items-center justify-center gap-2 h-11 rounded-xl font-semibold text-slate-900 bg-gradient-to-r from-yellow-400 to-amber-500 shadow-[0_8px_20px_rgba(217,119,6,0.3)] disabled:opacity-60"
            >
              {submitting ? <Loader2 className="animate-spin" size={16} /> : <Send size={15} />}
              {submitting ? "Saving..." : "Add Note"}
            </motion.button>
          </div>

          <div>
            <p className="text-[10.5px] uppercase tracking-[0.25em] text-slate-400 font-bold mb-3">
              Previous Notes
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
