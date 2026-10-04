# Development Guidelines for Hedgie Hub

## Critical Architecture Rules

### Database Query Limits

**RULE**: Supabase has a default 1000-row limit per query. Always paginate when fetching potentially large datasets.

**Required patterns**:

```typescript
// ✅ CORRECT: Paginate for large tables
let allRows: any[] = [];
let offset = 0;
const BATCH_SIZE = 1000;
let hasMore = true;

while (hasMore) {
  const { data: batch } = await supabase
    .from("large_table")
    .select("*")
    .range(offset, offset + BATCH_SIZE - 1);
  
  if (batch && batch.length > 0) {
    allRows = allRows.concat(batch);
    offset += batch.length;
    hasMore = batch.length === BATCH_SIZE;
  } else {
    hasMore = false;
  }
}

// ❌ WRONG: Single query without pagination
const { data } = await supabase.from("large_table").select("*");
```

**Tables requiring pagination**:
- `calendar_events` (1300+ rows)
- `attendance` (10,000+ rows expected)
- `zoom_attendees` (large historical data)
- Any table that could exceed 1000 rows

### API Route Performance

**RULE**: Batch database operations to avoid timeouts on Vercel (300s max).

**Required patterns**:
1. Load reference data upfront with `Promise.all()`
2. Process in memory using Map/Set lookups
3. Batch writes in chunks of 100-500 with parallel execution
4. Avoid sequential database calls inside loops

### Attendance Table Design

**RULE**: The `attendance` table allows multiple records per `(member_id, prickle_id)` to track leave/rejoin patterns.

**Why**: People can leave and rejoin the same meeting/prickle (e.g., bathroom break, stepped away for a call).

**Example**:
```
Alice attends "Morning Writing" prickle:
- Record 1: join=9:00, leave=9:30 (30 min)
- Record 2: join=10:00, leave=11:00 (60 min)
Total time: 90 min (not 120 min if merged)
```

**Important queries**:
```sql
-- Count unique prickles attended (NOT count of attendance records)
SELECT COUNT(DISTINCT prickle_id) FROM attendance WHERE member_id = 'alice';

-- Total time spent
SELECT SUM(leave_time - join_time) FROM attendance WHERE member_id = 'alice';

-- Did member attend this prickle? (returns true even if multiple records)
SELECT EXISTS(SELECT 1 FROM attendance WHERE member_id = 'alice' AND prickle_id = '123');
```

**DO NOT**: Add unique constraint on `(member_id, prickle_id)` or deduplicate attendance records

### Member Identity Resolution

**RULE**: Member-facing pages (`app/(member)/`) must use `getEffectiveIdentity` to resolve the current member, not `supabase.auth.getUser()` alone.

**Why**: Admins can use sudo mode to browse as a specific member. `getEffectiveIdentity` returns the *effective* member identity — the sudo'd member when active, the real user's member record otherwise. Pages that skip this and use the raw auth user ID will show the admin's own data during sudo, breaking the sudo experience.

**Required pattern**:

```typescript
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";

// ✅ CORRECT: Use effective identity for member data
const user = await getCurrentUser(); // verified JWT claims, no Auth round trip
if (!user) redirect("/login");

const effectiveIdentity = await getEffectiveIdentity(user);
if (!effectiveIdentity) redirect("/admin"); // admin with no member record

// Use effectiveIdentity.memberId for all member-scoped queries
const { data } = await supabase
  .from("attendance")
  .select("*")
  .eq("member_id", effectiveIdentity.memberId);

// ❌ WRONG: Using raw auth user ID bypasses sudo
const { data: { user } } = await supabase.auth.getUser();
const { data: member } = await supabase
  .from("members")
  .select("*")
  .eq("email", user.email); // breaks during sudo — returns admin's record
```

**Role-aware links (admin vs member URLs)**:

When a page needs to show different links for admins vs regular members (e.g. `/admin/members/{id}` vs `/members/{id}`), combine the role check with sudo state:

