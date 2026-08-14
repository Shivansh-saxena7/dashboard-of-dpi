"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { Video, FileText, Send, Loader2, MessageCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { downloadShareFileAssets, openWhatsAppChatForAssets, ShareableAsset } from "@/lib/shareAssetsViaWhatsApp";

const BUCKET = "project-assets";

interface AssetRow {
  group_id: string;
  group_label: string;
  asset_id: string;
  asset_label: string;
  asset_type: "VIDEO" | "FILE";
  video_url: string | null;
  storage_path: string | null;
}

interface GroupedAssets {
  groupId: string;
  groupLabel: string;
  assets: AssetRow[];
}

interface LeadProjectAssetsSectionProps {
  leadId: string;
  leadMobile: string;
  leadProject?: string | null;
}

// Renders nothing at all if the lead's project doesn't match any
// canonical project (directly or via an alias) — most leads won't
// have an asset repository set up yet, and an empty card on every
// single lead detail page would just be clutter. get_lead_project_
// assets() owns the whole match-and-fetch decision (direct name match
// -> alias fallback -> grouped assets), so this component doesn't
// duplicate any of that matching logic itself.
export default function LeadProjectAssetsSection({ leadId, leadMobile, leadProject }: LeadProjectAssetsSectionProps) {
  const [groups, setGroups] = useState<GroupedAssets[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  // Staged when the share included FILE assets — WhatsApp can't be
  // opened in the same click that triggered the file download (see
  // lib/shareAssetsViaWhatsApp.ts), so this holds the assets until
  // the employee taps a fresh, separate "Open WhatsApp" button.
  const [pendingWhatsApp, setPendingWhatsApp] = useState<ShareableAsset[] | null>(null);

  useEffect(() => {
    loadAssets();
    setPendingWhatsApp(null);
  }, [leadId]);

  async function loadAssets() {
    const { data, error } = await supabase.rpc("get_lead_project_assets", { p_lead_id: leadId });

    if (error || !data || data.length === 0) {
      setGroups([]);
      return;
    }

    const byGroup = new Map<string, GroupedAssets>();
    (data as any[]).forEach((row) => {
      if (!byGroup.has(row.group_id)) {
        byGroup.set(row.group_id, { groupId: row.group_id, groupLabel: row.group_label, assets: [] });
      }
      byGroup.get(row.group_id)!.assets.push(row);
    });

    setGroups(Array.from(byGroup.values()));
  }

  function toggleAsset(assetId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
    // Invalidate any staged "Open WhatsApp" button from a previous
    // send — it holds a snapshot of whatever was selected AT THAT
    // TIME. If the employee changes the checkboxes afterward without
    // re-tapping "Send via WhatsApp", that stale button must not be
    // allowed to fire with the old (now-mismatched) selection. Real
    // bug this fixes: selected Video+PDF, sent, then unticked Video
    // leaving only PDF checked, then tapped the still-visible old
    // button — it fired with the original Video+PDF snapshot, so the
    // client got a message mentioning the video despite it no longer
    // being selected.
    setPendingWhatsApp(null);
  }

  async function handleSend() {
    if (!groups || selectedIds.size === 0) return;

    setSending(true);
    try {
      const allAssets = groups.flatMap((g) => g.assets);
      const selected = allAssets.filter((a) => selectedIds.has(a.asset_id));

      const shareables: ShareableAsset[] = selected.map((a) => {
        const group = groups.find((g) => g.groupId === a.group_id)!;
        return {
          id: a.asset_id,
          label: a.asset_label,
          groupLabel: group.groupLabel,
          assetType: a.asset_type,
          url: a.asset_type === "VIDEO" ? a.video_url! : supabase.storage.from(BUCKET).getPublicUrl(a.storage_path!).data.publicUrl
        };
      });

      const hasFiles = shareables.some((a) => a.assetType === "FILE");

      if (hasFiles) {
        downloadShareFileAssets(shareables);
      } else {
        // No files involved — a single window.open() in this same
        // gesture is safe, no separate tap needed.
        openWhatsAppChatForAssets(leadMobile, shareables, leadProject || undefined);
      }

      const { error: logError } = await supabase.rpc("log_asset_share_atomic", {
        p_lead_id: leadId,
        p_asset_ids: Array.from(selectedIds)
      });

      if (logError) {
        console.error("log_asset_share_atomic failed:", logError.message);
      }

      if (hasFiles) {
        setPendingWhatsApp(shareables);
        toast.success("Files downloaded — please attach them manually once WhatsApp opens.");
      } else {
        toast.success("WhatsApp opened with the client's chat.");
      }
      setSelectedIds(new Set());
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong — please try again.");
    } finally {
      setSending(false);
    }
  }

  function handleOpenWhatsApp() {
    if (!pendingWhatsApp) return;
    openWhatsAppChatForAssets(leadMobile, pendingWhatsApp, leadProject || undefined);
    setPendingWhatsApp(null);
  }

  if (groups === null) return null;
  if (groups.length === 0) return null;

  return (
    <div className="rounded-2xl bg-white border border-slate-100 shadow-md p-5">
      <p className="text-sm font-bold text-slate-800 mb-1">Project Assets</p>
      <p className="text-xs text-slate-400 mb-4">Select assets to send together in one WhatsApp message.</p>

      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.groupId}>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">{g.groupLabel}</p>
            <div className="space-y-1.5">
              {g.assets.map((a) => (
                <label
                  key={a.asset_id}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition ${
                    selectedIds.has(a.asset_id) ? "bg-amber-50 border-amber-300" : "bg-slate-50 border-slate-100 hover:border-slate-200"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(a.asset_id)}
                    onChange={() => toggleAsset(a.asset_id)}
                    className="h-4 w-4 accent-amber-500 shrink-0"
                  />
                  {a.asset_type === "VIDEO" ? (
                    <Video size={14} className="text-red-500 shrink-0" />
                  ) : (
                    <FileText size={14} className="text-blue-500 shrink-0" />
                  )}
                  {/* min-w-0 required for truncate to work on a flex
                      child — a bare truncate class is ignored otherwise
                      since flex items default to min-width:auto (see
                      app/admin/layout.tsx for the same established fix). */}
                  <span className="text-sm text-slate-700 truncate min-w-0">{a.asset_label}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      {selectedIds.size > 0 && (
        <motion.button
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          whileTap={{ scale: 0.98 }}
          disabled={sending}
          onClick={handleSend}
          className="mt-4 w-full flex items-center justify-center gap-2 h-11 rounded-xl font-semibold text-white bg-gradient-to-r from-emerald-500 to-emerald-600 shadow-[0_8px_20px_rgba(16,185,129,0.3)] disabled:opacity-60"
        >
          {sending ? <Loader2 className="animate-spin" size={16} /> : <Send size={15} />}
          {sending ? "Sending..." : `Send via WhatsApp (${selectedIds.size})`}
        </motion.button>
      )}

      {pendingWhatsApp && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="w-full min-w-0 mt-3 space-y-2">
          {/* Employee-only instruction — this never goes into the
              client's WhatsApp message text, only shown here on-screen.
              w-full + min-w-0 on every nested flex/text element (not just
              the outer wrapper) + break-words is the fix — a bare
              truncate/break-words on a flex child does nothing without
              min-w-0 on that same child, since flex items default to
              min-width:auto (established pattern, see app/admin/layout.tsx). */}
          <div className="w-full min-w-0 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5">
            <p className="text-xs font-semibold text-amber-800 mb-1 break-words">
              Files downloaded — please attach them manually once WhatsApp opens:
            </p>
            <ul className="space-y-0.5 min-w-0">
              {pendingWhatsApp
                .filter((a) => a.assetType === "FILE")
                .map((a) => (
                  <li key={a.id} className="flex gap-1.5 text-xs text-amber-700 min-w-0">
                    <span className="shrink-0">•</span>
                    <span className="min-w-0 break-words">
                      {a.groupLabel} — {a.label}
                    </span>
                  </li>
                ))}
            </ul>
          </div>

          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={handleOpenWhatsApp}
            className="w-full min-w-0 flex items-center justify-center gap-2 min-h-11 py-2.5 px-3 rounded-xl font-semibold text-white bg-gradient-to-r from-green-500 to-green-600 shadow-[0_8px_20px_rgba(34,197,94,0.3)] text-sm"
          >
            <MessageCircle size={15} className="shrink-0" />
            <span className="min-w-0 truncate">Open WhatsApp</span>
          </motion.button>
        </motion.div>
      )}
    </div>
  );
}
