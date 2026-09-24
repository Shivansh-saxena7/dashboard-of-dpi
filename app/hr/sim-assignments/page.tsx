"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Eye, EyeOff } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";

interface EmployeeRow {
  id: string;
  name: string;
}

interface SimAssignmentRow {
  id: string;
  sim_number: string;
  email_address: string;
  is_active: boolean;
  created_at: string;
}

interface ActiveHolderRow {
  sim_assignment_id: string;
  employee_id: string;
  employee: { name: string } | null;
}

// Company SIM/Email tracking -- own page, not a tab inside
// /hr/documents (different interaction model: this is credentialed,
// reassignable asset data, not a file). "Who holds it now" is always
// derived from sim_assignment_history (is_active=true), never a column
// on company_sim_assignments itself -- see HRMS_MASTER_PLAN.md for why.
// Passwords are never fetched in bulk with the list -- only on demand,
// per row, when Show Password is clicked, to minimize how much
// plaintext sits in browser memory at once.
export default function HrSimAssignmentsPage() {
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [assignments, setAssignments] = useState<SimAssignmentRow[]>([]);
  const [activeHolders, setActiveHolders] = useState<ActiveHolderRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [newSimNumber, setNewSimNumber] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newEmployeeId, setNewEmployeeId] = useState("");
  const [newReason, setNewReason] = useState("");
  const [creating, setCreating] = useState(false);

  const [transferFormId, setTransferFormId] = useState<string | null>(null);
  const [transferEmployeeId, setTransferEmployeeId] = useState("");
  const [transferReason, setTransferReason] = useState("");
  const [transferring, setTransferring] = useState(false);

  const [revealedPasswords, setRevealedPasswords] = useState<Record<string, string>>({});
  const [revealingId, setRevealingId] = useState<string | null>(null);

  useEffect(() => {
    loadEmployees();
    loadAssignments();
  }, []);

  async function loadEmployees() {
    const { data } = await supabase.from("employees").select("id, name").eq("is_active", true).order("name");
    if (data) setEmployees(data);
  }

  async function loadAssignments() {
    setLoading(true);
    const [{ data: sims, error }, { data: holders }] = await Promise.all([
      supabase.from("company_sim_assignments").select("id, sim_number, email_address, is_active, created_at").order("created_at", { ascending: false }),
      supabase
        .from("sim_assignment_history")
        .select("sim_assignment_id, employee_id, employee:employees!sim_assignment_history_employee_id_fkey(name)")
        .eq("is_active", true)
    ]);

    if (error) {
      toast.error(error.message || "Could not load SIM assignments.");
      setLoading(false);
      return;
    }

    setAssignments((sims || []) as SimAssignmentRow[]);
    setActiveHolders((holders || []) as unknown as ActiveHolderRow[]);
    setLoading(false);
  }

  const rows = useMemo(
    () =>
      assignments.map((sim) => ({
        sim,
        holder: activeHolders.find((h) => h.sim_assignment_id === sim.id) || null
      })),
    [assignments, activeHolders]
  );

  async function handleCreate() {
    if (!newSimNumber.trim() || !newEmail.trim() || !newPassword || !newEmployeeId || !newReason.trim()) {
      toast.error("All fields are required.");
      return;
    }

    setCreating(true);
    try {
      const { error } = await supabase.rpc("create_sim_assignment_atomic", {
        p_sim_number: newSimNumber.trim(),
        p_email_address: newEmail.trim(),
        p_email_password: newPassword,
        p_employee_id: newEmployeeId,
        p_reason: newReason.trim()
      });

      if (error) {
        toast.error(error.message || "Could not create SIM assignment.");
        return;
      }

      toast.success("SIM assignment created.");
      setCreateOpen(false);
      setNewSimNumber("");
      setNewEmail("");
      setNewPassword("");
      setNewEmployeeId("");
      setNewReason("");
      loadAssignments();
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong.");
    } finally {
      setCreating(false);
    }
  }

  async function handleTransfer(simAssignmentId: string) {
    if (!transferReason.trim()) {
      toast.error("A reason is required.");
      return;
    }

    setTransferring(true);
    try {
      const { error } = await supabase.rpc("transfer_sim_assignment_atomic", {
        p_sim_assignment_id: simAssignmentId,
        p_new_employee_id: transferEmployeeId || null,
        p_reason: transferReason.trim()
      });

      if (error) {
        toast.error(error.message || "Could not transfer this SIM assignment.");
        return;
      }

      toast.success(transferEmployeeId ? "Transferred." : "Unassigned.");
      setTransferFormId(null);
      setTransferEmployeeId("");
      setTransferReason("");
      loadAssignments();
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong.");
    } finally {
      setTransferring(false);
    }
  }

  async function handleRevealPassword(simAssignmentId: string) {
    if (revealedPasswords[simAssignmentId]) {
      setRevealedPasswords((prev) => {
        const next = { ...prev };
        delete next[simAssignmentId];
        return next;
      });
      return;
    }

    setRevealingId(simAssignmentId);
    try {
      const { data, error } = await supabase.rpc("get_sim_assignment_credentials_atomic", {
        p_sim_assignment_id: simAssignmentId
      });

      if (error || !data || data.length === 0) {
        toast.error(error?.message || "Could not fetch password.");
        return;
      }

      setRevealedPasswords((prev) => ({ ...prev, [simAssignmentId]: data[0].email_password }));
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong.");
    } finally {
      setRevealingId(null);
    }
  }

  return (
    <div className="space-y-6 pb-10">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-[24px] bg-gradient-to-br from-teal-700 via-emerald-600 to-teal-500 text-white p-6"
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.2em] text-teal-100 uppercase mb-2">HR Assets</p>
            <h1 className="text-xl font-bold">Company SIM / Email Tracking</h1>
            <p className="text-sm text-white/70 mt-1">Track which employee holds each company SIM and email, and transfer when someone leaves.</p>
          </div>
          <button
            onClick={() => setCreateOpen(true)}
            className="shrink-0 flex items-center gap-1.5 h-10 px-4 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-sm font-semibold transition"
          >
            📱 New SIM / Email
          </button>
        </div>
      </motion.div>

      {createOpen && (
        <div className="rounded-2xl bg-white border border-slate-100 shadow-md p-5 space-y-3">
          <p className="text-sm font-bold text-slate-800">New SIM / Email</p>
          <div className="flex flex-wrap gap-2">
            <input
              value={newSimNumber}
              onChange={(e) => setNewSimNumber(e.target.value)}
              placeholder="SIM number"
              className="h-10 rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs outline-none"
            />
            <input
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="Company email address"
              className="h-10 flex-1 min-w-[200px] rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs outline-none"
            />
            <input
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Email password"
              type="text"
              className="h-10 rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs outline-none"
            />
            <select
              value={newEmployeeId}
              onChange={(e) => setNewEmployeeId(e.target.value)}
              className="h-10 rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs font-semibold text-slate-600 outline-none"
            >
              <option value="">Assign to...</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name}
                </option>
              ))}
            </select>
            <input
              value={newReason}
              onChange={(e) => setNewReason(e.target.value)}
              placeholder="Reason (required)"
              className="h-10 flex-1 min-w-[180px] rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs outline-none"
            />
          </div>
          <div className="flex gap-2">
            <button
              disabled={creating}
              onClick={handleCreate}
              className="h-10 px-4 rounded-xl text-xs font-bold bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-60 transition"
            >
              {creating ? "Creating..." : "Create"}
            </button>
            <button
              disabled={creating}
              onClick={() => setCreateOpen(false)}
              className="h-10 px-4 rounded-xl text-xs font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-60 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400 px-1">Loading...</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-400 px-1">No SIM/email assignments yet.</p>
      ) : (
        <div className="space-y-3">
          {rows.map(({ sim, holder }) => (
            <div key={sim.id} className="rounded-2xl bg-white border border-slate-100 shadow-[0_2px_10px_rgba(15,23,42,0.05)] p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-slate-800">{sim.sim_number}</p>
                    <span className="text-xs text-slate-500">{sim.email_address}</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {holder ? (
                      <>
                        Held by <span className="font-semibold">{holder.employee?.name || "—"}</span>
                      </>
                    ) : (
                      <span className="italic text-amber-600">Unassigned (in drawer)</span>
                    )}
                  </p>
                  {revealedPasswords[sim.id] && (
                    <p className="text-xs text-slate-500 mt-1">
                      Password: <span className="font-mono font-semibold">{revealedPasswords[sim.id]}</span>
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    disabled={revealingId === sim.id}
                    onClick={() => handleRevealPassword(sim.id)}
                    className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-60"
                  >
                    {revealedPasswords[sim.id] ? <EyeOff size={13} /> : <Eye size={13} />}
                    {revealedPasswords[sim.id] ? "Hide" : "Show"} Password
                  </button>
                  <button
                    onClick={() => setTransferFormId(transferFormId === sim.id ? null : sim.id)}
                    className="text-xs font-bold px-3 py-1.5 rounded-full bg-teal-50 text-teal-700 hover:bg-teal-100"
                  >
                    Transfer
                  </button>
                </div>
              </div>

              {transferFormId === sim.id && (
                <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap gap-2 items-center">
                  <select
                    value={transferEmployeeId}
                    onChange={(e) => setTransferEmployeeId(e.target.value)}
                    className="h-9 rounded-lg bg-slate-50 border border-slate-200 px-2 text-xs outline-none"
                  >
                    <option value="">Unassign only (no new holder)</option>
                    {employees
                      .filter((e) => e.id !== holder?.employee_id)
                      .map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.name}
                        </option>
                      ))}
                  </select>
                  <input
                    value={transferReason}
                    onChange={(e) => setTransferReason(e.target.value)}
                    placeholder="Reason (required)"
                    className="h-9 flex-1 min-w-[160px] rounded-lg bg-slate-50 border border-slate-200 px-2 text-xs outline-none"
                  />
                  <button
                    disabled={transferring}
                    onClick={() => handleTransfer(sim.id)}
                    className="text-xs font-bold px-3 py-1.5 rounded-full bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-60"
                  >
                    Confirm
                  </button>
                  <button
                    disabled={transferring}
                    onClick={() => {
                      setTransferFormId(null);
                      setTransferEmployeeId("");
                      setTransferReason("");
                    }}
                    className="text-xs font-bold px-3 py-1.5 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-60"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