```typescript
const [profileResult, effectiveIdentity] = await Promise.all([
  supabase.from("user_profiles").select("role").eq("id", user.id).single(),
  getEffectiveIdentity(user),
]);
const isAdmin = profileResult.data?.role === "admin";
const isActingAsAdmin = isAdmin && !effectiveIdentity?.isSudo;
const memberBasePath = isActingAsAdmin ? "/admin/members" : "/members";
```

**`EffectiveIdentity` fields**: `memberId`, `memberName`, `memberEmail`, `isSudo: boolean`

**Auth lookups in server code**: Use `getCurrentUser()` from `lib/auth.ts` (returns `{ id, email }` or `null`) in layouts, pages, server actions and API routes. It verifies the JWT locally via `supabase.auth.getClaims()` and is memoized per render with React `cache()`, so layout + page share one check. Only `lib/supabase/middleware.ts` (token refresh + live-session check) and code that needs fields absent from the JWT (`last_sign_in_at`, `identities`, etc.) or must confirm the session is still live server-side (e.g. session management in `app/(member)/settings/actions.ts`) should call `supabase.auth.getUser()`.

### Member Notifications

**RULE**: Anything the app sends a member on its own initiative (reminders, check-ins, alerts) goes through `createNotifier` (`lib/notifications/notify.ts`) as a notification kind registered in `lib/notifications/registry.ts`, never a direct `sendSlackDM`/`chat.postMessage`. That's what makes it show up on `/settings/notifications` and honor the member's opt-outs and channel choices, and it's how new channels (email, push, SMS...) reach every kind at once.

```typescript
const notifier = await createNotifier(serviceRoleClient, "prickle_checkin", memberIds); // batched lookups
for (const memberId of memberIds) {
  if (!notifier.canReach(memberId)) continue; // check BEFORE claiming a dedup row
  // ...claim the send in the feature's dedup log...
  const delivered = await notifier.send(memberId, { text, url, slackBlocks }); // [] if nothing went out
}
```

Layers: **channels** (`lib/channels/`: Slack and in-app banners today, later email/SMS/WhatsApp/push) are the shared delivery adapters; **notifications** sit on them and add per-kind member preferences; **messaging** (two-way chat, planned) will use the same adapters. Never call a provider from a feature. Adding a channel: `CHANNELS` entry in `lib/channels/catalog.ts` + adapter + register it in `lib/channels/index.ts`; no migration.

Exceptions that stay direct: replies the member just asked for (Slack sign-in link), shared rooms (Wheel of Wonder intro), and staff-channel posts (`notifyStaffNewBook`, `notifyStaffNewAward`, the feedback widget). For a send the member explicitly requested that should still look like the notification (admin test DMs), use `createNotifier(..., { channels: ["slack"] })`, which skips preferences.

### Tabbed Pages: Tabs Are Paths

**RULE**: A tabbed page's tabs are URL paths, never `?tab=`: the first tab at the base path, the rest at `<basePath>/<id>` (`/my-prickles`, `/my-prickles/all`; `/settings/notifications`). See `lib/tab-routes.ts`.

- The page's content lives in a shared server component taking `tab` (e.g. `app/(member)/my-prickles/MyPricklesPage.tsx`). The base `page.tsx` renders the first tab and calls `redirectLegacyTabParam` so old `?tab=` links (Slack DMs, calendar feeds, bookmarks) still land; each other tab is a folder whose `page.tsx` renders the shared component with its id. Static folders, not a catch-all, so they coexist with `[id]` siblings (`/projects/books` vs `/projects/[id]`).
- Render `<Tabs basePath="/my-prickles" initialTab={tab} key={tab}>`: clicks switch instantly on the client and rewrite the path with `history.replaceState` (no server round trip). Controlled `TabBar` users call `replaceTabPath` + `useFollowTabPath`. Keep tab ids in a plain module, not a `"use client"` file, if a server page needs them.
- Titles: export the page title and a tab-label map from the shared component and use them for the tab labels, each route's `metadata.title` (`tabTitle()` in `lib/tab-routes.ts` from `{ record?, section? }`: always most specific first, record · tab · section, since browsers cut titles off on the right; "All Prickles · My Prickles", "Fern Quillsby · Slack Activity"; no tab name on the first tab) and `<Tabs pageTitle>`, which sets `document.title` to the same string on a client tab switch (controlled `TabBar`: `setTabDocumentTitle`).
- Server actions `revalidatePath(basePath, "layout")` so every tab path refreshes.
- Query params are for state within a tab (`/my-prickles/all?commit=...`); switching tabs drops them.

