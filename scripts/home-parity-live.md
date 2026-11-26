# Employee Home: live parity check for the pilot (read-only)

Compares, for one or more real employees, the numbers the new Home shows with what `/leads` and `/data` show for the
same rows. Read-only from start to end: it only runs a `select`, and prints counts with the employee's 8-character id
(no names, no phone numbers).

## Run

1. Copy `scripts/home-parity-live.sql` to a scratch folder and put the pilot employee id prefixes (8 characters) in
   `array['xxxxxxxx']`, e.g. `array['27c38b3a']` (several are fine).
2. Export (read-only role):
   `npx supabase db query --remote --read-only -f <scratch>/home-parity-live.sql > <scratch>/home_live.txt`
3. Compare:
   `node scripts/parity-employee-home.js --live <scratch>/home_live.txt`
4. Delete `<scratch>/home_live.txt` (it holds lead ids).

Exit code 0 and `parity-employee-home: OK` = everything matched. Any difference is printed as a line and the exit code is 1.

## What is compared

| Home | Compared with |
|---|---|
| My leads (Leads / Follow-up / Visit / Booking), New, Recycle tomorrow | main's `/leads` counting (reference copy in the script) |
| Overdue follow-ups | the lead card's "Needs follow-up" / "Going stale" badge (reference copy) |
| Called no result, Missed reminders, Reminders today, Overdue, Visits due, Snooze ends | the `/leads?filter=...` lists (same rows, same reminders read) |
| Start button "N due now / M" | printed (queue rules are covered by the random check) |
| Data (LEAD + DATA employees) | the `/data` list count |
| Leave strip | printed (on leave / grace / coming up / none) |

Not in this check: **Given to you**. `get_given_lead_context` answers only for the logged-in caller, so a read-only
export cannot reproduce it; the Home and `/leads` call the same RPC and the same filter (tested in Playwright).

## When

- Before switching a pilot employee on, and once on the first pilot day (morning and afternoon).
- Run it at least 2 minutes away from a sweep (:00 / :15 / :30 / :45), so leads do not move between the two reads.
- A mismatch means: do not widen the pilot; set `employee_home_mode` back to `off` if the Home shows wrong numbers.
