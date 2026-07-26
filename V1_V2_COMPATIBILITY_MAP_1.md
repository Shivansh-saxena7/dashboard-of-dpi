# V1 → V2 COMPATIBILITY MAP
## DPI Dashboard — What We Have, What We Reuse, What's New

## 🚨 READ THIS FIRST — CRITICAL CONTEXT FOR CLAUDE CODE 🚨

**This codebase is currently running in LIVE PRODUCTION.** Real employees at Divya Padma Infosystem LLP use this application every day, right now, at `dashboard.divyapadma.com`. It is deployed via Vercel, connected to the `main` branch of this GitHub repository, and connected to a live Supabase database with real employee accounts, real posts, and real tracking data.

**Before writing or changing a single line of code, confirm the following:**

1. **You are working on the `dev` branch, never `main`.** Run `git branch` and confirm the active branch is `dev` before making any change. If it is not, stop and switch (`git checkout dev`) before proceeding. `main` auto-deploys to the live site on every push — a mistake there is not theoretical, it breaks a tool real people are using at that moment.
2. **Nothing described in this document as "V1 / existing" may be deleted, renamed, or behaviorally changed** unless the user explicitly asks for that specific change in that specific conversation. Building V2 features is additive by default.
3. **UI/UX must remain visually and behaviorally consistent between V1 and V2.** A user switching from the "Posts" tab to a new "Leads" tab should never feel like they've entered a different application. See Section 2 of `V2_MASTER_BLUEPRINT.md` for the exact design system to follow — colors, fonts, spacing, motion patterns, component shapes. Do not introduce new colors, fonts, or UI patterns without a specific reason tied to a new feature that genuinely needs it.
4. **Backend patterns must remain consistent.** New tables follow the same naming/structure conventions as existing ones. New API routes follow the same server-side-Supabase-client pattern already used in `app/api/data/route.ts`, `app/api/create-employee/route.ts`, etc. New Edge Functions follow the same pattern as `update-tracking-status` and `mark-missed-posts`. Do not introduce a second state-management library, a second styling approach, or a second calculation pattern when an established one already does the job.
5. **When in doubt, ask before assuming.** If a task seems like it would require touching a V1 file in a way not covered by this document, stop and confirm with the user first rather than guessing.

---



---

## 0. The Golden Rule (Learned From the V1 Bug)

In V1, the bug happened because a database trigger and application code both created tracking rows — nobody decided which one "owned" that job. For V2, every new feature must have **one clearly designated owner** for each piece of logic:

| Type of logic | Owner (V1 precedent) | Rule for V2 |
|---|---|---|
| Status/state decisions | `calculateStatus.ts` — one function, everything else calls it | Every new "what state is this thing in" decision (lead status, SLA state, recycle eligibility) gets **one function**, imported everywhere it's needed. Never re-implement the same if/else logic in two components. |
| Data creation (insert) | Was duplicated (bug); now lives only in `app/admin/posts/page.tsx` | Every "create a record" action (new lead import, lead recycling, site visit logging) must have **one code path**. If a database trigger could also do it, pick one — trigger OR app code, never both. |
| Aggregation/math | `calculateStats.ts`, `calculatePerformance.ts` | New aggregations (leaderboard points, funnel percentages, source ROI) go in `lib/`, written once, imported wherever displayed (admin dashboard, employee dashboard, PDF export) — so the number is guaranteed identical everywhere it appears. |
| Realtime subscriptions | `SessionGuard.tsx`, `Header.tsx` (with Strict-Mode double-invoke guard) | Every new realtime feature (booking celebration, hot-lead alerts) reuses the **same guarded-channel pattern** already proven in these two files — copy the pattern, don't invent a new one. |

---

## 1. What V1 Already Gives Us (Reuse As-Is)

These are fully built and don't need to change for V2:

| V1 Asset | What It Does | How V2 Reuses It |
|---|---|---|
| Supabase Auth + `employees` table | Login, role storage, active/inactive flag | Same login system for Lead Manager. No new auth system needed. |
| `role` field on `employees` | Currently `admin` / `employee` | **Needs extension** — see Section 3. |
| `SessionGuard.tsx` realtime pattern | Force-logout on deactivation/role change, Strict-Mode-safe | Copy this exact pattern for: booking celebration alerts, hot-lead alerts, SLA countdown pushes. |
| `Header.tsx` notification bell + realtime | Existing notification infrastructure | Reuse directly — lead assignment, SLA warnings, and booking celebrations can all pipe into the same `notification` table and bell UI, no new notification system needed. |
| `calculateStatus.ts` pattern (single-source-of-truth function) | Decides ASSIGNED/MISSED/PERMANENT/COMPLETED from raw data | **Copy this exact pattern** for `calculateLeadStatus.ts` / `calculateSLAStatus.ts` — one function, used by employee dashboard, admin dashboard, and reports alike. |
| `getUniquePosts.ts` / dedupe-by-Map pattern | Prevents double-counting in stats | Reuse the same dedupe technique for lead lists, so a lead never gets double-counted in a leaderboard the way tracking rows once did. |
| `react-hot-toast` (Toaster in `app/layout.tsx`) | Pop-up messages, already themed | Reuse directly for booking celebration toasts — no new library needed. |
| Framer Motion + Tailwind dark/gold theme | Established visual language | All new UI (Lead Manager, Team Leader dashboard, Project Asset Library) should visually match this — reuse existing color tokens and animation patterns from `login/page.tsx` and `admin/layout.tsx`. |
| `/api/data` pattern (server-side Supabase client, filterable by query params) | Proven pattern for filtered data fetching | Template for new endpoints like `/api/leads` (filter by employee/date/project/source). |
| Supabase Edge Functions (Deno) pattern | `update-tracking-status`, `mark-missed-posts` | Template for new Edge Functions: `assign-lead`, `recycle-stale-leads` (scheduled), `check-sla-breach`. |
| Unique constraint defensive pattern | `tracking_employee_post_unique` | Apply the same defensive-constraint thinking to every new table from day one (see Section 5) — don't wait for a bug to add it this time. |
| `app/admin/employees/page.tsx` + `[id]/page.tsx` | Employee list, individual profile, activate/deactivate | Extend, don't rebuild — add team assignment and RR-eligibility toggles to this existing page. |
| `app/admin/settings/page.tsx` | Make Admin / Remove Admin, credential updates | Extend to include "Make Team Leader" and geofence radius/office coordinates settings. |
| PWA-readiness | Next.js supports this natively | No architecture change needed — just add `manifest.json` + service worker config on top of the existing app. |

**Bottom line: the entire authentication, layout, notification, and calculation-pattern foundation carries over untouched. V2 is additive, not a rebuild.**

---

## 2. What Needs Fixing First (Before V2 Work Starts)

These are V1 issues that must be resolved first, because V2 features will build directly on top of them — building on a shaky foundation would just multiply the existing bugs:

| Issue | Why It Blocks V2 |
|---|---|
| Admin/employee redirect bug (`app/page.tsx`, `app/admin/layout.tsx`) | The new Team Leader role adds a *third* tier to this same redirect logic — must fix the two-tier version first, or the three-tier version inherits the same bug. |
| Redundant parallel code paths (login, mark-done, missed-sweep) | V2 adds several more "does this thing exist in two places" risks (lead assignment, SLA checks). Clean up the existing duplicates first so the pattern doesn't repeat. |
| `/api/permanent-missed` broken field names | If copied as a template for the new SLA-check Edge Function, the same bug gets copied forward. Fix or delete before using as a reference. |
| Website title / favicon | Cosmetic, but should ship before V2 UI work starts so the whole app looks finished together. |
| Header.tsx realtime double-subscribe fix | Must be confirmed fixed and stable before we add 2-3 more realtime channels (booking celebration, hot-lead alerts) — otherwise we're stacking new realtime features on an already-fragile pattern. |

---

## 3. Database Schema — Extend vs. New Tables

### 3.1 Extend Existing Tables

**`employees` table — add these columns:**