### No Hardcoded Config

**RULE**: Deployment/org config (URLs, hosts, emails, timezones, IDs, slugs) lives outside the code, never as literals or `??` fallbacks. Two places, by whether the value varies:

- **Same in every environment** -> `app.config.ts` (committed). App code reads it through `lib/config.ts` (`APP_URL`, `ORG_TIMEZONE`, `SUPPORT_EMAIL`); `next.config.ts`, `__checks__/config.ts` and scripts import the JSON directly. SQL/pg_cron can't read the file, so `npm run env:sync:vault` copies the values it needs into Vault (`SHARED_CONFIG_IN_VAULT` in `scripts/sync-vault-secrets.ts`, e.g. `app_url`).
- **Secret, or not fit to publish (the repo is public)** -> an env var declared in `env-vars.config.ts`, synced to Vercel/GitHub/Vault by the `env:sync*` scripts. Its value goes in `.env.shared` when every environment uses the same one (one Zoom/Kajabi/Google/Slack account), else in `.env.preview`/`.env.prod`, which override `.env.shared` (`scripts/env-files.ts`). Keep a client ID with its secret. Sync a new required var before the code that reads it deploys.

Tests assert against the imported config values (e.g. `SUPPORT_EMAIL` from `@/lib/config`), not repeated literals.

### Admin Route Protection

**RULE**: Every `app/(admin)/admin/**/page.tsx` starts with `await requireAdminPage()`, and every admin-only server action starts with `const auth = await requireAdminAction(); if (!auth.ok) return { error: auth.error };` (both from `lib/admin-auth.ts`). Don't hand-roll `user_profiles` role checks, and don't rely on the admin layout or the page to protect an action.

Layers, per the Next.js auth guide (`node_modules/next/dist/docs/01-app/02-guides/authentication.md`):
- **Optimistic, in `proxy.ts`** (`lib/supabase/middleware.ts`): `/admin` and `/admin/*` (not `/administrivia`; see `isAdminPath` in `lib/admin-paths.ts`) → anonymous to `/login`, signed-in non-admin to `/no-access`. Reuses the user the proxy already loads, and reads the role from the `app_role` claim of the access token its `getUser()` just verified. The proxy never reads `user_profiles`. The claim is added by the Supabase custom access token hook (`public.custom_access_token_hook`, migration `20260926000900`, enabled by `[auth.hook.custom_access_token]` in `supabase/config.toml`): the role string, or JSON `null` when there's no `user_profiles` row. Anything but `"admin"`, including a missing claim (hook not enabled, or its lookup failed), counts as not-admin and goes to `/no-access`.
- **Secure, next to the data**: `requireAdminPage()` in `app/(admin)/layout.tsx` and every admin page (memoized with `cache()`, so layout + page share one lookup), same redirects. Pages repeat it because layouts don't re-run on client navigation and don't stop a page segment from rendering. It reads `user_profiles.role` on purpose, and so does `requireAdminAction()`: **never authorize from the `app_role` claim.** A token keeps the role it was minted with until it refreshes, up to `auth.jwt_expiry` (3600s, i.e. up to 1 hour). A demoted admin keeps an `admin` claim for up to that long, so the proxy lets them past the pre-filter and the page-level check stops them. A newly promoted admin gets sent to `/no-access` by the proxy until their token refreshes (up to 1 hour, or at once if they sign out and back in).
- **Server actions** are directly callable POST endpoints, so each admin action checks for itself with `requireAdminAction()` (returns `{ ok: false, error }` rather than redirecting; `startSudo` throws it). `tests/components/pages/admin-auth.test.tsx` fails if an admin page or an action in a `"use server"` file under `app/(admin)/` (or `app/actions/sudo.ts`) is missing its check; list deliberate exceptions there with a reason.

