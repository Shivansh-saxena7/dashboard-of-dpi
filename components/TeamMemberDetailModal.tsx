"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { X, Send, Loader2, Repeat } from "lucide-react";
import { supabase } from "@/lib/supabase";
import toast from "react-hot-toast";
import { LEAD_STATUS_DISPLAY } from "@/lib/leadStatusDisplay";
import { BOARD_STAGES } from "@/lib/leadBoardStageDisplay";
import { assignedByLabel, AssignedBySource } from "@/lib/assignedByDisplay";
import { MemberAttendanceStatus } from "./TeamMemberCard";

interface TeamMemberDetailModalProps {
  member: { id: string; name: string };
  teamLeaderId: string;
  teamId: string;
  teamMembers: { id: string; name: string; is_active: boolean }[];
  attendanceStatus: MemberAttendanceStatus;
  onClose: () => void;
  onReassigned: () => void;
}

interface MemberLead {
  id: string;
  name: string;
  project: string | null;
  status: string;
  board_stage: string | null;
  activeHistoryId: string | null;
  assignedByType: "SYSTEM" | "ADMIN" | "TEAM_LEADER" | null;
  assignedByName: string | null;
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

const LEADS_PAGE_SIZE = 10;

// View-only — no status/board_stage change controls at all, unlike
// LeadDetailModal (which this reuses the drawer motion pattern from).
// Team Notes are the one thing this screen can WRITE, and even that
// write is scoped by RLS (team_notes_team_leader_insert) to notes
// about this leader's own team members only — the noted employee
// themselves has no policy that could ever surface these rows to
// them, enforced at the database level (see the Phase 5 SQL).
export default function TeamMemberDetailModal({ member, teamLeaderId, teamId, teamMembers, attendanceStatus, onClose, onReassigned }: TeamMemberDetailModalProps) {

  const [leads, setLeads] = useState<MemberLead[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(true);
  const [loadingMoreLeads, setLoadingMoreLeads] = useState(false);
  const [leadsPage, setLeadsPage] = useState(0);
  const [leadsTotalCount, setLeadsTotalCount] = useState(0);

  const [notes, setNotes] = useState<TeamNote[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(true);

  const [noteText, setNoteText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [reassigningLeadId, setReassigningLeadId] = useState<string | null>(null);
  const [reassignTargetId, setReassignTargetId] = useState("");
  const [reassignNote, setReassignNote] = useState("");
  const [reassignSubmitting, setReassignSubmitting] = useState(false);

  useEffect(() => {
    setLeads([]);
    setLeadsPage(0);
    loadLeads(0, false);
    loadNotes();
  }, [member.id]);

  // lead_history!inner + is_active filter: the "only one active
  // assignment per lead" constraint guarantees at most one match, so
  // [0] below is safe — same assumption recycle-stale-leads already
  // makes on this same shape. { count: "exact" } + .range() paginate
  // — a team member with a large book of leads no longer forces this
  // drawer to fetch (and render) all of it at once.
  async function loadLeads(pageIndex: number, append: boolean) {
    if (append) {
      setLoadingMoreLeads(true);
    } else {
      setLoadingLeads(true);
    }

    const from = pageIndex * LEADS_PAGE_SIZE;
    const to = from + LEADS_PAGE_SIZE - 1;

    const { data, error, count } = await supabase
      .from("leads")
      .select(
        `
        id, name, project, status, board_stage,
        lead_history!inner (
          id, assigned_by_type,
          assigned_by:employees!lead_history_assigned_by_employee_id_fkey(name)
        )
        `,
        { count: "exact" }
      )
      .eq("current_owner_id", member.id)
      .eq("lead_history.is_active", true)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (!error && data) {
      type RawLead = {
        id: string;
        name: string;
        project: string | null;
        status: string;
        board_stage: string | null;
        lead_history: (AssignedBySource & { id: string })[] | null;
      };

      const mapped = (data as unknown as RawLead[]).map((lead) => {
        const activeHistory = lead.lead_history?.[0] || null;
        return {
          id: lead.id,
          name: lead.name,
          project: lead.project,
          status: lead.status,
          board_stage: lead.board_stage,
          activeHistoryId: activeHistory?.id ?? null,
          assignedByType: activeHistory?.assigned_by_type ?? null,
          assignedByName: activeHistory
            ? assignedByLabel(activeHistory)
            : null
        };
      });

      setLeads((prev) => (append ? [...prev, ...mapped] : mapped));
      setLeadsTotalCount(count ?? 0);
    }

    setLoadingLeads(false);
    setLoadingMoreLeads(false);
  }

  function loadMoreLeads() {
    const next = leadsPage + 1;
    setLeadsPage(next);
    loadLeads(next, true);
  }

  async function submitReassign(lead: MemberLead) {
    if (!reassignTargetId || !lead.activeHistoryId) return;

    setReassignSubmitting(true);

    try {

      const { error } = await supabase.rpc("reassign_lead_by_team_leader_atomic", {
        p_lead_id: lead.id,
        p_old_lead_history_id: lead.activeHistoryId,
        p_new_employee_id: reassignTargetId,
        p_note: reassignNote.trim() || null
      });

      if (error) {
        toast.error(error.message || "Could not reassign this lead.");
        return;
      }

      toast.success("Lead reassigned.");
      setReassigningLeadId(null);
      setReassignTargetId("");
      setReassignNote("");
      setLeadsPage(0);
      loadLeads(0, false);
      onReassigned();

    } catch (err) {
      console.log(err);
      toast.error("Something went wrong.");
    } finally {
      setReassignSubmitting(false);
    }
  }

  async function loadNotes() {
    setLoadingNotes(true);

    const { data, error } = await supabase
      .from("team_notes")
      .select("id, note, created_at")
      .eq("employee_id", member.id)
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
        team_id: teamId,
        author_id: teamLeaderId,
        employee_id: member.id,
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
              Leads ({leadsTotalCount})
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
                  const reassignOptions = teamMembers.filter((m) => m.is_active && m.id !== member.id);
                  const isReassigning = reassigningLeadId === lead.id;

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

                      {lead.assignedByName && (
                        <p className="text-[11px] text-slate-400 mt-1.5 font-medium">
                          {lead.assignedByName}
                        </p>
                      )}

                      {reassignOptions.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-slate-100">
                          {!isReassigning ? (
                            <button
                              onClick={() => {
                                setReassigningLeadId(lead.id);
                                setReassignTargetId("");
                                setReassignNote("");
                              }}
                              className="flex items-center gap-1 text-[11px] font-bold text-amber-700 hover:text-amber-800 transition"
                            >
                              <Repeat size={11} />
                              Reassign
                            </button>
                          ) : (
                            <div className="space-y-1.5">
                              <select
                                value={reassignTargetId}
                                onChange={(e) => setReassignTargetId(e.target.value)}
                                className="w-full h-8 rounded-lg bg-slate-50 border border-slate-200 px-2 text-[11px] font-semibold text-slate-600 outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-300 transition"
                              >
                                <option value="">Select member...</option>
                                {reassignOptions.map((m) => (
                                  <option key={m.id} value={m.id}>{m.name}</option>
                                ))}
                              </select>

                              <input
                                type="text"
                                value={reassignNote}
                                onChange={(e) => setReassignNote(e.target.value)}
                                placeholder="Reason (optional)"
                                className="w-full h-8 rounded-lg bg-slate-50 border border-slate-200 px-2 text-[11px] text-slate-600 outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-300 transition"
                              />

                              <div className="flex items-center gap-1.5">
                                <button
                                  onClick={() => submitReassign(lead)}
                                  disabled={!reassignTargetId || reassignSubmitting}
                                  className="flex-1 h-8 rounded-lg bg-amber-500 text-white text-[11px] font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-amber-600 transition"
                                >
                                  {reassignSubmitting ? <Loader2 className="animate-spin mx-auto" size={12} /> : "Confirm"}
                                </button>
                                <button
                                  onClick={() => {
                                    setReassigningLeadId(null);
                                    setReassignTargetId("");
                                    setReassignNote("");
                                  }}
                                  disabled={reassignSubmitting}
                                  className="h-8 px-2 rounded-lg text-slate-400 text-[11px] font-semibold hover:text-slate-600 transition"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {leads.length < leadsTotalCount && (
                  <button
                    onClick={loadMoreLeads}
                    disabled={loadingMoreLeads}
                    className="w-full h-9 rounded-lg text-[12px] font-bold text-amber-700 hover:text-amber-800 transition disabled:opacity-50"
                  >
                    {loadingMoreLeads ? (
                      <Loader2 className="animate-spin mx-auto" size={14} />
                    ) : (
                      `Load More (${leadsTotalCount - leads.length} more)`
                    )}
                  </button>
                )}
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
