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

### Data Access Layer (repositories)

**RULE**: A table that has a repository in `lib/data/` is queried only through it: no `.from("<table>")` in pages, actions, routes or other lib code. Today: `prickle_attendance` (`lib/data/attendance.ts`), `prickles` and `prickle_types` (`lib/data/prickles.ts`), `members` (`lib/data/members.ts`: identity scans, full-record lists, lookups by id, auth user and email; profile columns, search and writes are still direct and on the guard test's allowlist). `tests/lib/data-access-layer.test.ts` fails on a new direct query and lists the files still to move (an allowlist that only shrinks; remove a file's line when you move its queries).

- **One interface per aggregate, two implementations.** `AttendanceRepository` is what callers depend on; `SupabaseAttendanceRepository` runs the queries (typed with `Db`, i.e. `SupabaseClient<Database>` from `lib/data/database.types.ts`), `InMemoryAttendanceRepository` is the twin for tests, demos and typed seed data. `createRepos(db)` (`lib/data/repos.ts`) builds them over one client; `getRepos()` (user, RLS, sudo header) and `getServiceRepos()` (service role) are in `lib/data/server.ts`. The client you pass decides the privilege.
- **Callers take the repository, not the client**, so their tests pass the in-memory twin instead of faking PostgREST call shapes. Leaf lib functions take `attendance: AttendanceRepository`; big functions that still take a `supabase` client build `createRepos(supabase)` inside until they are converted.
- **Business rules live in the repository once**: distinct prickles vs. attendance records, pagination past 1000 rows (with a stable `.order("id")`), id chunking for `.in(...)`. Methods return domain-shaped data (`Set`, `Map`, `AttendanceLink`), not PostgREST rows, and throw on a database error instead of returning an empty result.
- **Joins are the repository's job.** A method returns the shape the use case wants with the other table already joined in (`PrickleDetail` is a prickle with its `type` and `host`); the Supabase class runs the PostgREST embed and maps it, the in-memory class joins from a shared `InMemoryDataset` (`lib/data/in-memory.ts`: members, prickle types, prickles, attendance). Build a dataset and `createInMemoryRepos(dataset)` in a test, or as a typed seed profile; `vi.mock("@/lib/data/repos")` to hand it to code that calls `createRepos`. Never write a PostgREST embed (`prickle_types(name)`, `host:prickle_host(...)`) outside `lib/data/`.
- **Both implementations pass one contract suite** per repository (`tests/helpers/*-contract.ts`, run by `tests/lib/data/` against the twin and `tests/api/data/` against the real database). A new method goes in the interface, both classes and the contract.
- **Adding a repository**: interface + Supabase class + in-memory class in `lib/data/<aggregate>.ts`, add it to `Repos`/`createRepos`, a contract suite run both ways, and add the table to `REPOSITORY_TABLES` in the guard test with the files still querying it.
- **Types**: `pnpm types:gen` regenerates `lib/data/database.types.ts` from the local database after a migration (`supabase start` with all migrations applied); commit the result. `Row<"table">` from `lib/data/db.ts` gives a row type. The shared clients in `lib/supabase/` are still untyped (typing them surfaces ~430 compile errors, see `docs/TODO.md`), so only repositories get compile-time column checks for now.

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

**Time-sensitive or not**: set `timeSensitiveUntil` on the message only for something worth interrupting the member for, and only until it stops being so: a check-in until the prickle starts, a check-out for a few hours after it ends. Each channel interprets it (in-app: a banner until then, otherwise just under the bell; push could map it to the OS's time-sensitive level). Leave it out for anything that can wait. Set `ref` so the feature can `resolveInAppNotifications` (mark it read) once it's dealt with; nothing is ever dropped from the inbox.

Layers: **channels** (`lib/channels/`: Slack, in-app, browser push and email today, later SMS/WhatsApp) are the shared delivery adapters; **notifications** sit on them and add per-kind member preferences; **messaging** (two-way chat, planned) will use the same adapters. Never call a provider from a feature. Adding a channel: `CHANNELS` entry in `lib/channels/catalog.ts` + adapter + register it in `lib/channels/index.ts`; no migration.

**Email**: the `email` channel sends to `members.email` through Resend's API (`lib/email.ts`; `RESEND_API_KEY`, sender in `app.config.ts`). It is off by default (no kind lists it in `defaultChannels`); members opt in per kind in settings. Flipping that default later is safe: `notification_preferences` rows exist only for explicit choices (even ones matching the default), so only members who never chose change. Each kind has a React Email template in `emails/notifications/` (TypeScript fails until a new kind has one), rendered to HTML and plain text *at send time*, not pushed anywhere: Supabase's email templates (`supabase/emails/` -> `supabase/templates/`, pushed with the config) only cover its own auth emails, and its mailer can't send anything else. Every email has a per-kind unsubscribe, built by the channel from a signed token (`lib/email-unsubscribe.ts`, `EMAIL_UNSUBSCRIBE_SECRET`, never rotate: old emails' links would break): a footer link to the public `/unsubscribe?t=` page (shows the state, a button to unsubscribe or turn back on, a link to settings; viewing never changes anything, since link scanners open every link) and `List-Unsubscribe`/`List-Unsubscribe-Post` headers for mail clients' own button, which POST to `/api/email/unsubscribe` (no GET handler, on purpose). Both write the same `notification_preferences` row as the settings page. Outside production `sendEmail` redirects to `EMAIL_DEV_ADDRESS` (like `SLACK_TEST_MODE`), so local and preview never email real members.

