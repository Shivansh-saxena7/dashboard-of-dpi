"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  CallQualityDetails,
  CallQualityFlag,
  CallQualityRow,
  CallQualitySummary,
  FLAG_CHIPS,
  flagExample,
  flagMetaFor,
  isCallQualityHidden,
  isCallQualityMissing,
  istDayKey,
  longDate
} from "@/lib/callQuality";
import { Collapsible, HowCalculated, ScoreLight, StatusNotes, Timeline } from "@/components/CallQualityParts";

// Employee's own Call Quality panel on /report (2026-10-28; plain-language rewrite 2026-10-29).
// Written for non-technical readers on a phone: short words, big text, no jargon. Only ever the
// signed-in employee's own data — the RPCs refuse anyone else's id, and refuse entirely while
// Admin has switched call_quality_visible_to_employees off (the panel then simply hides).
const INTRO_KEY = "callQualityIntroSeen";

const INTRO_STEPS = [
  { title: "1. Dial from the CRM", text: "Tap the Call button in the CRM. The CRM notes the time." },
  { title: "2. Save the result", text: "After the call, save what happened. The lead opens for you when you come back." },
  { title: "3. Talked another way?", text: 'Customer called you, another phone, or a WhatsApp call? Pick it under "How did you talk?".' },
  { title: "4. Check your day", text: 'See every dial in "My day". Green means good.' }
];

function dayOf(row: CallQualityRow): string {
  return new Date(new Date(row.at).getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default function MyCallQuality({ employeeId }: { employeeId: string }) {
  const [summary, setSummary] = useState<CallQualitySummary | null>(null);
  const [details, setDetails] = useState<CallQualityDetails | null>(null);
  const [hidden, setHidden] = useState(false);
  const [day, setDay] = useState(istDayKey(0));
  const [introStep, setIntroStep] = useState<number | null>(null);

  const from = istDayKey(6);
  const to = istDayKey(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      supabase.rpc("get_call_quality_summary", { p_employee_id: employeeId, p_from: from, p_to: to }),
      supabase.rpc("get_call_quality_details", { p_employee_id: employeeId, p_from: from, p_to: to })
    ]).then(([s, d]) => {
      if (cancelled) return;
      const error = s.error ?? d.error;
      if (error) {
        if (!isCallQualityMissing(error) && !isCallQualityHidden(error)) console.error("call quality failed:", error.message);
        setHidden(true);
        return;
      }
      setSummary(s.data as CallQualitySummary);
      setDetails(d.data as CallQualityDetails);
      setHidden(false);
      try {
        if (!localStorage.getItem(INTRO_KEY)) setIntroStep(0);
      } catch {
        // storage blocked: just skip the intro
      }
    });
    return () => {
      cancelled = true;
    };
  }, [employeeId, from, to]);

  function closeIntro() {
    setIntroStep(null);
    try {
      localStorage.setItem(INTRO_KEY, "1");
    } catch {
      // ignore
    }
  }

  if (hidden || !summary || !details) return null;
  const s = summary.settings;
  const me = summary.employees[0];
  const lead = me?.by_card_type.LEAD;
  const data = me?.by_card_type.DATA;
  const showData = (data?.dial_clicks ?? 0) > 0;
  const showLead = (lead?.dial_clicks ?? 0) > 0 || !showData;

  const rows = details.rows;
  const today = istDayKey(0);
  const dayRows = rows.filter((r) => dayOf(r) === day);
  const flagsPresent = FLAG_CHIPS.map((c) => c.flag).filter((f) => rows.some((r) => r.flags.includes(f)));
  const days = Array.from({ length: 7 }, (_, i) => istDayKey(i));

  return (
    <div className="space-y-3">
      {introStep !== null && (
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
          <p className="text-xs font-semibold text-amber-800 mb-1">New: Call Quality ({introStep + 1} of {INTRO_STEPS.length})</p>
          <p className="text-lg font-bold text-slate-900">{INTRO_STEPS[introStep].title}</p>
          <p className="text-[15px] text-slate-700 mt-1">{INTRO_STEPS[introStep].text}</p>
          <div className="flex gap-2 mt-3">
            <button type="button" onClick={closeIntro} className="h-11 px-4 rounded-xl bg-white border border-slate-200 text-sm font-semibold text-slate-600">Skip</button>
            <button
              type="button"
              onClick={() => (introStep + 1 < INTRO_STEPS.length ? setIntroStep(introStep + 1) : closeIntro())}
              className="flex-1 h-11 rounded-xl bg-slate-900 text-white text-sm font-semibold"
            >
              {introStep + 1 < INTRO_STEPS.length ? "Next" : "Got it"}
            </button>
          </div>
        </div>
      )}

      <div className="rounded-2xl bg-white border border-slate-100 shadow-md p-4 space-y-3">
        <p className="text-lg font-bold text-slate-900">📞 Call Quality</p>
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="text-sm font-bold text-slate-800 mb-1">Why does the CRM show this?</p>
          <p className="text-[15px] text-slate-700">Your manager and you see the same numbers.</p>
          <p className="text-[15px] text-slate-700">They show how many calls were really followed by a saved result.</p>
          <p className="text-[15px] text-slate-700">
            {summary.enforced ? "Your manager uses this score in reviews." : "This is not a punishment; the first week is a learning week."}
          </p>
        </div>
        <StatusNotes estimated={summary.estimated} enforced={summary.enforced} />

        <p className="text-sm font-semibold text-slate-500">Your score, last 7 days</p>
        <div className="space-y-3">
          {showLead && <ScoreLight score={lead?.genuine_score ?? null} settings={s} explain label={showData ? "Lead cards" : undefined} />}
          {showData && <ScoreLight score={data?.genuine_score ?? null} settings={s} explain label="Data cards" />}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Dials" value={me?.totals.dial_clicks ?? 0} />
          <Stat label="Results saved" value={me?.totals.results_saved ?? 0} />
          <Stat label="Connected" value={me?.totals.connected ?? 0} />
        </div>
      </div>

      {flagsPresent.length > 0 && (
        <div className="space-y-2">
          <p className="text-[15px] font-bold text-slate-800 px-1">What needs attention (last 7 days)</p>
          {flagsPresent.map((f) => (
            <FlagCard key={f} flag={f} rows={rows} today={today} details={details} />
          ))}
        </div>
      )}

      <div className="rounded-2xl bg-white border border-slate-100 shadow-md p-4 space-y-3">
        <p className="text-lg font-bold text-slate-900">My day</p>
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
          {days.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDay(d)}
              className={`shrink-0 h-10 px-3 rounded-xl text-sm font-semibold border ${day === d ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200"}`}
            >
              {d === today ? "Today" : longDate(d).split(" ").slice(0, 3).join(" ")}
            </button>
          ))}
        </div>
        <Timeline rows={dayRows} settings={s} />
      </div>

      <div className="space-y-2">
        <p className="text-[15px] font-bold text-slate-800 px-1">Questions</p>
        <Faq q="I called but the call got cut." a="Just tap Call again. A redial never counts against you. Save the result when you are done." />
        <Faq q="The customer called me." a={'Open the lead, pick "Customer called me" under "How did you talk?", and save the result.'} />
        <Faq q="I used another phone." a={'Pick "Called from another phone" under "How did you talk?" when you save the result.'} />
        <Faq q="I forgot to save the result." a={`Open the lead and save it now. It still counts if you save it within ${s.outcome_link_minutes} minutes of the dial.`} />
        <Faq q="Why is my score low?" a={'Look at "What needs attention" above. Each card shows your own example and how to fix it.'} />
        <Faq
          q="Will this affect my salary?"
          a={summary.enforced ? "Your manager uses this score in reviews. Ask your manager if you have any question." : "Learning week: no action. We will tell you before anything changes."}
        />
      </div>

      <div className="px-1">
        <HowCalculated settings={s} />
      </div>
    </div>
  );
}

