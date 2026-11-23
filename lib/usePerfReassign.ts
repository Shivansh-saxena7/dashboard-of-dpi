"use client";
// Performance Report: give leads from the report (2026-11-23, admin only, behind lead_engine_settings.
// admin_report_reassign_mode). Every call is an RPC with the lead list in the request body (POST), never in a URL, at
// most 200 leads a call: bigger selections go in pages of 200, one batch (and one idempotency key) per page. The SQL
// re-checks admin, the receiver, the current owner and positive leads; this file only pages and adds up.
import { supabase } from "@/lib/supabase";
import { reportClientError } from "@/lib/reportClientError";
import { chunks, REASSIGN_CHUNK, type ReassignItem } from "@/lib/perfReport";

export interface Preview {
  requested: number; will_move: number; positive_included: number; positive_excluded: number;
  skipped: Record<string, number>; from: Record<string, number>; receiver_problem: string | null;
}
export interface GiveResult { moved: number; skipped: number; skipped_breakdown: Record<string, number>; batch_ids: string[]; error: string | null; done: number }
const add = (a: Record<string, number>, b: Record<string, number> | null | undefined) => {
  for (const [k, v] of Object.entries(b ?? {})) a[k] = (a[k] ?? 0) + Number(v);
  return a;
};

export async function loadSalesEmployees(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase.from("employees").select("id,name").eq("is_active", true).eq("department", "sales").order("name").limit(500);
  if (error) reportClientError("perf-reassign:employees", error.message, "warning");
  return ((data ?? []) as { id: string; name: string | null }[]).map((e) => ({ id: e.id, name: e.name ?? e.id.slice(0, 8) }));
}

// What would happen; nothing is written.
export async function previewGive(items: ReassignItem[], to: string, mode: "give" | "give_back", includePositive: boolean): Promise<Preview | { error: string }> {
  const out: Preview = { requested: 0, will_move: 0, positive_included: 0, positive_excluded: 0, skipped: {}, from: {}, receiver_problem: null };
  for (const part of chunks(items, REASSIGN_CHUNK)) {
    const { data, error } = await supabase.rpc("admin_report_reassign_preview", { p_items: part, p_to_employee: to, p_mode: mode, p_include_positive: includePositive });
    if (error || !data) {
      reportClientError("perf-reassign:preview", error?.message ?? "empty answer", "warning");
      return { error: error?.message ?? "Couldn't check these leads." };
    }
    const p = data as Preview;
    out.requested += p.requested;
    out.will_move += p.will_move;
    out.positive_included += p.positive_included;
    out.positive_excluded += p.positive_excluded;
    add(out.skipped, p.skipped);
    add(out.from, p.from);
    out.receiver_problem = out.receiver_problem ?? p.receiver_problem;
  }
  return out;
}

// Give (or give back) in pages of 200. A failed page stops the run; pages already done stay done (each is its own batch).
export async function applyGive(items: ReassignItem[], to: string, mode: "give" | "give_back", reason: string, label: string, includePositive: boolean,
  runKey: string, onProgress?: (done: number, total: number) => void): Promise<GiveResult> {
  const out: GiveResult = { moved: 0, skipped: 0, skipped_breakdown: {}, batch_ids: [], error: null, done: 0 };
  const parts = chunks(items, REASSIGN_CHUNK);
  for (const [i, part] of parts.entries()) {
    const { data, error } = await supabase.rpc("admin_reassign_leads_from_report", {
      p_items: part, p_to_employee: to, p_mode: mode, p_reason: reason, p_label: label || null, p_include_positive: includePositive,
      p_idempotency_key: `${runKey}-${i}`
    });
    if (error || !data) {
      reportClientError("perf-reassign:give", error?.message ?? "empty answer", "error");
      out.error = error?.message ?? "empty answer";
      return out;
    }
    const r = data as { batch_id: string; moved: number; skipped: number; skipped_breakdown: Record<string, number> };
    out.moved += r.moved;
    out.skipped += r.skipped;
    add(out.skipped_breakdown, r.skipped_breakdown);
    if (r.batch_id && !out.batch_ids.includes(r.batch_id)) out.batch_ids.push(r.batch_id);
    out.done += part.length;
    onProgress?.(out.done, items.length);
  }
  return out;
}

export async function undoBatch(batchId: string, reason: string, key: string) {
  const { data, error } = await supabase.rpc("admin_undo_report_batch", { p_batch_id: batchId, p_reason: reason, p_idempotency_key: key });
  if (error) reportClientError("perf-reassign:undo", error.message, "error");
  return { data: data as { moved: number; skipped: number; skipped_breakdown: Record<string, number>; batch_id: string } | null, error: error?.message ?? null };
}

export interface BatchRow {
  batch_id: string; created_at: string; mode: "give" | "give_back" | "undo"; label: string | null; reason: string; to_employee_id: string; to_name: string | null;
  from_employee_ids: string[]; moved: number; skipped: number; undo_of: string | null; undone_by: string | null; by_name: string | null;
}
export async function loadBatches(from: string, to: string): Promise<BatchRow[] | null> {
  const { data, error } = await supabase.rpc("get_report_batches", { p_from: from, p_to: to });
  if (error) {
    reportClientError("perf-reassign:batches", error.message, "warning");
    return null;
  }
  return (data ?? []) as BatchRow[];
}
export interface Side { leads: number; followup: number; visit: number; connected: number; converted: number; no_result: number }
export interface Outcome {
  batch: BatchRow & { from_names: string[] | null; skipped_breakdown: Record<string, number> };
  before: Side; after: Side;
  leads: { lead_id: string; lead_name: string | null; status: "moved" | "skipped"; skip_reason: string | null; positive: boolean; before: Record<string, unknown>; after: Record<string, unknown> }[];
}
export async function loadOutcome(batchId: string): Promise<Outcome | null> {
  const { data, error } = await supabase.rpc("get_report_batch_outcome", { p_batch_id: batchId });
  if (error) {
    reportClientError("perf-reassign:outcome", error.message, "warning");
    return null;
  }
  return data as Outcome;
}
export interface LeadBatch { batch_id: string; at: string; mode: string; label: string | null; reason: string; from_name: string | null; to_name: string | null; status: string; skip_reason: string | null; new_stint_id: string | null }
export async function loadLeadBatches(leadId: string): Promise<LeadBatch[]> {
  const { data, error } = await supabase.rpc("get_lead_report_batches", { p_lead_id: leadId });
  if (error) {
    reportClientError("perf-reassign:lead-batches", error.message, "warning");
    return [];
  }
  return ((data as { batches?: LeadBatch[] })?.batches ?? []);
}