**Adding a kind** also needs its sample message in `sampleMessages` (`lib/notification-test.ts`; TypeScript fails until it has one), which powers Admin → Test Notifications (`/admin/notifications`): every kind on every channel, sent to the admin's own accounts.

**Slack notification delivery**: Automatic Slack DMs follow each member's per-kind channel preferences and require a safe Slack account match. Keep production `SLACK_TEST_MODE=false`; local and preview sends redirect to the dev account. Ambiguous matches are rejected, logged and reported to Sentry and `#hub-alerts`. A failed Slack post is logged and reported there too. A member without any reachable channel does not consume a notification dedup claim. A member with another successful channel does consume it, so a failed Slack DM is not retried for that notification.

Exceptions that stay direct: replies the member just asked for (Slack sign-in link), shared rooms (Wheel of Wonder intro), and staff-channel posts (`notifyStaffNewBook`, `notifyStaffNewAward`, the feedback widget). For a send the member explicitly requested that should still look like the notification (admin test DMs), use `createNotifier(..., { channels: ["slack"] })`, which skips preferences.

### Notification Messages: Links, Copy, Rollout

What the message says and where it leads matters as much as how it's routed (the section above).

- **Link to the exact thing.** A message about X opens X, not a page that merely relates to it: a check-out DM links to the check-out, and a "Check in" link that lands on a prickle page showing nothing about check-in is a bug. Send yourself the test message (Admin → Test Notifications, `/admin/notifications`; locally with Mailpit) and click the link before shipping.
- **No link previews.** Slack sends set `unfurl_links: false` and `unfurl_media: false` (see `lib/slack.ts`); a preview card under a DM is noise. The notifier and the Slack helpers already do; any new send must too.
- **Say what and ask the question**, in the voice of the existing messages: "Ready for {type} in ~20 min? Check in: how are you feeling coming in?", not a bare "Check in: {type}". Keep it short. Test sends are prefixed "[Test] ".
- **Escape going out, decode and resolve coming in.** Slack text writes `&`, `<`, `>` as `&amp;`, `&lt;`, `&gt;`, and mentions and channels are tokens (`<@U…>`, `<#C…>`). Escape what you send; decode entities and resolve tokens to names for what you display (`lib/chat/render.ts`, `lib/chat/names.ts`). A literal `&amp;`, `#channel` or a user id on screen is this bug. Test with a name that contains `&` and `<`.
- **A new automated sender starts in dry run.** Put it behind a feature flag per kind that says who gets it for real (`liveFor` in `lib/member-reminders.ts`, the `intro_reminders` and `prickle_reminders` flags in `lib/features.ts`); for everyone else it only logs the member id, kind, why, channels and message, and writes no dedup or backoff row, so switching it on later starts from a clean slate. Read the logs for a run or two, then widen: yourself, a segment, everyone.

### Usage Analytics

**RULE**: A feature that ships needs events that show whether it is used. Declare them in the tracking plan (`lib/analytics/events.ts`) and call `track("object_action", { ... })` from `lib/analytics/client.ts`; never write to `analytics_events` directly, send to a provider, or add a property that could hold a person's name, email or typed text. Only declared events and properties are stored. Clicks are autocaptured; put `data-track="name"` on important controls and `data-track-ignore` on anything that shouldn't be recorded. Funnels for admins go in `lib/analytics/funnels.ts` (`/admin/analytics`). A server action whose result matters (something saved, created, sent) is wrapped with `withAction` so its outcome is recorded (`lib/analytics/actions.ts`, `lib/analytics/server.ts`). Notifications are tagged with their kind and channel by `createNotifier`: never build a notification link that bypasses it. Details, consent and privacy rules: `docs/ANALYTICS.md`.

### Tabbed Pages: Tabs Are Paths

**RULE**: A tabbed page's tabs are URL paths, never `?tab=`: the first tab at the base path, the rest at `<basePath>/<id>` (`/my-prickles`, `/my-prickles/all`; `/settings/notifications`). See `lib/tab-routes.ts`.

