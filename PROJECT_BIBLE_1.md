# PROJECT BIBLE — DPI Dashboard (Smart Tracking System)

**Company:** Divya Padma Infosystem LLP
**Version:** 2.0 (Updated — reflects actual production codebase)
**Status:** Feature-complete, pre-hosting phase
**Last Updated:** July 21, 2026

---

## 1. Project Overview

DPI Dashboard ek internal employee performance tracking platform hai jo Divya Padma Infosystem ke social media engagement workflow ko automate karta hai.

**Core objective:**
- Admin daily social media "posts" create karta hai (Instagram + Facebook links ke saath).
- Har active employee ko automatically ek tracking record assign hota hai.
- Employee IG aur FB links open karke "Mark Done" karta hai.
- System real-time performance track karta hai — completed, missed, permanently missed.
- Admin dashboard par top/low performers, analytics, aur notifications dikhte hain.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Frontend Framework | Next.js 16.2.4, React 19.2.4 |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| Animation | Framer Motion 12 |
| Charts | Recharts 3.8 |
| Icons | lucide-react, react-icons |
| Notifications (UI) | react-hot-toast |
| Date Picker | react-datepicker |
| Backend | Next.js API Routes + Supabase Edge Functions (Deno) |
| Database | Supabase PostgreSQL |
| Auth | Supabase Auth (email/password) |
| Hosting (planned) | Vercel (frontend, free tier) + Supabase (backend, free tier) |
| Domain | dashboard.divyapadma.com (subdomain via Hostinger DNS → Vercel) |

---

## 3. Folder Architecture (Actual)

```
dashboard-of-dpi/
│
├── app/
│   ├── admin/
│   │   ├── analytics/page.tsx
│   │   ├── components/
│   │   │   ├── AddEmployeeesModal.tsx
│   │   │   ├── DeleteModal.tsx
│   │   │   └── PostSuccessModal.tsx
│   │   ├── employees/
│   │   │   ├── page.tsx
│   │   │   └── [id]/page.tsx
│   │   ├── notification-templates/page.tsx
│   │   ├── notifications/page.tsx
│   │   ├── posts/page.tsx
│   │   ├── settings/page.tsx
│   │   ├── layout.tsx
│   │   └── page.tsx              (Admin Dashboard home)
│   │
│   ├── api/
│   │   ├── admin/update-user/route.ts
│   │   ├── create-employee/route.ts
│   │   └── data/route.ts
│   │
│   ├── login/page.tsx
│   ├── layout.tsx                (Root layout — title/favicon updated July 23, 2026)
│   └── page.tsx                  (Employee Dashboard home)
│
├── components/
│   ├── AddTemplateModal.tsx
│   ├── EditTemplateModal.tsx
│   ├── Charts.tsx
│   ├── EmployeeDetails.tsx
│   ├── EmployeeList.tsx
│   ├── EmployeePanel.tsx
│   ├── Header.tsx
│   ├── LowPerformer.tsx
│   ├── NotificationModal.tsx
│   ├── SessionGuard.tsx
│   ├── StatsCard.tsx
│   ├── TopPerformers.tsx
│   └── calculateStatus.ts
│
├── lib/
│   ├── calculateMissed.ts
│   ├── calculatePerformance.ts
│   ├── calculateStats.ts
│   ├── getUniquePosts.ts
│   ├── getWeekData.ts
│   ├── supabase.ts               (client-side Supabase client, anon key)
│   └── supabaseAdmin.ts          (server-side Supabase client, service role key)
│
├── supabase/
│   └── functions/
│       ├── mark-missed-posts/index.ts
│       └── update-tracking-status/index.ts
│
├── middleware.ts                 (currently a no-op passthrough)
└── public/
    └── dpilogo.png + default Next.js svgs
```

---

## 4. Database Architecture (Supabase PostgreSQL)

### `employees`
| Field | Notes |
|---|---|
| id | UUID, PK |
| name | |
| email | |
| role | `admin` or employee |
| is_active | boolean — deactivated employees are blocked at login and skipped from tracking creation |
| auth_user_id | links to Supabase Auth user |

### `posts`
| Field | Notes |
|---|---|
| id | UUID, PK |
| post_number | int |
| date | |
| ig_link | |
| fb_link | |

