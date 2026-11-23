"use client";
// Performance Report, admin only (2026-11-23): give leads from the report, a lead's journey, and the admin batches with
// their before / after and undo. The give / undo controls show only while lead_engine_settings.
// admin_report_reassign_mode = 'on'; the journey (read-only) shows with the report. Every move goes through the SQL
// (admin_reassign_leads_from_report), which re-checks everything; employees see only "Given by admin", never the
// reason or the label (those stay in the admin-only batch tables).
import { useEffect, useMemo, useRef, useState } from "react";
import { originWord, skipText, statusTone, statusWord, type ReassignItem } from "@/lib/perfReport";
import { loadJourney, type JourneyStint } from "@/lib/usePerfReport";
import {
  applyGive, loadBatches, loadLeadBatches, loadOutcome, loadSalesEmployees, previewGive, undoBatch,
  type BatchRow, type GiveResult, type LeadBatch, type Outcome, type Preview
} from "@/lib/usePerfReassign";
import { Banner, BTN, CARD, dayText, FOCUS, INPUT, Pill, PRIMARY, Sheet, Skeleton } from "@/components/perfUi";

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const MIN_REASON = 5;

function Breakdown({ items, testId }: { items: Record<string, number>; testId: string }) {
  const list = Object.entries(items).filter(([, v]) => v > 0);
  if (!list.length) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-[13px] text-slate-700" data-testid={testId}>
      {list.map(([k, v]) => <li key={k}>Skipped {v}: {skipText(k)}</li>)}
    </ul>
  );
}