- The page's content lives in a shared server component taking `tab` (e.g. `app/(member)/my-prickles/MyPricklesPage.tsx`). The base `page.tsx` renders the first tab and calls `redirectLegacyTabParam` so old `?tab=` links (Slack DMs, calendar feeds, bookmarks) still land; each other tab is a folder whose `page.tsx` renders the shared component with its id. Static folders, not a catch-all, so they coexist with `[id]` siblings (`/projects/books` vs `/projects/[id]`).
- Render `<Tabs basePath="/my-prickles" initialTab={tab} key={tab}>`: clicks switch instantly on the client and rewrite the path with `history.replaceState` (no server round trip). Controlled `TabBar` users call `replaceTabPath` + `useFollowTabPath`. Keep tab ids in a plain module, not a `"use client"` file, if a server page needs them.
- Titles: export the page title and a tab-label map from the shared component and use them for the tab labels, each route's `metadata.title` (`tabTitle()` in `lib/tab-routes.ts` from `{ record?, section? }`: always most specific first, record · tab · section, since browsers cut titles off on the right; "All Prickles · My Prickles", "Fern Quillsby · Slack Activity"; no tab name on the first tab) and `<Tabs pageTitle>`, which sets `document.title` to the same string on a client tab switch (controlled `TabBar`: `setTabDocumentTitle`).
- Server actions `revalidatePath(basePath, "layout")` so every tab path refreshes.
- Query params are for state within a tab (`/my-prickles/all?commit=...`); switching tabs drops them.

### Responsive Layout: Viewport for the Shell, Container Queries Inside It

**RULE**: Viewport breakpoints (`sm:`/`md:`/`lg:`/`xl:`) decide the app shell only; a layout *inside the content area* that depends on how much room it has uses container queries: `@container` on a wrapper, and the *named* sizes from `theme.extend.containers` in `tailwind.config.ts` on children (`@pair:`, `@cards:`, `@split:`, `@columns:`, `@outline:`, from the `@tailwindcss/container-queries` plugin; the app is on Tailwind 3.4). Never the plugin's default sizes (`@md:`, `@3xl:`) or `@[62rem]:` literals: `tests/lib/container-sizes.test.ts` fails on them, so every page reflows at the same widths. `tests/lib/viewport-layouts.test.ts` likewise fails on a viewport `sm:`/`md:`/`lg:`/`xl:` `flex-row`, `flex-col`, `flex-wrap`/`flex-nowrap`, `grid-cols-*` or column/row placement in `app` or `components`, unless the file is in its allowlist with a reason (today only `ConsentBanner`, which is `fixed` to the window); visibility, spacing and text variants (`lg:hidden`, `sm:p-6`) are not checked. Write them mobile-first: the plugin has no `@max-*` variants, so the small-screen style is the base and the named size overrides it. A container can't query itself, so the `@container` goes on a wrapper around the element that changes, and never on an ancestor of `fixed` overlays (it contains them).

**Why**: The content area is narrower than the window by the sidebar's width. A page that picks its own viewport breakpoint has to guess what the shell is doing, and the guesses drift: the lesson page moved its outline into a side column at `lg` (1024px) while the sidebar was still visible until `md` (768px), so from 768-1023px the video was squeezed between two panels.

- The member and admin sidebars show from `lg` and become a hamburger menu below it (`components/MemberNavigation.tsx`, `app/(admin)/admin/AdminNavigation.tsx`, `components/MobileMenuButton.tsx`: change all three together). `@outline` is derived from this (the content area jumps 16rem narrower when the sidebar appears, so it is set above any width reachable then); if the sidebar's width or `lg` switch point changes, revisit it in `tailwind.config.ts`. Use Tailwind's default breakpoints; define any new one once in `theme.screens` in `tailwind.config.ts`, not as `min-[...px]` literals.
- Until a page is converted to container queries, a side column next to the main content must start at a viewport breakpoint at which the sidebar is already shown *and* enough room is left (the sidebar is 16rem wide).
- Mobile-first: base styles for small screens, then add `sm:`/`md:`... as it grows. Don't pick a layout in JavaScript (`useMediaQuery`): it flashes and mismatches on hydration.
- Check a layout change at widths just either side of every breakpoint it touches (e.g. 700, 800, 1000, 1100px), not just phone/tablet/desktop; the squeezed zone sits between two breakpoints.

### No Hardcoded Config

**RULE**: Deployment/org config (URLs, hosts, emails, timezones, IDs, slugs) lives outside the code, never as literals or `??` fallbacks. Two places, by whether the value varies:

- **Same in every environment** -> `app.config.ts` (committed). App code reads it through `lib/config.ts` (`APP_URL`, `ORG_TIMEZONE`, `SUPPORT_EMAIL`); `next.config.ts`, `__checks__/config.ts` and scripts import the JSON directly. SQL/pg_cron can't read the file, so `pnpm env:sync:vault` copies the values it needs into Vault (`SHARED_CONFIG_IN_VAULT` in `scripts/sync-vault-secrets.ts`, e.g. `app_url`).
- **Secret, or not fit to publish (the repo is public)** -> an env var declared in `env-vars.config.ts`, synced to Vercel/GitHub/Vault by the `env:sync*` scripts. Its value goes in `.env.shared` when every environment uses the same one (one Zoom/Kajabi/Google/Slack account), else in `.env.preview`/`.env.prod`, which override `.env.shared` (`scripts/env-files.ts`). Keep a client ID with its secret. Sync a new required var before the code that reads it deploys.