**Non-admins go to `/no-access`, never a member page**: member pages send anyone without a member record to `/admin`, so redirecting non-admins back to `/dashboard` would loop. `app/no-access/page.tsx` sits outside both route groups and must never redirect a signed-in user.

Sudo doesn't affect any of these checks: the sudo cookie changes the effective *member*, not the signed-in admin. API routes use `requireAdmin` (`lib/supabase/api-auth.ts`) instead.

The hook is tested by `supabase/tests/database/custom_access_token_hook.test.sql` (pgTAP, rolled back; `npm run test:pgtap`, which CI also runs). Because the proxy has no fallback, **no one reaches `/admin` on a project until the hook is enabled there** (and they've signed in again or their token has refreshed). See "Supabase config as code" below for how it gets enabled.

### Supabase config as code

`supabase/config.toml` is the source of truth for the Auth/API/DB/storage settings it declares: the top of the file is local dev, and `[remotes.prod]` overrides it for production (project `bxwtougjidectvjegdlr`). Anything not overridden there, such as `[auth.hook.custom_access_token]`, applies to production as-is. `supabase config push` only writes declared properties; undeclared ones keep their dashboard values. So change declared settings in `config.toml`, not the dashboard, or the next push reverts them.

- **CI pushes it automatically.** On every push to main, the push-migrations job pushes migrations and then runs the "Push Supabase config" step (`supabase config push --yes`). That order is the rule: config can point at SQL (the access token hook → `public.custom_access_token_hook`), and pushing it before the SQL exists breaks every sign-in and token refresh. The step refuses to run if the `RESEND_API_KEY` GitHub secret is empty, since the push fills the SMTP password from `env(RESEND_API_KEY)` and would otherwise clear it (the secret is declared in `env-vars.config.ts`; sync with `npm run env:sync:github`).
- **Leaked password protection** (`password_hibp_enabled`) has no `config.toml` key, so the next step in that job, "Enable leaked password protection", turns it on through the Management API. Don't turn it off in the dashboard; the next push to main turns it back on.
- Before merging a `config.toml` change, run `npm run config:diff` (read-only diff against production) and make sure it shows only the change you intend. Expected, harmless lines: `auth.sms.twilio.enabled` and `storage.image_transformation.enabled` show as remote-only.
- `npm run config:push` still works for a manual push (needs `RESEND_API_KEY` in `.env.prod`); follow the same SQL-before-config order.
- The Dashboard equivalent for the hook: Authentication → Hooks → Customize Access Token (JWT) Claims → Postgres function `public.custom_access_token_hook`.
- Where local defaults differ from production's values (auth email rate limit, storage analytics/vector), `[remotes.prod]` pins production's values so a push doesn't change them. If `config:diff` shows anything besides the change you intend, pin or fix it in `config.toml` before pushing.
- Local: the auth container reads hooks only at startup, so after changing `[auth.hook.*]` restart the stack (`supabase stop && supabase start`; no reset needed).

### Slack app manifest as code

`slack-app-manifest.yml` is the source of truth for the Slack app (Billie Bot). On a push to main that changes it or `scripts/slack-manifest.ts` (or a manual `workflow_dispatch` run), after the production deploy (the manifest points at app routes, so they must be live first), the `push-slack-manifest` job runs `scripts/slack-manifest.ts push`, which **replaces** the live app's configuration. Anything set in the Slack dashboard but missing from the manifest is removed, so change the manifest, not the dashboard. Before merging a manifest change, run `npm run slack:manifest:diff` (read-only) and check it shows only what you intend. `SLACK_CONFIG_REFRESH_TOKEN` is rewritten by CI on every run and is deliberately not in `env-vars.config.ts`. Setup, token rotation and recovery: `docs/SLACK_MANIFEST.md`.

### Testing Requirements

**RULE**: Critical data processing routes must have integration tests.

Required test coverage:
- `/api/process/calendar` - Test with >1000 events
- `/api/process/attendance` - Test with >1000 records
- `/api/sync/calendar` - Test pagination

**Component tests**: React Testing Library is available for interactive components (`@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`). Put `.tsx` test files under `tests/components/`, with `// @vitest-environment jsdom` as the first line. Prefer rendering the component and asserting on the DOM (`render` + `userEvent`/`fireEvent` + `screen`) over the older pattern in some `tests/components/*.test.ts` files of `fs.readFileSync`-ing the source and asserting `expect(src).toContain(...)` — that pattern doesn't verify behavior. See `tests/components/SortableTh.test.tsx` and `tests/components/MembersTable.test.tsx` for the current example.

**SQL tests (pgTAP)**: RLS policies, `SECURITY DEFINER` functions and auth hooks — anything only observable as a particular Postgres role — go in `supabase/tests/database/*.test.sql`. Each file wraps itself in `BEGIN … ROLLBACK`, creates the `pgtap` extension, and ends with `SELECT * FROM finish(true);` so a failed assertion raises. `npm run test:pgtap` (`scripts/test-pgtap.sh`) runs them all as `supabase_admin` against the local stack; CI runs it in the test-db job.

**Server-component page tests**: Async `page.tsx` files are tested the same way — `await` the page's default export with its props (e.g. `{ searchParams: Promise.resolve({ tab: "find" }) }`), then `render()` the returned JSX. `tests/helpers/server-page.ts` supplies the shared module mocks (point `vi.mock("next/navigation" | "@/lib/auth" | "@/lib/sudo" | "@/lib/supabase/server", ...)` at them), a chainable fake Supabase client (`useFakeSupabase({ table: { data } })`), `signInAs(user, identity)`, `renderServerPage` and `expectRedirect` (the mocked `redirect()` throws like Next's). Mock other lib/action calls and heavy client children per test. Put these under `tests/components/pages/`; see `tests/components/pages/unflagged-pages.test.tsx`.

