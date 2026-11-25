"use client";
// Lead Journey tab of the Performance Report (2026-11-26, definitions v3): per employee, who got a lead first, who
// worked it, who made it positive. Employee summary (Missed by me / Won from others / Assists with % of leads given and
// the team average), the journeys (owners in order), a drill-down on every number, and the Excel file. Admin only
// (page + RPC). English, 44px taps, blue accents, light only. No client name or number anywhere (lead short id only).
import { useMemo, useState } from "react";
import { Banner, BTN, CARD, CHIP, FOCUS, InfoButton, Pill, PRIMARY, Sheet, Skeleton } from "@/components/perfUi";
import {
  COUNT_DEF, COUNT_LABEL, COUNT_VIEW, EFFORT_NOTE, FAIR_NOTE, VIEWS, dayCount, excusedWord, gotByText, hoursText, jPct, lowSample, moveWord,
  originWordJ, outcomeText, resultWord, teamAvg, typeWord, viewLabel,
  type JourneyCountKey, type JourneyEmpRow, type JourneyRow, type JourneyStep
} from "@/lib/perfJourney";
import { downloadJourneyExcel } from "@/lib/perfJourneyExcel";
import type { usePerfJourney } from "@/lib/usePerfJourney";

type Hook = ReturnType<typeof usePerfJourney>;
const COUNTS: JourneyCountKey[] = ["leads", "positive", "missed", "not_counted", "won", "assist"];
const nf = (x: unknown) => (Number(x ?? 0) || 0).toLocaleString("en-IN");

