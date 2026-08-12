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
export default function ManualLeadEntryModal({ employees, onClose, onCreated }: ManualLeadEntryModalProps) {

  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [project, setProject] = useState("");
  const [priority, setPriority] = useState<LeadPriority>("cold");
  const [catcherName, setCatcherName] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [pastCatcherNames, setPastCatcherNames] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

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

    setSubmitting(true);

    try {
      const { error } = await supabase.rpc("create_manual_lead_atomic", {
        p_name: name.trim(),
        p_mobile: mobile.trim(),
        p_email: email.trim() || null,
        p_project: project.trim() || null,
        p_priority: priority,
        p_catcher_name: catcherName.trim(),
        p_employee_id: employeeId
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
            onChange={(e) => setMobile(e.target.value)}
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
            onChange={(e) => setProject(e.target.value)}
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

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full h-11 rounded-xl font-semibold text-white bg-gradient-to-r from-blue-600 to-cyan-500 disabled:opacity-60"
          >
            {submitting ? "Creating..." : "Create & Assign Lead"}
          </button>
        </div>
      </motion.div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : null;
}