**Time in tests: fake clock, never real waits**: Tests must not spend real time waiting on pauses, retries or deadlines. Server code that sleeps or keeps a time budget reads time through `lib/clock.ts` (`clock.now()`, `clock.sleep(ms)`), not `Date.now()`/`setTimeout` directly. Tests call `useFakeClock()` from `tests/helpers/fake-clock.ts`: `sleep` moves virtual time forward and resolves at once, and `fake.clock.advance(ms)` jumps ahead to hit a deadline or trigger a callback. See `tests/api/idempotency/slack-api-thread-selection.test.ts`. Don't use `vi.useFakeTimers()` with `runAllTimersAsync()`/`advanceTimersByTime()` in tests that make real HTTP calls (the local Supabase): it also fires the HTTP client's own timeouts on in-flight requests (`UND_ERR_HEADERS_TIMEOUT`), which fails only on slower CI. `vi.useFakeTimers({ toFake: ["Date"] })` + `vi.setSystemTime()` is fine for pinning "now".

## Code Review Checklist

Before committing changes to API routes, verify:

- [ ] Pagination implemented for queries that could return >1000 rows
- [ ] Database operations batched (no sequential queries in loops)
- [ ] `maxDuration` set appropriately for long-running operations
- [ ] Error handling includes logging for debugging in Vercel
- [ ] Changes tested locally with realistic data volumes

## Technology Stack

- **Framework**: Next.js 15 App Router
- **Database**: Supabase (PostgreSQL)
- **Deployment**: Vercel (Hobby tier: 300s timeout, limited resources)
- **Auth**: Supabase Auth (invite-only, RLS enabled)

## Data Architecture

**Bronze Layer** (raw imports from external systems):
- `calendar_events`, `zoom_attendees`, `zoom_meetings`, `kajabi_members`, `subscription_history`, `slack_messages`, `slack_reactions`, `slack_channels`, `slack_users`
- **Pattern**: UPSERT on natural keys for idempotency