export default function PerfJourney({ j, filterText, nameOf }: { j: Hook; filterText: string; nameOf: (id: string) => string }) {
  const [def, setDef] = useState<string | null>(null);
  const [perEmployee, setPerEmployee] = useState(true);
  const [excel, setExcel] = useState<{ busy: boolean; done: number; total: number; error: boolean }>({ busy: false, done: 0, total: 0, error: false });
  const r = j.data;
  const defs = useMemo(() => Object.fromEntries((r?.definitions ?? []).map((d) => [d.key, d])), [r]);
  const name = (e: JourneyEmpRow) => `${e.name ?? nameOf(e.employee_id)}${e.active === false ? " (inactive)" : ""}`;
  const open = (k: JourneyCountKey, who: JourneyEmpRow | null) => void j.openDrill(COUNT_VIEW[k], who?.employee_id ?? null, `${COUNT_LABEL[k]} · ${who ? name(who) : "Everyone"}`);
  const team = r?.team ?? null;

  const runExcel = async () => {
    if (!r) return;
    setExcel({ busy: true, done: 0, total: r.journeys.total, error: false });
    try {
      const { rows, total } = await j.allRows((done, total) => setExcel((x) => ({ ...x, done, total })));
      await downloadJourneyExcel({ report: r, rows, total, filterText, perEmployee, nameOf }, `lead-journey-${r.from}-to-${r.to}.xlsx`);
      setExcel({ busy: false, done: rows.length, total, error: false });
    } catch {
      setExcel((x) => ({ ...x, busy: false, error: true }));
    }
  };

  if (j.invalid) return null;
  if (j.error)
    return (
      <button type="button" onClick={j.retry} data-testid="lj-retry" className={`min-h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-left text-[15px] font-medium text-slate-700 ${FOCUS}`}>
        Couldn&apos;t load the lead journey. Tap to try again.
      </button>
    );
  if (!r) return <div className="space-y-3" data-testid="lj-loading">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>;

  return (
    <div data-testid="lj" className={`space-y-4 transition-opacity motion-reduce:transition-none ${j.loading ? "opacity-60" : ""}`} aria-busy={j.loading}>
      <Banner tone="blue" icon="◆" testId="lj-fair">
        <b>{FAIR_NOTE}</b> Compare each person with the team average; fresh and recycled leads can be looked at apart with the filters; grey rows have fewer than 20 leads. {EFFORT_NOTE}
      </Banner>

      <section className={`${CARD} flex flex-wrap items-center justify-between gap-3`} aria-label="Excel" data-testid="lj-excel">
        <p className="text-[13px] text-slate-600">Excel: Summary, Journeys and Definitions, with the filters above. Prints landscape, fit to width, with page numbers.</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className={`flex min-h-11 items-center gap-2 rounded-xl px-2 text-[15px] text-slate-800 ${FOCUS}`}>
            <input type="checkbox" className="h-5 w-5 accent-blue-700" checked={perEmployee} onChange={(e) => setPerEmployee(e.target.checked)} data-testid="lj-per-employee" />
            One sheet per employee
          </label>
          <button type="button" className={PRIMARY} onClick={runExcel} disabled={excel.busy || r.journeys.total === 0} data-testid="lj-excel-btn" aria-busy={excel.busy}>
            {excel.busy ? `Preparing… ${nf(excel.done)} / ${nf(excel.total)}` : "Download Excel"}
          </button>
        </div>
        {excel.error && <Banner tone="red" icon="!" testId="lj-excel-error">The Excel file could not be made. Please try again.</Banner>}
      </section>

      {r.journeys.total === 0 && r.by_employee.length === 0 ? (
        <p data-testid="lj-empty" className={`${CARD} text-[15px] text-slate-700`}>No leads were given in this range with these filters.</p>
      ) : (
        <>
          <section aria-label="Totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="lj-tiles">
            {([["leads", team?.distinct_leads ?? team?.leads, "different leads"], ["missed", team?.missed, `${teamAvg(team)} of leads given`],
              ["won", team?.won, `${teamAvg(team, "won")} of leads given`], ["assist", team?.assist, `${teamAvg(team, "assist")} of leads given`]] as [JourneyCountKey, unknown, string][]).map(([k, v, sub]) => (
              <div key={k} className={`${CARD} flex items-start justify-between gap-1 p-3`}>
                <button type="button" onClick={() => open(k, null)} data-testid={`lj-tile-${k}`} className={`min-h-11 min-w-0 flex-1 text-left ${FOCUS}`}>
                  <span className="block text-[13px] font-semibold text-slate-600">{COUNT_LABEL[k]}</span>
                  <span className="block text-[22px] font-bold tabular-nums text-slate-900">{nf(v)}</span>
                  <span className="block text-[13px] text-slate-600">{sub}</span>
                </button>
                <InfoButton label={COUNT_LABEL[k]} onClick={() => setDef(COUNT_DEF[k])} />
              </div>
            ))}
          </section>

          <section className={CARD} aria-labelledby="lj-emp-h" data-testid="lj-summary">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="lj-emp-h" className="text-base font-semibold text-slate-900">Employee summary</h2>
              <span className="flex items-center text-[13px] text-slate-600">Tap a number to see the leads<InfoButton label="% of leads given" onClick={() => setDef("journey_pct")} /></span>
            </div>
            <div className="mt-2 hidden overflow-x-auto lg:block">
              <table className="w-full border-collapse text-[14px] tabular-nums" data-testid="lj-table">
                <thead>
                  <tr className="text-[13px] text-slate-600">
                    <th colSpan={9} aria-hidden />
                    <th colSpan={4} className="rounded-t-lg bg-slate-50 px-1 pt-2 text-center font-bold text-slate-700" data-testid="lj-pct-head">% of leads given</th>
                  </tr>
                  <tr className="border-b border-slate-200 text-[13px] text-slate-600">
                    <th className="px-1 py-2 text-left font-bold">Employee</th>
                    {COUNTS.map((k) => <th key={k} className="px-1 py-2 text-right font-bold">{COUNT_LABEL[k]}</th>)}
                    <th className="px-1 py-2 text-right font-bold">Calls / lead <span className="font-normal">(approx)</span></th>
                    <th className="px-1 py-2 text-right font-bold">First action <span className="font-normal">(approx)</span></th>
                    <th className="bg-slate-50 px-1 py-2 text-right font-bold">Missed</th>
                    <th className="bg-slate-50 px-1 py-2 text-right font-bold" data-testid="lj-team-avg-head">Team avg</th>
                    <th className="bg-slate-50 px-1 py-2 text-right font-bold">Won</th>
                    <th className="bg-slate-50 px-1 py-2 text-right font-bold">Assist</th>
                  </tr>
                </thead>
                <tbody>
                  {r.by_employee.map((e) => {
                    const low = lowSample(e);
                    return (
                      <tr key={e.employee_id} className={`border-b border-slate-100 ${low ? "text-slate-500" : ""}`} data-testid={`lj-row-${e.employee_id}`} data-low={low ? "1" : "0"}>
                        <td className="min-w-[120px] px-1 py-1 text-left font-semibold leading-tight">{name(e)}{low && <span className="ml-1"><Pill tone="mute" icon="–">Low sample</Pill></span>}</td>
                        {COUNTS.map((k) => (
                          <td key={k} className="px-0 py-1 text-right">
                            <button type="button" data-testid={`lj-cell-${e.employee_id}-${k}`} onClick={() => open(k, e)} className={`min-h-11 min-w-11 rounded-lg px-1 text-right hover:text-blue-700 hover:underline ${FOCUS}`}>{nf(e[k])}</button>
                          </td>
                        ))}
                        <td className="px-1 py-1 text-right">{e.calls_avg == null ? "–" : Number(e.calls_avg).toFixed(1)}</td>
                        <td className="px-1 py-1 text-right">{hoursText(e.first_action_h)}</td>
                        <td className="bg-slate-50 px-1 py-1 text-right text-[13px]" data-testid={`lj-pct-${e.employee_id}-missed`}>{jPct(e.missed, e.leads)}</td>
                        <td className="bg-slate-50 px-1 py-1 text-right text-[13px] text-slate-600">{teamAvg(team)}</td>
                        <td className="bg-slate-50 px-1 py-1 text-right text-[13px]">{jPct(e.won, e.leads)}</td>
                        <td className="bg-slate-50 px-1 py-1 text-right text-[13px]">{jPct(e.assist, e.leads)}</td>
                      </tr>
                    );
                  })}
                  {team && (
                    <tr className="font-bold" data-testid="lj-team">
                      <td className="px-1 py-2.5 text-left leading-tight">Team (rows added)</td>
                      {COUNTS.map((k) => (
                        <td key={k} className="px-0 py-1 text-right">
                          <button type="button" onClick={() => open(k, null)} className={`min-h-11 min-w-11 rounded-lg px-1 text-right hover:text-blue-700 hover:underline ${FOCUS}`}>{nf(team[k])}</button>
                        </td>
                      ))}
                      <td className="px-1 py-2.5 text-right">{team.calls_avg == null ? "–" : Number(team.calls_avg).toFixed(1)}</td>
                      <td className="px-1 py-2.5 text-right">{hoursText(team.first_action_h)}</td>
                      <td className="bg-slate-50 px-1 py-2.5 text-right text-[13px]">{teamAvg(team)}</td>
                      <td className="bg-slate-50 px-1 py-2.5 text-right text-[13px]">{teamAvg(team)}</td>
                      <td className="bg-slate-50 px-1 py-2.5 text-right text-[13px]">{teamAvg(team, "won")}</td>
                      <td className="bg-slate-50 px-1 py-2.5 text-right text-[13px]">{teamAvg(team, "assist")}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-3 space-y-2 lg:hidden" data-testid="lj-cards">
              {r.by_employee.map((e) => {
                const low = lowSample(e);
                return (
                  <div key={e.employee_id} className={`rounded-xl border border-slate-200 p-3 ${low ? "bg-slate-50 text-slate-500" : ""}`} data-testid={`lj-card-${e.employee_id}`} data-low={low ? "1" : "0"}>
                    <div className="flex items-baseline justify-between gap-2">
                      <b className="min-w-0 truncate text-[15px] text-slate-900">{name(e)}</b>
                      {low ? <Pill tone="mute" icon="–">Low sample</Pill> : (
                        <button type="button" onClick={() => open("leads", e)} className={`min-h-11 flex-none text-[13px] font-semibold text-slate-700 ${FOCUS}`}>{nf(e.leads)} leads given</button>
                      )}
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-2">
                      {(["missed", "won", "assist", "not_counted"] as JourneyCountKey[]).map((k) => (
                        <button key={k} type="button" onClick={() => open(k, e)} data-testid={`lj-card-cell-${e.employee_id}-${k}`} className={`min-h-11 rounded-lg bg-white p-2 text-left ring-1 ring-slate-100 ${FOCUS}`}>
                          <span className="block text-[13px] text-slate-600">{COUNT_LABEL[k]}</span>
                          <span className="block text-[15px] font-bold tabular-nums text-slate-900">{nf(e[k])}{k !== "not_counted" && <> <span className="text-[13px] font-normal text-slate-600">{jPct(e[k], e.leads)}</span></>}</span>
                        </button>
                      ))}
                    </div>
                    <p className="mt-1 text-[13px] text-slate-600">Team avg missed {teamAvg(team)} · calls / lead {e.calls_avg == null ? "–" : Number(e.calls_avg).toFixed(1)} (approx)</p>
                  </div>
                );
              })}
            </div>
          </section>

          <section className={CARD} aria-labelledby="lj-jr-h" data-testid="lj-journeys">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="lj-jr-h" className="text-base font-semibold text-slate-900">Lead journeys</h2>
              <span className="text-[13px] text-slate-600">Latest {nf(r.journeys.rows.length)} of {nf(r.journeys.total)} · owners in order</span>
            </div>
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Show">
              {VIEWS.filter((v) => v.v !== "all").map((v) => (
                <button key={v.v} type="button" className={CHIP(false)} data-testid={`lj-view-${v.v}`} onClick={() => void j.openDrill(v.v, null, `${v.l} · Everyone`)}>{v.l}</button>
              ))}
            </div>
            <JourneyList rows={r.journeys.rows} />
          </section>
        </>
      )}

      {j.drill && (
        <Sheet title={j.drill.title} sub={filterText} onClose={j.closeDrill} testId="lj-drill" wide>
          {j.drill.error ? (
            <button type="button" className={BTN} onClick={() => void j.openDrill(j.drill!.view, j.drill!.employee, j.drill!.title)}>Couldn&apos;t load. Try again</button>
          ) : !j.drill.page ? (
            <Skeleton className="h-24" />
          ) : (
            <>
              <p className="text-[13px] text-slate-600" data-testid="lj-drill-total">{nf(j.drill.page.total)} lead{j.drill.page.total === 1 ? "" : "s"} · {viewLabel(j.drill.view)}</p>
              <JourneyList rows={j.drill.page.rows} stacked />
              {j.drill.page.rows.length < j.drill.page.total && (
                <button type="button" className={`${BTN} mt-3 w-full`} disabled={j.drill.loading} data-testid="lj-drill-more"
                  onClick={() => void j.openDrill(j.drill!.view, j.drill!.employee, j.drill!.title, true)}>
                  {j.drill.loading ? "Loading…" : `Show more (${nf(j.drill.page.total - j.drill.page.rows.length)} left)`}
                </button>
              )}
            </>
          )}
        </Sheet>
      )}
      {def && (
        <Sheet title={defs[def]?.label ?? "Definition"} sub={`Definitions v${r.def_version}`} onClose={() => setDef(null)} testId="lj-def">
          <p className="text-[15px] text-slate-800">{defs[def]?.rule ?? "—"}</p>
          <p className="mt-3 text-[13px] text-slate-600">{FAIR_NOTE} System moves alone never count against anyone.</p>
        </Sheet>
      )}
    </div>
  );
}

function Step({ s }: { s: JourneyStep }) {
  const tone = s.positive ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-slate-200 bg-white text-slate-800";
  return (
    <span className={`inline-flex flex-col rounded-lg border px-2 py-1 text-[13px] leading-tight ${tone}`} data-testid="lj-step">
      <b className="truncate">{s.name ?? s.employee_id.slice(0, 8)}</b>
      <span>{resultWord(s.result)} · {s.calls} call{s.calls === 1 ? "" : "s"} · {dayCount(s.days)}</span>
      <span className="text-slate-600">{originWordJ(s.origin)}{s.ended_at ? ` → ${moveWord(s.move)}` : ""}{excusedWord(s.excused) ? ` · ${excusedWord(s.excused)}` : ""}</span>
      {(s.missed || s.won || s.assist) && s.in_range && (
        <span className="font-semibold">{s.missed ? "Missed by me" : s.won ? "Won from others" : "Assist"}</span>
      )}
    </span>
  );
}

// Journeys: a table on wide screens, cards (steps wrap, no side scroll) on small screens and in the drill-down sheet.
function JourneyList({ rows, stacked = false }: { rows: JourneyRow[]; stacked?: boolean }) {
  if (!rows.length) return <p className="mt-2 text-[15px] text-slate-700" data-testid="lj-none">No leads here.</p>;
  return (
    <>
      {!stacked && (
        <div className="mt-2 hidden overflow-x-auto lg:block">
          <table className="w-full border-collapse text-[13px]" data-testid="lj-jtable">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                {["Lead", "Source", "Lead / Data", "Owner 1", "Owner 2", "Owner 3", "More", "Final outcome", "Got it"].map((h) => <th key={h} className="px-1 py-2 text-left font-bold">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.lead_id} className="border-b border-slate-100 align-top" data-testid={`lj-jrow-${r.lead_short}`}>
                  <td className="px-1 py-2 font-mono">{r.lead_short}</td>
                  <td className="px-1 py-2">{r.source ?? "–"}</td>
                  <td className="px-1 py-2">{typeWord(r.lead_type)}</td>
                  {[0, 1, 2].map((i) => <td key={i} className="px-1 py-2">{r.steps[i] ? <Step s={r.steps[i]} /> : "–"}</td>)}
                  <td className="px-1 py-2">{r.owners > 3 ? `+${r.owners - 3}` : ""}</td>
                  <td className="px-1 py-2">{outcomeText(r)}</td>
                  <td className="px-1 py-2 font-semibold">{gotByText(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ul className={`mt-2 space-y-2 ${stacked ? "" : "lg:hidden"}`} data-testid="lj-jcards">
        {rows.map((r) => (
          <li key={r.lead_id} className="rounded-xl border border-slate-200 p-3" data-testid={`lj-jcard-${r.lead_short}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-1 text-[13px]">
              <span className="font-mono font-semibold text-slate-900">{r.lead_short}</span>
              <span className="text-slate-600">{r.source ?? "–"} · {typeWord(r.lead_type)}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {r.steps.map((s, i) => (
                <span key={s.seq} className="flex min-w-0 max-w-full items-center gap-1">
                  {i > 0 && <span aria-hidden className="text-slate-400">→</span>}
                  <Step s={s} />
                </span>
              ))}
              {r.owners > r.steps.length && <span className="text-[13px] text-slate-600">+{r.owners - r.steps.length} more</span>}
            </div>
            <p className="mt-1 text-[13px] text-slate-700">Now: {outcomeText(r)} · Got it: <b>{gotByText(r)}</b></p>
          </li>
        ))}
      </ul>
    </>
  );
}
