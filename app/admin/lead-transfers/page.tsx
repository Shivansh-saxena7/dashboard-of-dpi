"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";

interface TransferRequest {
  id: string;
  lead_id: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  transferred_to_employee_id: string | null;
  reviewed_at: string | null;
  created_at: string;
  requested_by: { id: string; name: string } | null;
  transferred_to: { id: string; name: string } | null;
  reviewed_by: { id: string; name: string } | null;
  lead: { id: string; name: string; mobile: string; project: string | null; lead_type: string } | null;
}

// Dedicated page rather than a section bolted onto /admin/leads (same
// call already made for Tickets/Leave/Backup Status) -- this is its own
// request -> review -> resolve workflow, not a leads-list filter. Writes
// only ever go through approve_lead_transfer_atomic/reject_lead_transfer_
// atomic (which itself reuses force_reassign_lead_atomic for the actual
// reassignment -- Golden Rule, one owner for "move a lead to someone
// else" stays force_reassign_lead_atomic, this page never touches leads
// directly).
export default function AdminLeadTransfersPage() {
  const [requests, setRequests] = useState<TransferRequest[]>([]);
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"PENDING" | "HISTORY">("PENDING");
  const [selectedEmployee, setSelectedEmployee] = useState<Record<string, string>>({});
  const [actingId, setActingId] = useState<string | null>(null);

  useEffect(() => {
    loadRequests();
    loadEmployees();
  }, []);

  async function loadEmployees() {
    const { data, error } = await supabase
      .from("employees")
      .select("id, name")
      .eq("is_active", true)
      .order("name");

    if (!error && data) setEmployees(data);
  }

  async function loadRequests() {
    setLoading(true);

    const { data, error } = await supabase
      .from("lead_transfer_requests")
      .select(
        `
        id, lead_id, reason, status, transferred_to_employee_id, reviewed_at, created_at,
        requested_by:employees!lead_transfer_requests_requested_by_employee_id_fkey(id, name),
        transferred_to:employees!lead_transfer_requests_transferred_to_employee_id_fkey(id, name),
        reviewed_by:employees!lead_transfer_requests_reviewed_by_admin_id_fkey(id, name),
        lead:leads!lead_transfer_requests_lead_id_fkey(id, name, mobile, project, lead_type)
        `
      )
      .order("created_at", { ascending: false });

    if (error) {
      toast.error(error.message || "Could not load transfer requests.");
      setLoading(false);
      return;
    }

    setRequests((data || []) as unknown as TransferRequest[]);
    setLoading(false);
  }

  const pending = useMemo(() => requests.filter((r) => r.status === "PENDING"), [requests]);
  const history = useMemo(() => requests.filter((r) => r.status !== "PENDING"), [requests]);
  const visible = tab === "PENDING" ? pending : history;

  async function handleApprove(request: TransferRequest) {
    const newEmployeeId = selectedEmployee[request.id];
    if (!newEmployeeId) {
      toast.error("Pick who this lead should go to first.");
      return;
    }

    setActingId(request.id);
    try {
      const { error } = await supabase.rpc("approve_lead_transfer_atomic", {
        p_request_id: request.id,
        p_new_employee_id: newEmployeeId
      });

      if (error) {
        toast.error(error.message || "Could not approve this request.");
        return;
      }

      toast.success("Transfer approved and reassigned.");
      loadRequests();
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong.");
    } finally {
      setActingId(null);
    }
  }

  async function handleReject(request: TransferRequest) {
    setActingId(request.id);
    try {
      const { error } = await supabase.rpc("reject_lead_transfer_atomic", {
        p_request_id: request.id
      });

      if (error) {
        toast.error(error.message || "Could not reject this request.");
        return;
      }

      toast.success("Transfer request rejected.");
      loadRequests();
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong.");
    } finally {
      setActingId(null);
    }
  }

  return (
    <div className="space-y-6 pb-10">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-[24px] bg-gradient-to-br from-indigo-700 via-violet-600 to-indigo-500 text-white p-6"
      >
        <p className="text-[10px] font-semibold tracking-[0.2em] text-indigo-100 uppercase mb-2">
          Lead Transfers
        </p>
        <h1 className="text-xl font-bold">Transfer Requests</h1>
        <p className="text-sm text-white/70 mt-1">
          Employees can ask to hand a lead off to someone else. Approve to reassign it, or reject to keep it
          where it is.
        </p>
      </motion.div>

      <div className="flex gap-2">
        <button
          onClick={() => setTab("PENDING")}
          className={`text-xs font-bold px-4 py-2 rounded-full transition ${
            tab === "PENDING" ? "bg-indigo-600 text-white" : "bg-white border border-slate-200 text-slate-600"
          }`}
        >
          Pending {pending.length > 0 && `(${pending.length})`}
        </button>
        <button
          onClick={() => setTab("HISTORY")}
          className={`text-xs font-bold px-4 py-2 rounded-full transition ${
            tab === "HISTORY" ? "bg-indigo-600 text-white" : "bg-white border border-slate-200 text-slate-600"
          }`}
        >
          History
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400 px-1">Loading...</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-slate-400 px-1">
          {tab === "PENDING" ? "No pending transfer requests." : "No resolved transfer requests yet."}
        </p>
      ) : (
        <div className="space-y-3">
          {visible.map((r) => (
            <div key={r.id} className="rounded-2xl bg-white border border-slate-100 shadow-[0_2px_10px_rgba(15,23,42,0.05)] p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-slate-800">{r.lead?.name || "Unknown lead"}</p>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                      {r.lead?.lead_type === "DATA" ? "Data" : "Lead"}
                    </span>
                    {r.status !== "PENDING" && (
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          r.status === "APPROVED" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                        }`}
                      >
                        {r.status === "APPROVED" ? "✅ Approved" : "❌ Rejected"}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {r.lead?.mobile} {r.lead?.project ? `· ${r.lead.project}` : ""}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Requested by <span className="font-semibold">{r.requested_by?.name || "—"}</span> on{" "}
                    {new Date(r.created_at).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Reason: <span className="italic">&ldquo;{r.reason}&rdquo;</span>
                  </p>
                  {r.status !== "PENDING" && (
                    <p className="text-[11px] text-slate-400 mt-1">
                      {r.status === "APPROVED" ? `Transferred to ${r.transferred_to?.name || "—"}` : "Rejected"} by{" "}
                      {r.reviewed_by?.name || "—"}
                      {r.reviewed_at &&
                        ` on ${new Date(r.reviewed_at).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`}
                    </p>
                  )}
                </div>

                {r.status === "PENDING" && (
                  <div className="shrink-0 flex items-center gap-2">
                    <select
                      value={selectedEmployee[r.id] || ""}
                      onChange={(e) => setSelectedEmployee((prev) => ({ ...prev, [r.id]: e.target.value }))}
                      className="h-9 rounded-lg bg-slate-50 border border-slate-200 px-2 text-xs outline-none"
                    >
                      <option value="">Assign to...</option>
                      {employees
                        .filter((e) => e.id !== r.requested_by?.id)
                        .map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name}
                          </option>
                        ))}
                    </select>
                    <button
                      onClick={() => handleApprove(r)}
                      disabled={actingId === r.id}
                      className="text-xs font-bold px-3 py-1.5 rounded-full bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 transition"
                    >
                      {actingId === r.id ? "..." : "Approve"}
                    </button>
                    <button
                      onClick={() => handleReject(r)}
                      disabled={actingId === r.id}
                      className="text-xs font-bold px-3 py-1.5 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-60 transition"
                    >
                      {actingId === r.id ? "..." : "Reject"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