### `tracking` — the heart of the system
| Field | Notes |
|---|---|
| id | UUID, PK |
| employee_id | FK → employees |
| post_id | FK → posts |
| date | |
| ig_done | boolean |
| fb_done | boolean |
| done | boolean — true only when both ig_done and fb_done are true |
| permanent_missed | boolean |

**🔒 Unique constraint:** `tracking_employee_post_unique UNIQUE (employee_id, post_id)`
Added July 21, 2026 after a duplicate-row bug (see Section 10 — Known Issues & Fixes).

### `notification`
Stores individual employee notifications, generated at post-creation time.

### `notifications_templates`
Stores reusable notification message templates. A random active template is picked each time a post is created.

---

## 5. Business Flow (Actual, As Implemented)

```
Admin (app/admin/posts/page.tsx → createPost())
   │
   ├─► INSERT INTO posts
   │
   ├─► SELECT active employees (is_active = true)
   │
   ├─► SELECT active notification template (random pick)
   │
   ├─► BUILD tracking rows (one per active employee) → INSERT INTO tracking
   │
   └─► BUILD notification rows (one per active employee) → INSERT INTO notification
   │
   ▼
Employee logs in → sees assigned posts (app/page.tsx)
   │
   ├─► Opens IG link, opens FB link (tracked client-side in EmployeeDetails.tsx openedLinks state)
   │
   ├─► "Mark Done" enabled only after both links opened
   │
   ▼
Click Mark Done → calls Supabase Edge Function `update-tracking-status`
   │
   ├─► Sets ig_done / fb_done = true
   ├─► If both true → done = true, permanent_missed = false
   │
   ▼
Dashboard reflects real-time state via polling (/api/data, 5s interval on admin dashboard)
```

**⚠️ Important architecture note:** Tracking record creation happens **entirely in application code** (`app/admin/posts/page.tsx`), not via a database trigger. A database trigger (`after_post_insert` → `create_tracking_rows()`) previously existed and ran the *same* logic independently, causing duplicate tracking rows. The trigger has been **dropped** (see Section 10). Do not recreate it unless the application-side insert logic in `posts/page.tsx` is removed first — never have both active at once.

---

## 6. Authentication Flow

```
Supabase Auth (email/password)
   ↓
signInWithPassword()
   ↓
Lookup employees table by auth_user_id
   ↓
Check is_active
   ↓
role === "admin" → redirect /admin
role === employee → redirect /
   ↓
is_active === false → forced sign-out, blocked
```

**Login** is now handled by a single path: `app/login/page.tsx` using `supabase.auth.signInWithPassword` directly. (A redundant `app/api/login/route.ts` server-side route existed alongside it and was confirmed unused and deleted on July 23, 2026.)

**SessionGuard.tsx** (wraps authenticated pages) subscribes to realtime `postgres_changes` on the employee's own `employees` row. If an admin is demoted or an employee is deactivated *while logged in*, it force-signs them out immediately. Includes a Strict-Mode-safe duplicate-channel guard (checks `supabase.getChannels()` before subscribing).

---

## 7. Employee Workflow

```
Login → Employee Dashboard (app/page.tsx)
   ↓
EmployeePanel.tsx → shows list, EmployeeDetails.tsx → shows assigned posts for selected date
   ↓
Open Instagram link → Open Facebook link (both tracked in local state)
   ↓
Mark Done button enabled only once both opened
   ↓
POST → Edge Function `update-tracking-status`
   ↓
tracking.ig_done / fb_done / done updated in DB
   ↓
Dashboard re-fetches and reflects new state
```

---

## 8. Admin Workflow

- **Dashboard** (`app/admin/page.tsx`) — polls `/api/data` every 5 seconds, computes stats via `calculateStats()`, shows Top/Low performers and charts.
- **Posts** (`app/admin/posts/page.tsx`) — create post → auto-generates tracking + notifications for all active employees (see Section 5).
- **Employees** (`app/admin/employees/page.tsx`, `[id]/page.tsx`) — list, view individual employee detail/history, activate/deactivate.
- **Notifications** (`app/admin/notifications/page.tsx`) — view sent notifications.
- **Notification Templates** (`app/admin/notification-templates/page.tsx`) — CRUD on `notifications_templates` table.
- **Analytics** (`app/admin/analytics/page.tsx`) — performance insights and employee comparisons.
- **Settings** (`app/admin/settings/page.tsx`) — update employee credentials (email/password via `supabaseAdmin.auth.admin.updateUserById`), Make Admin / Remove Admin toggle.

