"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { Loader2, Plus, KeyRound } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface MetaDataset {
  id: string;
  label: string;
  dataset_id: string;
  is_active: boolean;
  created_at: string;
}

interface CapiLogRow {
  id: string;
  event_tier: string;
  meta_event_name: string;
  status: string;
  queued_at: string;
  sent_at: string | null;
  last_error: string | null;
  leads: { name: string; project: string | null } | null;
}

const STATUS_PILL: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-700",
  SENT: "bg-emerald-50 text-emerald-700",
  FAILED: "bg-red-50 text-red-700"
};

// Admin's Meta Datasets page (feature/meta-capi-integration,
// 2026-08-19) — manage datasets (token stored via Vault-backed RPCs,
// never held or displayed here once saved) plus a simple status log
// across all leads, so "did Meta genuinely get the signal" is never a
// guess. No auth-check needed here — admin/layout.tsx already gates
// every /admin/* route on role === "admin", same as every other admin
// page. The create/rotate API routes DO their own real auth check on
// top (resolveAdminCaller) since they touch an actual secret — every
// fetch below attaches the caller's own session token for that reason,
// unlike this codebase's older admin routes which don't require it.
export default function MetaDatasetsPage() {

  const [datasets, setDatasets] = useState<MetaDataset[]>([]);
  const [loadingDatasets, setLoadingDatasets] = useState(true);

  const [label, setLabel] = useState("");
  const [datasetId, setDatasetId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [creating, setCreating] = useState(false);

  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const [rotateTokenValue, setRotateTokenValue] = useState("");
  const [rotating, setRotating] = useState(false);

  const [logRows, setLogRows] = useState<CapiLogRow[]>([]);
  const [loadingLog, setLoadingLog] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  useEffect(() => {
    loadDatasets();
    loadLog();
  }, []);

  async function loadDatasets() {
    setLoadingDatasets(true);
    const { data } = await supabase
      .from("meta_datasets")
      .select("id, label, dataset_id, is_active, created_at")
      .order("created_at", { ascending: false });
    if (data) setDatasets(data);
    setLoadingDatasets(false);
  }

  async function loadLog() {
    setLoadingLog(true);
    const { data } = await supabase
      .from("meta_capi_events_log")
      .select("id, event_tier, meta_event_name, status, queued_at, sent_at, last_error, leads(name, project)")
      .order("queued_at", { ascending: false })
      .limit(100);
    if (data) setLogRows(data as any);
    setLoadingLog(false);
  }

  async function authedFetch(url: string, body: any) {
    const { data: { session } } = await supabase.auth.getSession();
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(session ? { Authorization: `Bearer ${session.access_token}` } : {})
      },
      body: JSON.stringify(body)
    });
  }

  async function createDataset() {
    if (!label.trim() || !datasetId.trim() || !accessToken.trim()) {
      toast.error("Label, Dataset ID, and Access Token are all required.");
      return;
    }

    setCreating(true);
    try {
      const res = await authedFetch("/api/admin/create-meta-dataset", {
        label: label.trim(),
        dataset_id: datasetId.trim(),
        access_token: accessToken.trim()
      });
      const result = await res.json();

      if (!res.ok) {
        toast.error(result.error || "Failed to create dataset.");
        return;
      }

      toast.success("Dataset added.");
      setLabel("");
      setDatasetId("");
      setAccessToken("");
      loadDatasets();
    } catch (err) {
      console.log(err);
      toast.error("Something went wrong.");
    } finally {
      setCreating(false);
    }
  }

  async function rotateToken(datasetRowId: string) {
    if (!rotateTokenValue.trim()) {
      toast.error("Enter the new access token.");
      return;
    }

    setRotating(true);
    try {
      const res = await authedFetch("/api/admin/rotate-meta-dataset-token", {
        dataset_row_id: datasetRowId,
        access_token: rotateTokenValue.trim()
      });
      const result = await res.json();

      if (!res.ok) {
        toast.error(result.error || "Failed to rotate token.");
        return;
      }

      toast.success("Token rotated.");
      setRotatingId(null);
      setRotateTokenValue("");
    } catch (err) {
      console.log(err);
      toast.error("Something went wrong.");
    } finally {
      setRotating(false);
    }
  }

  const visibleLog = statusFilter === "ALL" ? logRows : logRows.filter((r) => r.status === statusFilter);

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800 mb-1">Meta Datasets</h1>
        <p className="text-sm text-slate-500">
          Har Dataset ek Meta Ads campaign/account ko represent karta hai. Project ko is-page-pe nahi, Project
          Assets page pe ek Dataset se link kiya jaata hai.
        </p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-2xl border border-slate-100 shadow-md p-5"
      >
        <p className="text-sm font-bold text-slate-800 mb-3">Add Dataset</p>
        <div className="grid sm:grid-cols-3 gap-3">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (e.g. Kviraaj Campaign)"
            className="h-11 rounded-xl bg-slate-50 border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-amber-200"
          />
          <input
            value={datasetId}
            onChange={(e) => setDatasetId(e.target.value)}
            placeholder="Dataset ID"
            className="h-11 rounded-xl bg-slate-50 border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-amber-200"
          />
          <input
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            type="password"
            placeholder="Access Token"
            className="h-11 rounded-xl bg-slate-50 border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-amber-200"
          />
        </div>
        <button
          onClick={createDataset}
          disabled={creating}
          className="mt-3 flex items-center gap-2 h-11 px-4 rounded-xl text-sm font-semibold text-slate-900 bg-gradient-to-r from-yellow-400 to-amber-500 disabled:opacity-60"
        >
          {creating ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
          {creating ? "Adding..." : "Add Dataset"}
        </button>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-2xl border border-slate-100 shadow-md p-5"
      >
        <p className="text-sm font-bold text-slate-800 mb-3">Existing Datasets</p>
        {loadingDatasets ? (
          <p className="text-sm text-slate-400">Loading...</p>
        ) : datasets.length === 0 ? (
          <p className="text-sm text-slate-400">No datasets yet — add one above.</p>
        ) : (
          <div className="space-y-2">
            {datasets.map((d) => (
              <div key={d.id} className="rounded-xl border border-slate-100 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{d.label}</p>
                    <p className="text-xs text-slate-400">Dataset ID: {d.dataset_id}</p>
                  </div>
                  <button
                    onClick={() => { setRotatingId(rotatingId === d.id ? null : d.id); setRotateTokenValue(""); }}
                    className="shrink-0 flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200"
                  >
                    <KeyRound size={13} />
                    Rotate Token
                  </button>
                </div>

                {rotatingId === d.id && (
                  <div className="mt-3 flex gap-2">
                    <input
                      value={rotateTokenValue}
                      onChange={(e) => setRotateTokenValue(e.target.value)}
                      type="password"
                      placeholder="New Access Token"
                      className="flex-1 h-10 rounded-xl bg-slate-50 border border-slate-200 px-3 text-sm outline-none"
                    />
                    <button
                      onClick={() => rotateToken(d.id)}
                      disabled={rotating}
                      className="h-10 px-4 rounded-xl text-xs font-semibold text-white bg-slate-800 disabled:opacity-60"
                    >
                      {rotating ? "Saving..." : "Save"}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-2xl border border-slate-100 shadow-md p-5"
      >
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-bold text-slate-800">Signal Log</p>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 rounded-lg bg-slate-50 border border-slate-200 px-2 text-xs outline-none"
          >
            <option value="ALL">All</option>
            <option value="PENDING">Pending</option>
            <option value="SENT">Sent</option>
            <option value="FAILED">Failed</option>
          </select>
        </div>

        {loadingLog ? (
          <p className="text-sm text-slate-400">Loading...</p>
        ) : visibleLog.length === 0 ? (
          <p className="text-sm text-slate-400">No events yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 uppercase tracking-wide">
                  <th className="pb-2 pr-3">Lead</th>
                  <th className="pb-2 pr-3">Project</th>
                  <th className="pb-2 pr-3">Tier</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2 pr-3">When</th>
                  <th className="pb-2">Detail</th>
                </tr>
              </thead>
              <tbody>
                {visibleLog.map((row) => (
                  <tr key={row.id} className="border-t border-slate-50">
                    <td className="py-2 pr-3 font-medium text-slate-700">{row.leads?.name || "—"}</td>
                    <td className="py-2 pr-3 text-slate-500">{row.leads?.project || "—"}</td>
                    <td className="py-2 pr-3 text-slate-500">{row.event_tier}</td>
                    <td className="py-2 pr-3">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_PILL[row.status] || ""}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-slate-400 text-xs">
                      {new Date(row.sent_at || row.queued_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="py-2 text-slate-400 text-xs max-w-[240px] truncate" title={row.last_error || ""}>
                      {row.status === "FAILED" ? row.last_error : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>
    </div>
  );
}
