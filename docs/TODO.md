# TODO / Future Enhancements

## Member Status Refinements

### Fix Hiatus Tracking - TRUST ISSUE
**Problem:** Hiatus detection doesn't match manual spreadsheet. At-risk members may include people on known hiatus.

**Current Status Detection Logic:**
- Active: has "Quill & Cup Membership" product
- On Hiatus: has "Quill & Cup Member" tag but no product AND no "Offboarding" tag
- Inactive: has "Offboarding" tag OR neither product nor member tag

**Root Cause:** Missing or inconsistent source data from Kajabi
- Offboarding tags not consistently applied in Kajabi
- Manual hiatus spreadsheet may be more accurate than Kajabi tags
- ~21 members identified as needing Offboarding tag (hiatus ended, didn't resubscribe)

**Action Required:**
1. Audit Kajabi tagging - ensure SOPs are followed
2. Compare Kajabi export vs manual hiatus spreadsheet
3. Determine source of truth (Kajabi or spreadsheet?)
4. Either: Fix Kajabi tags OR import hiatus data from spreadsheet
5. Re-import and verify on_hiatus count matches expectations

### Enhanced Inactive Member Classification
Currently all inactive members are grouped together. Add granular status to distinguish:
- **Former Member** - Had "Quill & Cup Membership" product in the past but cancelled
- **Former Trial** - Had trial access but didn't convert to paid membership
- **Lead** - Never had any product (webinar attendee, waitlist, etc.)
- **Former BFF** - Completed BFF program but didn't continue with membership

**Implementation Notes:**
- May require historical product data or membership history tracking
- Could parse Tags for "Offboarding" + historical Products column
- Consider using `member_hiatus_history` pattern to track `member_product_history`

### Guest Attendance Tracking (Deferred)
Some people who attend prickles have no Kajabi footprint at all (not a member, trial, or lead) — e.g. a guest brought by a member. Tracking them would mean creating member-like records for people who never appear in any Bronze source.

**Why deferred:** Different problem from member status/matching — the whole pipeline assumes attendees resolve to a `members` row derived from Kajabi. Guests break that assumption and need their own identity/record model rather than a fix to existing matching logic.

---

## Data Import

### Slack API Import (`/data/import`)
- [ ] Create `SlackApiImportForm.tsx` component
- [ ] Use `SLACK_BOT_TOKEN` from env
- [ ] Convert `scripts/export-slack-data.ts` logic into API endpoint:
  - Create `/api/import/slack-api/route.ts`
  - Fetch users, channels, messages, reactions from Slack API
  - Format into CSV-like structure or call Bronze insert directly
- [ ] Add date range selector (last 7 days, 30 days, 90 days)
- [ ] Show progress indicator (Slack API is rate-limited)
- [ ] Replace placeholder in `/data/import/page.tsx`

### Testing Page CSV Imports (Lower Priority)
- [ ] Add Zoom CSV import to `/data/import/testing`
  - Component for uploading meeting/attendee CSV files
  - Parse and call `/api/import/zoom`
- [ ] Add Calendar CSV import to `/data/import/testing`
  - Component for uploading calendar events CSV
  - Parse and call `/api/import/calendar`

### Kajabi Data Expansion

**Current state:** Kajabi API sync (`/api/sync/kajabi`, runs daily at 3am via Vercel Cron) fetches contacts, customers, purchases, and offers into Bronze, then processes Silver. Goal is to own the full member lifecycle.

**Products catalog (next step)**
- Create `kajabi_products` table (manual catalog of ~10 known products)
- Create `member_products` junction table (historical product access)
- Update member processing to populate `member_products` from `kajabi_purchases` + `kajabi_offers`
- Known products to seed: Quill & Cup Membership, 180 Program, Mindset Training, Self-Editing Academy, BFF Program, Hedgies on First Orientation, Chicago Retreat
- Enables product-based queries: "Show all members with 180 Program", "When did member join/leave BFF?"

**Transaction history (future)**
- Kajabi API: `/v1/transactions` (if available on plan)
- Bronze table `kajabi_transactions`, Silver rollup for LTV / revenue analytics

**Lead & engagement tracking (future)**
- Form submissions, opt-in reports, product progress — lower priority until core member/financial data is solid

### Schedule Import
Import Prickles schedule from:
- Google Calendar API
- Slack integration
- Excel schedule (from Python app reference: `/Users/cody/codyaray/git/quillandcup/zoom-analytics`)

---

## Infrastructure & Deployment

### Multi-Environment Setup
**Status:** Documentation created, awaiting implementation

**Setup Tasks:**
1. [ ] Add custom domain to Vercel project
   - Configure DNS records (CNAME or A record)
   - Wait for SSL certificate provisioning
   - Set as production domain

2. [ ] Create development Supabase project
   - Provision new project for dev/preview environments
   - Copy schema from production
   - Add test data

3. [ ] Configure environment-specific variables in Vercel
   - Production: Production Supabase credentials
   - Preview: Development Supabase credentials
   - Development: Development Supabase credentials
   - Separate or share external integrations (Zoom, Google, Kajabi)

4. [ ] Verify environment isolation
   - Test local development uses dev Supabase
   - Test preview deployments use dev Supabase
   - Test production uses production Supabase
   - Confirm no data leakage between environments

5. [ ] Optional enhancements
   - Add EnvironmentIndicator component to root layout
   - Use lib/config.ts for environment-aware behavior
   - Add environment info to settings/about page

**Documentation:**
- Setup guide: `docs/DEPLOYMENT_SETUP.md`
- Quick start: `docs/QUICK_START.md`
- Verification checklist: `docs/VERIFICATION_CHECKLIST.md`
- Setup script: `scripts/setup-environments.sh`

**Benefits:**
- Safe testing without affecting production data
- Branch-based preview deployments for QA
- Clear separation of development and production
- Easier onboarding for new developers

---

## Security & Access Control

### User Invitations
- **In-app invite management**
  - Admin page to send invites with pre-set roles
  - Email templates for invitations
  - Track invite status and expiration

### Row Level Security (RLS)
- **Role-based restrictions**
  - Add assistant/member roles when we have non-admin users
  - Update policies to restrict based on role
  - Test thoroughly before granting access to non-admins

### Supabase Security Advisories (Skipped)
Two low-severity advisories from `supabase db advisors --linked --type security` were left unresolved after the 2026-08 RLS/search_path hardening pass (see `supabase/migrations/20260720034138_enable_rls_on_exposed_tables.sql` and `20260807023835_harden_search_path_and_definer_grants.sql`):

- **`anon_security_definer_function_executable` / `authenticated_security_definer_function_executable` on `is_admin()` and `create_user_profile()`** — both are `SECURITY DEFINER` and still grant `EXECUTE` to `anon`/`authenticated`. Not revoked because:
  - `create_user_profile()` is the `on_auth_user_created` trigger function that provisions a `user_profiles` row on signup — revoking risks breaking signup.
  - `is_admin()` is called inside the `user_profiles` RLS policies (`USING (is_admin())`) for role `{public}` — revoking `authenticated`/`anon` EXECUTE would likely break those policies for logged-in users, not just tighten anon access.
  - Real-world risk is low: `is_admin()` just returns a boolean based on `auth.uid()` (returns `false` for anon since `auth.uid()` is null), and `create_user_profile()` is a trigger function that errors if invoked directly outside trigger context.
  - **If revisited:** switch `is_admin()` to `SECURITY INVOKER` (it only reads `user_profiles`, which already has its own RLS) instead of touching grants, and/or restrict `create_user_profile()`'s grant to just the role Postgres uses to fire the trigger.

- **`auth_leaked_password_protection`** — Supabase Auth's HaveIBeenPwned check is disabled. This is a dashboard toggle, not a migration: **Dashboard → Authentication → Policies → Password Security → enable "Leaked password protection."**

### Role-Based Access Control (RBAC)
Define user roles and permissions:

1. **Member/Customer** (future)
   - View own profile and attendance history
   - Cannot access other members' data
   - Cannot access admin tools

2. **Admin** (current default)
   - Full access to all features
   - Import/process data
   - View all members and prickles
   - Edit members, prickles, aliases

3. **Assistant** (future)
   - Read-only access to member data for support
   - Can view attendance and engagement metrics
   - Cannot edit or delete
   - Cannot access import/process tools

4. **More granular roles** (future consideration)
   - Content Manager - manage prickles/calendar only
   - Analytics Viewer - read-only dashboards
   - Onboarding Specialist - member CRUD only

**Implementation:**
- Add `role` column to user profiles table
- Create RLS policies per role
- Update UI to show/hide features based on role
- Add role management interface for admins

---

## Gamification / Badges

### Community Builder Leaderboard
Recognize members who contribute most to community engagement — inspired by Long Angle's leaderboard (https://my.longangle.com/leaderboard).

Possible signals to rank on:
- Prickle attendance count or total hours
- Slack messages/reactions
- PUPs started or hosted
- Streak length (consecutive weeks active)
- Composite engagement score (see CRM Features / Engagement Scoring)

Considerations:
- Member-facing (public to the community) vs. admin-only view
- Time window options (all-time, last 30/90 days, current month)
- Opt-out mechanism so members who don't want to appear can hide themselves

### PUP-Starter Badge
Recognize members who drive spontaneous collaboration by being the first to join (or most frequently starting) Pop-Up Prickles.

Two possible definitions:
1. **First joiner** — member with the earliest `join_time` in `attendance` for a given PUP
2. **Most frequent caller** — member who initiates the most PUPs (may need Zoom host data or a `called_by` field on prickles)

---

## Analytics & Matching

### Member Matching Logic (In Progress)
Build fuzzy matching to connect Zoom attendance to members when emails aren't available:
- Name normalization (nicknames, variations)
- Manual mapping table for common aliases
- Confidence scoring

### Background Agents
Set up background agents for faster parallel development

---

## Live Page (Who's in the Prickle Right Now)

Show a `/live` page displaying the currently active prickle and its attendees in real time.

**What was built and reverted:** A server-rendered `/live` page with 30-second auto-refresh querying `prickles WHERE start_time <= now AND end_time >= now`, plus attendee lists split into "currently present" vs "was here earlier". Reverted because attendance data isn't available during live sessions.

**The blocker:** `prickle_attendance` (silver layer) is populated from Zoom reports, which are only available *after* a meeting ends. The page would always show 0 attendees during an active session.

**The Zoom webhook gap:** Webhooks are set up at `/api/webhooks/zoom` and do receive `meeting.participant_joined` events, but currently ignore them — only `meeting.ended` and `meeting.participant_left` trigger a Zoom API import (with a 10-second delay). Even the `participant_left` import only captures who has already left, not who is currently present.

**What's needed to build this properly:**

1. **Handle `meeting.participant_joined` in the Zoom webhook** — write to a lightweight `live_participants` table (not part of the silver pipeline). Schema: `(meeting_uuid, zoom_user_id, name, join_time, left_at TIMESTAMPTZ nullable)`.
2. **Handle `meeting.participant_left`** — set `left_at` on the matching row (already triggers the full import, which can remain).
3. **Handle `meeting.ended`** — clear all rows for that `meeting_uuid` from `live_participants`.
4. **Match live participants to prickles** — join `live_participants.meeting_uuid` to `prickles.zoom_meeting_uuid` to know which prickle is live.
5. **Match live participants to members** — reuse the existing alias/email matching logic to resolve `zoom_user_id` or name to `members.id`.
6. **Update the live page** — query `live_participants` instead of `prickle_attendance` for who is currently present, fall back to `prickle_attendance` for "was here earlier."

**Alternatively (simpler but less real-time):** On `meeting.participant_joined`, immediately trigger the Zoom import (Zoom's live participant list API is available mid-meeting). This would populate `zoom_attendees` and then reprocess attendance, showing joined participants with no leave_time set yet.

**Priority:** Low — the page itself is simple; the prerequisite is wiring up real-time Zoom participant data.

---

## UI Enhancements

### Navigation & Layout
- **User settings - additional preferences**
  - Preferred theme (dark/light/device default)
  - Working location for global time analysis
  - Further refine navigation hierarchy and grouping

### Dashboard Improvements

**Needed Fixes:**
- Top Attendees list should link to each member's profile page
- At-Risk Members list should link to each member's profile page

**Potential Additions:**

1. **Recent Activity Feed**
   - Last 10-20 activities across all members
   - Types: New members, prickle attendance, hiatus starts/ends
   - Real-time or near-real-time updates

2. **Upcoming Prickles This Week**
   - Calendar preview of this week's scheduled prickles
   - Show host, type, time, expected attendance (based on historical avg)
   - Click to view prickle details or edit

3. **Host Leaderboard / Host Stats**
   - Top hosts by number of prickles hosted (last 30 days)
   - Host attendance/punctuality stats
   - Identify hosts who need support
   - **Current hosts view**: for each active host, show hosting stats:
     - Total prickles hosted, total missed, total late
     - Total participants and total unique participants
     - Total duration hosted
     - First host date and most recent host date
     - Hosting streaks: consecutive weeks in a row, consecutive months in a row
   - **All-time hosts view**: everyone who has ever hosted, with same stats above

4. **Attendance Trends Charts**
   - Line chart: Average attendance over time (30/60/90 days)
   - Bar chart: Attendance by prickle type
   - Heatmap: Popular prickle times (day/hour)

5. **Alerts & Notifications Panel**
   - Host no-shows this week (scheduled but didn't attend)
   - Members who just became at-risk
   - Data processing errors or warnings
   - Unmatched Zoom attendees count

6. **Member Lifecycle Summary**
   - New members this month
   - Members ending hiatus soon
   - Churned members (went inactive this month)

### Admin Features
- Manually create/edit members
- Manually create/edit Prickles
- Mark members for outreach

### Member Profile Pages
- **Attendance breakdown by Prickle kind and time slot**
  - Show attendance counts grouped by Prickle type (e.g. "Heads Down: 42", "Progress Prickle: 18")
  - Drill into Prickle type + recurring day/time slot (e.g. "Heads Down on Mondays at 5am: 12")
  - Filter to show only Prickle kinds or time slots where attendance is zero or low — helps identify patterns like "never attends evening prickles" or "dropped off Pop-Up Prickles after March"
  - Applies to both member self-view (`/calendar`) and admin member detail

- **Attendance over time chart**
  - Show historical attendance patterns
  - Help identify engagement trends per member

- **Member status change tracking**
  - Track status transitions (active → hiatus → active, active → at-risk → active)
  - Show timeline: "Became at-risk: March 17", "Previously at-risk: Jan 5 - Jan 20 (returned after outreach)"
  - Helps validate at-risk detection and hiatus tracking
  - Shows engagement patterns over time
  - **Depends on:** Reliable hiatus data from Kajabi (see "Fix Hiatus Tracking" above)

- **Working location and timezone**
  - Configurable per member
  - Enable "local time" analysis (e.g., "most people write in evenings globally")
  - Show what local time members are attending from

### General Improvements
- Add favicon to the application

---

## Data Audits

### Access-date vs transaction-date audit (`kajabi_purchases`)
Find members/purchases where `effective_start_at` is more than ~7 days after the actual transaction date (`created_at_kajabi`). These purchases look like overlapping or out-of-order subscriptions in `detectResubscriptions`, which uses `effective_start_at` as the start of a membership period. A large lag between transaction date and access date can cause legitimate resubscriptions to be missed — e.g. a purchase made in January but access granted in February will appear to overlap with the prior subscription that ends in February, so no gap is detected.

Query: `SELECT * FROM bronze.kajabi_purchases WHERE effective_start_at - created_at_kajabi > interval '7 days'`

---

## Bug Fixes

### Bronze-Tier Pagination Gap in `/api/process/members`
- **Where:** `app/api/process/members/route.ts` — Bronze table fetches (lines ~41-42)
- **Tables affected:** `kajabi_contacts`, `kajabi_customers`, `kajabi_purchases`, `kajabi_offers`
- **Problem:** All four Bronze tables are fetched with a single unguarded `.select("*")` (no pagination). When any table exceeds 1000 rows, Silver processing silently truncates — members beyond row 1000 get incorrect status/plan and null profile fields (photo_url, bio, socials) with no error or warning.
- **Fix:** Add paginated fetch for all four Bronze sources, then merge results in memory before processing
- **Why not fixed yet:** Pre-existing in codebase; requires a larger refactor to paginate + merge all four Bronze sources

### Fire-and-forget Silver reprocessing in Zoom/Calendar webhooks (same risk class as the Slack Bronze-write bug)
- **Where:** `app/api/webhooks/zoom/route.ts` (`triggerZoomImport(...).then().catch()` inside a `setTimeout`), `app/api/webhooks/calendar/route.ts` (`triggerCalendarSync(...).then().catch()`)
- **Problem:** Both trigger their reprocessing chain without `await`ing it, after the webhook has already sent its `200 OK` response. Vercel can freeze/terminate the function's execution environment as soon as the response goes out, killing the in-flight work mid-request — the same underlying failure mode that let the Slack webhook's Bronze writes fail silently for two months (fixed in commit `6a52822`; that bug also had a second, independent cause — a wrong column name — which is why it was confirmed and this one isn't yet).
- **Why not fixed yet:** No confirmed data loss observed for Zoom/Calendar; deferred to keep the Slack fix scoped.
- **Fix:** wrap the trigger calls in Next.js 15's `after()` (from `next/server`, already available on this repo's Next 15.3+) so Vercel keeps the function alive until the background work finishes, instead of racing the response.

### Member Filters
- **At-risk and highly-engaged filters don't work**
  - URL: `/dashboard/members?filter=highly_engaged`
  - Filter parameter is in URL but not applied to results
  - Both filters affected

### Reconciliation: Split monolithic endpoint and unify discrepancy logic _(refactor + code smell)_
- **Code smell:** `has_discrepancy` is currently a hybrid — computed server-side for Kajabi/Stripe in `/api/analyze/subscription-reconciliation`, but Slack absence is ORed in client-side in `app/(admin)/admin/reconciliation/page.tsx`
- **Root cause:** Slack, Stripe orphans, and Zoom access were already extracted into their own endpoints (`/api/analyze/slack-reconciliation`, `/api/analyze/stripe-orphans`, `/api/analyze/zoom-access`), but the subscription endpoint is still an all-in-one monolith that owns the `has_discrepancy` flag
- **Fix:**
  1. Split `/api/analyze/subscription-reconciliation` into separate endpoints (Stripe, Kajabi, etc.) following the same pattern
  2. Move all `has_discrepancy` logic client-side so the page computes it by combining all sources uniformly
  3. Remove `has_discrepancy` from the API response (it becomes a pure UI concern)

---

## CRM Features

### Slack Integration (Phase 1: In Progress)
**Goal:** Track Slack engagement as another signal of community health

**Phase 1: Data Ingestion (Real-time Slack API)**
- Install Slack app with Events API
- Ingest: messages posted, reactions given/received, thread participation, channel activity, file uploads
- Store in `member_activities` table (already has slack_message, slack_reaction types)
- Bronze layer: `slack_events` (raw Slack events)
- Silver layer: Process into `member_activities`

**Phase 2: Member Profile Enhancement**
- Show Slack activity on member profile pages
  - "Posted 12 messages this month"
  - "Active in #accountability, #sprints"
  - Timeline of Slack engagement alongside Prickle attendance

**Phase 3: Combined Engagement Scoring**
- Calculate unified engagement score across Prickles + Slack + other activities
- Weight different activity types (Prickle attendance = 5, Slack message = 1, etc.)
- Display on dashboard and member profiles

**Phase 4: At-Risk Detection Enhancement**
- Use Slack activity as health signal
- Flag members who stopped posting (used to be active)
- Identify lurkers (attending Prickles but not engaging in Slack)
- Combined risk score: low Prickle attendance + low Slack activity

**Phase 5: Outreach Triggers & Alerts**
- "Alice hasn't posted in 14 days (usually posts 3x/week)"
- "Bob is very active in Slack but hasn't attended a Prickle in 30 days"
- Email/dashboard notifications for community managers

**Phase 6: Channel Health Metrics (Future)**
- Messages per day by channel
- Member participation rates
- Identify dead channels for archival

**Phase 7: Activity Feed (Future)**
- Live stream of community activity
- Recent Slack messages, reactions, file shares
- Combined with Prickle attendance
- Real-time or near-real-time updates
- Help admins stay connected to pulse of community

**Host Confirmation Flow (Phase TBD):**
- After each prickle ends, message the host to confirm participants and resolve unmatched Zoom attendees
- For unhosted prickles: TBD — options include assigning to a random active member or the most "senior" hedgie (by join date or total duration excluding hiatus periods)

**Messaging Abstraction Layer (prerequisite for Host Confirmation and future integrations):**
- Abstract all outbound member messaging behind a common interface so backends are swappable per member
- Initial backends: Slack, SMS, in-app notifications
- Future backends: WhatsApp (important for non-US hedgies), email, etc.
- Per-member preference: each member picks their preferred channel (or falls back to a default priority order)
- The Host Confirmation Flow and any future interactive flows (confirmations, reminders, outreach) should be built on top of this abstraction, not wired directly to Slack

**Phase 1 Progress:**
- [x] Database migrations (Bronze tables, aliases extension)
- [x] Export script (batch CSV export with auto-join for public channels)
- [x] Import API endpoint (handles multi-line CSV fields, escaped quotes)
- [x] Processing endpoint (Bronze → Silver with DELETE + INSERT pattern)
- [x] Member matching library (3-tier: manual alias > email > normalized name)
- [x] Tests (reprocessability, idempotency, matching) - All 9 tests passing
- [x] Initial export and import (484 users, 26 channels, 485 messages, 4726 reactions → 111 activities)
- [ ] Data hygiene UI (unmatched users matching interface)
- [ ] Dashboard updates (member profiles show Slack activity, engagement scoring)

### Payment Failure Notifications
On payment failure, send a Slack DM to the member to prompt them to update their payment method.

### Activity Feed Expansion (Future)
Beyond Slack, expand `member_activities` tracking:
- Whitepaper downloads
- Email opens/clicks
- Retreat registrations/attendance
- Community contributions

### Engagement Scoring
Refine `engagement_score` calculation based on activity types and recency
