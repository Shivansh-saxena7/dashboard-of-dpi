"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { UserCheck, X } from "lucide-react";
import { supabase } from "@/lib/supabase";

import PageHeader from "@/components/PageHeader";
interface RequestRow {
  id: string;
  candidate_id: string;
  requested_by: string;
  requested_at: string;
  email: string;
  role: string;
  department: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  resulting_employee_id: string | null;
  candidate: { name: string; mobile: string; position_applied_for: string } | null;
  requester: { name: string } | null;
}

// Admin can view (same "Admin sees everything" pattern used
// everywhere else in this app), but Approve/Reject is Super-Admin-
// exclusive -- approving this IS setting someone's initial
// role/department, the same thing the column-lock trigger already
// protects, so the same exclusivity holds here. The real enforcement
// is server-side in /api/review-employee-creation-request; isSuperAdmin
// here only controls whether the buttons render.
export default function EmployeeRequestsPage() {
  const [myRole, setMyRole] = useState<string | null>(null);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [approvingFor, setApprovingFor] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [rejectingFor, setRejectingFor] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);

  const isSuperAdmin = myRole === "super_admin";

  useEffect(() => {
    loadSelf();
    loadRequests();
  }, []);

  async function loadSelf() {
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from("employees").select("role").eq("auth_user_id", user.id).single();
    if (data) setMyRole(data.role);
  }

  async function loadRequests() {
    setLoading(true);
    const { data } = await supabase
      .from("employee_creation_requests")
      .select(
        "*, candidate:candidates(name, mobile, position_applied_for), requester:employees!employee_creation_requests_requested_by_fkey(name)"
      )
      .order("requested_at", { ascending: false });
    setRequests((data || []) as RequestRow[]);
    setLoading(false);
  }

  async function callReview(requestId: string, action: "APPROVE" | "REJECT", extra: Record<string, any> = {}) {
    const {
      data: { session }
    } = await supabase.auth.getSession();
    if (!session) {
      toast.error("Your session has expired — please log in again.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/review-employee-creation-request", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ requestId, action, ...extra })
      });
      const result = await res.json();

      if (!result.success) {
        toast.error(result.message || "Action failed.");
        return;
      }

      toast.success(action === "APPROVE" ? "Employee account created." : "Request rejected.");
      setApprovingFor(null);
      setPassword("");
      setRejectingFor(null);
      setRejectReason("");
      loadRequests();
    } catch (err: any) {
      toast.error(err.message || "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  const pending = requests.filter((r) => r.status === "PENDING");
  const decided = requests.filter((r) => r.status !== "PENDING").slice(0, 20);

  if (loading) return <div className="p-6 text-sm text-slate-400">Loading...</div>;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="People"
        title="Employee Requests"
        description={
          <>
            HR-submitted requests to create employee accounts from converted candidates.
            {!isSuperAdmin && " Only Super Admin can approve or reject — you're viewing read-only."}
          </>
        }
      />

      <div className="bg-white rounded-[24px] border border-slate-100 shadow-md p-5">
        <h2 className="text-lg font-bold text-slate-800 mb-4">Pending ({pending.length})</h2>

        {pending.length === 0 ? (
          <p className="text-sm text-slate-400">No pending requests.</p>
        ) : (
          <div className="space-y-3">
            {pending.map((r) => (
              <div key={r.id} className="rounded-2xl border border-amber-100 bg-amber-50/50 p-4 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-bold text-slate-800 text-sm">{r.candidate?.name || "Unknown candidate"}</p>
                    <p className="text-xs text-slate-500">
                      {r.candidate?.mobile} · {r.candidate?.position_applied_for}
                    </p>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Requested by {r.requester?.name || "—"} on {new Date(r.requested_at).toLocaleString()}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                  <span className="px-2 py-1 rounded-lg bg-white border border-slate-200">📧 {r.email}</span>
                  <span className="px-2 py-1 rounded-lg bg-white border border-slate-200">Role: {r.role}</span>
                  <span className="px-2 py-1 rounded-lg bg-white border border-slate-200">Dept: {r.department}</span>
                </div>

                {isSuperAdmin && (
                  <div className="pt-1">
                    {approvingFor === r.id ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Temporary password"
                          className="h-9 rounded-lg bg-white border border-slate-200 px-2 text-xs outline-none"
                        />
                        <button
                          disabled={busy}
                          onClick={() => callReview(r.id, "APPROVE", { password })}
                          className="h-9 px-3 rounded-lg bg-emerald-600 text-white text-xs font-bold disabled:opacity-50"
                        >
                          {busy ? "Creating..." : "Confirm Approve"}
                        </button>
                        <button onClick={() => setApprovingFor(null)} className="h-9 px-2 text-xs text-slate-400">
                          Cancel
                        </button>
                      </div>
                    ) : rejectingFor === r.id ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          placeholder="Reason (optional)"
                          className="h-9 rounded-lg bg-white border border-slate-200 px-2 text-xs outline-none"
                        />
                        <button
                          disabled={busy}
                          onClick={() => callReview(r.id, "REJECT", { rejectionReason: rejectReason })}
                          className="h-9 px-3 rounded-lg bg-red-600 text-white text-xs font-bold disabled:opacity-50"
                        >
                          {busy ? "Rejecting..." : "Confirm Reject"}
                        </button>
                        <button onClick={() => setRejectingFor(null)} className="h-9 px-2 text-xs text-slate-400">
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setApprovingFor(r.id)}
                          className="h-9 px-3 rounded-lg bg-emerald-600 text-white text-xs font-bold flex items-center gap-1.5"
                        >
                          <UserCheck size={13} /> Approve
                        </button>
                        <button
                          onClick={() => setRejectingFor(r.id)}
                          className="h-9 px-3 rounded-lg bg-white border border-red-200 text-red-600 text-xs font-bold flex items-center gap-1.5"
                        >
                          <X size={13} /> Reject
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {decided.length > 0 && (
        <div className="bg-white rounded-[24px] border border-slate-100 shadow-md p-5">
          <h2 className="text-lg font-bold text-slate-800 mb-4">Recent decisions</h2>
          <div className="space-y-2">
            {decided.map((r) => (
              <div key={r.id} className="flex items-center justify-between text-xs border-b border-slate-100 pb-2 last:border-0">
                <span className="text-slate-600">
                  {r.candidate?.name || "Unknown"} · {r.email}
                </span>
                <span className={r.status === "APPROVED" ? "text-emerald-600 font-bold" : "text-red-500 font-bold"}>
                  {r.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
