"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";
import { X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { LEAD_PRIORITY_DISPLAY, LeadPriority } from "@/lib/leadPriorityDisplay";

interface ManualLeadEntryModalProps {
  employees: { id: string; name: string; is_active: boolean }[];
  onClose: () => void;
  onCreated: () => void;
  // Admin only — may create a lead that conflicts with an existing one
  // (same client + same project, or no project) by giving a reason.
  // create_manual_lead_atomic enforces this server-side regardless.
  canOverrideDuplicates?: boolean;
}

interface ExistingConflictLead {
  lead_id: string;
  project: string | null;
  status: string;
  owner_name: string | null;
  reason: "SAME_PROJECT" | "NO_PROJECT";
}

// Shared by /admin/leads and /coordinator (LEADS tab) — one modal,
// not a forked copy, since both roles got this power identically
// (approved deliberate exception to Coordinator's normal read-only
// scope — see create_manual_lead_atomic, which gates on admin OR
// sales_coordinator). Portaled to document.body, same reasoning as
// AdminLeadHistoryModal — a fixed-position drawer needs to resolve
// against the viewport, not a transformed ancestor.
//
// "Catcher" = walk-in-client-catching site staff, NOT an employees-
// table row — no login, no registry. catcher_name is deliberately
// free-text with a <datalist> autocomplete sourced from past entries
// (not a full new Catchers master-table — that's a bigger feature
// than what's been asked for). The lead this creates is a completely
// normal lead_type='LEAD' lead afterwards (full SLA/recycling), just
// tagged source='Catcher' for reporting.
//
// Duplicate handling (2026-10-03): the same client under a DIFFERENT
// project is a legitimate separate lead and goes straight through. A
// conflict (same project, or no project on either side) is shown
// before creating — existing owner(s) listed — and Admin can create
// anyway with a reason; Coordinators can't. The rule itself lives only
// in lead_conflicts_core (via find_lead_conflicts), never here.
export default function ManualLeadEntryModal({ employees, onClose, onCreated, canOverrideDuplicates = false }: ManualLeadEntryModalProps) {

  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [project, setProject] = useState("");
  const [priority, setPriority] = useState<LeadPriority>("cold");
  const [catcherName, setCatcherName] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [pastCatcherNames, setPastCatcherNames] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  // Non-null once a submit found conflicts — the form then shows them
  // and (for Admin) asks for an override reason before re-submitting.
  const [conflicts, setConflicts] = useState<ExistingConflictLead[] | null>(null);
  const [overrideReason, setOverrideReason] = useState("");

  // Any edit to the fields the duplicate rule depends on invalidates
  // the conflicts shown, so they're re-checked on the next submit.
  function resetConflicts() {
    setConflicts(null);
    setOverrideReason("");
  }

  useEffect(() => {
    loadPastCatcherNames();
  }, []);

  async function loadPastCatcherNames() {
    const { data } = await supabase
      .from("leads")
      .select("catcher_name")
      .not("catcher_name", "is", null)
      .order("catcher_name")
      .limit(500);

    if (data) {
      setPastCatcherNames(Array.from(new Set(data.map((r) => r.catcher_name).filter(Boolean))));
    }
  }

  async function handleSubmit() {
    if (!name.trim() || !mobile.trim() || !catcherName.trim() || !employeeId || submitting) {
      toast.error("Name, Mobile, Catcher Name, and Employee are required.");
      return;
    }

    if (conflicts && conflicts.length > 0 && (!canOverrideDuplicates || !overrideReason.trim())) {
      toast.error(
        canOverrideDuplicates
          ? "Enter a reason to create this lead anyway."
          : "This client already has a lead for this project. Ask an Admin to add it."
      );
      return;
    }

    setSubmitting(true);

    try {
      if (!conflicts) {
        const { data: found, error: conflictError } = await supabase.rpc("find_lead_conflicts", {
          p_candidates: [{ mobile: mobile.trim(), project: project.trim() || null }]
        });

        if (conflictError) {
          toast.error(conflictError.message || "Could not check for existing leads.");
          return;
        }

        const existing: ExistingConflictLead[] = found?.[0]?.existing || [];
        setConflicts(existing);

        if (existing.length > 0) {
          // Stop here so the existing owner(s) are seen before anything
          // is created — the next submit (with a reason) goes through.
          return;
        }
      }

      const { error } = await supabase.rpc("create_manual_lead_atomic", {
        p_name: name.trim(),
        p_mobile: mobile.trim(),
        p_email: email.trim() || null,
        p_project: project.trim() || null,
        p_priority: priority,
        p_catcher_name: catcherName.trim(),
        p_employee_id: employeeId,
        p_override_reason: conflicts && conflicts.length > 0 ? overrideReason.trim() : null
      });

      if (error) {
        toast.error(error.message || "Could not create this lead.");
        return;
      }

      toast.success("Lead created and assigned.");
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
          <h2 className="text-lg font-bold text-slate-800">🎣 Add Manual Lead (Catcher)</h2>
          <button onClick={onClose} className="h-8 w-8 rounded-lg bg-slate-50 flex items-center justify-center text-slate-400 hover:text-slate-600 transition">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3">
          <input
            type="text"
            placeholder="Name *"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full h-11 rounded-xl bg-slate-50 border border-slate-200 px-3.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
          />

          <input
            type="tel"
            placeholder="Mobile *"
            value={mobile}
            onChange={(e) => {
              setMobile(e.target.value);
              resetConflicts();
            }}
            className="w-full h-11 rounded-xl bg-slate-50 border border-slate-200 px-3.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
          />

          <input
            type="email"
            placeholder="Email (optional)"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full h-11 rounded-xl bg-slate-50 border border-slate-200 px-3.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
          />

          <input
            type="text"
            placeholder="Project (optional)"
            value={project}
            onChange={(e) => {
              setProject(e.target.value);
              resetConflicts();
            }}
            className="w-full h-11 rounded-xl bg-slate-50 border border-slate-200 px-3.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
          />

          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as LeadPriority)}
            className="w-full h-11 rounded-xl bg-slate-50 border border-slate-200 px-3.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
          >
            {Object.entries(LEAD_PRIORITY_DISPLAY).map(([value, display]) => (
              <option key={value} value={value}>{display.label}</option>
            ))}
          </select>

          <div>
            <input
              type="text"
              list="catcher-name-suggestions"
              placeholder="Catcher Name *"
              value={catcherName}
              onChange={(e) => setCatcherName(e.target.value)}
              className="w-full h-11 rounded-xl bg-slate-50 border border-slate-200 px-3.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
            />
            <datalist id="catcher-name-suggestions">
              {pastCatcherNames.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>

          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="w-full h-11 rounded-xl bg-slate-50 border border-slate-200 px-3.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
          >
            <option value="">Assign to employee... *</option>
            {employees
              .filter((e) => e.is_active)
              .map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
          </select>

          {conflicts && conflicts.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
              <p className="text-xs font-bold text-amber-800">
                {conflicts[0].reason === "NO_PROJECT"
                  ? "This client already exists, and there's no project to tell the leads apart:"
                  : "This client already has a lead for this project:"}
              </p>
              <ul className="space-y-1">
                {conflicts.map((c) => (
                  <li key={c.lead_id} className="text-xs text-amber-900">
                    {c.project || "No project"} · {c.owner_name || "Unassigned"} · {c.status}
                  </li>
                ))}
              </ul>
              {canOverrideDuplicates ? (
                <textarea
                  placeholder="Reason to create anyway *"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  rows={2}
                  className="w-full rounded-xl bg-white border border-amber-200 px-3.5 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-200"
                />
              ) : (
                <p className="text-xs text-amber-800">Only an Admin can create a duplicate lead.</p>
              )}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting || (conflicts !== null && conflicts.length > 0 && !canOverrideDuplicates)}
            className="w-full h-11 rounded-xl font-semibold text-white bg-gradient-to-r from-blue-600 to-cyan-500 disabled:opacity-60"
          >
            {submitting
              ? "Creating..."
              : conflicts && conflicts.length > 0
                ? "Create Anyway"
                : "Create & Assign Lead"}
          </button>
        </div>
      </motion.div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : null;
}