Tests assert against the imported config values (e.g. `SUPPORT_EMAIL` from `@/lib/config`), not repeated literals.

### Business Facts: Derive, Don't Assume

**RULE**: Don't hardcode a business number or assume a naming pattern from what you happened to see. Read it from the source data, or derive it.

- Trial length is not a constant: it is usually 7 days but has been a month, many Stripe offers have no trial, and some programs (180 Program, Self Editing Academy) have none at all. Take it from the contact's or offer's own data, and handle "none".
- Whether a trial converted, who counts as a returning member, and similar outcomes are derived from membership history (see `lib/mentorship.ts`), never stored or guessed.
- Titles and labels come from the data. Don't parse "Week 1" or "Module 2" out of a title, or assume every module has one; they don't all start that way.
- If the data isn't there, say so and add a `docs/TODO.md` entry (`.claude/rules/defer-to-todo.md`) instead of picking a default.

### Resource ID Tiers

**RULE**: A Tier 2 resource's id must never be exposed to users (page URLs, links in Slack, email, notifications or calendar feeds, copyable image/download links, exports and downloads such as CSV, and any API consumed by something other than our own client, e.g. a public or partner API or outbound webhook). Our own client-to-server API calls and request bodies are internal and fine, even for admins; ids there show up in browser dev tools but are not shared or copied. An admin page URL counts as exposed. If a feature needs to expose one, elevate the table to Tier 1 (readable prefix) first.

**Why**: Tier 1 tables get hand-chosen readable ids (`mbr_`, `prkl_`, `photo_`, ...) because people see them; Tier 2 (the rest) get short internal prefixes and can be migrated later without breaking any link. Exposing a Tier 2 id would make a later migration break links. Tier lists and the migration plan: `docs/SHORT_IDS_PLAN.md`. Tier 1 is converted and live (since 2026-10-23); Tier 2 and Bronze are still uuids until phase 2, but the rule applies now, since exposing a table's uuid today has the same cost later.

Not everything that looks like an id is one of ours. Slugs and feature or badge keys are chosen by people, external ids (Slack, Zoom, Kajabi, Stripe, Mux) by other systems, and secret tokens and browser-generated idempotency keys stay as they are; none of them is converted. A row's primary key is always produced by the server, never supplied by a person or a request body. See "Ids we don't generate" in `docs/SHORT_IDS_PLAN.md`.

### New Tables and Ids

**RULE**: A table we own gets a text primary key `id text PRIMARY KEY DEFAULT public.new_id('<prefix>')` (`<prefix>_<12 base58 chars>`, e.g. `mbr_7Kx2mQ9dFh3N`), never `uuid DEFAULT gen_random_uuid()`. A column that references one of our tables is `text`, not `uuid`. This keeps phase 2 of `docs/SHORT_IDS_PLAN.md` (converting the Tier 2 and Bronze tables) from growing with every new migration.

- **Prefix.** Lowercase letters only, unique across all tables, short and pronounceable (see the Tier 1 and Tier 2 lists in the plan; take the next free one for a new table). Record it in the table comment: `COMMENT ON TABLE ... IS '... [id prefix: xxx_]'`. A table a person will see in a URL, link or message is Tier 1 and needs a readable prefix agreed with the owner first; everything else is Tier 2 and its id must never be exposed (previous section).
- **References.** `member_id text NOT NULL REFERENCES members(id)`, not `uuid`. Tables whose key is a reference (`member_id` as the primary key) or a composite of references follow the same rule.
- **Still uuid.** Anything Supabase owns (`auth.users.id` and every column that references it: `user_id`, `created_by`, `updated_by`, ...), auth session ids, Vault secret ids, and ids the browser makes up (analytics `message_id`/`session_id`, watch-segment ids) stay `uuid`. External ids (Slack, Zoom, Kajabi, Stripe, Mux) are text from the source and are not ours.
- **App code.** Validate an id from a URL, query string or form with `isId(value, "<prefix>")` from `lib/ids.ts` (add the prefix to `ID_PREFIXES` for a new Tier 1 table), never with a uuid regex or `z.string().uuid()`. `isUuid` is only for auth and browser-made ids. Tests and fixtures use prefixed ids (`mbr_AAAAAAAAAAA1`; base58 has no `0`, `O`, `I` or `l`), not uuid literals.
- **SQL functions.** Arguments, results and variables that hold one of our ids are `text`. A function with a uuid argument that is really one of our ids breaks the moment the table converts: `CREATE OR REPLACE` cannot change a signature, so it means a drop and recreate with grants and comments replayed.
- **Migrations that rewrite ids.** If one sets `session_replication_role = replica` (to keep triggers and audit rows quiet), end it with `NOTIFY pgrst, 'reload schema';`: replica mode also silences the event trigger that makes PostgREST reload, and production would keep calling the old function signatures. See "Lessons from the phase 1 run" in the plan.

### Admin Route Protection

