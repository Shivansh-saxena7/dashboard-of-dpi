"use client";

// Booking requests queue for Admin / Super Admin / Sales Coordinator
// (2026-10-10). Pending requests oldest first; Approve runs
// approve_booking_atomic (the booking, points and team celebration happen
// then), Reject needs a reason and sends it to the employee. Writes only go
// through those RPCs.
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";
import { LEAD_POINTS } from "@/lib/calculateLeadPoints";
import { formatAgo } from "@/lib/leadCardLook";

interface BookingRequestRow {
  id: string;
  lead_id: string;
  size: string | null;
  note: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  requested_at: string;
  decided_at: string | null;
  reject_reason: string | null;
  lead: { name: string | null; project: string | null; source: string | null; status: string; board_stage: string | null; lead_type: string | null } | null;
  employee: { name: string } | null;
  decided_by_employee: { name: string } | null;
}

const SELECT = `
  id, lead_id, size, note, status, requested_at, decided_at, reject_reason,
  lead:leads ( name, project, source, status, board_stage, lead_type ),
  employee:employees!booking_requests_employee_id_fkey ( name ),
  decided_by_employee:employees!booking_requests_decided_by_fkey ( name )
`;

export default function BookingRequestsQueue({ onPendingCount }: { onPendingCount?: (n: number) => void }) {
  const [pending, setPending] = useState<BookingRequestRow[]>([]);
  const [recent, setRecent] = useState<BookingRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    // Bounded: a queue of open requests plus the latest decisions, never the whole table.
    const [{ data: open, error: openError }, { data: done }] = await Promise.all([
      supabase.from("booking_requests").select(SELECT).eq("status", "PENDING").order("requested_at", { ascending: true }).limit(200),
      supabase.from("booking_requests").select(SELECT).neq("status", "PENDING").order("decided_at", { ascending: false }).limit(20)
    ]);
    if (openError) toast.error("Could not load booking requests.");
    setPending((open as unknown as BookingRequestRow[]) || []);
    setRecent((done as unknown as BookingRequestRow[]) || []);
    onPendingCount?.((open || []).length);
    setLoading(false);
  }, [onPendingCount]);

  useEffect(() => {
    load();
  }, [load]);

  async function approve(id: string) {
    setBusyId(id);
    const { error } = await supabase.rpc("approve_booking_atomic", { p_request_id: id, p_points: LEAD_POINTS.BOOKED });
    setBusyId(null);
    setConfirmId(null);
    if (error) {
      toast.error(error.message.replace(/^approve_booking_atomic:\s*/, "") || "Could not approve.");
      return;
    }
    toast.success("Booking approved.");
    load();
  }

  async function reject(id: string) {
    if (!reason.trim()) {
      toast.error("Add a reason so the employee knows why.");
      return;
    }
    setBusyId(id);
    const { error } = await supabase.rpc("reject_booking_atomic", { p_request_id: id, p_reason: reason.trim() });
    setBusyId(null);
    if (error) {
      toast.error(error.message.replace(/^reject_booking_atomic:\s*/, "") || "Could not reject.");
      return;
    }
    toast.success("Booking request rejected.");
    setRejectId(null);
    setReason("");
    load();
  }

  const nowMs = new Date().getTime();
  const card = "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm";

  if (loading) return <p className="text-sm text-slate-400">Loading booking requests...</p>;

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-sm font-bold text-slate-700 mb-3">Waiting for approval ({pending.length})</h2>
        {pending.length === 0 ? (
          <p className={`${card} text-sm text-slate-500`}>No booking requests are waiting.</p>
        ) : (
          <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(100%,19rem),1fr))]">
            {pending.map((r) => {
              const ageMs = nowMs - new Date(r.requested_at).getTime();
              const old = ageMs > 3 * 24 * 3600000;
              return (
                <div key={r.id} className={card}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-bold text-slate-900">{r.lead?.name || "Lead"}</p>
                      <p className="truncate text-xs text-slate-500">{[r.lead?.project, r.lead?.source].filter(Boolean).join(" · ") || "No project"}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${old ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`} title={new Date(r.requested_at).toLocaleString("en-IN")}>
                      {formatAgo(ageMs)}
                    </span>
                  </div>
                  <dl className="mt-3 space-y-1 text-[13px]">
                    <div className="flex gap-2"><dt className="w-24 shrink-0 text-slate-500">Requested by</dt><dd className="font-semibold text-slate-800">{r.employee?.name || "—"}</dd></div>
                    <div className="flex gap-2"><dt className="w-24 shrink-0 text-slate-500">Unit / size</dt><dd className="text-slate-800">{r.size || "—"}</dd></div>
                    <div className="flex gap-2"><dt className="w-24 shrink-0 text-slate-500">Details</dt><dd className="min-w-0 break-words text-slate-800">{r.note || "—"}</dd></div>
                    <div className="flex gap-2"><dt className="w-24 shrink-0 text-slate-500">Lead now</dt><dd className="text-slate-800">{r.lead ? `${r.lead.status}${r.lead.board_stage ? ` · ${r.lead.board_stage}` : ""}` : "—"}</dd></div>
                  </dl>

                  {rejectId === r.id ? (
                    <div className="mt-3 space-y-2">
                      <textarea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        rows={2}
                        maxLength={300}
                        placeholder="Reason (sent to the employee)"
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-200"
                      />
                      <div className="flex gap-2">
                        <button type="button" disabled={busyId === r.id} onClick={() => reject(r.id)} className="flex-1 h-10 rounded-xl bg-rose-600 text-sm font-semibold text-white disabled:opacity-60">
                          {busyId === r.id ? "Rejecting..." : "Reject request"}
                        </button>
                        <button type="button" onClick={() => { setRejectId(null); setReason(""); }} className="flex-1 h-10 rounded-xl bg-slate-100 text-sm font-semibold text-slate-700">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : confirmId === r.id ? (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs text-slate-500">This books the lead for {r.employee?.name || "the employee"}, adds the booking points and tells the whole team.</p>
                      <div className="flex gap-2">
                        <button type="button" disabled={busyId === r.id} onClick={() => approve(r.id)} className="flex-1 h-10 rounded-xl bg-green-600 text-sm font-semibold text-white disabled:opacity-60">
                          {busyId === r.id ? "Approving..." : "Confirm approve"}
                        </button>
                        <button type="button" onClick={() => setConfirmId(null)} className="flex-1 h-10 rounded-xl bg-slate-100 text-sm font-semibold text-slate-700">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 flex gap-2">
                      <button type="button" onClick={() => setConfirmId(r.id)} className="flex-1 h-10 rounded-xl bg-green-600 text-sm font-semibold text-white">
                        Approve
                      </button>
                      <button type="button" onClick={() => { setRejectId(r.id); setReason(""); }} className="flex-1 h-10 rounded-xl bg-rose-50 text-sm font-semibold text-rose-700 border border-rose-200">
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {recent.length > 0 && (
        <section>
          <h2 className="text-sm font-bold text-slate-700 mb-3">Recently decided</h2>
          <div className={`${card} divide-y divide-slate-100 p-0`}>
            {recent.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[13px]">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${r.status === "APPROVED" ? "bg-green-100 text-green-800" : "bg-rose-100 text-rose-800"}`}>
                  {r.status === "APPROVED" ? "Approved" : "Rejected"}
                </span>
                <span className="min-w-0 truncate font-semibold text-slate-800">{r.lead?.name || "Lead"}</span>
                <span className="text-slate-500">{r.employee?.name || "—"}</span>
                {r.reject_reason && <span className="min-w-0 truncate text-slate-500">— {r.reject_reason}</span>}
                <span className="ml-auto text-slate-400">{r.decided_by_employee?.name ? `by ${r.decided_by_employee.name}` : ""}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
