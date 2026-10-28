# Call Quality (Phase 1, software only)

Makes the work report show which calls have a believable record. Built 2026-10-28 on `feature/call-quality`.

## What is recorded
- **Dial click**: every tap on a CRM Call button (`contact_click_log`, server time). Same as before.
- **Logged call**: every outcome an employee sets (`lead_activity_log` STATUS_UPDATE). Same as before.
- **New**: when an outcome is logged, `log_lead_update_atomic` links it to that employee's latest Call tap on the
  same lead (within `outcome_link_minutes`, if that tap has no outcome yet) and stores the outcome, its time and
  the gap in seconds on the click row. Server time only; employees cannot write these rows (RLS, no policies).
- Nothing is recorded outside the CRM: no phone call log, no recordings, no personal calls.

`call_count` is unchanged everywhere (recycle, SLA and DataCard attempts depend on it).

## Flags (DB views `call_quality_clicks`, `call_quality_flags`)
| Flag | Rule (default) | Lowers score |
|---|---|---|
| Quick outcome | outcome < 10 s after the tap | yes |
| Click without outcome | nothing logged on the lead (status, board move, note, WhatsApp tap) within 30 min | yes |
| Outcome without click | status with no Call/WhatsApp tap on that lead in the 60 min before | yes |
| Rapid clicks | Call tap < 20 s after the previous Call tap | yes |
| Burst | 8+ Call taps within 5 min | yes |
| Repeat clicks | 4th+ dial of the same lead in a day | yes |
| Outside office hours | outside SLA office hours or on the weekly off | no (context) |
| No shift start | no Shift Start that day | no (context) |
| Redial | same lead dialed again within 30 min with nothing logged in between | no, left out entirely |

**Genuine score** = clean judged calls ÷ (judged calls + outcomes without a click). A call is judged once its
30-min window has passed and it is not a redial. Below `call_quality_min_sample` (10) the score is not shown.
All thresholds are columns on `lead_engine_settings`, editable in Admin → Settings → Call Quality.

Before go-live (`call_quality_live_since`) there are no stored links; the views match outcomes to clicks by time
and every such number is labelled **Estimated**. No old row is updated.

## Where it shows
- Admin → Work Reports: team table (7 / 30 days, Leads / Data split), score, Dial clicks / Logged calls / Connected,
  flag chips, daily trend; a row opens the call-by-call list with times, gap and flags. "How is this calculated?"
- Employee → My Report: own score (Today / 7 days), own flags with exact times, tips. Own data only.
- Work report (both): a strip with Dial clicks / Logged calls / Connected / Genuine score. Old tiles unchanged.
- Back from a call, the lead's detail opens so the outcome can be logged.
- In-app: "You dialed <lead> N minutes ago and have not logged an outcome." (every 5 min, 10:30–20:25 IST,
  once per click, grouped when more than 3) and a day-end summary at 18:45 IST.

## Rollout switches
- `call_quality_visible_to_employees` (default ON): employee panel, work-report strip for employees, nudges and the
  day-end summary. OFF hides all of them; Admin still sees everything.
- `call_quality_enforced` (default OFF): only a label today ("Learning week — the score is not used for evaluation
  yet"). Nothing is blocked by Call Quality in Phase 1.

## Files
- SQL: `supabase/sql/2026-10-28_call_quality.sql` (apply), `_rollback.sql`, `_tests.sql` (35 known answers, dry-run only).
- App: `lib/callQuality.ts`, `lib/logCallClick.ts` (the one owner of the Call-click RPC), `lib/usePendingOutcomeSheet.ts`,
  `components/CallQuality*.tsx`, `components/MyCallQuality.tsx`.
- Build check: `scripts/check-call-quality.js` (in prebuild).

## Safe order
Both halves are backward compatible: the app without the DB part shows "Call Quality is not switched on yet";
the DB part without the new app only adds keys the old app ignores. The one thing to avoid is a working day with
the DB part applied but the old app live (nudges would reach employees without the outcome sheet or the notice).
Recommended: send the notice → deploy the app → apply the SQL after 18:45 IST the same day → next morning it is live.

## Employee notice (send before go-live)

> **Call Quality in the CRM — starting <date>**
>
> From <date>, the CRM shows a Call Quality score next to your work report.
>
> **What the CRM records:** only what you do inside the CRM: when you tap a Call or WhatsApp button, and when you
> log a call outcome or a note. Times come from the server. The CRM does not read your phone's call log, does not
> record calls, and never sees personal calls.
>
> **Why:** so that the work report shows real calling work fairly. Simply tapping Call should not count the same as
> a real call, and genuine effort should be visible.
>
> **What you will see:** on My Report, your score, your Dial clicks, Logged calls and Connected calls, and any flags
> with their exact times. When you come back from a call, the lead opens so you can log the outcome. If you dial and
> do not log anything for 30 minutes, the CRM reminds you.
>
> **The first week is a learning week:** the score is not used for evaluation. Use it to build the habit: dial from
> the CRM, log every outcome right after the call. A dropped call that you redial never counts against you.
>
> Questions? Ask <admin name>.
