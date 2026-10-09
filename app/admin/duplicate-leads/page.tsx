"use client";

// Duplicate lead merge (2026-10-09). Lists groups of 2+ active lead rows
// with the same owner, the same mobile and the same project (from
// list_duplicate_lead_groups — admin / super_admin only, last 4 digits
// only, no names). One group at a time: open -> Preview -> Confirm merge
// through merge_duplicate_leads (the server re-checks everything and needs
// the preview's token). Nothing is deleted: the extra rows become JUNK and
// point at the kept row.

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import PageHeader from "@/components/PageHeader";
import { LEAD_STATUS_DISPLAY } from "@/lib/leadStatusDisplay";
import { LeadStatus } from "@/lib/getValidNextLeadStatuses";

interface GroupRow {
  lead_id: string;
  id8: string;
  status: LeadStatus;
  board_stage: string | null;
  created_at: string;
  calls: number;
  notes: number;
  last_activity_at: string | null;
  suggested_keep: boolean;
  blocked_reason: string | null;
}

interface Group {
  group_key: string;
  owner_name: string | null;
  project: string | null;
  mobile_last4: string;
  row_count: number;
  rows: GroupRow[];
}

interface Preview {
  confirm_token: string;
  keep_id8: string;
  merge_id8s: string[];
  notes_to_copy: number;
  reminders_to_move: number;
  unread_notifications_to_clear: number;
}

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";
const cleanError = (message: string) => message.replace(/^(list_duplicate_lead_groups|merge_duplicate_leads): /, "");

export default function DuplicateLeadsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.rpc("list_duplicate_lead_groups");
    if (error) toast.error(cleanError(error.message));
    setGroups((data as Group[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load
    load();
  }, []);

  function toggle(key: string) {
    setOpenKey(openKey === key ? null : key);
    setPreview(null);
  }

  async function runPreview(group: Group) {
    setBusy(true);
    const { data, error } = await supabase.rpc("merge_duplicate_leads", { p_lead_ids: group.rows.map((r) => r.lead_id) });
    setBusy(false);
    if (error) return toast.error(cleanError(error.message));
    setPreview(data as Preview);
  }

  async function confirmMerge(group: Group) {
    if (!preview) return;
    setBusy(true);
    const { error } = await supabase.rpc("merge_duplicate_leads", {
      p_lead_ids: group.rows.map((r) => r.lead_id),
      p_confirm_token: preview.confirm_token
    });
    setBusy(false);
    if (error) return toast.error(cleanError(error.message));
    toast.success(`Merged — kept ${preview.keep_id8}, ${preview.merge_id8s.length} duplicate row(s) marked Junk.`);
    setOpenKey(null);
    setPreview(null);
    load();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Leads"
        title="Duplicate Leads"
        description="Groups of active leads with the same owner, the same mobile number and the same project. Merging keeps the most advanced row; the others are marked Junk (nothing is deleted) and their notes are copied onto the kept row. Only the last 4 digits of the number are shown."
      />

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-slate-400" /></div>
      ) : groups.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center text-sm text-slate-500">No duplicate groups right now.</div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">{groups.length} group(s)</p>
          {groups.map((group) => {
            const open = openKey === group.group_key;
            const blocked = group.rows.filter((r) => !r.suggested_keep && r.blocked_reason);
            return (
              <div key={group.group_key} className="bg-white rounded-2xl border border-slate-100 shadow-sm">
                <button onClick={() => toggle(group.group_key)} className="w-full flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-left">
                  <span className="text-sm font-bold text-slate-800">
                    •••••• {group.mobile_last4} · {group.project || "No project"}
                  </span>
                  <span className="text-xs text-slate-600">
                    {group.owner_name || "—"} · {group.row_count} rows {open ? "▲" : "▼"}
                  </span>
                </button>

                {open && (
                  <div className="border-t border-slate-100 px-4 py-3 space-y-3">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="text-slate-500">
                          <tr className="text-left">
                            <th className="py-1.5 pr-3 font-semibold">Lead</th>
                            <th className="py-1.5 pr-3 font-semibold">Status</th>
                            <th className="py-1.5 pr-3 font-semibold">Created</th>
                            <th className="py-1.5 pr-3 font-semibold">Calls</th>
                            <th className="py-1.5 pr-3 font-semibold">Notes</th>
                            <th className="py-1.5 pr-3 font-semibold">Last activity</th>
                            <th className="py-1.5 font-semibold">On merge</th>
                          </tr>
                        </thead>
                        <tbody className="text-slate-700">
                          {group.rows.map((r) => (
                            <tr key={r.lead_id} className="border-t border-slate-100">
                              <td className="py-1.5 pr-3 font-mono">{r.id8}</td>
                              <td className="py-1.5 pr-3">
                                {LEAD_STATUS_DISPLAY[r.status]?.label || r.status}
                                {r.board_stage && r.board_stage !== "LEADS" ? ` · ${r.board_stage.replace("_", " ").toLowerCase()}` : ""}
                              </td>
                              <td className="py-1.5 pr-3 whitespace-nowrap">{when(r.created_at)}</td>
                              <td className="py-1.5 pr-3">{r.calls}</td>
                              <td className="py-1.5 pr-3">{r.notes}</td>
                              <td className="py-1.5 pr-3 whitespace-nowrap">{when(r.last_activity_at)}</td>
                              <td className="py-1.5 font-semibold">
                                {r.suggested_keep ? <span className="text-emerald-700">Keep</span> : <span className="text-slate-600">Junk (merged)</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {blocked.length > 0 ? (
                      <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
                        Needs manual review — {blocked.map((r) => `${r.id8}: ${r.blocked_reason}`).join("; ")}.
                      </p>
                    ) : (
                      <>
                        {preview && (
                          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-700 space-y-0.5">
                            <p className="font-bold text-slate-800">Preview — nothing changed yet</p>
                            <p>Keep: {preview.keep_id8}. Mark Junk (merged): {preview.merge_id8s.join(", ")}.</p>
                            <p>
                              Notes copied to the kept lead: {preview.notes_to_copy} · Pending reminders moved: {preview.reminders_to_move} · Unread
                              notifications cleared: {preview.unread_notifications_to_clear}
                            </p>
                            <p className="text-slate-500">The kept lead&apos;s status, SLA timer and recycle count stay as they are.</p>
                          </div>
                        )}
                        <div className="flex gap-2">
                          <button onClick={() => runPreview(group)} disabled={busy} className="h-9 px-4 rounded-xl bg-slate-800 text-white text-xs font-bold disabled:opacity-60">
                            Preview
                          </button>
                          {preview && (
                            <button onClick={() => confirmMerge(group)} disabled={busy} className="h-9 px-4 rounded-xl bg-red-700 text-white text-xs font-bold disabled:opacity-60">
                              {busy ? <Loader2 size={14} className="animate-spin" /> : "Confirm merge"}
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