**RULE**: Every `app/(admin)/admin/**/page.tsx` starts with `await requireAdminPage()`, and every admin-only server action starts with `const auth = await requireAdminAction(); if (!auth.ok) return { error: auth.error };` (both from `lib/admin-auth.ts`). Don't hand-roll `user_profiles` role checks, and don't rely on the admin layout or the page to protect an action.

Layers, per the Next.js auth guide (`node_modules/next/dist/docs/01-app/02-guides/authentication.md`):
- **Optimistic, in `proxy.ts`** (`lib/supabase/middleware.ts`): `/admin` and `/admin/*` (not `/administrivia`; see `isAdminPath` in `lib/admin-paths.ts`) → anonymous to `/login`, signed-in non-admin to `/no-access`. Reuses the user the proxy already loads, and reads the role from the `app_role` claim of the access token its `getUser()` just verified. The proxy never reads `user_profiles`. The claim is added by the Supabase custom access token hook (`public.custom_access_token_hook`, migration `20260926000900`, enabled by `[auth.hook.custom_access_token]` in `supabase/config.toml`): the role string, or JSON `null` when there's no `user_profiles` row. Anything but `"admin"`, including a missing claim (hook not enabled, or its lookup failed), counts as not-admin and goes to `/no-access`.
- **Secure, next to the data**: `requireAdminPage()` in `app/(admin)/layout.tsx` and every admin page (memoized with `cache()`, so layout + page share one lookup), same redirects. Pages repeat it because layouts don't re-run on client navigation and don't stop a page segment from rendering. It reads `user_profiles.role` on purpose, and so does `requireAdminAction()`: **never authorize from the `app_role` claim.** A token keeps the role it was minted with until it refreshes, up to `auth.jwt_expiry` (3600s, i.e. up to 1 hour). A demoted admin keeps an `admin` claim for up to that long, so the proxy lets them past the pre-filter and the page-level check stops them. A newly promoted admin gets sent to `/no-access` by the proxy until their token refreshes (up to 1 hour, or at once if they sign out and back in).
- **Server actions** are directly callable POST endpoints, so each admin action checks for itself with `requireAdminAction()` (returns `{ ok: false, error }` rather than redirecting; `startSudo` throws it). `tests/components/pages/admin-auth.test.tsx` fails if an admin page or an action in a `"use server"` file under `app/(admin)/` (or `app/actions/sudo.ts`) is missing its check; list deliberate exceptions there with a reason.

**Non-admins go to `/no-access`, never a member page**: member pages send anyone without a member record to `/admin`, so redirecting non-admins back to `/dashboard` would loop. `app/no-access/page.tsx` sits outside both route groups and must never redirect a signed-in user.

Sudo doesn't affect any of these checks: the sudo cookie changes the effective *member*, not the signed-in admin. API routes use `requireAdmin` (`lib/supabase/api-auth.ts`) instead.

The hook is tested by `supabase/tests/database/custom_access_token_hook.test.sql` (pgTAP, rolled back; `pnpm test:pgtap`, which CI also runs). Because the proxy has no fallback, **no one reaches `/admin` on a project until the hook is enabled there** (and they've signed in again or their token has refreshed). See "Supabase config as code" below for how it gets enabled.

### Supabase config as code

`supabase/config.toml` is the source of truth for the Auth/API/DB/storage settings it declares: the top of the file is local dev, and `[remotes.prod]` overrides it for production (project `bxwtougjidectvjegdlr`). Anything not overridden there, such as `[auth.hook.custom_access_token]`, applies to production as-is. `supabase config push` only writes declared properties; undeclared ones keep their dashboard values. So change declared settings in `config.toml`, not the dashboard, or the next push reverts them.

- **CI pushes it automatically.** On every push to main, the push-migrations job pushes migrations and then runs the "Push Supabase config" step (`supabase config push --yes`). That order is the rule: config can point at SQL (the access token hook → `public.custom_access_token_hook`), and pushing it before the SQL exists breaks every sign-in and token refresh. The step refuses to run if the `RESEND_API_KEY` GitHub secret is empty, since the push fills the SMTP password from `env(RESEND_API_KEY)` and would otherwise clear it (the secret is declared in `env-vars.config.ts`; sync with `pnpm env:sync:github`).
- **Leaked password protection** (`password_hibp_enabled`) has no `config.toml` key, so the next step in that job, "Enable leaked password protection", turns it on through the Management API. Don't turn it off in the dashboard; the next push to main turns it back on.
- Before merging a `config.toml` change, run `pnpm config:diff` (read-only diff against production) and make sure it shows only the change you intend. Expected, harmless lines: `auth.sms.twilio.enabled` and `storage.image_transformation.enabled` show as remote-only.
- `pnpm config:push` still works for a manual push (needs `RESEND_API_KEY` in `.env.prod`); follow the same SQL-before-config order.
- The Dashboard equivalent for the hook: Authentication → Hooks → Customize Access Token (JWT) Claims → Postgres function `public.custom_access_token_hook`.
- Where local defaults differ from production's values (auth email rate limit, storage analytics/vector), `[remotes.prod]` pins production's values so a push doesn't change them. If `config:diff` shows anything besides the change you intend, pin or fix it in `config.toml` before pushing.
- Local: the auth container reads hooks only at startup, so after changing `[auth.hook.*]` restart the stack (`supabase stop && supabase start`; no reset needed).

### Migration numbering

A new migration's timestamp must be newer than the latest on `main`, with no duplicate versions: `supabase db push` rejects an older one only after merge, when it fails the deploy. `pnpm check:migrations` (`scripts/check-migration-order.ts`, compared with `origin/main`) runs in the pre-commit hook and in the `Check migration numbering` CI job, which starts first and fails in seconds: on pull requests against the base branch, and on main against the commit before the push (two PRs that each passed alone can still collide). `push-migrations` waits on it. If it fails, rename the file with a fresh timestamp (and check other worktrees for the number you pick).

### GitHub repo settings as code

`github-repo-config.yml` is the source of truth for the repo's settings (`settings:`, today `allow_auto_merge: true`, which `.github/workflows/auto-merge.yml` relies on to enable auto-merge on every new non-draft PR: it squash-merges itself once the required checks pass; open a draft or click "Disable auto-merge" to hold one back; it re-checks on every push, since a PR opened while conflicting never got it, but never after you turned it off) and rulesets (today: `main` requires the `Test (unit)`, `Test (db) & build` and `Coverage report` checks, needs every PR review thread resolved (bots' included; no approvals required), and can't be deleted or force-pushed; nothing is pushed to `main` directly, admins included, so land changes through a PR, where an admin can still override with "Merge without waiting for requirements"). `pnpm github:config:diff` previews against the live repo (read-only) and `pnpm github:config:push` applies it; both go through `gh` and need repo admin, since Actions' `GITHUB_TOKEN` can't manage rulesets, so this is run by hand. A push replaces a declared ruleset's settings, so change the file, not the Settings page. When a CI job is renamed or added, update the required check names there. The coverage floors are `AREA_FLOORS` in `scripts/coverage-report.ts`. Rulesets on a private repo need a paid GitHub plan; the org is on the free plan.

