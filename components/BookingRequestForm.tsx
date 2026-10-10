"use client";

// "Request booking" form for the employee's lead / data modal (2026-10-10).
// Sends request_booking_atomic; the lead only moves to Booking once an Admin
// or Sales Coordinator approves it.
import { useState } from "react";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";

export default function BookingRequestForm({
  leadId,
  onCancel,
  onSent
}: {
  leadId: string;
  onCancel: () => void;
  onSent: () => void;
}) {
  const [size, setSize] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  async function send() {
    setSending(true);
    try {
      const { error } = await supabase.rpc("request_booking_atomic", {
        p_lead_id: leadId,
        p_size: size.trim() || null,
        p_note: note.trim() || null
      });
      if (error) {
        toast.error(
          /already pending/i.test(error.message)
            ? "A booking request for this lead is already waiting for approval."
            : error.message || "Could not send the booking request."
        );
        return;
      }
      toast.success("Booking request sent for approval.");
      onSent();
    } catch (err) {
      console.log(err);
      toast.error("Something went wrong.");
    } finally {
      setSending(false);
    }
  }

  const field = "w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-300";

  return (
    <div>
      <p className="text-xs text-slate-500 mb-3">
        An Admin or Sales Coordinator checks the booking first. The lead moves to Booking (and the team is told) only after approval.
      </p>
      <div className="space-y-2 mb-3">
        <label className="block">
          <span className="text-[11px] font-semibold text-slate-600">Unit / size (optional)</span>
          <input value={size} onChange={(e) => setSize(e.target.value)} maxLength={60} placeholder="e.g. 2 BHK, Plot 120 sq yd" className={field} />
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold text-slate-600">Details for the approver (optional)</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="e.g. token amount, payment mode, receipt number"
            className={`${field} h-auto py-2 resize-none`}
          />
        </label>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={sending}
          onClick={send}
          className="flex-1 h-10 rounded-xl text-sm font-semibold bg-green-600 text-white disabled:opacity-60"
        >
          {sending ? "Sending..." : "Send request"}
        </button>
        <button
          type="button"
          disabled={sending}
          onClick={onCancel}
          className="flex-1 h-10 rounded-xl text-sm font-semibold bg-slate-100 text-slate-700 disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
