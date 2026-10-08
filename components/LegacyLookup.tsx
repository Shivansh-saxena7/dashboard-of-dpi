"use client";

// Legacy Lookup (2026-10-08, Legacy Phase 3). Admin / Sales Coordinator
// types a full mobile number; find_legacy_number returns masked register
// rows (last 4 digits, owner, tab, status) — the register itself is never
// listed. "Make real lead" -> preview (last 4 digits, owner, project) ->
// confirm, one number at a time, through make_legacy_lead (the server
// checks the role, blocks numbers already on any lead, and needs the
// preview's token to confirm). The new lead is owned by the employee whose
// register holds the number.

import { useState } from "react";
import toast from "react-hot-toast";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface Match {
  legacy_id: string;
  mobile_last4: string;
  owner_name: string | null;
  owner_active: boolean;
  source_tab: string | null;
  converted: boolean;
  lead_exists: boolean;
}

interface Preview {
  mobile_last4: string;
  owner_name: string | null;
  project: string | null;
  blocked: "ALREADY_CONVERTED" | "NUMBER_ALREADY_A_LEAD" | "OWNER_INACTIVE" | null;
  confirm_token: string | null;
}

const BLOCK_TEXT: Record<string, string> = {
  ALREADY_CONVERTED: "This register entry has already been turned into a lead.",
  NUMBER_ALREADY_A_LEAD: "This number is already on a lead in the system — no duplicate is created.",
  OWNER_INACTIVE: "The employee who owns this register entry is inactive."
};

const cleanError = (message: string) => message.replace(/^(find_legacy_number|make_legacy_lead): /, "");

export default function LegacyLookup() {
  const [mobile, setMobile] = useState("");
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [selected, setSelected] = useState<Match | null>(null);
  const [project, setProject] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setSelected(null);
    setPreview(null);
    setProject("");
  }

  async function search() {
    reset();
    setMatches(null);
    const digits = mobile.replace(/[^0-9]/g, "");
    if (digits.length < 10) return toast.error("Enter the full 10-digit mobile number.");
    setBusy(true);
    const { data, error } = await supabase.rpc("find_legacy_number", { p_mobile: mobile });
    setBusy(false);
    if (error) return toast.error(cleanError(error.message));
    setMatches((data as Match[]) || []);
  }

  async function runPreview() {
    if (!selected) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("make_legacy_lead", { p_legacy_id: selected.legacy_id, p_project: project.trim() || null });
    setBusy(false);
    if (error) return toast.error(cleanError(error.message));
    setPreview(data as Preview);
  }

  async function confirm() {
    if (!selected || !preview?.confirm_token) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("make_legacy_lead", {
      p_legacy_id: selected.legacy_id,
      p_project: project.trim() || null,
      p_confirm_token: preview.confirm_token
    });
    setBusy(false);
    if (error) return toast.error(cleanError(error.message));
    toast.success(`Lead created and assigned to ${(data as { owner_name: string }).owner_name || "the owner"}.`);
    reset();
    setMatches(null);
    setMobile("");
  }

  const statusOf = (m: Match) =>
    m.converted ? "Already converted" : m.lead_exists ? "Already a lead" : !m.owner_active ? "Owner inactive" : "Available";

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-md p-5 space-y-4">
      <div>
        <p className="text-sm font-bold text-slate-800">Legacy lookup</p>
        <p className="text-xs text-slate-500 mt-0.5">
          Type a full mobile number to check it against employees&apos; old client registers. One number at a time; the register is never listed.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={mobile}
          onChange={(e) => { setMobile(e.target.value); setMatches(null); reset(); }}
          onKeyDown={(e) => e.key === "Enter" && search()}
          inputMode="tel"
          placeholder="Mobile number"
          className="h-10 w-56 rounded-xl bg-slate-50 border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-cyan-200"
        />
        <button onClick={search} disabled={busy} className="h-10 px-4 rounded-xl bg-slate-800 text-white text-sm font-bold disabled:opacity-60">
          {busy && !selected ? <Loader2 size={14} className="animate-spin" /> : "Search"}
        </button>
      </div>

      {matches && matches.length === 0 && <p className="text-xs text-slate-500">Not found in any legacy register.</p>}

      {matches && matches.length > 0 && (
        <div className="space-y-2">
          {matches.map((m) => {
            const available = statusOf(m) === "Available";
            return (
              <div key={m.legacy_id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2.5 text-sm">
                <div>
                  <p className="font-semibold text-slate-700">•••••• {m.mobile_last4} · {m.owner_name || "—"}</p>
                  <p className="text-xs text-slate-500">{m.source_tab ? `Sheet tab: ${m.source_tab} · ` : ""}{statusOf(m)}</p>
                </div>
                {available && (
                  <button
                    onClick={() => { setSelected(m); setPreview(null); setProject(""); }}
                    className="h-8 px-3 rounded-lg bg-cyan-50 text-cyan-700 text-xs font-bold"
                  >
                    Make real lead
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="rounded-xl border border-cyan-100 bg-cyan-50/40 p-4 space-y-3">
          <p className="text-sm font-bold text-slate-800">Make real lead — •••••• {selected.mobile_last4}</p>
          <label className="block text-xs font-semibold text-slate-500 space-y-1">
            <span>Project (optional)</span>
            <input
              value={project}
              maxLength={100}
              onChange={(e) => { setProject(e.target.value); setPreview(null); }}
              placeholder="e.g. Neotown"
              className="h-10 w-full rounded-xl bg-white border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-cyan-200"
            />
          </label>

          {preview && (
            <div className={`rounded-lg p-3 text-sm ${preview.blocked ? "bg-red-50 text-red-800" : "bg-white text-slate-700 border border-slate-100"}`}>
              <p className="font-bold">Preview — nothing created yet</p>
              <p>Number: •••••• {preview.mobile_last4}</p>
              <p>Owner (from the register): {preview.owner_name || "—"}</p>
              <p>Project: {preview.project || "none"}</p>
              <p className="text-xs text-slate-500 mt-1">Created as a personal lead (source: Legacy) — no SLA timer and no recycling.</p>
              {preview.blocked && <p className="font-semibold mt-1">{BLOCK_TEXT[preview.blocked]}</p>}
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={runPreview} disabled={busy} className="h-9 px-4 rounded-xl bg-slate-800 text-white text-xs font-bold disabled:opacity-60">Preview</button>
            {preview && !preview.blocked && preview.confirm_token && (
              <button onClick={confirm} disabled={busy} className="h-9 px-4 rounded-xl bg-cyan-500 text-white text-xs font-bold disabled:opacity-60">
                {busy ? <Loader2 size={14} className="animate-spin" /> : "Confirm — create lead"}
              </button>
            )}
            <button onClick={reset} className="h-9 px-4 rounded-xl bg-white text-slate-600 text-xs font-bold border border-slate-200">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