| New Column | Purpose |
|---|---|
| `role` (extend allowed values) | Add `"team_leader"` as a third valid value, alongside existing `"admin"` / `"employee"`. Every place in the code that does `role === "admin"` or `role === "employee"` needs to be checked (found in `app/admin/employees/page.tsx` and `app/page.tsx` — see Section 0's redirect note). |
| `rr_eligible` (boolean) | Mirrors the Google Sheet's `RR_Eligible` column — whether this employee participates in round-robin lead assignment. |
| `team_id` | Links employee to a team (nullable — not everyone is on a team). |
| `office_lat`, `office_lng` (or a separate `settings` table) | Geofence center point for shift-start validation. Better as a single admin-configurable setting than per-employee. |

**Note:** `is_active` and `auth_user_id` already exist and work correctly — no change needed, V2 attendance just adds automation on top of what's already there.

### 3.2 New Tables Needed

Following the same lean, purpose-built style as `posts` / `tracking` / `notification`:

| Table | Purpose | Modeled After |
|---|---|---|
| `leads` | Core lead record — name, mobile, email, project, source, current status, priority, current owner (employee_id), created_at | `posts` (source-of-truth record) |
| `lead_history` | Every assignment + outcome, one row per attempt — powers recycling logic and admin audit trail | `tracking` (per-assignment record pattern) — **must get a defensive constraint from day one, e.g. no duplicate active assignment per lead** |
| `lead_outcomes` (or a status enum on `leads`) | NEW / CONNECTED / NOT_CONNECTED / SWITCHED_OFF / NOT_INTERESTED / CONVERTED / JUNK | Small lookup, similar to how `calculateStatus.ts` outputs a fixed set of states |
| `site_visits` | Visit / revisit / booked entries with timestamp and points value | New — funnel + leaderboard depend on this |
| `teams` | Team name, team_leader employee_id | New |
| `team_notes` | Coaching notes, visible only to admin + that team's leader | New — needs RLS (Row Level Security) so employees can never read it |
| `projects` (may already partially exist via `posts.project` references — confirm) | Project master record — name, location, configurations available | Extend or formalize if not already a dedicated table |
| `project_assets` | Files (docs/videos/images), tagged by project + configuration/size + category | New — Supabase Storage + this metadata table |
| `shareable_links` | Generated link token, target asset, expiry timestamp, created_by | New — powers the branded player + expiring links |
| `csv_import_mappings` | Remembers column mapping per source (99Acres/Housing/Meta) so admin doesn't remap every time | New |
| `lead_engine_settings` | Round-robin pointer, last-lead-ID counters — direct equivalent of the Google Sheet's `Settings` tab | New — this is the most direct 1:1 migration from the existing Sheet |
| `attendance` (or extend a `shifts` table) | Shift start/end timestamp, geofence pass/fail, date | New |

**Design principle carried over from `tracking`:** every table that represents "one assignment/attempt" (like `lead_history`, `site_visits`) should get a **unique constraint or check constraint** planned at design time, not added after a bug appears. This is the single biggest lesson from the V1 fix log.

---

## 4. Feature-by-Feature: Reuse Map

| V2 Feature | Reuses From V1 | New Work Required |
|---|---|---|
| Geo-fenced shift start | Auth pattern, `employees.is_active` gate concept | New: browser geolocation API call, distance calculation, `attendance` table, gate check before lead assignment |
| Smart CSV import | `/api/create-employee`-style API route pattern (server-side Supabase client) | New: fuzzy header matching logic, manual mapping UI, `csv_import_mappings` table |
| Lead recycling + SLA timer | `calculateStatus.ts` single-source-of-truth pattern, Edge Function pattern (`mark-missed-posts` is nearly a direct template for a scheduled "check overdue leads" function) | New: `calculateSLAStatus.ts` (new file, same pattern), recycling Edge Function |
| "Always shows New" to employee | `getUniquePosts.ts` dedupe-and-display pattern (show only what's relevant to the viewer) | New: simply don't pass history data to the employee-facing lead card component — admin views get the full `lead_history` join, employee views don't |
| Site Visit → Revisit → Booked funnel + leaderboard | `calculateStats.ts` + `TopPerformers.tsx` / `LowPerformer.tsx` UI pattern | Extend: new `calculateLeadPoints.ts` (same style as `calculatePerformance.ts`), new `SiteVisitLeaderboard.tsx` component modeled on existing `TopPerformers.tsx` |
| Booking celebration | `SessionGuard.tsx` realtime channel pattern + `react-hot-toast` | New: one new realtime channel + confetti animation (Framer Motion, already installed) |
| Team Leader role | `role`-based routing already established in login/admin-layout | New: `team_id` relations, team-scoped queries, `team_notes` table with RLS |
| Project Asset Library + branded player | Supabase Storage (not yet used in V1, but same project/account) | New: storage buckets, `project_assets` table, custom video player component, `shareable_links` with expiry |
| Excel/PDF export | None directly, but `xlsx` skill and `pdf` skill are available for this exact purpose | New: export routes using established skill patterns — this is a fresh build but a well-trodden one |
| Hindi/English toggle | None yet | New: i18n setup — small addition, doesn't touch existing logic |
| PWA | None yet, but Next.js supports natively | New: `manifest.json`, service worker, install prompt — additive, no rebuild |
| Content protection deterrents | None yet | New: watermark overlay component, right-click/devtools deterrents on the video player specifically |

---

## 5. What This Means for Build Order

Given the reuse map above, a sensible build order (grouped by dependency, not by earlier discussion order) is:

**Phase 0 — Fix & Stabilize (before any V2 code)**
1. Fix admin/employee redirect bug
2. Clean up redundant code paths (login/mark-done/missed-sweep)
3. Fix or remove `/api/permanent-missed`
4. Confirm Header.tsx realtime fix is stable
5. Title/favicon polish
6. Deploy V1 to production (Vercel + Hostinger DNS)

**Phase 1 — Foundation for Lead Engine (V2 core)**
1. New tables: `leads`, `lead_history`, `lead_engine_settings`, `teams`
2. Extend `employees` (role values, `rr_eligible`, `team_id`)
3. `calculateSLAStatus.ts` + `calculateLeadPoints.ts` (single-source-of-truth functions, following the `calculateStatus.ts` pattern exactly)
4. Round-robin + Project_Rules-equivalent assignment logic — this is a direct migration of the existing Google Sheet logic into Supabase functions/Edge Functions

**Phase 2 — Attendance Gate**
1. Geofencing + shift start
2. Wire the gate into lead assignment (no shift = no new leads, per your requirement)

**Phase 3 — Employee-Facing Lead Manager**
1. Lead list UI, status updates, notes, call counter
2. "Always New" display logic
3. SLA countdown visual

**Phase 4 — Recycling + Leaderboard**
1. Recycling Edge Function (scheduled, modeled on `mark-missed-posts`)
2. Site Visit → Revisit → Booked tracking
3. Leaderboard UI (Top/Low performer style, extended)
4. Booking celebration realtime + toast + monthly wall

**Phase 5 — Team Leader Role**
1. Team-scoped views, team notes, combined team dashboard

**Phase 6 — Project Asset Library**
1. Storage setup, size-wise structure, branded player, shareable links with expiry, watermarking

**Phase 7 — Reporting**
1. Excel/PDF export, filters, scheduled reports, comparison reports, performance cards

**Phase 8 — Polish**
1. Smart CSV import (can actually move earlier if migrating off Sheets is urgent — flagging this as flexible)
2. Hindi/English toggle
3. PWA setup

> **Note:** Smart CSV import is placed late here only because it depends on `leads`/`lead_engine_settings` existing first — but if getting off Google Sheets quickly is the priority, Phase 1 + a basic version of CSV import (even before recycling/leaderboard are built) could be pulled forward. Worth discussing when we get to actual sprint planning.

---

## 6. Development Workflow Reminder (From Our Earlier Discussion)

All of the above should happen on a separate `dev` branch, ideally against a separate staging Supabase project, following the workflow already agreed:

```
dev branch (new Supabase project, test data)
   ↓ build + test locally (npm run dev, localhost)
   ↓ push to GitHub dev branch → Vercel preview URL → real-world test
   ↓ only after full confidence → merge into main → live for real employees
```

This matters even more for V2 than V1, because V2 touches live business data (real leads, real client contact info) — a mistake here isn't just a UI bug, it could mean a real client's lead getting lost or duplicated.

---

*This document should be read alongside `PROJECT_BIBLE.md` (V1 architecture reference). Together they form the complete picture: what exists, what's changing, and what's being built new.*