**Local Layer** (operational data owned by this app):
- `member_hiatus_history`, `member_name_aliases`, `ignored_zoom_names`, `prickle_types`, `staff`, `calendar_feed_tokens` (secret per-member token for the subscribable `/api/calendar/feed/<token>.ics` feed), `calendar_feed_items` (prickles, weekly slots and events a member added to that feed by hand), `member_ask_me_about` (profile "Ask me about…" topics), `member_notes` (a member's private notes to self about another member; author-only RLS with no admin access, hidden in sudo), `prickle_checkins` (a member's check-in for a prickle: feelings before/after, what they needed, how it went; readable by the member and admins, writable only by the member, read-only in sudo; option keys in `lib/prickle-checkins.ts`), `writing_prompt_dismissals` (prickles a member dismissed from the dashboard's "What did you write?" prompt), `notification_preferences` (a member's per-kind, per-channel overrides of the notification defaults in `lib/notifications/registry.ts`; no row = default; member-writable, admin-readable, read-only in sudo), `in_app_notifications` (banners the in-app channel sent a member, until dismissed, expired or resolved by the feature with `resolveInAppNotifications`; server-written, member and admin readable, the member can only set `dismissed_at`; hidden in sudo), `member_onboarding` (a member's Getting started tour: steps marked done by hand, dismissed/completed; other steps count as done from the member's own data, see `lib/onboarding.ts`; hidden and read-only in sudo), `slack_identities` (Slack user id → Hub account allowed to sign in from Slack; server-written only) and `slack_sign_in_tokens` (hashed single-use button tokens and codes the Slack app hands out); see `lib/slack-sign-in.ts`, both service role only
- **Pattern**: Normal CRUD operations (INSERT, UPDATE, DELETE)
- **NOT reprocessed** - these tables ARE the source of truth

**Silver Layer** (canonical state, computed from Bronze + Local):
- `members`, `prickles`, `attendance`, `member_activities`
- **Pattern**: `prickles` UPSERT on their source key (`calendar_event_id` for calendar prickles, `zoom_meeting_uuid` for PUPs) and DELETE orphans whose source is gone, so **prickle ids — and `/prickles/<id>` URLs — are stable** across reprocessing (safe to reference; add `ON DELETE CASCADE`/`SET NULL` for the rare real delete); DELETE + INSERT for `attendance`; `members` uses a custom atomic upsert (see below) to preserve historical attendance via the `ON DELETE CASCADE` FK; `member_activities` uses two patterns depending on source — DELETE+INSERT by `source` + date range for reprocessable mirrors (Slack, prickle attendance, mirrored atomically inside `reprocess_prickle_attendance_atomic`), and a best-effort single insert alongside the primary action for append-only sources (writing-progress, outreach touches, logins) that are never reprocessed. See `docs/ACTIVITY_AND_AUDIT_LOG.md`.

**Gold Layer** (aggregated views):
- Currently computed on-demand in dashboard queries

### Data Pipeline Reprocessability

**CRITICAL PRINCIPLE**: Silver layer processing MUST be fully reprocessable from Bronze + Local sources.

**Why this matters**:
- Deleted events must be removed from Silver layer when reprocessing
- UPSERT patterns leave orphaned data (e.g., deleted calendar event stays in prickles)
- The pipeline must always reflect current truth from ALL sources (Bronze + Local)

**Note on `members`**: Former members are intentionally retained (status set to cancelled) rather than deleted, because `prickle_attendance.member_id` has `ON DELETE CASCADE` — deleting a member would wipe their full attendance history. `attendance` uses the canonical DELETE + INSERT pattern; `prickles` upsert on their source key and delete orphans, which keeps their ids stable.

**Required Pattern for ALL Silver Processing**:

```typescript
// ✅ CORRECT: DELETE + INSERT pattern
export async function POST(request: NextRequest) {
  // 1. Load Bronze data (imports)
  const bronzeData = await supabase.from("bronze_table").select("*");
  
  // 2. Load Local data (operational)
  const localData = await supabase.from("local_table").select("*");
  
  // 3. DELETE existing Silver data in scope
  await supabase
    .from("silver_table")
    .delete()
    .gte("date_field", fromDate)  // Scope by date range or condition
    .lte("date_field", toDate);
  
  // 4. Reconcile Bronze + Local → Silver in memory
  const silverData = reconcileSources(bronzeData, localData);
  
  // 5. INSERT fresh Silver data
  await supabase.from("silver_table").insert(silverData);
}

// ❌ WRONG: UPSERT pattern (leaves orphaned data)
await supabase.from("silver_table").upsert(silverData, { onConflict: "id" });
```

**Current Implementation Status**:

1. **`/api/process/members`** ✅ — **exception to DELETE + INSERT**
   - Uses `reprocess_members_atomic` SQL function instead of DELETE + INSERT
   - UPDATE existing members matched by `kajabi_id` (handles email/name changes)
   - UPSERT new members by email (staff and brand-new contacts)
   - **Does NOT delete members missing from new data** — former members stay in the table with their status updated to cancelled, preserving `prickle_attendance` history via the `ON DELETE CASCADE` FK
   - Scope: All members (full refresh of fields, never a row delete)

2. **`/api/process/calendar`** ✅
   - UPSERT calendar prickles from `calendar_events` on `calendar_event_id` (existing prickles keep their id)
   - DELETE prickles in the date range whose calendar event is gone (orphans)
   - Scope: Date range (fromDate, toDate)

3. **`/api/process/attendance`** ✅
   - DELETE attendance in date range
   - UPSERT PUPs (zoom-sourced prickles) on `zoom_meeting_uuid` (+ start/end), DELETE orphaned PUPs
   - INSERT fresh attendance from `zoom_attendees` in date range
   - Scope: Date range (fromDate, toDate)

**Bronze Layer Idempotency** (different pattern):

Bronze imports use UPSERT or timestamp-based append for idempotency:

```typescript
// ✅ Calendar sync: UPSERT by google_event_id
await supabase.from("calendar_events").upsert(events, { 
  onConflict: "google_event_id" 
});

// ✅ Zoom import: UPSERT by meeting_uuid
await supabase.from("zoom_meetings").upsert(meetings, {
  onConflict: "uuid"
});

// ✅ Members import: Append with imported_at timestamp (snapshots)
await supabase.from("kajabi_members").insert({ 
  ...memberData, 
  imported_at: new Date() 
});
// Processing uses latest snapshot, making it idempotent at processing level
```

**Soft delete in Bronze and Local, not hard delete**: When a source stops reporting something (a Slack message or reaction removed, a member leaving a channel), mark it (`deleted_at`, `removed_at`, `left_at`) rather than deleting the row. Silver can still DELETE + INSERT: it re-derives the soft-deleted state from Bronze/Local on every run, so nothing is lost. Hard delete only when the row has no history worth keeping, or when a Silver rebuild re-creates it. Before marking something deleted because it's missing from a fetch, confirm that fetch fully succeeded for that scope, or a failed API call reads as a mass deletion.

**Nothing through webhooks alone**: Every webhook-handled event type (created, changed, deleted, membership, etc.) must also be caught by a pull-based import that runs in the nightly reconciliation cron and from the manual admin import. Webhooks and on-demand incremental fetches (e.g. fetch a missing thread when a webhook references a message we don't have) are latency optimizations layered on top, never the only path. New integrations follow this; extending on-demand incremental fetch to every source is tracked in `docs/TODO.md`.

**Testing Requirements**:

Every Silver processing route MUST have reprocessability tests verifying:
1. Initial processing creates records
2. Reprocessing with deleted source data removes Silver records
3. Reprocessing with changed source data updates Silver records
4. DELETE + INSERT pattern (not UPSERT) - orphan detection

See: `tests/api/reprocessability/`

Every Bronze import route MUST have idempotency tests verifying:
1. First import creates records
2. Re-importing same data does NOT create duplicates
3. Re-importing with changed data updates correctly (UPSERT) or creates new snapshots (append-only)
4. Multiple import cycles are safe

See: `tests/api/idempotency/`

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