function FlagCard({ flag, rows, today, details }: { flag: CallQualityFlag; rows: CallQualityRow[]; today: string; details: CallQualityDetails }) {
  const s = details.settings;
  const meta = flagMetaFor(flag, s);
  const withFlag = rows.filter((r) => r.flags.includes(flag));
  const lowers = withFlag.some((r) => r.score_flags.includes(flag));
  const todays = withFlag.filter((r) => dayOf(r) === today);
  const example = (todays.length > 0 ? todays : withFlag)[todays.length > 0 ? 0 : withFlag.length - 1];
  return (
    <Collapsible
      tone={lowers ? "red" : "grey"}
      title={
        <span className="flex items-center gap-2">
          <span className={`inline-block w-2.5 h-2.5 rounded-full ${lowers ? "bg-red-500" : "bg-slate-300"}`} />
          {meta.label} <span className="text-slate-400 font-normal">· {withFlag.length}</span>
        </span>
      }
    >
      <div className="space-y-2 text-[15px]">
        <Line label="What this means" text={meta.what} />
        <Line label="Why we show it" text={meta.why} />
        {example && <Line label={todays.length > 0 ? "Your example today" : "Your latest example"} text={flagExample(flag, example, s)} />}
        <Line label="How to fix" text={meta.fix} />
        {!lowers && <p className="text-sm text-slate-500">This did not lower your score.</p>}
      </div>
    </Collapsible>
  );
}

function Line({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-slate-800">{text}</p>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <Collapsible title={q}>
      <p className="text-[15px] text-slate-700">{a}</p>
    </Collapsible>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-100 p-2 text-center">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="text-2xl font-bold text-slate-800 tabular-nums">{value}</p>
    </div>
  );
}
