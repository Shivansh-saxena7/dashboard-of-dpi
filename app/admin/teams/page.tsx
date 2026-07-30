"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Users, Crown, Search, Plus, Check, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import toast from "react-hot-toast";
import DeleteModal from "../components/DeleteModal";

// Admin-only team management — creating teams, assigning a Team
// Leader, and adding/removing members, all from one team-centric
// panel (select a team, see/edit its full roster) rather than a
// per-employee dropdown scattered across the Employees page. All
// writes are direct sequential Supabase calls (no RPC) — this is a
// trusted Admin action on data Admin already has full RLS access to,
// same pattern as Settings page's Make Admin / Remove Admin and the
// rr_eligible toggle. Team Leaders themselves get no management UI
// at all — /team (their own view) is read-only, by design.
export default function AdminTeamsPage() {

  const [teams, setTeams] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [newTeamName, setNewTeamName] = useState("");
  const [creating, setCreating] = useState(false);

  const [teamNameDraft, setTeamNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [assigningLeader, setAssigningLeader] = useState(false);
  const [togglingMemberId, setTogglingMemberId] = useState<string | null>(null);

  const [memberSearch, setMemberSearch] = useState("");

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);

    const [{ data: teamsData }, { data: employeesData }] = await Promise.all([
      supabase.from("teams").select("*").order("name"),
      supabase.from("employees").select("id, name, email, role, team_id").order("name")
    ]);

    setTeams(teamsData || []);
    setEmployees(employeesData || []);
    setLoading(false);
  }

  const selectedTeam = teams.find((t) => t.id === selectedTeamId) || null;

  useEffect(() => {
    setTeamNameDraft(selectedTeam?.name || "");
  }, [selectedTeamId, selectedTeam?.name]);

  const teamNameById = useMemo(() => {
    const map = new Map<string, string>();
    teams.forEach((t) => map.set(t.id, t.name));
    return map;
  }, [teams]);

  const memberCountByTeam = useMemo(() => {
    const counts = new Map<string, number>();
    employees.forEach((e) => {
      if (e.team_id) counts.set(e.team_id, (counts.get(e.team_id) || 0) + 1);
    });
    return counts;
  }, [employees]);

  async function createTeam() {
    if (!newTeamName.trim()) return;

    setCreating(true);

    try {
      const { data, error } = await supabase
        .from("teams")
        .insert({ name: newTeamName.trim() })
        .select()
        .single();

      if (error) {
        toast.error(error.message || "Could not create team.");
        return;
      }

      toast.success("Team created.");
      setNewTeamName("");
      await loadData();
      setSelectedTeamId(data.id);

    } catch (err) {
      console.log(err);
      toast.error("Something went wrong.");
    } finally {
      setCreating(false);
    }
  }

  async function saveTeamName() {
    if (!selectedTeam || !teamNameDraft.trim() || teamNameDraft.trim() === selectedTeam.name) return;

    setSavingName(true);

    try {
      const { error } = await supabase
        .from("teams")
        .update({ name: teamNameDraft.trim() })
        .eq("id", selectedTeam.id);

      if (error) {
        toast.error(error.message || "Could not rename team.");
        return;
      }

      toast.success("Team renamed.");
      await loadData();

    } catch (err) {
      console.log(err);
      toast.error("Something went wrong.");
    } finally {
      setSavingName(false);
    }
  }

  async function assignLeader(newLeaderId: string) {
    if (!selectedTeam || !newLeaderId) return;

    setAssigningLeader(true);

    try {
      const oldLeaderId: string | null = selectedTeam.team_leader_id;

      const { error: teamError } = await supabase
        .from("teams")
        .update({ team_leader_id: newLeaderId })
        .eq("id", selectedTeam.id);

      if (teamError) {
        toast.error(teamError.message || "Could not assign Team Leader.");
        return;
      }

      // The leader is also a member of their own team — this is
      // exactly what current_employee_team_id() relies on for their
      // own RLS-scoped view access.
      await supabase
        .from("employees")
        .update({ role: "team_leader", team_id: selectedTeam.id })
        .eq("id", newLeaderId);

      // Step down the previous leader — but only if they aren't
      // still leading a different team. Their team membership
      // (team_id) is left untouched; that's a separate, deliberate
      // Admin decision via the checklist below.
      if (oldLeaderId && oldLeaderId !== newLeaderId) {
        const { count } = await supabase
          .from("teams")
          .select("*", { count: "exact", head: true })
          .eq("team_leader_id", oldLeaderId);

        if (!count) {
          await supabase.from("employees").update({ role: "employee" }).eq("id", oldLeaderId);
        }
      }

      toast.success("Team Leader updated.");
      await loadData();

    } catch (err) {
      console.log(err);
      toast.error("Something went wrong.");
    } finally {
      setAssigningLeader(false);
    }
  }

  async function toggleMember(employeeId: string, currentlyInTeam: boolean) {
    if (!selectedTeam) return;

    // A team's current leader can't be unchecked directly — that
    // would leave teams.team_leader_id pointing at someone no longer
    // on the team, an inconsistent state the checklist should never
    // be able to produce. Reassign the leader first.
    if (currentlyInTeam && employeeId === selectedTeam.team_leader_id) {
      toast.error("Reassign the Team Leader first before removing them.");
      return;
    }

    setTogglingMemberId(employeeId);

    try {
      const { error } = await supabase
        .from("employees")
        .update({ team_id: currentlyInTeam ? null : selectedTeam.id })
        .eq("id", employeeId);

      if (error) {
        toast.error(error.message || "Could not update membership.");
        return;
      }

      await loadData();

    } catch (err) {
      console.log(err);
      toast.error("Something went wrong.");
    } finally {
      setTogglingMemberId(null);
    }
  }

  async function deleteTeam() {
    if (!selectedTeam) return;

    setDeleting(true);

    try {

      // Must clear team_id on every member BEFORE deleting the team
      // row — employees.team_id is a foreign key to teams(id) with
      // no ON DELETE clause, so deleting the team first would fail
      // with a foreign-key-violation while any member still points
      // at it.
      const { error: clearMembersError } = await supabase
        .from("employees")
        .update({ team_id: null })
        .eq("team_id", selectedTeam.id);

      if (clearMembersError) {
        toast.error(clearMembersError.message || "Could not remove team members.");
        return;
      }

      // Step the leader back down to 'employee' — but only if they
      // aren't leading some other team too.
      if (selectedTeam.team_leader_id) {
        const { count } = await supabase
          .from("teams")
          .select("*", { count: "exact", head: true })
          .eq("team_leader_id", selectedTeam.team_leader_id)
          .neq("id", selectedTeam.id);

        if (!count) {
          await supabase
            .from("employees")
            .update({ role: "employee" })
            .eq("id", selectedTeam.team_leader_id);
        }
      }

      const { error: deleteError } = await supabase
        .from("teams")
        .delete()
        .eq("id", selectedTeam.id);

      if (deleteError) {
        toast.error(deleteError.message || "Could not delete team.");
        return;
      }

      toast.success("Team deleted.");
      setDeleteModalOpen(false);
      setSelectedTeamId(null);
      await loadData();

    } catch (err) {
      console.log(err);
      toast.error("Something went wrong.");
    } finally {
      setDeleting(false);
    }
  }

  const visibleEmployeesForChecklist = employees.filter((e) => {
    if (!memberSearch.trim()) return true;
    const q = memberSearch.trim().toLowerCase();
    return e.name?.toLowerCase().includes(q) || e.email?.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between gap-5">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">Teams</h1>
          <p className="text-slate-500 mt-1">Manage teams, leaders, and members</p>
        </div>

        <div className="flex gap-2">
          <input
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            placeholder="New team name..."
            className="h-12 rounded-2xl bg-white border border-slate-200 px-4 outline-none focus:ring-4 focus:ring-cyan-200"
          />
          <button
            onClick={createTeam}
            disabled={creating || !newTeamName.trim()}
            className="h-12 px-6 rounded-2xl text-white font-medium bg-gradient-to-r from-blue-600 to-cyan-500 shadow-lg hover:scale-105 transition disabled:opacity-50 disabled:hover:scale-100 flex items-center gap-2"
          >
            <Plus size={18} />
            Create
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-sm text-slate-400 py-10">Loading teams...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5">

          <div className="space-y-3">
            {teams.length === 0 && (
              <div className="bg-white rounded-3xl border border-slate-100 shadow-md p-6 text-center text-sm text-slate-400">
                No teams yet — create one above.
              </div>
            )}

            {teams.map((team) => {
              const active = team.id === selectedTeamId;
              const leaderName = employees.find((e) => e.id === team.team_leader_id)?.name;

              return (
                <motion.button
                  key={team.id}
                  onClick={() => setSelectedTeamId(team.id)}
                  whileHover={{ y: -2 }}
                  className={`w-full text-left rounded-3xl p-5 border shadow-md transition-all ${
                    active
                      ? "bg-gradient-to-br from-blue-600 to-cyan-500 border-transparent text-white"
                      : "bg-white border-slate-100 text-slate-800 hover:shadow-xl"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${active ? "bg-white/20" : "bg-blue-50"}`}>
                      <Users size={18} className={active ? "text-white" : "text-blue-600"} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold truncate">{team.name}</p>
                      <p className={`text-xs truncate ${active ? "text-white/80" : "text-slate-500"}`}>
                        {memberCountByTeam.get(team.id) || 0} members · {leaderName ? `Led by ${leaderName}` : "No leader assigned"}
                      </p>
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </div>

          <div>
            {!selectedTeam ? (
              <div className="bg-white rounded-[24px] border border-slate-100 shadow-md p-10 text-center text-sm text-slate-400">
                Select a team on the left to manage it.
              </div>
            ) : (
              <motion.div
                key={selectedTeam.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-5"
              >
                <div className="bg-white rounded-[24px] border border-slate-100 shadow-md p-6 relative">
                  <button
                    onClick={() => setDeleteModalOpen(true)}
                    title="Delete Team"
                    className="absolute top-5 right-5 h-9 w-9 rounded-full bg-red-50 border border-red-100 flex items-center justify-center text-red-500 hover:bg-red-500 hover:text-white transition"
                  >
                    <Trash2 size={15} />
                  </button>

                  <div className="flex items-center justify-between mb-3 pr-12">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-bold">Team Name</p>
                    <p className="text-[10px] text-slate-400">Edit and press Save to rename</p>
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={teamNameDraft}
                      onChange={(e) => setTeamNameDraft(e.target.value)}
                      className="flex-1 h-12 rounded-xl bg-slate-50 border border-slate-200 px-4 outline-none focus:ring-4 focus:ring-cyan-200"
                    />
                    <button
                      onClick={saveTeamName}
                      disabled={savingName || !teamNameDraft.trim() || teamNameDraft.trim() === selectedTeam.name}
                      className="h-12 px-5 rounded-xl font-semibold text-white bg-gradient-to-r from-blue-600 to-cyan-500 disabled:opacity-50"
                    >
                      Save
                    </button>
                  </div>

                  <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-bold mb-3 mt-6">Team Leader</p>
                  <div className="relative">
                    <Crown size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-amber-500" />
                    <select
                      value={selectedTeam.team_leader_id || ""}
                      onChange={(e) => e.target.value && assignLeader(e.target.value)}
                      disabled={assigningLeader}
                      className="w-full h-12 rounded-xl bg-slate-50 border border-slate-200 pl-10 pr-4 outline-none focus:ring-4 focus:ring-cyan-200 appearance-none"
                    >
                      <option value="" disabled>Select a Team Leader...</option>
                      {employees.map((e) => (
                        <option key={e.id} value={e.id}>{e.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="bg-white rounded-[24px] border border-slate-100 shadow-md p-6">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-bold">
                      Members ({memberCountByTeam.get(selectedTeam.id) || 0})
                    </p>
                    <p className="flex items-center gap-1 text-[10px] text-emerald-600 font-medium">
                      <Check size={11} />
                      Changes save automatically
                    </p>
                  </div>
                  <p className="text-[11px] text-slate-400 mb-4">
                    Check or uncheck to add/remove a member — no separate save step.
                  </p>

                  <div className="relative mb-4">
                    <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                      placeholder="Search employees..."
                      className="w-full h-11 rounded-xl bg-slate-50 border border-slate-200 pl-10 pr-3 text-sm outline-none focus:ring-2 focus:ring-cyan-200"
                    />
                  </div>

                  <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
                    {visibleEmployeesForChecklist.map((employee) => {
                      const inThisTeam = employee.team_id === selectedTeam.id;
                      const inOtherTeam = employee.team_id && employee.team_id !== selectedTeam.id;
                      const isLeader = employee.id === selectedTeam.team_leader_id;
                      const toggling = togglingMemberId === employee.id;

                      return (
                        <label
                          key={employee.id}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition ${
                            inThisTeam ? "bg-cyan-50" : "hover:bg-slate-50"
                          } ${isLeader ? "opacity-80" : "cursor-pointer"}`}
                        >
                          <button
                            type="button"
                            disabled={toggling || isLeader}
                            onClick={() => toggleMember(employee.id, inThisTeam)}
                            className={`h-5 w-5 rounded-md flex items-center justify-center shrink-0 border transition ${
                              inThisTeam
                                ? "bg-gradient-to-br from-blue-600 to-cyan-500 border-transparent"
                                : "border-slate-300 bg-white"
                            } ${isLeader ? "cursor-not-allowed" : ""}`}
                          >
                            {inThisTeam && <Check size={13} className="text-white" />}
                          </button>

                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-slate-700 truncate">
                              {employee.name}
                              {isLeader && <span className="ml-2 text-[10px] font-bold text-amber-600">LEADER</span>}
                            </p>
                            {inOtherTeam && (
                              <p className="text-[11px] text-slate-400">
                                Currently in: {teamNameById.get(employee.team_id) || "another team"}
                              </p>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      )}

      {selectedTeam && (
        <DeleteModal
          open={deleteModalOpen}
          setOpen={setDeleteModalOpen}
          onDelete={deleteTeam}
          title="Delete Team"
          message={
            deleting
              ? "Deleting..."
              : `Are you sure? This will remove ${memberCountByTeam.get(selectedTeam.id) || 0} member(s) from "${selectedTeam.name}" and permanently delete the team. This action cannot be undone.`
          }
        />
      )}
    </div>
  );
}