### Slack app manifest as code

`slack-app-manifest.yml` is the source of truth for the Slack app (Billie Bot). On a push to main that changes it or `scripts/slack-manifest.ts` (or a manual `workflow_dispatch` run), after the production deploy (the manifest points at app routes, so they must be live first), the `push-slack-manifest` job runs `scripts/slack-manifest.ts push`, which **replaces** the live app's configuration. Anything set in the Slack dashboard but missing from the manifest is removed, so change the manifest, not the dashboard. Before merging a manifest change, run `pnpm slack:manifest:diff` (read-only) and check it shows only what you intend. `SLACK_CONFIG_REFRESH_TOKEN` is rewritten by CI on every run and is deliberately not in `env-vars.config.ts`. Setup, token rotation and recovery: `docs/SLACK_MANIFEST.md`.

### Testing Requirements

**RULE**: Critical data processing routes must have integration tests.

Required test coverage:
- `/api/process/calendar` - Test with >1000 events
- `/api/process/attendance` - Test with >1000 records
- `/api/sync/calendar` - Test pagination

**API route tests**: `tests/api/**` call route handlers in-process with `apiFetch` from `tests/helpers/api-fetch.ts`, a drop-in for `fetch(`${getTestApiBaseUrl()}/api/...`)` that finds the `app/api/**/route.ts` for the path, builds a `NextRequest` and calls the handler, so Vitest's coverage counts the route (a request to the separate `next start` server is invisible to v8). It serves `cookies()`/`headers()` from the request, so cookie-auth routes work; it skips `proxy.ts`, which leaves `/api/*` public (routes authenticate themselves), and the proxy has its own tests. Don't `fetch` the app server from a new test; the only HTTP tests are the few in `tests/api/smoke/`, for Next's own routing and body parsing. Routes answer a malformed JSON body with 400: read it with `await request.json().catch(() => undefined)` and return the 400 on `undefined`, not a bare `await request.json()`.

**Component tests**: React Testing Library is available for interactive components (`@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`). Put `.tsx` test files under `tests/components/`, with `// @vitest-environment jsdom` as the first line. Prefer rendering the component and asserting on the DOM (`render` + `userEvent`/`fireEvent` + `screen`) over the older pattern in some `tests/components/*.test.ts` files of `fs.readFileSync`-ing the source and asserting `expect(src).toContain(...)` — that pattern doesn't verify behavior. See `tests/components/SortableTh.test.tsx` and `tests/components/MembersTable.test.tsx` for the current example.

**SQL tests (pgTAP)**: RLS policies, `SECURITY DEFINER` functions and auth hooks — anything only observable as a particular Postgres role — go in `supabase/tests/database/*.test.sql`. Each file wraps itself in `BEGIN … ROLLBACK`, creates the `pgtap` extension, and ends with `SELECT * FROM finish(true);` so a failed assertion raises. `pnpm test:pgtap` (`scripts/test-pgtap.sh`) runs them all as `supabase_admin` against the local stack; CI runs it in the test-db job.

