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

## Flags (rules of 2026-10-29; DB functions `call_quality_click_rows` / `call_quality_outcome_rows`)
One plain name for employees and admins alike.
| Name (code) | Rule (default) | Lowers score |
|---|---|---|
| No result saved (NO_RESULT) | no status / follow-up move / note / WhatsApp tap on the lead within 60 min (reminder at 30 min) | yes |
| Result saved too fast (TOO_FAST) | Connected/Converted < 25 s after the tap | yes |
| | Not interested < 10 s; any other status < 3 s | no (context) |
| Many dials in a row (MANY_DIALS) | tap < 20 s after a tap that had no result yet, or 8+ taps in 5 min (Data cards 12+) with < 50% of them saved | yes |
| Result without a dial (NO_DIAL) | status with no Call/WhatsApp tap in the 60 min before; "Customer called me / Called from another phone / WhatsApp call" never count | only on a day where it is 20%+ of that day's results |
| Same lead dialed many times (REPEAT_DIALS) | 4th+ dial of one lead in a day | no |
| Outside office hours / No shift start | as named | no |
| Dialed again (REDIAL) | same lead dialed again within 60 min, nothing saved between | left out entirely |

**Score** = clean dials ÷ (counted dials + "result without a dial" on pattern days). Leads and Data cards are scored
separately. Fewer than 30 dials in the period → "Not enough data yet". Green 80+, Amber 60–79, Red below 60.
**"How did you talk?"** chip on the outcome sheet saves `lead_activity_log.contact_method` (server time = the row's
`created_at`). Admin sees an info note when "Customer called me"/"another phone" is 20%+ of an employee's results.
All thresholds are columns on `lead_engine_settings`, editable in Admin → Settings → Call Quality.

## Where it shows
- Admin → Work Reports: team table (7 / 30 days): Leads score, Data score, Dials, Results saved, Connected, flag chips,
  info notes, daily trend. A row opens that employee's day, dial by dial, with the reason for every flag, and
  "Open dispute view" → `/admin/work-reports/dispute?employee=…&date=…` (printable).
- Employee → My Report: first-time 4-step intro, "Why does the CRM show this?", traffic-light score (7 days),
  "What needs attention" cards (what / why / your example / how to fix), "My day" (any of the last 7 days), FAQ.
- Work report strip (both) and one extra WhatsApp line "Dials 20 | Results saved 18 | Score 90 (Green)" (setting).
- Back from a call, the lead's detail opens; reminder after 30 min; day-end summary 18:45 IST.

## Rollout switches
- `call_quality_visible_to_employees` (default ON): employee panel, work-report strip for employees, nudges and the
  day-end summary. OFF hides all of them; Admin still sees everything.
- `call_quality_share_line` (default ON): the extra WhatsApp line.
- `call_quality_enforced` (default OFF): only a label today ("Learning week — the score is not used for evaluation
  yet"). Nothing is blocked by Call Quality in Phase 1.

## Files
- SQL: `supabase/sql/2026-10-28_call_quality.sql` (apply), `_rollback.sql`, `_tests.sql` (47 known answers, dry-run only).
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
> do not save anything for 30 minutes, the CRM reminds you. If the customer called you or you used another phone,
> pick that under "How did you talk?" when you save the result.
>
> **The first week is a learning week:** the score is not used for evaluation. Use it to build the habit: dial from
> the CRM, log every outcome right after the call. A dropped call that you redial never counts against you.
>
> Questions? Ask <admin name>.
