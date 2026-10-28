"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";

// Admin Settings — Call Quality thresholds and the two rollout switches
// (2026-10-28). Saved through update_call_quality_settings (admin-only RPC,
// range-checked by a DB constraint). Office hours are not here: Call Quality
// reuses the SLA office hours card above.
const FIELDS: { key: string; column: string; label: string; unit: string }[] = [
  { key: "quick_outcome_seconds", column: "quick_outcome_seconds", label: "Quick outcome under", unit: "seconds" },
  { key: "rapid_click_seconds", column: "rapid_click_seconds", label: "Rapid click under", unit: "seconds" },
  { key: "outcome_window_minutes", column: "outcome_window_minutes", label: "Outcome window", unit: "minutes" },
  { key: "outcome_link_minutes", column: "outcome_link_minutes", label: "Link outcome to a click within", unit: "minutes" },
  { key: "burst_min_clicks", column: "burst_min_clicks", label: "Burst: clicks", unit: "or more" },
  { key: "burst_window_minutes", column: "burst_window_minutes", label: "Burst: within", unit: "minutes" },
  { key: "repeat_clicks_per_day", column: "repeat_clicks_per_day", label: "Repeat clicks: dial number", unit: "or more, same lead, same day" },
  { key: "min_sample", column: "call_quality_min_sample", label: "Show score after", unit: "judged calls" }
];

export default function CallQualitySettingsCard() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [visible, setVisible] = useState(true);
  const [enforced, setEnforced] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase
      .from("lead_engine_settings")
      .select(FIELDS.map((f) => f.column).join(", ") + ", call_quality_visible_to_employees, call_quality_enforced")
      .eq("id", 1)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          setAvailable(false);
          return;
        }
        const row = data as unknown as Record<string, unknown>;
        setValues(Object.fromEntries(FIELDS.map((f) => [f.key, String(row[f.column] ?? "")])));
        setVisible(Boolean(row.call_quality_visible_to_employees));
        setEnforced(Boolean(row.call_quality_enforced));
        setAvailable(true);
      });
  }, []);

  async function save() {
    const payload: Record<string, number | boolean> = { visible_to_employees: visible, enforced };
    for (const f of FIELDS) {
      const n = Number(values[f.key]);
      if (!Number.isInteger(n) || n <= 0) {
        toast.error(`${f.label} must be a whole number greater than 0.`);
        return;
      }
      payload[f.key] = n;
    }
    setSaving(true);
    const { error } = await supabase.rpc("update_call_quality_settings", { p_settings: payload });
    setSaving(false);
    if (error) toast.error(error.message || "Could not save Call Quality settings.");
    else toast.success("Call Quality settings saved.");
  }

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-[24px] border border-slate-100 shadow-md p-6">
      <h2 className="text-xl font-bold text-slate-800 mb-1">📞 Call Quality</h2>
      <p className="text-xs text-slate-500 mb-5">Thresholds for the call flags and the genuine score. Office hours come from the SLA office hours above.</p>

      {available === null && <p className="text-sm text-slate-400">Loading...</p>}
      {available === false && <p className="text-sm text-slate-400">Call Quality is not switched on yet.</p>}
      {available && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {FIELDS.map((f) => (
              <div key={f.key}>
                <label className="text-xs font-semibold text-slate-500 mb-1 block">{f.label}</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    value={values[f.key] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    className="w-24 h-11 rounded-xl bg-slate-50 border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-amber-200"
                  />
                  <span className="text-xs text-slate-500">{f.unit}</span>
                </div>
              </div>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />
            Show Call Quality to employees (their own score, flags and reminders)
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={enforced} onChange={(e) => setEnforced(e.target.checked)} />
            Use the score for evaluation (off = learning week label everywhere)
          </label>
          <button onClick={save} disabled={saving} className="w-full h-12 rounded-2xl text-white font-semibold bg-gradient-to-r from-blue-600 to-cyan-500 disabled:opacity-60">
            {saving ? "Saving..." : "Save Call Quality Settings"}
          </button>
        </div>
      )}
    </motion.div>
  );
}
