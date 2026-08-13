"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Plus, Ticket as TicketIcon, Clock3 } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";
import RaiseTicketModal from "./RaiseTicketModal";

interface TicketRow {
  id: string;
  subject: string;
  description: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED";
  createdAt: string;
  resolvedAt: string | null;
  fellBackToAdmin: boolean;
  raisedByEmployeeId: string;
  raisedByName: string;
  resolvedByName: string | null;
  categoryLabel: string;
}

interface TicketsViewProps {
  myEmployeeId: string | null;
}

const STATUS_DISPLAY: Record<TicketRow["status"], { label: string; className: string }> = {
  OPEN: { label: "Open", className: "bg-amber-100 text-amber-700" },
  IN_PROGRESS: { label: "In Progress", className: "bg-blue-100 text-blue-700" },
  RESOLVED: { label: "Resolved", className: "bg-emerald-100 text-emerald-700" }
};

const PRIORITY_DISPLAY: Record<TicketRow["priority"], { label: string; className: string }> = {
  LOW: { label: "Low", className: "bg-slate-100 text-slate-500" },
  MEDIUM: { label: "Medium", className: "bg-amber-100 text-amber-700" },
  HIGH: { label: "High", className: "bg-red-100 text-red-700" }
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Reused across all three surfaces (employee /tickets, Admin,
// Coordinator) — one component, not a forked copy per role (same
// Golden-Rule reuse as WeeklyLeaderboardView). RLS on `tickets`
// already returns exactly the right rows for whoever's logged in
// (own tickets + tickets in their resolver pool + everything if
// Admin) — this just groups that single fetch into two tabs
// client-side rather than issuing two separate queries. Status
// changes go through update_ticket_status_atomic, never a raw
// update — the RPC is the actual authorization boundary (Admin's
// universal override lives there), the disabled/hidden buttons here
// are just a UI hint matching what the RPC would allow anyway.
export default function TicketsView({ myEmployeeId }: TicketsViewProps) {
  const [tab, setTab] = useState<"MINE" | "RESOLVE">("MINE");
  const [tickets, setTickets] = useState<TicketRow[] | null>(null);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  async function loadTickets() {
    const { data, error } = await supabase
      .from("tickets")
      .select(
        `
        id, subject, description, priority, status, created_at, resolved_at, fell_back_to_admin,
        raised_by_employee_id,
        category:ticket_categories(label),
        raised_by:employees!tickets_raised_by_employee_id_fkey(name),
        resolved_by:employees!tickets_resolved_by_employee_id_fkey(name)
        `
      )
      .order("created_at", { ascending: false });

    if (!error && data) {
      setTickets(
        (data as any[]).map((r) => ({
          id: r.id,
          subject: r.subject,
          description: r.description,
          priority: r.priority,
          status: r.status,
          createdAt: r.created_at,
          resolvedAt: r.resolved_at,
          fellBackToAdmin: r.fell_back_to_admin,
          raisedByEmployeeId: r.raised_by_employee_id,
          raisedByName: r.raised_by?.name || "Unknown",
          resolvedByName: r.resolved_by?.name || null,
          categoryLabel: r.category?.label || "—"
        }))
      );
    } else {
      setTickets([]);
    }
  }

  useEffect(() => {
    loadTickets();
  }, []);

  async function handleStatusChange(ticketId: string, newStatus: "IN_PROGRESS" | "RESOLVED") {
    setUpdatingId(ticketId);
    try {
      const { error } = await supabase.rpc("update_ticket_status_atomic", {
        p_ticket_id: ticketId,
        p_new_status: newStatus
      });

      if (error) {
        toast.error(error.message || "Could not update this ticket.");
        return;
      }

      toast.success(newStatus === "RESOLVED" ? "Ticket resolved." : "Ticket marked in progress.");
      await loadTickets();
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong.");
    } finally {
      setUpdatingId(null);
    }
  }

  const myTickets = (tickets || []).filter((t) => t.raisedByEmployeeId === myEmployeeId);
  const toResolveTickets = (tickets || []).filter((t) => t.raisedByEmployeeId !== myEmployeeId);
  const visibleTickets = tab === "MINE" ? myTickets : toResolveTickets;

  return (
    <div>
      {raiseOpen && (
        <RaiseTicketModal onClose={() => setRaiseOpen(false)} onCreated={loadTickets} />
      )}

      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 w-fit">
          <button
            onClick={() => setTab("MINE")}
            className={`h-9 px-3.5 rounded-lg text-xs font-bold transition ${
              tab === "MINE" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
            }`}
          >
            My Tickets ({myTickets.length})
          </button>
          <button
            onClick={() => setTab("RESOLVE")}
            className={`h-9 px-3.5 rounded-lg text-xs font-bold transition ${
              tab === "RESOLVE" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
            }`}
          >
            To Resolve ({toResolveTickets.length})
          </button>
        </div>

        <button
          onClick={() => setRaiseOpen(true)}
          className="flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-gradient-to-r from-blue-600 to-cyan-500 text-white text-xs font-bold shadow-sm"
        >
          <Plus size={14} />
          Raise Ticket
        </button>
      </div>

      <div className="space-y-2.5">
        {tickets === null ? (
          <p className="text-sm text-slate-400 text-center py-8">Loading...</p>
        ) : visibleTickets.length === 0 ? (
          <div className="text-center py-10 text-slate-400">
            <TicketIcon size={32} className="mx-auto mb-2 opacity-40" />
            <p className="text-sm">{tab === "MINE" ? "You haven't raised any tickets yet." : "Nothing to resolve right now."}</p>
          </div>
        ) : (
          visibleTickets.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl bg-white border border-slate-100 shadow-sm p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_DISPLAY[t.status].className}`}>
                      {STATUS_DISPLAY[t.status].label}
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${PRIORITY_DISPLAY[t.priority].className}`}>
                      {PRIORITY_DISPLAY[t.priority].label}
                    </span>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                      {t.categoryLabel}
                      {t.fellBackToAdmin && " (→ Admin)"}
                    </span>
                  </div>
                  <p className="text-sm font-bold text-slate-800 truncate">{t.subject}</p>
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2">{t.description}</p>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-slate-100">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <Clock3 size={12} />
                  {tab === "MINE" ? `Raised ${formatDate(t.createdAt)}` : `By ${t.raisedByName} · ${formatDate(t.createdAt)}`}
                  {t.status === "RESOLVED" && t.resolvedByName && ` · Resolved by ${t.resolvedByName}`}
                </div>

                {tab === "RESOLVE" && t.status !== "RESOLVED" && (
                  <div className="flex gap-2 shrink-0">
                    {t.status === "OPEN" && (
                      <button
                        onClick={() => handleStatusChange(t.id, "IN_PROGRESS")}
                        disabled={updatingId === t.id}
                        className="h-8 px-3 rounded-lg bg-blue-50 text-blue-700 text-[11px] font-bold disabled:opacity-40 hover:bg-blue-100 transition"
                      >
                        Start Progress
                      </button>
                    )}
                    <button
                      onClick={() => handleStatusChange(t.id, "RESOLVED")}
                      disabled={updatingId === t.id}
                      className="h-8 px-3 rounded-lg bg-emerald-50 text-emerald-700 text-[11px] font-bold disabled:opacity-40 hover:bg-emerald-100 transition"
                    >
                      Resolve
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}
