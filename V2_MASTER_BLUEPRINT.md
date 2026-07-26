# V2 MASTER BLUEPRINT
## DPI Dashboard — Lead Engine (Complete A-to-Z Spec)

## 🚨 Read `V1_V2_COMPATIBILITY_MAP.md` First 🚨

That document contains critical, non-negotiable rules about working safely on a **live production codebase** — including the `dev`-branch-only rule, and the requirement that V1 behavior and UI must never regress. This blueprint assumes those rules are already understood. Do not skip straight to feature-building without reading both documents in full.

**Purpose of this document:** This is the single source of truth for building V2. It is meant to be handed directly to Claude Code (or any developer/AI) at the start of V2 work. It contains everything needed to build V2 in a way that looks, feels, and behaves as one continuous product with V1 — not a bolted-on second app.

**How to use this doc:** Before writing any V2 code, read this entire document. Before building any new UI component, check Section 2 (Design System) and match it exactly. Before creating any new database table, check Section 5 (Database Schema) and Section 7 (Golden Rules) so no table is built without its safety constraints from day one. Before starting any feature, check Section 8 (Build Order) so work happens in the right sequence.

---

## 1. Context — What Already Exists (V1)

V1 is a live, working employee social-media-engagement tracker for Divya Padma Infosystem LLP, built on Next.js 16 + Supabase. Admins create "posts" (Instagram/Facebook links), employees complete them, dashboards show performance. Full details live in `PROJECT_BIBLE.md` and `V1_V2_COMPATIBILITY_MAP.md` — this document assumes both have been read.

**V2 does not replace or rebuild V1. V2 adds a Lead Management Engine alongside it, reusing V1's auth, layout, theme, and calculation patterns.**

---

## 2. Design System — Must Match Exactly

Every new V2 screen, card, button, and animation must draw from this exact palette and pattern set. Do not introduce new colors, fonts, or animation styles — extend using what's below.

### 2.1 Color Palette

| Purpose | Value | Used For |
|---|---|---|
| Primary background (dark) | `#080808`, `#0b0b0b`, `#111827` | Login-style/full-dark screens |
| Primary background (light, admin panels) | `#f4f8fc` (admin layout background) | Admin dashboard body |
| Gold accent (primary) | `yellow-400`, `yellow-500`, `amber-300` | Buttons, highlights, active states, borders, CTAs |
| Gold accent (deep) | `#B8860B`, `#D4AF37`, `#9c7a1f`, `#E8C766` | Premium touches — drawer headers, founder credits, badges |
| Cyan/blue accent | `cyan-500`, `blue-600`, `indigo-600` | Secondary actions, admin sidebar hovers, links |
| Glass card background | `bg-white/[0.04]` to `bg-white/[0.07]` + `backdrop-blur-3xl` or `backdrop-blur-xl` | Any card on a dark background |
| Light card background (admin) | `bg-white` with `shadow-md`, `border border-slate-100` | Any card on the light admin background |
| Success | `#16a34a` (green-600) | Toast success, completed states |
| Error/danger | `#dc2626` (red-600) | Toast errors, destructive actions, logout button |
| Text (dark bg) | `text-white`, `text-gray-300`, `text-gray-400`, `text-gray-500` (decreasing emphasis) | |
| Text (light bg) | `text-slate-800`, `text-slate-700`, `text-slate-500`, `text-slate-400` (decreasing emphasis) | |

### 2.2 Typography

- **Headings:** Playfair Display (`next/font/google`, weights 600/700) — serif, used for major titles ("DPI Dashboard," section heroes)
- **Body/UI text:** Geist (already the app default) — everything else
- Letter-spacing on small uppercase labels: `tracking-[0.15em]` to `tracking-[0.25em]` (this "wide-spaced small caps" look is used throughout — e.g. "DIVYA PADMA INFOSYSTEM LLP," "FOUNDERS," "Get In Touch")

### 2.3 Shape & Spacing

- Border radius is large and consistent: `rounded-[20px]`, `rounded-[24px]`, `rounded-[32px]` for cards; `rounded-xl`/`rounded-2xl` for buttons and inputs. **Nothing sharp-cornered.**
- Card padding: `p-5` to `p-7` typical
- Gaps between elements: `gap-3` to `gap-5` typical