// Confirm sheet: preview (no writes), reason + label (admin only), then give in pages of 200.
export function GiveSheet({ items, mode, giveBackTo, ownerName, onClose, onDone }: {
  items: ReassignItem[]; mode: "give" | "give_back"; giveBackTo?: { id: string; name: string }; ownerName: (id: string) => string;
  onClose: () => void; onDone: () => void;
}) {
  const [people, setPeople] = useState<{ id: string; name: string }[] | null>(mode === "give" ? null : []);
  const [to, setTo] = useState(giveBackTo?.id ?? "");
  const [incPos, setIncPos] = useState(false);
  const [reason, setReason] = useState("");
  const [label, setLabel] = useState("");
  const [previewAt, setPreview] = useState<{ key: string; p: Preview | { error: string } } | null>(null);
  const [run, setRun] = useState<{ busy: boolean; done: number; result: GiveResult | null }>({ busy: false, done: 0, result: null });
  const runKey = useRef(newKey());
  useEffect(() => {
    if (mode === "give") void loadSalesEmployees().then(setPeople);
  }, [mode]);
  const previewKey = `${to}|${mode}|${incPos}`;
  useEffect(() => {
    if (!to) return;
    let alive = true;
    void previewGive(items, to, mode, incPos).then((p) => { if (alive) setPreview({ key: `${to}|${mode}|${incPos}`, p }); });
    return () => { alive = false; };
  }, [items, to, mode, incPos]);
  const preview = previewAt && previewAt.key === previewKey ? previewAt.p : null;
  const toName = giveBackTo?.name ?? people?.find((p) => p.id === to)?.name ?? "";
  const p = preview && !("error" in preview) ? preview : null;
  const reasonOk = reason.trim().length >= MIN_REASON;
  const canGo = !!p && p.will_move > 0 && !p.receiver_problem && reasonOk && !run.busy && !run.result;
  const title = mode === "give" ? `Give ${items.length.toLocaleString("en-IN")} leads` : `Give ${items.length.toLocaleString("en-IN")} leads back to ${toName}`;
  return (
    <Sheet title={title} sub="Admin action" onClose={onClose} testId="perf-give" wide>
      {run.result ? (
        <div className="space-y-3" data-testid="perf-give-result">
          <Banner tone={run.result.error ? "amber" : "green"} icon={run.result.error ? "▲" : "✓"} testId="perf-give-result-line">
            {run.result.moved.toLocaleString("en-IN")} moved to {toName}, {run.result.skipped.toLocaleString("en-IN")} skipped.
            {run.result.error ? ` Stopped after ${run.result.done} leads: ${run.result.error}` : ""}
          </Banner>
          <Breakdown items={run.result.skipped_breakdown} testId="perf-give-result-skips" />
          {run.result.batch_ids.length > 0 && (
            <p className="text-[13px] text-slate-600" data-testid="perf-give-batches">Batch {run.result.batch_ids.map((b) => b.slice(0, 8)).join(", ")} · see “Given by admin” below the report.</p>
          )}
          <button type="button" className={`${PRIMARY} w-full`} onClick={onDone} data-testid="perf-give-done">Done</button>
        </div>
      ) : (
        <div className="space-y-3">
          {mode === "give" && (
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-slate-700">
              Give to
              <select value={to} onChange={(e) => setTo(e.target.value)} className={INPUT} data-testid="perf-give-to" disabled={!people}>
                <option value="">{people ? "Choose a sales employee" : "Loading…"}</option>
                {(people ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
          )}
          {to && (
            <div className="rounded-xl border border-slate-200 p-3" data-testid="perf-give-preview">
              {!preview ? <Skeleton className="h-20" /> : "error" in preview ? (
                <Banner tone="red" icon="✕" testId="perf-give-preview-error">{preview.error}</Banner>
              ) : (
                <table className="w-full text-[15px] tabular-nums">
                  <tbody>
                    <tr><td className="py-1 text-slate-600">From</td><td className="py-1 text-right" data-testid="perf-give-from">
                      {Object.entries(preview.from).map(([id, c]) => `${id === "none" ? "No owner" : ownerName(id)} (${c})`).join(", ") || "–"}</td></tr>
                    <tr><td className="py-1 text-slate-600">To</td><td className="py-1 text-right">{toName}</td></tr>
                    <tr className="font-bold"><td className="py-1">Will move</td><td className="py-1 text-right" data-testid="perf-give-will-move">{preview.will_move.toLocaleString("en-IN")}</td></tr>
                    <tr><td className="py-1 text-slate-600">Positive leads</td><td className="py-1 text-right" data-testid="perf-give-positive">
                      {incPos ? `${preview.positive_included} included` : `${preview.positive_excluded} left out`}</td></tr>
                  </tbody>
                </table>
              )}
              {p && <Breakdown items={Object.fromEntries(Object.entries(p.skipped).filter(([k]) => k !== "positive lead (excluded)"))} testId="perf-give-skips" />}
              {p?.receiver_problem && <Banner tone="red" icon="✕" testId="perf-give-receiver">Can&apos;t give to {toName}: {p.receiver_problem}.</Banner>}
            </div>
          )}
          <label className="flex min-h-11 items-center gap-3 text-[15px] text-slate-800">
            <input type="checkbox" className="h-5 w-5 accent-blue-700" checked={incPos} onChange={(e) => setIncPos(e.target.checked)} data-testid="perf-give-incpos" />
            Include positive leads (follow-up, visit, booking, connected, converted)
          </label>
          <Banner tone="amber" icon="▲" testId="perf-give-warning">
            This is a deliberate admin decision. Leads move now. Positive leads keep their stage and get 14 days of protection; others start again as New.
            The employee sees only “Given by admin”. Your reason and label stay admin-only.
          </Banner>
          <label className="flex flex-col gap-1 text-[13px] font-semibold text-slate-700">
            Reason (admin only, at least {MIN_REASON} characters)
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} className={`${INPUT} py-2`} data-testid="perf-give-reason" />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-semibold text-slate-700">
            Label (admin only, optional)
            <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} className={INPUT} data-testid="perf-give-label" />
          </label>
          <div className="flex gap-2">
            <button type="button" className={`${BTN} flex-1`} onClick={onClose}>Cancel</button>
            <button type="button" disabled={!canGo} className={`${PRIMARY} flex-1`} data-testid="perf-give-confirm"
              onClick={async () => {
                setRun({ busy: true, done: 0, result: null });
                const result = await applyGive(items, to, mode, reason.trim(), label.trim(), incPos, runKey.current, (done) => setRun((r) => ({ ...r, done })));
                setRun({ busy: false, done: result.done, result });
              }}>
              {run.busy ? `Moving ${run.done} of ${items.length}…` : `Give ${p ? p.will_move.toLocaleString("en-IN") : ""} leads`.replace("  ", " ")}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

// One lead's journey: assignments in order, with the admin batches that moved it (when the give controls are on).
export function JourneySheet({ leadId, leadName, withBatches, onClose }: { leadId: string; leadName: string; withBatches: boolean; onClose: () => void }) {
  const [data, setData] = useState<{ stints: JourneyStint[]; batches: LeadBatch[] } | { error: string } | null>(null);
  useEffect(() => {
    let alive = true;
    void Promise.all([loadJourney(leadId), withBatches ? loadLeadBatches(leadId) : Promise.resolve([] as LeadBatch[])]).then(([j, b]) => {
      if (alive) setData("error" in j ? j : { stints: j.stints, batches: b });
    });
    return () => { alive = false; };
  }, [leadId, withBatches]);
  return (
    <Sheet title={`Journey · ${leadName}`} sub="Admin only" onClose={onClose} testId="perf-journey">
      {!data ? <Skeleton className="h-32" /> : "error" in data ? <Banner tone="amber" icon="▲" testId="perf-journey-error">{data.error}</Banner> : (
        <ol className="relative ml-2 border-l-2 border-slate-200 pl-4" data-testid="perf-journey-list">
          {data.stints.map((s, i) => {
            const by = data.batches.filter((b) => b.status === "moved" && b.new_stint_id === s.stint_id);
            const res = s.result ?? "NO_RESULT";
            const t = statusTone(res);
            return (
              <li key={s.stint_id} className="space-y-2 pb-3">
                {by.map((b) => (
                  <div key={b.batch_id} className="relative rounded-xl bg-amber-50 p-2 text-[13px] text-amber-900" data-testid="perf-journey-admin">
                    <span aria-hidden className="absolute -left-[23px] top-3 h-3 w-3 rounded-full border-2 border-amber-600 bg-amber-50" />
                    <b>{b.mode === "undo" ? "Undone by admin" : b.mode === "give_back" ? "Given back by admin" : "Given by admin"} to {b.to_name ?? "–"}</b> · {dayText(b.at)}
                    {b.label ? ` · “${b.label}”` : ""}<br />Reason: {b.reason}
                  </div>
                ))}
                <div className="relative" data-testid="perf-journey-stint">
                  <span aria-hidden className="absolute -left-[23px] top-1.5 h-3 w-3 rounded-full border-2 border-blue-700 bg-white" />
                  <p className="text-[15px] text-slate-900"><b>{i + 1}. {s.employee_name ?? s.employee_id.slice(0, 8)}</b> · {originWord(s.origin)}</p>
                  <p className="text-[13px] text-slate-600">{dayText(s.assigned_at)} – {s.ended_at ? dayText(s.ended_at) : "now"}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Pill tone={t.tone} icon={t.icon}>{statusWord(res)}</Pill>
                    {s.connected && res !== "CONNECTED" && <Pill tone="green" icon="✓">Connected</Pill>}
                    {s.followup && <Pill tone="blue" icon="◆">Follow-up</Pill>}
                    {s.visit && <Pill tone="blue" icon="◆">Visit</Pill>}
                    {s.converted && res !== "CONVERTED" && <Pill tone="green" icon="✓">Converted</Pill>}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Sheet>
  );
}

// "Given by admin" batches in the report's date range, newest first; tap one for before / after and undo.
export function BatchesSection({ from, to, refreshKey, onChanged }: { from: string; to: string; refreshKey: number; onChanged: () => void }) {
  const [loaded, setRows] = useState<{ key: string; rows: BatchRow[] | "error" } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const key = `${from}|${to}|${refreshKey}`;
  useEffect(() => {
    let alive = true;
    void loadBatches(from, to).then((b) => { if (alive) setRows({ key: `${from}|${to}|${refreshKey}`, rows: b ?? "error" }); });
    return () => { alive = false; };
  }, [from, to, refreshKey]);
  const rows = loaded && loaded.key === key ? loaded.rows : null;
  return (
    <section className={CARD} aria-labelledby="perf-batches-h" data-testid="perf-batches">
      <h2 id="perf-batches-h" className="text-base font-semibold text-slate-900">Given by admin (batches)</h2>
      <p className="text-[13px] text-slate-600">Admin only. Tap a batch to see what happened before and after.</p>
      {rows === null ? <Skeleton className="mt-2 h-16" /> : rows === "error" ? (
        <p className="mt-2 text-[15px] text-slate-700">Couldn&apos;t load the batches.</p>
      ) : rows.length === 0 ? (
        <p className="mt-2 text-[15px] text-slate-700" data-testid="perf-batches-empty">No leads were given from the report in these dates.</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100">
          {rows.map((b) => (
            <li key={b.batch_id}>
              <button type="button" onClick={() => setOpen(b.batch_id)} data-testid="perf-batch-row"
                className={`flex min-h-11 w-full flex-wrap items-center justify-between gap-2 py-2 text-left ${FOCUS}`}>
                <span className="min-w-0">
                  <b className="text-[15px] text-slate-900">{b.label ?? (b.mode === "undo" ? "Undo" : "No label")}</b>
                  <span className="block text-[13px] text-slate-600">{dayText(b.created_at)} · {b.mode === "give_back" ? "Given back" : b.mode === "undo" ? "Undo" : "Given"} to {b.to_name ?? "–"} · {b.moved} moved, {b.skipped} skipped</span>
                </span>
                {b.undone_by && <Pill tone="mute" icon="↺">Undone</Pill>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <BatchSheet batchId={open} onClose={() => setOpen(null)} onChanged={onChanged} />}
    </section>
  );
}

function BatchSheet({ batchId, onClose, onChanged }: { batchId: string; onClose: () => void; onChanged: () => void }) {
  const [o, setO] = useState<Outcome | null | "error">(null);
  const [undo, setUndo] = useState<{ open: boolean; reason: string; busy: boolean; msg: string | null }>({ open: false, reason: "", busy: false, msg: null });
  const undoKey = useRef(newKey());
  useEffect(() => {
    let alive = true;
    void loadOutcome(batchId).then((x) => { if (alive) setO(x ?? "error"); });
    return () => { alive = false; };
  }, [batchId]);
  const cols = useMemo(() => [["leads", "Leads"], ["followup", "Follow-ups"], ["visit", "Visits"], ["connected", "Connected"], ["converted", "Converted"], ["no_result", "No result"]] as const, []);
  if (o === null) return <Sheet title="Batch" onClose={onClose} testId="perf-batch"><Skeleton className="h-32" /></Sheet>;
  if (o === "error") return <Sheet title="Batch" onClose={onClose} testId="perf-batch"><p className="text-[15px]">Couldn&apos;t load this batch.</p></Sheet>;
  const b = o.batch;
  const fromNames = (b.from_names ?? []).join(", ") || "–";
  return (
    <Sheet title={`Batch · ${b.label ?? b.batch_id.slice(0, 8)}`} sub={`${dayText(b.created_at)} · admin only`} onClose={onClose} testId="perf-batch" wide>
      <p className="text-[13px] text-slate-600">{b.moved} moved from {fromNames} to {b.to_name ?? "–"} · {b.skipped} skipped · reason: {b.reason}</p>
      <Breakdown items={b.skipped_breakdown ?? {}} testId="perf-batch-skips" />
      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-[15px] tabular-nums" data-testid="perf-batch-table">
          <thead><tr className="border-b border-slate-200 text-[13px] text-slate-600"><th className="px-2 py-2 text-left">Who</th>{cols.map(([k, l]) => <th key={k} className="px-2 py-2 text-right">{l}</th>)}</tr></thead>
          <tbody>
            {([["Before", fromNames, o.before], ["After", b.to_name ?? "–", o.after]] as const).map(([w, name, side]) => (
              <tr key={w} className="border-b border-slate-100">
                <td className="whitespace-nowrap px-2 py-2 text-left">{w} · {name}</td>
                {cols.map(([k]) => <td key={k} className="px-2 py-2 text-right">{Number(side?.[k] ?? 0)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-[15px] text-emerald-900" data-testid="perf-batch-line">
        With {fromNames}: {o.before.followup} follow-ups, {o.before.visit} visits, {o.before.connected} connected, {o.before.converted} converted.
        {" "}Given to {b.to_name ?? "–"}: {o.after.followup} follow-ups, {o.after.visit} visits, {o.after.connected} connected, {o.after.converted} converted.
      </p>
      {b.mode !== "undo" && !b.undone_by && (
        <div className="mt-3 space-y-2">
          {!undo.open ? (
            <button type="button" className={`${BTN} w-full`} onClick={() => setUndo((u) => ({ ...u, open: true }))} data-testid="perf-batch-undo">Undo this batch…</button>
          ) : undo.msg ? (
            <Banner tone="green" icon="✓" testId="perf-batch-undo-result">{undo.msg}</Banner>
          ) : (
            <>
              <Banner tone="amber" icon="▲" testId="perf-batch-undo-warning">Only leads nobody has worked on since the batch go back to their previous owner. The rest stay, with a reason.</Banner>
              <textarea value={undo.reason} onChange={(e) => setUndo((u) => ({ ...u, reason: e.target.value }))} rows={2} maxLength={300} placeholder="Reason (admin only)"
                aria-label="Undo reason" className={`${INPUT} py-2`} data-testid="perf-batch-undo-reason" />
              <button type="button" className={`${PRIMARY} w-full`} disabled={undo.busy || undo.reason.trim().length < MIN_REASON} data-testid="perf-batch-undo-confirm"
                onClick={async () => {
                  setUndo((u) => ({ ...u, busy: true }));
                  const r = await undoBatch(b.batch_id, undo.reason.trim(), undoKey.current);
                  const skips = Object.entries(r.data?.skipped_breakdown ?? {}).map(([k, v]) => `${v} ${k}`).join("; ");
                  setUndo((u) => ({ ...u, busy: false, msg: r.error ? `Couldn't undo: ${r.error}` : `${r.data?.moved ?? 0} given back, ${r.data?.skipped ?? 0} stayed${skips ? ` (${skips})` : ""}.` }));
                  if (!r.error) onChanged();
                }}>
                {undo.busy ? "Undoing…" : "Undo batch"}
              </button>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}
