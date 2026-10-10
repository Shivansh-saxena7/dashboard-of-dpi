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

import RecycledBadge from "./RecycledBadge";
import TimerPausedBadge from "./TimerPausedBadge";
import { getRecycleCutoff } from "@/lib/calculateSLAStatus";
import RecycleChip from "@/components/RecycleChip";
import { leadCardFont } from "@/lib/leadCardFont";
import { FACT_LABEL, FACT_VALUE, FACTS_BOX, CHAMPAGNE, dotStyle, CALL_BUTTON, callStyle, cardSurface, formatAgo, formatAssignedExact, GLASS_BOX, HAIRLINE, HEADER_GLASS, INK, NAME_COLOR, NEUTRAL_TAG, PASS, PassTone, SIZE, statusPillStyle, TAG, TEXT2 } from "@/lib/leadCardLook";
import FactIcon from "@/components/FactIcon";
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
  assignedByType: "SYSTEM" | "ADMIN" | "TEAM_LEADER" | "SALES_COORDINATOR" | "SELF" | null;
  assignedByName: string | null;
  recycleReason: string | null;
  recycledFromStatus: string | null;
  recycledFromStage: string | null;
  // Step 8: recycle/SLA clock running (for the "Timer paused" badge).
  clockRunning: boolean;
  recycleAt: string | null;
  recycleWhy: string | null;
  // Display only (already fetched): facts row.
  assignedAt: string | null;
  lastActivityAt: string | null;
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
  //
  // .eq("lead_type", "LEAD") — reassign_lead_by_team_leader_atomic
  // (below) has no concept of Data at all (built purely for the Leads
  // SLA/round-robin model), so a Data row showing up in this list
  // would be reassignable through machinery that isn't built to
  // handle it correctly. Same scoping decision as LeadList.tsx.
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
        id, name, project, status, board_stage, lead_type, recycle_count, sla_deadline, is_personal_lead,
        lead_history!inner (
          id, assigned_by_type, recycle_reason, recycled_from_status, recycled_from_stage,
          paused_until, pause_reason, last_activity_at, assigned_at, outcome_at,
          assigned_by:employees!lead_history_assigned_by_employee_id_fkey(name)
        )
        `,
        { count: "exact" }
      )
      .eq("current_owner_id", member.id)
      .eq("lead_type", "LEAD")
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
        lead_type: string;
        recycle_count: number | null;
        sla_deadline: string | null;
        is_personal_lead: boolean | null;
        lead_history: (AssignedBySource & {
          id: string; recycle_reason: string | null; recycled_from_status: string | null; recycled_from_stage: string | null;
          paused_until: string | null; pause_reason: string | null; last_activity_at: string | null; assigned_at: string | null; outcome_at: string | null;
        })[] | null;
      };

      const mapped = (data as unknown as RawLead[]).map((lead) => {
        const activeHistory = lead.lead_history?.[0] || null;
        // Same rule as the employee/admin cards: a recycle cutoff exists
        // (null for paused/locked/personal/terminal leads), or a NEW
        // lead's SLA deadline is still ahead and the lead isn't paused.
        const cutoff = getRecycleCutoff(
          {
            status: lead.status,
            sla_deadline: lead.sla_deadline,
            recycle_count: lead.recycle_count ?? 0,
            lead_type: lead.lead_type,
            board_stage: lead.board_stage,
            paused_until: activeHistory?.paused_until ?? null,
            last_activity_at: activeHistory?.last_activity_at ?? null,
            pause_reason: activeHistory?.pause_reason ?? null,
            assigned_at: activeHistory?.assigned_at ?? null
          },
          activeHistory?.outcome_at ?? null,
          Boolean(lead.is_personal_lead)
        );
        const newSlaRunning =
          lead.status === "NEW" && !lead.is_personal_lead && Boolean(lead.sla_deadline) && new Date(lead.sla_deadline as string) > new Date() &&
          !(activeHistory?.paused_until && new Date(activeHistory.paused_until) > new Date());
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
            : null,
          recycleReason: activeHistory?.recycle_reason ?? null,
          recycledFromStatus: activeHistory?.recycled_from_status ?? null,
          recycledFromStage: activeHistory?.recycled_from_stage ?? null,
          assignedAt: activeHistory?.assigned_at ?? null,
          lastActivityAt: activeHistory?.last_activity_at ?? null,
          clockRunning: cutoff !== null || newSlaRunning,
          // Recycle countdown chip (2026-10-10): the same cutoff, or the new
          // lead's first-call deadline.
          recycleAt: cutoff ? cutoff.cutoffAt.toISOString() : newSlaRunning ? lead.sla_deadline : null,
          recycleWhy: cutoff ? cutoff.reason : newSlaRunning ? "FIRST_CALL" : null
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
              <div className="grid grid-cols-1 items-start gap-3 rounded-[20px] bg-[linear-gradient(180deg,#f3f6fb_0%,#e9eef6_100%)] p-2.5">
                {leads.map((lead) => {
                  const statusDisplay = LEAD_STATUS_DISPLAY[lead.status as keyof typeof LEAD_STATUS_DISPLAY];
                  const boardStageDisplay = BOARD_STAGES.find((b) => b.stage === (lead.board_stage || "LEADS"));
                  const reassignOptions = teamMembers.filter((m) => m.is_active && m.id !== member.id);
                  const isReassigning = reassigningLeadId === lead.id;
                  // Lead-card look (2026-10-09), presentation only: one tone per card.
                  const tone: PassTone = lead.board_stage && lead.board_stage !== "LEADS" ? "FOLLOW_UP" : "NEW";
                  const look = PASS[tone];
                  const nowMs = new Date().getTime();

                  return (
                    <div
                      key={lead.id}
                      style={cardSurface(tone)}
                      className={`${leadCardFont.className} @container relative w-full min-w-0 overflow-hidden rounded-[18px] border shadow-[var(--card-shadow)]`}
                    >
                      {/* 3px accent line + slim header: status, board stage, timer paused */}
                      <div className="h-[3px]" style={{ background: look.line }} aria-hidden="true" />
                      <div className={`flex flex-wrap items-center gap-1.5 px-3.5 py-1.5 ${HEADER_GLASS}`} style={{ background: look.header }}>
                        {statusDisplay && (
                          <span className={`${TAG} tracking-[.04em]`} style={statusPillStyle(lead.status)}>
                            {statusDisplay.label.toUpperCase()}
                          </span>
                        )}
                        {boardStageDisplay && (
                          <span className={TAG} style={NEUTRAL_TAG}>
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={dotStyle(look.accent)} aria-hidden="true" />
                            {boardStageDisplay.label}
                          </span>
                        )}
                        <span className="inline-flex empty:hidden [&>span]:inline-flex [&>span]:h-[22px] [&>span]:items-center [&>span]:text-[11px] [&>span]:bg-[#f3f6fa]! [&>span]:text-[#475569]! [&>span]:shadow-[inset_0_0_0_1px_#e8edf3]">
                          <TimerPausedBadge clockRunning={lead.clockRunning} size="sm" />
                        </span>
                      </div>

                      <div className="flex flex-col gap-2 px-3.5 pt-2.5 pb-3">
                        <div className="min-w-0">
                          <p title={lead.name} className={`${SIZE.name} break-words line-clamp-2`} style={{ color: NAME_COLOR }}>{lead.name}</p>
                          {lead.project && <p className={`mt-0.5 ${SIZE.project} font-medium truncate`} style={{ color: look.project }}>{lead.project}</p>}
                        </div>

                        {/* Facts row: Assigned (exact · ago) / Last activity / Assigned by */}
                        <dl className="grid grid-cols-[minmax(0,1fr)_auto] @max-[20rem]:grid-cols-1 gap-x-4 gap-y-1.5 rounded-[12px] px-3 py-2" style={FACTS_BOX}>
                          <div className="min-w-0">
                            <dt className={FACT_LABEL}><FactIcon name="assigned" />Assigned</dt>
                            <dd className={`${FACT_VALUE} tabular-nums`}>
                              {lead.assignedAt ? (
                                <>
                                  <span className="whitespace-nowrap">{formatAssignedExact(lead.assignedAt)}</span>{" "}
                                  <span className="whitespace-nowrap font-semibold" style={{ color: TEXT2 }}>· {formatAgo(nowMs - new Date(lead.assignedAt).getTime())}</span>
                                </>
                              ) : (
                                "—"
                              )}
                            </dd>
                          </div>
                          <div className="min-w-0">
                            <dt className={FACT_LABEL}><FactIcon name="activity" />Last activity</dt>
                            <dd className={`${FACT_VALUE} tabular-nums`}>
                              {lead.lastActivityAt ? formatAgo(nowMs - new Date(lead.lastActivityAt).getTime()) : "—"}
                            </dd>
                          </div>
                          {lead.assignedByName && (
                            <div className="col-span-full min-w-0">
                              <dt className={FACT_LABEL}><FactIcon name="by" />Assigned by</dt>
                              <dd className={`${SIZE.factValue} font-semibold truncate`} style={{ color: TEXT2 }}>{lead.assignedByName}</dd>
                            </div>
                          )}
                        </dl>

                        {/* Recycled (with reason) — shared badge, neutral look. */}
                        {(lead.recycleReason) && (
                          <div className="flex min-w-0 [&>span]:h-[22px]! [&>span]:inline-flex! [&>span]:items-center! [&>span]:text-[11px]! [&>span]:bg-[#f3f6fa]! [&>span]:text-[#475569]! [&>span]:border-[#e8edf3]!">
                            <RecycledBadge reason={lead.recycleReason} fromStage={lead.recycledFromStage} fromStatus={lead.recycledFromStatus} />
                          </div>
                        )}
                        <RecycleChip
                          at={lead.recycleAt ? new Date(lead.recycleAt) : null}
                          why={lead.recycleWhy === "FIRST_CALL" ? "if it isn't called before the first-call deadline" : (lead.recycleWhy || "recycle rule").toLowerCase().replace(/_/g, " ")}
                          nowMs={nowMs}
                        />

                        {reassignOptions.length > 0 && (
                          <>
                            <div className="border-t border-dashed" style={{ borderColor: CHAMPAGNE.line }} aria-hidden="true" />
                            {!isReassigning ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setReassigningLeadId(lead.id);
                                  setReassignTargetId("");
                                  setReassignNote("");
                                }}
                                style={callStyle(tone)}
                                className={`${CALL_BUTTON} ${SIZE.button} w-full flex-none!`}
                              >
                                <Repeat size={15} strokeWidth={2} />
                                Reassign
                              </button>
                            ) : (
                              <div className="space-y-2 rounded-[12px] p-3" style={GLASS_BOX}>
                                <select
                                  value={reassignTargetId}
                                  onChange={(e) => setReassignTargetId(e.target.value)}
                                  aria-label="Team member"
                                  className="block h-11 w-full rounded-[12px] bg-white px-3 text-[13px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                                  style={{ boxShadow: `inset 0 0 0 1px ${HAIRLINE}`, color: INK }}
                                >
                                  <option value="">Select a team member</option>
                                  {reassignOptions.map((m) => (
                                    <option key={m.id} value={m.id}>{m.name}</option>
                                  ))}
                                </select>

                                <input
                                  type="text"
                                  value={reassignNote}
                                  onChange={(e) => setReassignNote(e.target.value)}
                                  placeholder="Reason (optional)"
                                  aria-label="Reason"
                                  className="block h-11 w-full rounded-[12px] bg-white px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                                  style={{ boxShadow: `inset 0 0 0 1px ${HAIRLINE}`, color: INK }}
                                />

                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => submitReassign(lead)}
                                    disabled={!reassignTargetId || reassignSubmitting}
                                    style={callStyle(tone)}
                                    className={`${CALL_BUTTON} ${SIZE.button} disabled:opacity-40 disabled:cursor-not-allowed`}
                                  >
                                    {reassignSubmitting ? <Loader2 className="animate-spin mx-auto" size={15} /> : "Confirm"}
                                  </button>
                                  <button
                                    onClick={() => {
                                      setReassigningLeadId(null);
                                      setReassignTargetId("");
                                      setReassignNote("");
                                    }}
                                    disabled={reassignSubmitting}
                                    className="h-11 px-3 rounded-[12px] text-[13px] font-semibold transition hover:bg-white/60"
                                    style={{ color: TEXT2 }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}

                {leads.length < leadsTotalCount && (
                  <button
                    onClick={loadMoreLeads}
                    disabled={loadingMoreLeads}
                    className="w-full h-11 rounded-[12px] text-[13px] font-bold transition disabled:opacity-50 hover:bg-white/60"
                    style={{ color: TEXT2 }}
                  >
                    {loadingMoreLeads ? (
                      <Loader2 className="animate-spin mx-auto" size={14} />
                    ) : (
                      `Load more (${leadsTotalCount - leads.length} more)`
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
