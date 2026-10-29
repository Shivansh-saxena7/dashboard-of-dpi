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
  { key: "outcome_link_minutes", column: "outcome_link_minutes", label: "\"No result saved\" after", unit: "minutes" },
  { key: "reminder_after_minutes", column: "reminder_after_minutes", label: "Reminder to the employee after", unit: "minutes" },
  { key: "quick_connected_seconds", column: "quick_connected_seconds", label: "\"Connected\" saved faster than", unit: "seconds (lowers score)" },
  { key: "quick_not_interested_seconds", column: "quick_not_interested_seconds", label: "\"Not interested\" saved faster than", unit: "seconds (context only)" },
  { key: "outcome_floor_seconds", column: "outcome_floor_seconds", label: "Any other result saved faster than", unit: "seconds (context only)" },
  { key: "rapid_click_seconds", column: "rapid_click_seconds", label: "Many dials: next dial within", unit: "seconds, last one unsaved" },
  { key: "burst_min_clicks", column: "burst_min_clicks", label: "Many dials: Lead cards", unit: "dials or more" },
  { key: "burst_data_min_clicks", column: "burst_data_min_clicks", label: "Many dials: Data cards", unit: "dials or more" },
  { key: "burst_window_minutes", column: "burst_window_minutes", label: "Many dials: within", unit: "minutes" },
  { key: "burst_result_share_pct", column: "burst_result_share_pct", label: "Many dials: fewer saved than", unit: "%" },
  { key: "repeat_clicks_per_day", column: "repeat_clicks_per_day", label: "Same lead dialed", unit: "times or more a day (context only)" },
  { key: "no_dial_share_pct", column: "no_dial_share_pct", label: "\"Result without a dial\" lowers score from", unit: "% of a day's results" },
  { key: "declared_other_share_pct", column: "declared_other_share_pct", label: "Show \"Customer called / another phone\" note from", unit: "% of results" },
  { key: "score_min_clicks", column: "score_min_clicks", label: "Show a score after", unit: "dials in the period" }
];

export default function CallQualitySettingsCard() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [visible, setVisible] = useState(true);
  const [enforced, setEnforced] = useState(false);
  const [shareLineOn, setShareLineOn] = useState(true);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase
      .from("lead_engine_settings")
      .select(FIELDS.map((f) => f.column).join(", ") + ", call_quality_visible_to_employees, call_quality_enforced, call_quality_share_line")
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
        setShareLineOn(Boolean(row.call_quality_share_line));
        setAvailable(true);
      });
  }, []);

  async function save() {
    const payload: Record<string, number | boolean> = { visible_to_employees: visible, enforced, share_line: shareLineOn };
    for (const f of FIELDS) {
      const n = Number(values[f.key]);
      if (!Number.isInteger(n) || n < 0) {
        toast.error(`${f.label}: enter a whole number.`);
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
                    min={0}
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
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={shareLineOn} onChange={(e) => setShareLineOn(e.target.checked)} />
            Add the line &quot;Dials | Results saved | Score&quot; to the WhatsApp work report
          </label>
          <button onClick={save} disabled={saving} className="w-full h-12 rounded-2xl text-white font-semibold bg-gradient-to-r from-blue-600 to-cyan-500 disabled:opacity-60">
            {saving ? "Saving..." : "Save Call Quality Settings"}
          </button>
        </div>
      )}
    </motion.div>
  );
}
