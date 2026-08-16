"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { X, Plus, Trash2, MessageCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { calculateCostSheet } from "@/lib/costSheetCalculations";
import { buildCostSheetPdfBlob, downloadPdfBlob, CostSheetPdfInput } from "@/lib/exportTable";
import { downloadShareFileAssets, openWhatsAppChatForAssets, ShareableAsset } from "@/lib/shareAssetsViaWhatsApp";

const BUCKET = "project-assets";
const INPUT_CLASS = "w-full h-11 rounded-xl bg-slate-50 border border-slate-200 px-3.5 text-sm outline-none focus:ring-2 focus:ring-blue-200";

interface CostSheetModalProps {
  leadId: string;
  leadName: string;
  leadMobile: string;
  leadProject?: string | null;
  onClose: () => void;
}

interface ProjectOption {
  id: string;
  name: string;
}

interface OtherChargeRow {
  label: string;
  amount: string;
}

function fmtINR(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function SummaryRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-blue-700/80 min-w-0 truncate">{label}</span>
      <span className="font-semibold text-blue-900 shrink-0">Rs. {fmtINR(value)}</span>
    </div>
  );
}

// The big Part 2 form — real company Cost Sheet format (S.No /
// Particularity / Size / Rate / Flat-Cost), confirmed against an
// actual La Residentia sheet. Project+Size reuse Part 1's projects/
// project_asset_groups tables purely for a curated dropdown+datalist
// (not the alias-resolution RPC — a wrong default here just means the
// employee picks manually, no authorization stakes, unlike Part 1's
// get_lead_project_assets). "Size / Type" (free text, e.g. "2BHK —
// 880 sqft", header/labeling only) is deliberately a SEPARATE field
// from "Area (sqft)" (numeric, actually multiplies against the BSP/
// IFMS/Lease Rent rates) — collapsing them would mean guessing a
// number out of free text, which this avoids entirely. Calculation is
// entirely owned by lib/costSheetCalculations.ts; PDF styling by
// lib/exportTable.ts; share+tracking reuses Part 1's exact tiered
// WhatsApp mechanism via a single synthetic FILE ShareableAsset.
export default function CostSheetModal({ leadId, leadName, leadMobile, leadProject, onClose }: CostSheetModalProps) {
  const [defaultGovtChargePct, setDefaultGovtChargePct] = useState<number | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = useState("");
  const [sizeOptions, setSizeOptions] = useState<string[]>([]);
  const [size, setSize] = useState("");

  const [area, setArea] = useState("");
  const [bspRate, setBspRate] = useState("");
  const [ifmsRate, setIfmsRate] = useState("");
  const [leaseRentRate, setLeaseRentRate] = useState("");
  const [carParking, setCarParking] = useState("");
  const [clubMembership, setClubMembership] = useState("");
  const [viewPlc, setViewPlc] = useState("");
  const [floorPlc, setFloorPlc] = useState("");
  const [powerBackup, setPowerBackup] = useState("");
  const [dualMeter, setDualMeter] = useState("");
  const [otherCharges, setOtherCharges] = useState<OtherChargeRow[]>([]);
  const [govtChargePct, setGovtChargePct] = useState("");

  const [generating, setGenerating] = useState(false);
  const [pendingShare, setPendingShare] = useState<ShareableAsset | null>(null);

  useEffect(() => {
    loadInitial();
  }, []);

  async function loadInitial() {
    const [{ data: settingsData }, { data: projectsData }] = await Promise.all([
      supabase.from("cost_sheet_settings").select("*").eq("id", 1).single(),
      supabase.from("projects").select("id, name").eq("is_active", true).order("name")
    ]);

    if (settingsData) {
      setDefaultGovtChargePct(settingsData.govt_charge_pct);
      setGovtChargePct(String(settingsData.govt_charge_pct));
    }

    if (projectsData) {
      setProjects(projectsData);
      const cleanLeadProject = (leadProject || "").trim().toLowerCase();
      const match = cleanLeadProject ? projectsData.find((p) => p.name.trim().toLowerCase() === cleanLeadProject) : null;
      if (match) setProjectId(match.id);
    }
  }

  useEffect(() => {
    if (!projectId) {
      setSizeOptions([]);
      return;
    }
    supabase
      .from("project_asset_groups")
      .select("label")
      .eq("project_id", projectId)
      .order("sort_order")
      .then(({ data }) => setSizeOptions((data || []).map((g) => g.label)));
  }, [projectId]);

  const projectName = useMemo(() => projects.find((p) => p.id === projectId)?.name || "", [projects, projectId]);

  const numericInputs = useMemo(
    () => ({
      area: parseFloat(area) || 0,
      bspRate: parseFloat(bspRate) || 0,
      ifmsRate: parseFloat(ifmsRate) || 0,
      leaseRentRate: parseFloat(leaseRentRate) || 0,
      carParking: parseFloat(carParking) || 0,
      clubMembership: parseFloat(clubMembership) || 0,
      viewPlc: parseFloat(viewPlc) || 0,
      floorPlc: parseFloat(floorPlc) || 0,
      powerBackup: parseFloat(powerBackup) || 0,
      dualMeter: parseFloat(dualMeter) || 0,
      otherCharges: otherCharges.map((o) => ({ label: o.label.trim() || "Other Charge", amount: parseFloat(o.amount) || 0 })),
      govtChargePct: parseFloat(govtChargePct) || 0
    }),
    [area, bspRate, ifmsRate, leaseRentRate, carParking, clubMembership, viewPlc, floorPlc, powerBackup, dualMeter, otherCharges, govtChargePct]
  );

  const result = useMemo(() => calculateCostSheet(numericInputs), [numericInputs]);

  // A staged "Open WhatsApp" button holds a snapshot of the exact PDF
  // that was generated — if any input changes after that, the snapshot
  // no longer matches what's on screen. Same stale-state bug (and same
  // fix) as Part 1's toggleAsset — see LeadProjectAssetsSection.tsx.
  useEffect(() => {
    setPendingShare(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericInputs, projectId, size]);

  function addOtherCharge() {
    setOtherCharges((prev) => [...prev, { label: "", amount: "" }]);
  }
  function updateOtherCharge(index: number, field: "label" | "amount", value: string) {
    setOtherCharges((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }
  function removeOtherCharge(index: number) {
    setOtherCharges((prev) => prev.filter((_, i) => i !== index));
  }

  function buildPdfInput(): CostSheetPdfInput {
    return {
      leadName,
      leadMobile,
      project: projectName || "—",
      size: size.trim() || "—",
      area: numericInputs.area,
      bspRate: numericInputs.bspRate,
      ifmsRate: numericInputs.ifmsRate,
      leaseRentRate: numericInputs.leaseRentRate,
      carParking: numericInputs.carParking,
      clubMembership: numericInputs.clubMembership,
      viewPlc: numericInputs.viewPlc,
      floorPlc: numericInputs.floorPlc,
      powerBackup: numericInputs.powerBackup,
      dualMeter: numericInputs.dualMeter,
      otherCharges: numericInputs.otherCharges,
      bspAmount: result.bspAmount,
      ifmsAmount: result.ifmsAmount,
      leaseRentAmount: result.leaseRentAmount,
      totalFlatCost: result.totalFlatCost,
      govtChargePct: result.govtChargePct,
      govtCharge: result.govtCharge,
      grandTotal: result.grandTotal
    };
  }

  function validate(): boolean {
    if (!projectId) {
      toast.error("Please select a project.");
      return false;
    }
    if (!size.trim()) {
      toast.error("Please enter a size/type.");
      return false;
    }
    if (numericInputs.area <= 0) {
      toast.error("Please enter the area in sqft.");
      return false;
    }
    return true;
  }

  async function handleDownload() {
    if (!validate()) return;
    const input = buildPdfInput();

    setGenerating(true);
    try {
      const blob = await buildCostSheetPdfBlob(input);
      downloadPdfBlob(blob, "cost-sheet");
      toast.success("Cost sheet PDF downloaded.");
    } catch (err) {
      console.error(err);
      toast.error("Could not generate PDF — please try again.");
    } finally {
      setGenerating(false);
    }
  }

  // Uploads the PDF to Storage (only at share-time, not on every
  // generation — avoids orphaned files for cost sheets that are
  // generated but never actually sent), then reuses Part 1's exact
  // tiered WhatsApp mechanism via one synthetic FILE ShareableAsset.
  async function handleSend() {
    if (!validate()) return;
    const input = buildPdfInput();

    setGenerating(true);
    try {
      const blob = await buildCostSheetPdfBlob(input);
      const path = `cost-sheets/${leadId}/${Date.now()}.pdf`;

      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: "application/pdf" });
      if (uploadError) throw uploadError;

      const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

      const asset: ShareableAsset = {
        id: path,
        label: "Cost Sheet",
        groupLabel: `${input.project} — ${input.size}`,
        assetType: "FILE",
        url: publicUrl
      };

      downloadShareFileAssets([asset]);

      const { error: logError } = await supabase.rpc("log_cost_sheet_share_atomic", {
        p_lead_id: leadId,
        p_snapshot: { ...input, pdfUrl: publicUrl }
      });
      if (logError) {
        console.error("log_cost_sheet_share_atomic failed:", logError.message);
      }

      setPendingShare(asset);
      toast.success("Cost sheet PDF downloaded — please attach it manually once WhatsApp opens.");
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong — please try again.");
    } finally {
      setGenerating(false);
    }
  }

  function handleOpenWhatsApp() {
    if (!pendingShare) return;
    openWhatsAppChatForAssets(leadMobile, [pendingShare], projectName || undefined);
    setPendingShare(null);
  }

  const modal = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div onClick={onClose} className="absolute inset-0 bg-black/40" />

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="relative w-full max-w-lg bg-white rounded-[24px] shadow-2xl max-h-[90vh] flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
          <h2 className="text-lg font-bold text-slate-800">🧾 Cost Sheet Generator</h2>
          <button onClick={onClose} className="h-8 w-8 rounded-lg bg-slate-50 flex items-center justify-center text-slate-400 hover:text-slate-600 transition">
            <X size={16} />
          </button>
        </div>

        {/* Only this middle section scrolls — the action buttons and
            the "Open WhatsApp" step below are pinned in a sticky
            footer OUTSIDE this scroll container, so on a long form
            (many number fields) the next step is never scrolled out
            of view. Real bug this fixes: after tapping "Send via
            WhatsApp" near the bottom of a long scroll, the newly-
            revealed "Open WhatsApp" button used to render further
            below the fold — the flow hadn't actually broken, the
            button was just invisible without an extra scroll. */}
        <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-3">
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={INPUT_CLASS}>
            <option value="">Select project...</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          <div>
            <input
              type="text"
              list="cost-sheet-size-options"
              placeholder="Size / Type (e.g. 2BHK — 880 sqft)"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              className={INPUT_CLASS}
            />
            <datalist id="cost-sheet-size-options">
              {sizeOptions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>

          <input type="number" placeholder="Area (sqft)" value={area} onChange={(e) => setArea(e.target.value)} className={INPUT_CLASS} />

          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">Per-sqft rates</p>
            <div className="grid grid-cols-3 gap-2">
              <input type="number" placeholder="BSP Rate" value={bspRate} onChange={(e) => setBspRate(e.target.value)} className={INPUT_CLASS} />
              <input type="number" placeholder="IFMS Rate" value={ifmsRate} onChange={(e) => setIfmsRate(e.target.value)} className={INPUT_CLASS} />
              <input type="number" placeholder="Lease Rent Rate" value={leaseRentRate} onChange={(e) => setLeaseRentRate(e.target.value)} className={INPUT_CLASS} />
            </div>
          </div>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">Fixed charges</p>
            <div className="grid grid-cols-2 gap-2">
              <input type="number" placeholder="Car Parking" value={carParking} onChange={(e) => setCarParking(e.target.value)} className={INPUT_CLASS} />
              <input type="number" placeholder="Club Membership" value={clubMembership} onChange={(e) => setClubMembership(e.target.value)} className={INPUT_CLASS} />
              <input type="number" placeholder="View PLC" value={viewPlc} onChange={(e) => setViewPlc(e.target.value)} className={INPUT_CLASS} />
              <input type="number" placeholder="Floor PLC" value={floorPlc} onChange={(e) => setFloorPlc(e.target.value)} className={INPUT_CLASS} />
              <input type="number" placeholder="Power Backup" value={powerBackup} onChange={(e) => setPowerBackup(e.target.value)} className={INPUT_CLASS} />
              <input type="number" placeholder="Dual Meter" value={dualMeter} onChange={(e) => setDualMeter(e.target.value)} className={INPUT_CLASS} />
            </div>
          </div>

          <div className="space-y-2">
            {otherCharges.map((oc, idx) => (
              <div key={idx} className="flex gap-2">
                <input
                  type="text"
                  placeholder="Charge label"
                  value={oc.label}
                  onChange={(e) => updateOtherCharge(idx, "label", e.target.value)}
                  className="flex-1 min-w-0 h-10 rounded-lg bg-slate-50 border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-blue-200"
                />
                <input
                  type="number"
                  placeholder="Amount"
                  value={oc.amount}
                  onChange={(e) => updateOtherCharge(idx, "amount", e.target.value)}
                  className="w-28 shrink-0 h-10 rounded-lg bg-slate-50 border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-blue-200"
                />
                <button onClick={() => removeOtherCharge(idx)} className="h-10 w-10 shrink-0 rounded-lg bg-red-50 text-red-500 flex items-center justify-center">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button onClick={addOtherCharge} className="text-xs font-semibold text-blue-600 flex items-center gap-1">
              <Plus size={12} /> Add Other Charge
            </button>
          </div>

          <div>
            <input
              type="number"
              placeholder="Govt Charge %"
              value={govtChargePct}
              onChange={(e) => setGovtChargePct(e.target.value)}
              className={INPUT_CLASS}
            />
            {defaultGovtChargePct !== null && (
              <p className="text-[10px] text-slate-400 mt-1">Defaults to {defaultGovtChargePct}% (Admin Settings) — edit here for this specific deal if needed.</p>
            )}
          </div>

          <div className="rounded-xl bg-blue-50 border border-blue-100 p-3 space-y-1 text-xs">
            <SummaryRow label="BSP" value={result.bspAmount} />
            <SummaryRow label="IFMS" value={result.ifmsAmount} />
            <SummaryRow label="Lease Rent" value={result.leaseRentAmount} />
            <div className="pt-1.5 mt-1.5 border-t border-blue-200 flex justify-between gap-2">
              <span className="font-semibold text-blue-900">Total Flat Cost</span>
              <span className="font-semibold text-blue-900 shrink-0">Rs. {fmtINR(result.totalFlatCost)}</span>
            </div>
            <SummaryRow label={`Govt Charge (${result.govtChargePct}%)`} value={result.govtCharge} />
            <div className="pt-1.5 mt-1.5 border-t border-blue-200 flex justify-between gap-2">
              <span className="font-bold text-blue-900">Grand Total</span>
              <span className="font-bold text-blue-900 shrink-0">Rs. {fmtINR(result.grandTotal)}</span>
            </div>
            <p className="text-[10px] text-blue-700/70 italic pt-1">
              Internal estimate only, not a legal/tax document.
            </p>
          </div>
        </div>

        <div className="shrink-0 px-6 pt-3 pb-6 border-t border-slate-100 space-y-2">
          {/* min-h-11 (not h-11) + flex items-center justify-center +
              text-sm — same fix as the "Open WhatsApp" button below.
              Fixed-height + no flex-centering + default (16px) text
              meant "Send via WhatsApp" wrapped to 2 lines at the
              narrow flex-1-shrunk width these get on mobile, and with
              a FIXED height + default overflow:visible, that second
              line rendered past the button's own box instead of the
              box growing to fit it. */}
          <div className="flex gap-2">
            <button
              onClick={handleDownload}
              disabled={generating}
              className="flex-1 min-w-0 min-h-11 flex items-center justify-center px-2 py-2 rounded-xl font-semibold text-sm text-blue-700 bg-blue-50 border border-blue-200 disabled:opacity-60"
            >
              {generating ? "Working..." : "Download PDF"}
            </button>
            <button
              onClick={handleSend}
              disabled={generating}
              className="flex-1 min-w-0 min-h-11 flex items-center justify-center px-2 py-2 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-emerald-500 to-emerald-600 shadow-[0_8px_20px_rgba(16,185,129,0.3)] disabled:opacity-60"
            >
              {generating ? "Working..." : "Send via WhatsApp"}
            </button>
          </div>

          {pendingShare && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="w-full min-w-0 space-y-2">
              <div className="w-full min-w-0 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5">
                <p className="text-xs font-semibold text-amber-800 break-words">
                  PDF downloaded — please attach it manually once WhatsApp opens.
                </p>
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
      </motion.div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : null;
}
