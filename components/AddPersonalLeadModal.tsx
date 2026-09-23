"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";
import { X } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface AddPersonalLeadModalProps {
  onClose: () => void;
  // Takes the new lead's id (2026-09-23) — the caller (LeadList.tsx)
  // uses it to auto-open LeadDetailModal for this exact lead right
  // after creation, so the employee lands straight on the familiar
  // status-setting UI instead of having to find the new card
  // themselves. Reuses that existing modal/RPC entirely — no new
  // status-setting logic here.
  onCreated: (leadId: string) => void;
  // Quick Dial (2026-09-23) — pre-fills Mobile when opened from the
  // "Add as Personal Lead?" prompt after a quick-dial call, so the
  // employee isn't retyping a number they just dialed. Undefined for
  // the plain "+ Add Personal Lead" entry point, same component
  // either way (Golden Rule) — only this one prop differs.
  initialMobile?: string;
}

// Employee self-service personal-lead add (2026-09-23) — deliberately
// the smallest possible form: Name + Mobile only required, Project
// optional. No Priority/Catcher-Name/Employee-picker like
// ManualLeadEntryModal.tsx (Admin/Coordinator's equivalent) — none of
// those apply here (there's no employee to pick, the caller IS the
// employee; there's no physical catcher), and every dropped field is
// one less step, directly serving the "fewest possible steps" ease-
// of-use requirement this feature was built around.
//
// create_personal_lead_atomic does the real work server-side: mirrors
// create_manual_lead_atomic's round-robin-bypass (never consumes a
// distribution turn), adds a duplicate check that RPC doesn't have
// (same last-10-digit mobile normalization the CSV-import dedup fix
// uses), tags is_personal_lead=true (which calculateSLAStatus.ts's
// isPersonalLead param then uses to suppress all SLA/recycle timers
// for this lead, permanently, regardless of stage/status), and logs a
// system_anomaly_log entry (visible to Admin, not blocking) if this
// employee has self-added 5+ personal leads today.
export default function AddPersonalLeadModal({ onClose, onCreated, initialMobile }: AddPersonalLeadModalProps) {

  const [name, setName] = useState("");
  const [mobile, setMobile] = useState(initialMobile || "");
  const [project, setProject] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Mobile-only required (2026-09-23) — an employee sometimes has
  // just a number, sometimes a number+name, sometimes all three; Name
  // defaults server-side to "Unknown" when left blank, same
  // established convention import-leads-csv already uses for exactly
  // this case, not a new rule invented here.
  async function handleSubmit() {
    if (!mobile.trim() || submitting) {
      toast.error("Mobile is required.");
      return;
    }

    setSubmitting(true);

    try {
      const { data, error } = await supabase.rpc("create_personal_lead_atomic", {
        p_name: name.trim(),
        p_mobile: mobile.trim(),
        p_email: null,
        p_project: project.trim() || null
      });

      if (error) {
        toast.error(error.message || "Could not add this lead.");
        return;
      }

      toast.success("Personal lead added — no SLA timer on this one.");
      onCreated(data as string);
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
        className="relative w-full max-w-md bg-white rounded-[24px] shadow-2xl p-6"
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold text-slate-800">🔒 Add Personal Lead</h2>
          <button onClick={onClose} className="h-8 w-8 rounded-lg bg-slate-50 flex items-center justify-center text-slate-400 hover:text-slate-600 transition">
            <X size={16} />
          </button>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          A lead you brought yourself — assigned straight to you, no SLA timer, ever.
        </p>

        <div className="space-y-3">
          {/* Mobile first (2026-09-23) — it's the only actually-
              required field now, and Quick Dial pre-fills it, so it
              reads as the primary field, not an afterthought below
              Name. */}
          <input
            type="tel"
            placeholder="Mobile *"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            autoFocus={!initialMobile}
            className="w-full h-11 rounded-xl bg-slate-50 border border-slate-200 px-3.5 text-sm outline-none focus:ring-2 focus:ring-violet-200"
          />

          <input
            type="text"
            placeholder="Name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus={Boolean(initialMobile)}
            className="w-full h-11 rounded-xl bg-slate-50 border border-slate-200 px-3.5 text-sm outline-none focus:ring-2 focus:ring-violet-200"
          />

          <input
            type="text"
            placeholder="Project (optional)"
            value={project}
            onChange={(e) => setProject(e.target.value)}
            className="w-full h-11 rounded-xl bg-slate-50 border border-slate-200 px-3.5 text-sm outline-none focus:ring-2 focus:ring-violet-200"
          />

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full h-11 rounded-xl font-semibold text-white bg-gradient-to-r from-violet-600 to-purple-500 disabled:opacity-60"
          >
            {submitting ? "Adding..." : "Add Lead"}
          </button>
        </div>
      </motion.div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : null;
}
