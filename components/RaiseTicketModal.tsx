"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";
import { X } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface TicketCategory {
  id: string;
  key: string;
  label: string;
}

interface RaiseTicketModalProps {
  onClose: () => void;
  onCreated: () => void;
}

// Shared by every surface (employee /tickets, Admin, Sales
// Coordinator) — one modal, not a forked copy, since raising a ticket
// is identical for every role (create_manual_lead_atomic/
// ManualLeadEntryModal precedent). Categories are fetched live from
// ticket_categories rather than hardcoded here — that table is the
// actual extensibility point (a future V3/V4 category shows up in
// this dropdown automatically, no code change). Portaled to
// document.body, same reasoning as every other full-screen modal in
// this app.
export default function RaiseTicketModal({ onClose, onCreated }: RaiseTicketModalProps) {
  const [categories, setCategories] = useState<TicketCategory[]>([]);
  const [categoryKey, setCategoryKey] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"LOW" | "MEDIUM" | "HIGH">("MEDIUM");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function loadCategories() {
      const { data } = await supabase
        .from("ticket_categories")
        .select("id, key, label")
        .eq("is_active", true)
        .order("sort_order");

      if (data) {
        setCategories(data);
        if (data.length > 0) setCategoryKey(data[0].key);
      }
    }
    loadCategories();
  }, []);

  async function handleSubmit() {
    if (!categoryKey || !subject.trim() || !description.trim() || submitting) {
      toast.error("Category, Subject, and Description are required.");
      return;
    }

    setSubmitting(true);

    try {
      const { error } = await supabase.rpc("raise_ticket_atomic", {
        p_category_key: categoryKey,
        p_subject: subject.trim(),
        p_description: description.trim(),
        p_priority: priority
      });

      if (error) {
        toast.error(error.message || "Could not raise this ticket.");
        return;
      }

      toast.success("Ticket raised.");
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
          <h2 className="text-lg font-bold text-slate-800">🎫 Raise a Ticket</h2>
          <button onClick={onClose} className="h-8 w-8 rounded-lg bg-slate-50 flex items-center justify-center text-slate-400 hover:text-slate-600 transition">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3">
          <select
            value={categoryKey}
            onChange={(e) => setCategoryKey(e.target.value)}
            className="w-full h-11 rounded-xl bg-slate-50 border border-slate-200 px-3.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
          >
            {categories.map((c) => (
              <option key={c.id} value={c.key}>{c.label}</option>
            ))}
          </select>

          <input
            type="text"
            placeholder="Subject *"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full h-11 rounded-xl bg-slate-50 border border-slate-200 px-3.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
          />

          <textarea
            placeholder="Describe the issue... *"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="w-full rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-200 resize-none"
          />

          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as "LOW" | "MEDIUM" | "HIGH")}
            className="w-full h-11 rounded-xl bg-slate-50 border border-slate-200 px-3.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
          >
            <option value="LOW">Low priority</option>
            <option value="MEDIUM">Medium priority</option>
            <option value="HIGH">High priority</option>
          </select>

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full h-11 rounded-xl font-semibold text-white bg-gradient-to-r from-blue-600 to-cyan-500 disabled:opacity-60"
          >
            {submitting ? "Raising..." : "Raise Ticket"}
          </button>
        </div>
      </motion.div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : null;
}