---

## 9. API Layer

| Route | Method | Purpose |
|---|---|---|
| `/api/data` | GET | Returns formatted tracking + post + employee join data. Supports `employeeId` and `date` query filters. Uses service role key (server-side only). |
| `/api/create-employee` | POST | Creates a Supabase Auth user + corresponding `employees` row. |
| `/api/admin/update-user` | POST | Updates an employee's Auth email/password and mirrors email into `employees` table. |

**✅ Redundancy resolved (July 23, 2026):** Three duplicate/unused code paths were confirmed unused via codebase search and deleted:
- `app/api/login/route.ts` (login is handled solely by `app/login/page.tsx`)
- `app/api/mark-done/route.ts` (Mark Done is handled solely by the Edge Function `update-tracking-status`)
- `app/api/permanent-missed/route.ts` (the missed-sweep is handled solely by the Edge Function `mark-missed-posts`, which is now correctly scheduled via `pg_cron` — see Section 10)

This resolved exactly the pattern that caused the duplicate-tracking-row bug — two independent code paths performing the same write. Going forward, each of these three jobs now has exactly one owner in the codebase.

---

## 10. Known Issues & Fixes (Fix Log)

### ✅ FIXED — July 21, 2026: Duplicate tracking rows on post creation
**Symptom:** Employee dashboard showed a completed post as incomplete after browser refresh, even though the admin dashboard's aggregate stats (Completed/Pending/Performance) were correct.

**Root cause:** Two independent code paths were creating tracking rows for every new post:
1. A database trigger `after_post_insert` → `create_tracking_rows()` function on the `posts` table.
2. The frontend `createPost()` function in `app/admin/posts/page.tsx`, which manually fetched active employees and inserted tracking rows itself.

Both fired on every post creation → 2 tracking rows per employee per post. On refresh, the frontend's `.find()` lookup (keyed by Post ID) picked the *first* matching row, which was often the stale/incomplete duplicate — while dashboard-level aggregates (calculated from `getUniquePosts()`, a `Map`-based dedupe) happened to read the correct one, causing the two UI sections to visibly disagree.