**Server-component page tests**: Async `page.tsx` files are tested the same way — `await` the page's default export with its props (e.g. `{ searchParams: Promise.resolve({ tab: "find" }) }`), then `render()` the returned JSX. `tests/helpers/server-page.ts` supplies the shared module mocks (point `vi.mock("next/navigation" | "@/lib/auth" | "@/lib/sudo" | "@/lib/supabase/server", ...)` at them), a chainable fake Supabase client (`useFakeSupabase({ table: { data } })`), `signInAs(user, identity)`, `renderServerPage` and `expectRedirect` (the mocked `redirect()` throws like Next's). Mock other lib/action calls and heavy client children per test. Put these under `tests/components/pages/`; see `tests/components/pages/unflagged-pages.test.tsx`.

**Time in tests: fake clock, never real waits**: Tests must not spend real time waiting on pauses, retries or deadlines. Server code that sleeps or keeps a time budget reads time through `lib/clock.ts` (`clock.now()`, `clock.sleep(ms)`), not `Date.now()`/`setTimeout` directly. Tests call `useFakeClock()` from `tests/helpers/fake-clock.ts`: `sleep` moves virtual time forward and resolves at once, and `fake.clock.advance(ms)` jumps ahead to hit a deadline or trigger a callback. See `tests/api/idempotency/slack-api-thread-selection.test.ts`. Don't use `vi.useFakeTimers()` with `runAllTimersAsync()`/`advanceTimersByTime()` in tests that make real HTTP calls (the local Supabase): it also fires the HTTP client's own timeouts on in-flight requests (`UND_ERR_HEADERS_TIMEOUT`), which fails only on slower CI. `vi.useFakeTimers({ toFake: ["Date"] })` + `vi.setSystemTime()` is fine for pinning "now".

### Type-checking

**RULE**: Every worktree has its own `node_modules` (`pnpm install --frozen-lockfile`, run by `paseo.json` setup; takes seconds because pnpm hard-links from its global store). If `next` or `tsc` is missing, run that install and then typecheck and test your change; never report "not installed" as the reason a check was skipped.

