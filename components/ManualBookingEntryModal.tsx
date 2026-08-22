"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";
import { X, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { LEAD_POINTS } from "@/lib/calculateLeadPoints";

interface ManualBookingEntryModalProps {
  employees: { id: string; name: string; is_active: boolean }[];
  onClose: () => void;
  onCreated: () => void;
}

interface LeadSearchResult {
  id: string;
  name: string;
  mobile: string;
  project: string | null;
  current_owner_id: string | null;
  owner_name: string | null;
}

type Mode = "EXISTING" | "STANDALONE";

// Admin-only. Both paths converge on the SAME log_booking_atomic RPC
// every real employee-side booking already uses (LeadDetailModal /
// DataDetailModal) — no parallel booking/celebration/leaderboard
// logic lives here. log_booking_atomic gained two additive, DEFAULT-
// NULL params for this (2026-08-22): p_target_employee_id (admin-only
// override of "whose booking is this", gated by role inside the
// function itself, not here) and p_size (appended to the celebration
// message only when present — real/Existing-Lead bookings never pass
// it, so their celebration text is unchanged).
//
// Standalone creates a bare placeholder lead first (via the new
// create_manual_booking_lead_atomic — deliberately NOT
// create_manual_lead_atomic, whose Catcher/Visit-lock/1-point-visit
// logic is the wrong shape for a retroactive booking record), then
// books it through the exact same log_booking_atomic call Existing-
// Lead uses.
export default function ManualBookingEntryModal({ employees, onClose, onCreated }: ManualBookingEntryModalProps) {

  const [mode, setMode] = useState<Mode>("EXISTING");
  const [submitting, setSubmitting] = useState(false);

  // Option A — existing lead
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<LeadSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedLead, setSelectedLead] = useState<LeadSearchResult | null>(null);

  // Option B — standalone
  const [employeeId, setEmployeeId] = useState("");
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [project, setProject] = useState("");
  const [size, setSize] = useState("");

  useEffect(() => {
    if (mode === "STANDALONE" && projects.length === 0) {
      loadProjects();
    }
  }, [mode]);

  async function loadProjects() {
    const { data } = await supabase
      .from("projects")
      .select("id, name")
      .eq("is_active", true)
      .order("name");

    if (data) setProjects(data);
  }

  // Debounced live search against the DB rather than filtering an
  // already-loaded list (unlike LeadList's own filters) — the leads
  // table is far too large to load into this modal wholesale.
  // CONVERTED is excluded because log_booking_atomic is a no-op on an
  // already-converted lead; JUNK is excluded because it raises.
  useEffect(() => {
    if (searchQuery.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    const timer = setTimeout(async () => {
      const q = searchQuery.trim();
      const { data } = await supabase
        .from("leads")
        .select("id, name, mobile, project, current_owner_id, employees(name)")
        .not("status", "in", "(CONVERTED,JUNK)")
        .not("current_owner_id", "is", null)
        .or(`name.ilike.%${q}%,mobile.ilike.%${q}%,project.ilike.%${q}%`)
        .limit(20);

      setSearchResults(
        (data || []).map((l: any) => ({
          id: l.id,
          name: l.name,
          mobile: l.mobile,
          project: l.project,
          current_owner_id: l.current_owner_id,
          owner_name: l.employees?.name || null
        }))
      );
      setSearching(false);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  async function handleSubmitExisting() {
    if (!selectedLead?.current_owner_id || submitting) return;

    setSubmitting(true);
    try {
      const { error } = await supabase.rpc("log_booking_atomic", {
        p_lead_id: selectedLead.id,
        p_points: LEAD_POINTS.BOOKED,
        p_target_employee_id: selectedLead.current_owner_id
      });

      if (error) {
        toast.error(error.message || "Could not log this booking.");
        return;
      }

      toast.success("Booking logged.");
      onCreated();
      onClose();
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmitStandalone() {
    if (!employeeId || !project || submitting) {
      toast.error("Employee and Project are required.");
      return;
    }

    setSubmitting(true);
    try {
      const { data: leadId, error: createError } = await supabase.rpc("create_manual_booking_lead_atomic", {
        p_employee_id: employeeId,
        p_project: project
      });

      if (createError || !leadId) {
        toast.error(createError?.message || "Could not create this record.");
        return;
      }

      const { error: bookError } = await supabase.rpc("log_booking_atomic", {
        p_lead_id: leadId,
        p_points: LEAD_POINTS.BOOKED,
        p_target_employee_id: employeeId,
        p_size: size.trim() || null
      });

      if (bookError) {
        toast.error(bookError.message || "Record created but booking failed — check Admin Leads.");
        return;
      }

      toast.success("Manual booking logged.");
      onCreated();
      onClose();
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  const modal = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div onClick={onClose} className="absolute inset-0 bg-black/40" />

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="relative w-full max-w-md bg-white rounded-[24px] shadow-2xl p-6 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-800">🏆 Manual Booking Entry</h2>
          <button onClick={onClose} className="h-8 w-8 rounded-lg bg-slate-50 flex items-center justify-center text-slate-400 hover:text-slate-600 transition">
            <X size={16} />
          </button>
        </div>

        <div className="flex gap-2 mb-4 p-1 bg-slate-50 rounded-xl">
          <button
            onClick={() => setMode("EXISTING")}
            className={`flex-1 h-9 rounded-lg text-xs font-semibold transition ${
              mode === "EXISTING" ? "bg-white shadow text-slate-800" : "text-slate-500"
            }`}
          >
            Existing Lead
          </button>
          <button
            onClick={() => setMode("STANDALONE")}
            className={`flex-1 h-9 rounded-lg text-xs font-semibold transition ${
              mode === "STANDALONE" ? "bg-white shadow text-slate-800" : "text-slate-500"
            }`}
          >
            Standalone (No Lead)
          </button>
        </div>

        {mode === "EXISTING" ? (
          <div className="space-y-3">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search name, mobile, or project..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSelectedLead(null);
                }}
                className="w-full h-11 rounded-xl bg-slate-50 border border-slate-200 pl-9 pr-3.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>

            {searching && <p className="text-xs text-slate-400">Searching...</p>}

            {!selectedLead && searchResults.length > 0 && (
              <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-56 overflow-y-auto">
                {searchResults.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => {
                      setSelectedLead(l);
                      setSearchResults([]);
                      setSearchQuery(l.name);
                    }}
                    className="w-full text-left px-3.5 py-2.5 hover:bg-slate-50 transition"
                  >
                    <p className="text-sm font-semibold text-slate-800">{l.name}</p>
                    <p className="text-xs text-slate-400">
                      {l.mobile} · {l.project || "No project"} · {l.owner_name || "Unassigned"}
                    </p>
                  </button>
                ))}
              </div>
            )}

            {selectedLead && (
              <div className="rounded-xl bg-amber-50 border border-amber-100 p-3">
                <p className="text-sm font-bold text-amber-800">{selectedLead.name}</p>
                <p className="text-xs text-amber-700/80 mt-0.5">
                  {selectedLead.project || "No project"} · Owned by {selectedLead.owner_name || "Unassigned"}
                </p>
              </div>
            )}

            <button
              onClick={handleSubmitExisting}
              disabled={submitting || !selectedLead?.current_owner_id}
              className="w-full h-11 rounded-xl font-semibold text-white bg-gradient-to-r from-amber-500 to-orange-500 disabled:opacity-60"
            >
              {submitting ? "Logging..." : "Mark as Booked"}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="w-full h-11 rounded-xl bg-slate-50 border border-slate-200 px-3.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
            >
              <option value="">Employee... *</option>
              {employees.filter((e) => e.is_active).map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>

            <select
              value={project}
              onChange={(e) => setProject(e.target.value)}
              className="w-full h-11 rounded-xl bg-slate-50 border border-slate-200 px-3.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
            >
              <option value="">Project... *</option>
              {projects.map((p) => (
                <option key={p.id} value={p.name}>{p.name}</option>
              ))}
            </select>

            <input
              type="text"
              placeholder='Size (e.g. "2BHK - 1200 sqft") — optional'
              value={size}
              onChange={(e) => setSize(e.target.value)}
              className="w-full h-11 rounded-xl bg-slate-50 border border-slate-200 px-3.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
            />

            <p className="text-[11px] text-slate-400 leading-relaxed">
              No client name or mobile is collected — matches Booking Celebration, which has never shown client
              details. A privacy-safe placeholder record is created internally.
            </p>

            <button
              onClick={handleSubmitStandalone}
              disabled={submitting || !employeeId || !project}
              className="w-full h-11 rounded-xl font-semibold text-white bg-gradient-to-r from-amber-500 to-orange-500 disabled:opacity-60"
            >
              {submitting ? "Logging..." : "Create & Log Booking"}
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : null;
}