**Fix applied:**
1. Cleaned existing duplicate rows (kept the completed/most-progressed row per employee+post pair, deleted the other).
2. Dropped the redundant DB trigger: `DROP TRIGGER IF EXISTS after_post_insert ON posts;` (the `create_tracking_rows()` function itself was left in place, unused, in case it's needed again).
3. Added a permanent safety-net constraint: `ALTER TABLE tracking ADD CONSTRAINT tracking_employee_post_unique UNIQUE (employee_id, post_id);` — any future duplicate insert attempt from any code path will now fail loudly at the database level instead of silently creating a second row.
4. Verified end-to-end: fresh post created → exactly 1 tracking row per active employee → mark done → refresh → status persists correctly.

**Decision:** Application-side tracking creation (in `posts/page.tsx`) was kept as the single source of truth; the DB trigger was removed. If reintroducing DB-side automation in future, the frontend's manual insert must be removed first — never run both simultaneously.

### ✅ FIXED — July 23, 2026: Admin redirected to Employee dashboard on fresh session
**Symptom:** When starting the dev server fresh and visiting `localhost:3000` directly (with an existing browser session already saved), an Admin account would land on the Employee dashboard instead of `/admin` — happened consistently, not randomly.

**Root cause:** `app/page.tsx` (the employee dashboard route) checked login status and `is_active`, but never checked `role`. Only `app/login/page.tsx`'s manual login flow redirected admins to `/admin` — so a persisted session hitting `/` directly skipped that redirect entirely. Symmetrically, `app/admin/layout.tsx` had no auth/role check at all — a non-admin hitting `/admin` directly would not be redirected away either.

**Fix applied:** Added a `role === "admin"` check in `app/page.tsx` (redirects to `/admin`) and a full auth/role guard in `app/admin/layout.tsx`'s `loadAdmin()` function (redirects non-admins to `/`, unauthenticated users to `/login`, deactivated users are signed out).

### ✅ FIXED — July 23, 2026: Header notification realtime crash on login
**Symptom:** `Runtime Error: cannot add 'postgres_changes' callbacks for realtime:employee-<id> after subscribe()` appeared right after login; refreshing made it disappear.

**Root cause:** Same React Strict Mode double-invoke pattern previously fixed in `SessionGuard.tsx`, this time in `components/Header.tsx`'s notification realtime `useEffect` — no guard against a channel with the same topic already existing.

**Fix applied:** Added the same guarded-channel pattern (check `supabase.getChannels()` for an existing channel with the same topic and remove it before resubscribing, plus a `cancelled` flag) already established in `SessionGuard.tsx`.

### ✅ FIXED — July 23, 2026: Title, favicon, and cron scheduling
- `app/layout.tsx` metadata updated (title: "DPI Dashboard | Divya Padma Infosystem"; description updated to reflect the growing product scope).
- Favicon replaced with a tightly-cropped version of the DPI house-mark logo (old `app/favicon.ico` removed, `metadata.icons` now points to a cropped `dpi-icon.png`, since Next.js prioritizes `app/favicon.ico` over `metadata.icons` if both exist).
- The `mark-missed-posts` Edge Function was confirmed correctly gated behind an 11 PM check (the "TEMP TESTING" comment in the code was stale/misleading — the actual check was already correct), but the function was **never actually running automatically** because no cron schedule existed, and the required `pg_net` Postgres extension wasn't enabled. Both `pg_cron` and `pg_net` were enabled, and a daily cron job (`mark-missed-posts-daily`, running at 17:35 UTC / 11:05 PM IST) was created via `cron.schedule()`, using a Supabase Vault-stored secret for the service role key (never exposed in plaintext in SQL). **Verification of the first live automatic run is pending** — check `cron.job_run_details` and confirm `tracking.permanent_missed` updates correctly for yesterday's date.

### ✅ RESOLVED — July 23, 2026: Redundant parallel code paths, `lib/fetchData.ts`, and `/api/permanent-missed`
All three were confirmed unused/redundant and deleted — see Section 9 for details. `lib/utils.ts` (an empty placeholder file, never imported anywhere) was deleted in the same pass.

### ✅ FIXED — July 24-25, 2026: Employee creation missing `is_active`, causing instant logout after login
**Symptom:** Newly created employees could not stay logged in — login appeared to succeed but the app immediately signed them out and redirected to `/login`.

**Root cause:** `app/api/create-employee/route.ts` inserted new rows into `employees` without setting `is_active`, so it defaulted to `NULL`. Both `app/page.tsx` and `app/admin/layout.tsx` check `if (!data.is_active) { signOut(); redirect }` — in JavaScript, `NULL` is falsy, so this check fired for every new employee, signing them out instantly even though authentication itself had succeeded.

**Fix applied:** Added `is_active: true` explicitly to the insert in `create-employee/route.ts`, and ran a one-time `UPDATE employees SET is_active = true WHERE is_active IS NULL;` to repair existing broken rows.

**Related fix — Add Employee modal was bypassing the API entirely:** `app/admin/components/AddEmployeeesModal.tsx` was calling `supabase.auth.signUp()` directly from the browser instead of going through `/api/create-employee`. This is the public self-signup flow (requires email confirmation, doesn't guarantee a clean `user.id`), not the admin-provisioning flow — it's what caused unpredictable `auth_user_id` values and inconsistent behavior. Fixed by routing the modal through `fetch("/api/create-employee")` instead, so there is now exactly one path for employee creation (Golden Rule: one job, one owner).

### ✅ FIXED — July 25, 2026: Deleting an employee left an orphaned Auth account
**Symptom:** After deleting an employee from the admin panel and later trying to re-create an account with the same email, Supabase returned "A user with this email address has already been registered" — even though the `employees` table showed no matching row.

**Root cause:** The delete flow only removed the `employees` table row (`supabase.from("employees").delete()`), never the corresponding Supabase Auth account. Auth and the `employees` table are separate systems; deleting one side never touched the other.

**Fix applied:** Added `app/api/delete-employee/route.ts` — a server-side route (using the service role key) that looks up the employee's `auth_user_id`, deletes the `employees` row, and then deletes the matching Auth user via `supabaseAdmin.auth.admin.deleteUser()`. `app/admin/employees/page.tsx`'s `deleteEmployee()` now calls this route instead of deleting directly from the browser. Deletion is now fully clean on both sides — no orphaned accounts, no blocked emails on re-creation.

### ✅ FIXED — July 24-25, 2026: Mobile responsiveness, iOS text/dark-mode issues, and polish items
A cluster of related fixes, all now live:
- Employee card layout in `app/admin/employees/page.tsx` was overflowing horizontally on mobile (fixed `flex justify-between` with no `flex-col` breakpoint) — added `flex-col md:flex-row` plus `flex-wrap` on the action-buttons group.
- The date filter `<input type="date">` and the "Today Data" button were overflowing/invisible on iOS Safari due to native form-control styling — fixed with `appearance-none` (per-element and globally in `app/globals.css`) plus explicit text colors.
- `app/globals.css` had a leftover default Next.js `@media (prefers-color-scheme: dark)` block that silently switched body text to a near-white color whenever a user's phone was in Dark Mode — this was the root cause of "some text looks faded on iPhone." Removed entirely; the app is intentionally light-theme-only. Combined with `colorScheme: "light"` set on `<body>` in `app/layout.tsx` and `other: { "color-scheme": "light" }` in `metadata`, this is now fully locked down.
- ⚠️ **Caution for future work:** an early attempt at the iOS form-styling fix added a blanket `input, button, select, textarea { color: inherit; }` rule in `globals.css`. Because Tailwind v4 utility classes live inside a CSS `@layer` and plain rules outside a layer always win regardless of specificity, this silently overrode `text-white` on the login page's inputs. The `color: inherit` line was removed — **any future global form-element CSS should avoid setting `color` at all**, and should be tested against every themed input (dark login form included), not just the default light-admin forms.
- Header (`components/Header.tsx`) company name/logo weren't responsive — added mobile-specific smaller sizes (`text-[11px] sm:text-[15px]`, smaller logo) with `min-w-0` on flex containers to allow proper shrinking.
- A stale session flash (briefly showing old dashboard content on fresh page loads) was fixed by adding an `authChecked` gate in `app/page.tsx` that renders a blank white screen until the auth check completes, plus switching `router.push` to `router.replace` on logout/redirect so browser history doesn't retain a stale entry.
- Favicon: root cause of "favicon not updating" was `shortcut: "/favicon.ico"` in `metadata.icons` pointing at a file that had been deleted — removed the dangling reference. (Any remaining stale favicon after this fix is Chrome's own favicon cache, not a code issue — confirmed fine in Edge/Firefox.)

### ✅ ADDED — July 25, 2026: PWA support, Footer component, custom SMTP
- `public/manifest.json` + properly safe-zone-padded app icons (`icon-192.png`, `icon-512.png` — generous padding so Android's maskable-icon cropping never clips the logo) added for "Add to Home Screen" support on iOS and Android. Linked via `manifest: "/manifest.json"` in `app/layout.tsx` metadata.
- New reusable `components/Footer.tsx` — shows company name, founders, developer credit, and version badge, in a single responsive line on wider screens (`flex-wrap`) that stacks cleanly on mobile. Added to `app/page.tsx` (employee dashboard) and `app/admin/layout.tsx` (covers every admin page automatically, since it wraps all admin routes).
- Custom SMTP (Gmail, via an App Password) configured in Supabase Authentication settings, resolving the built-in email service's low rate limit that was blocking rapid employee creation.
- All unused debug `console.log`/`console.table` calls removed from the main polling paths (`app/page.tsx`, `app/api/data/route.ts`) — error-path `console.log(err)` calls inside `catch` blocks were deliberately left in place, since they're useful for diagnosing production issues.
- `pg_cron` + `pg_net` extensions enabled in Supabase, and a daily cron job (`mark-missed-posts-daily`, 17:35 UTC / 11:05 PM IST) now actually triggers the `mark-missed-posts` Edge Function — previously this function existed and was correctly gated on time, but was never being called automatically because no schedule existed.

## 11. Status Engine

Single source of truth: `components/calculateStatus.ts`

```
Possible statuses: ASSIGNED | MISSED | PERMANENT | COMPLETED
```

**Business rules:**
- Rule 1: Both `ig_done` and `fb_done` true → `COMPLETED`.
- Rule 2: Not completed + current time ≥ 11:00 PM (post date) → `PERMANENT`.
- Rule 3: Not completed + current time ≥ 6:30 PM (post date) → `MISSED`.
- Rule 4: Otherwise → `ASSIGNED`.

This powers dashboard stats (`calculateStats.ts`), weekly ranking, and top/low performer calculations.

---

## 12. Analytics Engine

```
raw tracking+post+employee data (from /api/data)
   ↓
getWeekData()        → filters to last 7 days
   ↓
getUniquePosts()     → dedupes by employee_id + Post ID (Map-based)
   ↓
calculateStatus()    → per-post status
   ↓
calculateStats()     → aggregate counts (completed/pending/missed/permanent)
   ↓
calculatePerformance() → percentage score
```

**Top Performer:** `status === COMPLETED` → +1 score → sort desc → top 3.
**Low Performer:** `status === MISSED or PERMANENT` → +1 penalty → sort desc.

---

## 13. Realtime Components

- **SessionGuard.tsx** — subscribes to the logged-in user's own `employees` row for admin-demotion/deactivation while active.
- **Admin dashboard** — uses 5-second polling (`setInterval`) on `/api/data` rather than a realtime subscription. Functional but not push-based; worth noting for future optimization (e.g., switch to Supabase Realtime channel on `tracking` table changes).

---

## 14. Edge Functions (Deno, Supabase)

| Function | Purpose |
|---|---|
| `update-tracking-status` | Marks ig_done/fb_done true for a tracking row; sets done=true + permanent_missed=false once both platforms are done. |
| `mark-missed-posts` | Scheduled sweep — after 11 PM, marks all incomplete tracking rows for today as `permanent_missed = true`. Contains a "TEMP TESTING" comment suggesting the 11 PM gate may have been temporarily disabled during dev — confirm it's restored before production. |

---

## 15. Environment Variables Required (for Vercel deployment)

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY   (used by lib/supabase.ts, client-side)
SUPABASE_SERVICE_ROLE_KEY       (used by lib/supabaseAdmin.ts and API routes — server-side ONLY, never expose to client)
```

⚠️ `SUPABASE_SERVICE_ROLE_KEY` must **not** be prefixed with `NEXT_PUBLIC_` — confirmed it currently isn't. Keep it that way; it bypasses Row Level Security.

---

## 16. Design System Notes

- Dark theme with gold (`yellow-400/500`) and cyan accent glows, glassmorphic cards (`bg-white/[0.04] backdrop-blur-3xl`), Playfair Display serif for headings, Geist for body text.
- Framer Motion used for entrance animations and ambient background glow movement throughout admin and login pages.
- Login page footer now includes: "Founders: Mr. Ashwani Srivastava & Mrs. Anamika Sinha" and "Designed & Developed by Shivansh Saxena."

---

## 17. Pre-Hosting Checklist

- [x] Fix `app/layout.tsx` metadata (title + description) — done July 23, 2026
- [x] Replace default favicon with DPI logo — done July 23, 2026
- [x] Fix admin/employee redirect bug — done July 23, 2026
- [x] Fix Header.tsx realtime double-subscribe crash — done July 23, 2026
- [x] Enable `pg_cron` + `pg_net`, schedule `mark-missed-posts-daily` — done July 23, 2026 (first live automatic run verification pending — check tomorrow morning)
- [x] Push all of the above to GitHub `main` — done July 23, 2026
- [x] Audit and remove redundant login / mark-done / missed-sweep code paths — done July 23, 2026 (`app/api/login`, `app/api/mark-done`, `app/api/permanent-missed`, `lib/fetchData.ts`, `lib/utils.ts` deleted and pushed to GitHub)
- [ ] Add all required env vars to Vercel project settings (Section 15)
- [ ] Deploy to Vercel (free tier)
- [ ] Point `dashboard.divyapadma.com` (Hostinger DNS) to Vercel
- [ ] Stay on Supabase free tier — confirmed safe as long as there's at least one API request within any 7-day window (daily usage from posts/employees keeps this well within the safe zone)
- [ ] Create a `dev` branch before starting V2 work (see `V2_MASTER_BLUEPRINT.md`) — keep `main` as the stable, live-deployed branch going forward
- [ ] **Decision made:** V1 will be migrated to multi-tenant architecture before/alongside V2 work, since social-media-engagement-tracking bundled with a real estate CRM is a rare combination in the market and there's product/business intent behind it. See `V1_MULTI_TENANT_MIGRATION_PLAN.md` for the full plan — this is a deliberate scope addition beyond the original V1 hosting checklist.

---

## 18. Future Roadmap (Unchanged from Original Bible)

- Attendance integration
- Monthly performance reports
- Team-wise / department dashboards
- Export to Excel/PDF
- Automated reminders, Email/WhatsApp notifications
- KPI trends, historical analytics
- Role-based permissions expansion