**RULE**: Run `pnpm typecheck`, not bare `tsc --noEmit`. `PageProps`/`LayoutProps` are global types that Next generates into `.next/types` (by `next dev`, `next build` or `next typegen`); in a fresh worktree or after clearing `.next`, bare `tsc` reports `Cannot find name 'PageProps'` on every page that uses them. Those errors are not real and not pre-existing: the script runs `next typegen` first, and a clean run means zero errors.

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
- `calendar_events`, `zoom_attendees`, `zoom_meetings`, `kajabi_members`, `subscription_history`, `slack_messages`, `slack_reactions`, `slack_channels` (channels and, with `is_mpim`, group DMs the bot is in), `slack_users`, `slack_channel_members` (who is in each conversation now; `left_at` is when they last left), `slack_channel_member_events` (append-only history of joins and leaves, from Slack's join/leave notices, webhook events and the member list; read it as periods through the `slack_channel_membership_periods` view), `slack_custom_emoji` (`deleted_at` soft delete), `slack_files` (files on messages and the path of our copy in the private `slack-files` bucket; service role only)
- **Slack content is service role only**: `slack_messages` (text, files, raw payload) and `slack_files` can't be read by admins. Admin pages read `bronze.slack_messages_meta` (who, where, when, thread shape, `has_files`; no content; a `security_invoker` view over column grants on `slack_messages`, so its metadata columns need a `GRANT SELECT (col)` when added); code that needs the text runs server-side with the service role after checking the caller. `raw_payload` on `slack_users`, `slack_channels`, `slack_reactions` and `slack_channel_member_events` is hidden the same way with column grants, so `select("*")` on those fails for a signed-in user, and a column added to one of them needs its own `GRANT SELECT (col) ... TO authenticated` (`slack_content_privacy.test.sql` fails if one is missed).
- **Pattern**: UPSERT on natural keys for idempotency

**Local Layer** (operational data owned by this app):
- `member_hiatus_history`, `member_name_aliases`, `ignored_zoom_names`, `restricted_slack_channels` (private Slack channels whose messages staff can't read; a row = restricted, every change audited and shown in the Activity Log's Privacy view; restricting clears the text already in `member_activities` and rebuilds leave it out; managed at `/admin/data/slack-channels`), `chat_channels`, `chat_channel_members`, `chat_messages`, `chat_message_contents`, `chat_reactions` (the read-only Hub mirror of bridged Slack conversations, projected from Bronze by `/api/process/chat`; ids are stable across reprocessing; content in its own table so RLS can gate it; service role writes; see `docs/SLACK_BRIDGED_CHAT.md`), `prickle_types`, `staff`, `calendar_feed_tokens` (secret per-member token for the subscribable `/api/calendar/feed/<token>.ics` feed), `calendar_feed_items` (prickles, weekly slots and events a member added to that feed by hand), `member_ask_me_about` (profile "Ask me about…" topics), `member_notes` (a member's private notes to self about another member; author-only RLS with no admin access, hidden in sudo), `prickle_checkins` (a member's check-in for a prickle: mood before and after on two labeled 1-5 scales, optionally the feeling named on the Feeling Wheel (Willcox, 1982), their intention, and whether they got what they came for; see `docs/CHECKINS.md`; readable by the member and admins, writable only by the member, read-only in sudo; option keys in `lib/prickle-checkins.ts`), `prickle_checkin_dismissals` and `prickle_checkout_dismissals` (prickles whose check-in offer or check-out a member dismissed: hidden from the dashboard, the search palette and upcoming prickles, and no Slack DM; the check-out one holds the dashboard's "What did you write?" dismissals), `notification_preferences` (a member's per-kind, per-channel overrides of the notification defaults in `lib/notifications/registry.ts`; no row = default; member-writable, admin-readable, read-only in sudo), `in_app_notifications` (what the in-app channel sent a member, kept for good: the `/notifications` inbox table, the latest few under the header bell, and a banner while unread and still time-sensitive (`OutboundMessage.timeSensitiveUntil`, `banner_until`); read when opened, its banner dismissed, "Mark all as read", or the feature resolves it with `resolveInAppNotifications`; server-written, member and admin readable, the member can only set `read_at`; hidden in sudo), `member_reminder_log` (reminders sent: intro in #start-here, prickle reminders; backoff and dedup for `/api/internal/member-reminders`, see `lib/member-reminders.ts`; service role only), `member_onboarding` (a member's Getting started tour: steps marked done by hand, dismissed/completed; other steps count as done from the member's own data, see `lib/onboarding.ts`; hidden and read-only in sudo), `push_subscriptions` (browsers a member turned Browser notifications on for: Web Push endpoint and keys, so service role only; `deleted_at` when turned off or the push service says it's gone; see `lib/channels/web-push.ts`), `mentorships` (the Big Sister program: every new member, however they arrived, matched with a big sister for 30 days; `started_on` and `kind` come from the sign-up in `lib/arrivals.ts`, never typed; `outcome_note` is the big sister's reason a trial didn't continue, written through `set_mentorship_note`; admin only, since it names new members; whether a trial converted is derived from membership history in `lib/mentorship.ts`, never stored; the Big Sister badge counts them through `mentorship_counts()`, members read their own side through `my_mentorships()`), `big_sister_volunteers` (members who volunteer to be a big sister, soft-deleted with `deleted_at`; self-serve under the hosting eligibility rule; see `docs/BIG_SISTERS.md`), `slack_identities` (Slack user id → Hub account allowed to sign in from Slack; server-written only) and `slack_sign_in_tokens` (hashed single-use button tokens and codes the Slack app hands out); see `lib/slack-sign-in.ts`, both service role only
- **Pattern**: Normal CRUD operations (INSERT, UPDATE, DELETE)
- **NOT reprocessed** - these tables ARE the source of truth

**Silver Layer** (canonical state, computed from Bronze + Local):
- `members`, `prickles`, `attendance`, `member_activities`
- **Pattern**: `prickles` UPSERT on their source key (`calendar_event_id` for calendar prickles, `zoom_meeting_uuid` for PUPs) and DELETE orphans whose source is gone, so **prickle ids — and `/prickles/<id>` URLs — are stable** across reprocessing (safe to reference; add `ON DELETE CASCADE`/`SET NULL` for the rare real delete); DELETE + INSERT for `attendance`; `members` uses a custom atomic upsert (see below) to preserve historical attendance via the `ON DELETE CASCADE` FK; `member_activities` uses two patterns depending on source — DELETE+INSERT by `source` + date range for reprocessable mirrors (Slack, one week per `reprocess_slack_activities_atomic` call because rewriting 90 days in one statement ran past the 8s statement timeout; prickle attendance, mirrored atomically inside `reprocess_prickle_attendance_atomic`), and a best-effort single insert alongside the primary action for append-only sources (writing-progress, outreach touches, logins) that are never reprocessed. See `docs/ACTIVITY_AND_AUDIT_LOG.md`.

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

**Soft delete in Bronze and Local, not hard delete**: When a source stops reporting something (a Slack message or reaction removed, a member leaving a channel), mark it rather than deleting the row. The soft-delete column is always named `deleted_at` (not `removed_at` or another synonym), so every table is read the same way: `deleted_at IS NULL` means live. A timestamp that is a fact about the thing rather than a tombstone keeps its own name (`archived_at`, `dismissed_at`, a membership's `left_at`). Silver can still DELETE + INSERT: it re-derives the soft-deleted state from Bronze/Local on every run, so nothing is lost. Hard delete only when the row has no history worth keeping, or when a Silver rebuild re-creates it. Before marking something deleted because it's missing from a fetch, confirm that fetch fully succeeded for that scope, or a failed API call reads as a mass deletion.

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