### 2.4 Motion (Framer Motion)

- Entrance pattern: `initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}` (or `y: 40` for hero/major elements), `transition={{ duration: 0.8–1 }}`
- Staggered list entrance: same pattern with `transition={{ delay: baseDelay + i * 0.06 }}` per item
- Hover: `whileHover={{ y: -2 }}` (cards) or `whileHover={{ scale: 1.02 }}` (buttons)
- Tap: `whileTap={{ scale: 0.98 }}`
- Ambient background movement: slow looping glow blobs — `animate={{ x: [-20,20,-20], y:[0,-20,0] }} transition={{ duration: 10-12, repeat: Infinity }}` — use for any full-screen "hero" moment (e.g., Team Leader dashboard landing, Booking Celebration takeover)
- Drawer/modal slide-in: `initial={{ x: "100%" }} animate={{ x: 0 }} transition={{ type: "spring", stiffness: 120, damping: 18 }}`

### 2.5 Iconography

`lucide-react` is the established icon set (already used throughout — `Bell`, `Mail`, `Lock`, `LogOut`, etc.). Use lucide icons for all new UI; don't introduce a second icon library except `react-icons` for brand/social logos specifically (already used for Instagram/Facebook/YouTube).

### 2.6 Feedback & Notifications

- `react-hot-toast` is the established toast system (already configured in `app/layout.tsx` with the app's color scheme). Reuse it as-is for every new success/error message in V2 — including the Booking Celebration toast (Section 4.6).
- The existing notification bell (`Header.tsx`) and `notification` table are the established in-app notification pattern. All new V2 notification types (lead assigned, SLA warning, booking celebration, recycled-lead history) plug into this same system — see Section 6.

### 2.7 Admin vs. Employee Visual Context

- **Employee-facing pages** (like `app/page.tsx`) use the light blue-white gradient background (`from-white via-blue-50 to-blue-100`) with light cards.
- **Admin-facing pages** (`app/admin/*`) use `bg-[#f4f8fc]` with a persistent sidebar (`app/admin/layout.tsx`), light cards, and blue-cyan gradient hero banners (e.g., the "Posts Management" banner: `from-[#0f172a] via-[#1d4ed8] to-[#06b6d4]`).
- **The Login screen** is the one place using the full dark/gold glass aesthetic.

**Rule for V2:** New Employee-facing Lead Manager screens → light theme (like the employee dashboard). New Admin-facing Lead Manager screens (analytics, CSV import, role management) → light admin theme with the same sidebar pattern. Any "big moment" screens (Booking Celebration, onboarding/first-login) may borrow the dark/gold hero treatment for impact, sparingly.

---

## 3. V1 ↔ V2 Boundary Rules (Non-Negotiable)

These were established during planning and must not be violated during implementation:

1. **Social media post assignment (V1) and Lead assignment (V2) are permanently independent systems.** Post assignment depends only on `employees.is_active`. Lead assignment depends on `is_active` **AND** the employee having started their shift today (Section 4.1). Never merge these gates.
2. **Geo-fenced Shift Start only gates new lead assignment.** It never blocks access to already-assigned leads — an employee can review/update existing leads from anywhere, anytime, regardless of shift status.
3. **V1's calculation files (`calculateStatus.ts`, `calculateStats.ts`, etc.) are not touched.** New V2 calculation logic (`calculateSLAStatus.ts`, `calculateLeadPoints.ts`) are new files following the exact same single-function, single-source-of-truth pattern — never duplicated across components.
4. **One job, one owner, one place in the code** — the lesson from the V1 duplicate-tracking-row bug applies to every new table and every new insert path in V2. No database trigger and application code ever perform the same insert simultaneously.

---

## 4. Feature Specification (Complete)

### 4.1 Geo-Fenced Attendance / Shift Gate

- On login, before anything else, the employee dashboard shows a **Start Shift** control.
- "Start Shift" is only clickable when the employee's live GPS location is within a configurable radius (default 30–40 meters) of the office's configured lat/lng (set once by Admin in Settings).
- Successful Start Shift → marks attendance present for the day, timestamps it, and **unlocks new lead assignment** for that employee for the rest of the day.
- Without Start Shift: employee can still see and act on **previously assigned** leads (view, update status, add notes, follow up) — only *new* lead assignment is blocked.
- Social media post access (V1) is completely unaffected by shift status.

### 4.2 Smart CSV Lead Import

- Admin uploads a CSV from any source (99Acres, Housing.com, Meta, or any future platform) — no fixed header format required.
- System attempts fuzzy auto-matching of columns to standard fields: Name, Mobile, Email, Project, Source, Lead Time. Unrecognized columns are held for **manual mapping** by the admin via a dropdown-based preview screen before import is finalized.
- Column mappings are remembered per source (via `csv_import_mappings`) so repeat imports from the same platform don't require re-mapping.
- Duplicate detection by phone number across existing leads; flagged for admin review, not auto-merged.
- `Assigned Time` is never read from the CSV — it's generated by the system at the moment of round-robin assignment.

### 4.3 Lead Assignment Engine (Round Robin + Project Rules)

**Important clarification: this is a rebuild, not an integration.** The Google Sheet (`LDE - Lead Distribution Engine`) is being used purely as a reference for what the *rules* should be — the finished V2 system has zero live connection to Google Sheets, no API calls to it, no dependency on it whatsoever. Every rule below gets reimplemented natively in Supabase tables and application/Edge Function code. Once V2 ships, the Google Sheet can be retired entirely.

Direct migration of the existing Google Sheets **logic** (`LDE - Lead Distribution Engine`):
- **Project Rules override:** certain projects are always assigned to a fixed employee (e.g., all Jewar-based projects → one specific employee), bypassing round robin entirely.
- **Round robin:** for everything else, cycles through employees where `is_active = true`, `rr_eligible = true`, and shift has been started today.
- A `lead_engine_settings` table holds the round-robin pointer and last-lead-ID counters — direct equivalent of the Sheet's `Settings` tab.

### 4.4 SLA Timer & Lead Recycling

- Every assigned lead carries a visible countdown: **2 hours to first contact.**
- If not marked `CONNECTED` within 2 hours, the lead automatically reassigns to the next eligible round-robin employee who hasn't touched it before.
- Additional recycling triggers: `NOT_CONNECTED` / `SWITCHED_OFF` outcomes get a 2–3 day cooldown before recycling; `NOT_INTERESTED` gets a 7-day cooldown, and a second `NOT_INTERESTED` result marks the lead `JUNK` permanently.
- **Maximum 3 recycles** before a lead is auto-marked `JUNK` and flagged for admin review.
- **Every recycled lead always displays as "New" to the receiving employee — no attempt history, no badge, no hint of prior recycling.** This is intentional (protects call energy/tone) — never surface this information on the employee side under any circumstance.
- Full history (who had it, when, what happened, why it moved) is visible only on the Admin side (`lead_history` table, joined view).

### 4.5 Lead Statuses (Fixed Set — Single Source of Truth)

```
NEW → CONNECTED → NOT_CONNECTED → SWITCHED_OFF → NOT_INTERESTED → CONVERTED → JUNK
```
Governed by one function (`calculateLeadStatus.ts` or similar), following the exact pattern of V1's `calculateStatus.ts` — never re-implemented inline anywhere else.

### 4.6 Site Visit → Revisit → Booked Funnel & Leaderboard

- Employees log: Site Visit (1st), Revisit (any additional), Booked (conversion) — each an event on the lead.
- Points: Visit = 1, Revisit = 1 (each), Booked = highest weight (suggested 5–10, confirm exact value at build time).
- **Weekly leaderboard**, same UX pattern as V1's `TopPerformers.tsx` / `LowPerformer.tsx`:
  - Admin dashboard: full ranked list, all employees.
  - Employee dashboard: only Top performer(s) and Low performer(s) shown — for motivation, not competitive pressure from seeing the full list.

### 4.7 Booking Celebration

- The moment any employee's lead is marked `Booked`, **every logged-in employee** receives:
  1. An instant toast (react-hot-toast, existing pattern) with a light confetti/animation moment (Framer Motion), e.g. "🎉 [Employee] just closed a booking — [Project]!"
  2. A permanent, always-visible **"Bookings This Month"** wall/section on every dashboard.
- Implemented via a realtime Supabase channel, following the exact Strict-Mode-safe guarded-channel pattern established in `SessionGuard.tsx` and the fixed `Header.tsx` (check `supabase.getChannels()` before subscribing, cancel flag on unmount).

### 4.8 Team Leader Role

- New `role` value: `"team_leader"` (alongside existing `admin` / `employee`).
- View-only access to their team's leads/performance/attendance — cannot edit any of it (only the employee themself edits their own records).
- Can add **team notes** (coaching remarks) — visible only to themself and Admin, never to the employee being noted about.
- Has a **combined team dashboard** (aggregate: total leads, bookings this week, top performer within the team).
- Also tracked individually like a normal employee if they personally handle leads.

### 4.9 Project Asset Library (Branded Media)

- Structure: Project → Overview assets (intro video, drone shots) + Configuration/size-specific folders (e.g., "895 sq ft — 2BHK": video + images).
- Employees browse by project → configuration, and generate a **shareable link** (not a download) for any asset.
- The link opens a **custom branded player** (not a raw video file): DPI logo overlay throughout, brief branded intro/outro clip, CTA at the end (contact number, "Book a visit").
- **Link expiry is admin-configurable** (default suggestion: 7 days, adjustable in settings, not hardcoded).
- Content protection deterrents (explicitly **not guarantees** — document this in the UI or admin help text): visible watermark (client name/phone/timestamp overlay), right-click/download-button disabled, best-effort screen-recording detection (pause/blur on detection), DevTools/inspect blocking. Screenshots and third-party-camera photos cannot be prevented by any web technology — this is a hard limitation, not an implementation gap.

### 4.10 Reporting & Export

- Filters: date range (including presets), employee, project, team, source.
- Report types: Leads, Performance, Attendance, Booking.
- Formats: **both Excel (.xlsx) and PDF** (PDF includes branding/logo and charts).
- **Scheduled auto-reports** (e.g., weekly summary emailed to Admin).
- **Comparison reports** (this month vs. last month).
- **Individual employee performance card** (single-employee PDF, suitable for appraisals/incentives).

### 4.11 Internal Communication — Request/Ticket System

Not a live chat — a structured, trackable request system, reusing the existing notification infrastructure for alerts.

**Routing table:**

| Category | Routes To |
|---|---|
| Technical Issue | Admin only |
| Leave Request | HR only *(V3 role, but the routing category can exist from V2 if convenient)* |
| Salary Issue | HR only |
| General Complaint | HR |
| Sensitive Complaint | Admin only (bypasses HR) |
| Complaint Against HR | Admin only (bypasses HR) |

**Features:**
- Status lifecycle: Open → In Progress → Resolved → Closed
- Priority tagging (Normal/Urgent)
- Attachment support (reuses the same storage pattern as Project Assets)
- 48-hour no-reply reminder to the receiving Admin/HR
- "My Requests" history on the employee side
- Admin/HR inbox view with filters

*(Note: full HR-side routing only becomes fully meaningful once the HR role exists in V3 — but building the request/ticket data model and UI in V2 with Admin as the only current recipient keeps the architecture ready and avoids rebuilding it later.)*

### 4.12 Hindi/English Toggle

- UI label-level i18n toggle. Does not touch business logic — purely a display-layer addition.

### 4.13 PWA (Progressive Web App)

- `manifest.json` + service worker, installable to home screen, app-like experience for field use (site visits). High priority per explicit instruction — should not be deferred to "polish" phase without discussion.

---

## 5. Database Schema (New Tables)

Extends `PROJECT_BIBLE.md` Section 4 and `V1_V2_COMPATIBILITY_MAP.md` Section 3. All new tables below; existing V1 tables are not restructured (only `employees` gets new columns).

**Extend `employees`:**
- `role` — add allowed value `"team_leader"`
- `rr_eligible` (boolean)
- `team_id` (nullable FK → teams)
- Geofence center is a single admin-level setting, not per-employee (see `lead_engine_settings` or a dedicated `office_settings` table)

**New tables:**

| Table | Purpose |
|---|---|
| `leads` | Core lead record |
| `lead_history` | One row per assignment/attempt — powers recycling + admin audit trail. **Needs a defensive constraint from day one** (e.g., only one *active* assignment per lead at a time) |
| `site_visits` | Visit/revisit/booked events, points value |
| `teams` | Team name + team_leader employee_id |
| `team_notes` | Coaching notes — needs RLS so employees can never read their own notes |
| `projects` | Formalize if not already implicit via `posts` |
| `project_assets` | Files tagged by project + configuration/size + category |
| `shareable_links` | Token, target asset, expiry, created_by |
| `csv_import_mappings` | Remembered column mapping per source |
| `lead_engine_settings` | Round-robin pointer, last-lead-ID counters, geofence config |
| `attendance` | Shift start/end, geofence pass/fail, date |
| `requests` | Internal ticket/request system (Section 4.11) |
| `request_replies` | Thread of replies per request |

---

## 6. Notification Event Types (Extends V1's `notification`/`notifications_templates`)

V1's random-template system stays exactly as-is for the existing "Post Assigned" event. Every new V2 event gets **one fixed, permanent template with dynamic value substitution** (not random selection):

- `LEAD_ASSIGNED`
- `SLA_WARNING`
- `LEAD_RECYCLED` (history-only, visible to admin — not surfaced to the employee who lost it, per 4.4)
- `BOOKING_CELEBRATION` (company-wide broadcast)
- `FOLLOWUP_REMINDER`
- `HOT_LEAD_MISSED` (admin-only)

All still flow through the same bell-icon/read-unread UI already built in `Header.tsx`.

---

## 7. Golden Rules (Carried Forward From V1's Bug History)

1. **One job, one owner.** Every insert, every status calculation, every aggregation has exactly one place in the codebase responsible for it.
2. **Single-source-of-truth functions** for any state decision (`calculateLeadStatus.ts`, `calculateSLAStatus.ts`, `calculateLeadPoints.ts`) — written once in `lib/`, imported everywhere needed, never reimplemented inline in a component.
3. **Defensive database constraints from day one** — every new table that represents "one attempt/assignment" gets a uniqueness or check constraint at design time, not retrofitted after a bug.
4. **Realtime channels always use the guarded pattern** (check `supabase.getChannels()`, cancel-flag on unmount) established in `SessionGuard.tsx`/`Header.tsx` — copy it, don't reinvent it.
5. **Never let a database trigger and application code perform the same write.** Pick one owner per action.

---

## 8. Build Order

1. **Foundation:** `leads`, `lead_history`, `lead_engine_settings`, `teams` tables; extend `employees`; `calculateSLAStatus.ts` + `calculateLeadPoints.ts`; round-robin + Project Rules migration from the Google Sheet
2. **Attendance Gate:** Geofencing + shift start; wire into lead assignment (never into post assignment)
3. **Employee Lead Manager UI:** Lead list, status updates, notes, call counter, "always New" display, SLA countdown visual
4. **Recycling + Leaderboard:** Scheduled recycling function (modeled on `mark-missed-posts`), Site Visit/Revisit/Booked tracking, leaderboard UI, Booking Celebration
5. **Team Leader Role:** Team-scoped views, team notes, combined dashboard
6. **Project Asset Library:** Storage setup, branded player, shareable links with expiry, watermarking
7. **Reporting:** Excel/PDF export, filters, scheduled/comparison reports, performance cards
8. **Communication:** Request/ticket system (Admin-only routing for now, HR routing activates in V3)
9. **Polish:** Smart CSV import (can be pulled earlier if migrating off Sheets is urgent), Hindi/English toggle, PWA setup

---

## 9. Explicit "Do Not Touch" List for V2 Work

- `calculateStatus.ts`, `calculateStats.ts`, `calculatePerformance.ts`, `getUniquePosts.ts`, `getWeekData.ts` (V1 calculation files)
- `app/admin/posts/page.tsx` post/tracking/notification creation logic (V1 social media flow)
- Existing `posts`, `tracking` tables — no schema changes
- Login/redirect logic should only be *extended* (to route `team_leader` correctly) — not rewritten

---

*This document should be provided in full to Claude Code (or any developer) at the start of every V2 work session, alongside `PROJECT_BIBLE.md` and `V1_V2_COMPATIBILITY_MAP.md`, so implementation stays consistent across sessions.*
