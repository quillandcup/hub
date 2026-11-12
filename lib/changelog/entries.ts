/**
 * The Hedgie Hub changelog: one entry per release a member would notice, newest first or not (the
 * helpers sort). This file is the single source: the in-app pages (/changelog), the
 * admin Changelog (engineering entries too) and the "What's new" digest all read it.
 * Written for members: say what they can now do, not what changed in the code. See docs/CHANGELOG_PROCESS.md.
 *
 * Screenshots live in public/changelog/<slug>/ (the repo and that folder are public: no member data in
 * them) and are written in `body` as `![alt](/changelog/<slug>/<file>.png)`. `image` is the one shown on
 * the list, the digest and the Slack post.
 */

export const CHANGELOG_CATEGORIES = {
  new: "New",
  improved: "Improved",
  fixed: "Fixed",
} as const;

export type ChangelogCategory = keyof typeof CHANGELOG_CATEGORIES;

/**
 * Who an entry is for. `product` entries are what members see: the What's new pages, the weekly digest, the
 * announcements post, and the admin Changelog. `engineering` entries (platform improvements, or the lower-level detail behind
 * a product update) appear only on the admin Changelog (`/admin/changelog`), with their body, and have no member page or notification.
 */
export const CHANGELOG_AUDIENCES = {
  product: "Product",
  engineering: "Engineering",
} as const;

export type ChangelogAudience = keyof typeof CHANGELOG_AUDIENCES;

export interface ChangelogEntry {
  /** The permalink (`/changelog/<slug>`): lowercase words and hyphens. Never changed once published, so shared links keep working. */
  slug: string;
  /** The day it shipped, YYYY-MM-DD (Eastern). */
  date: string;
  audience: ChangelogAudience;
  category: ChangelogCategory;
  /**
   * A significant new capability (Hub Chat, Courses), as opposed to one more improvement: badged "Major" on the What's new
   * pages, first in the weekly digest and the announcements post, and marked on the admin Changelog. A separate dimension from
   * `category` (a major feature is also "new"), so it stays rare on purpose. Product entries only.
   */
  major?: boolean;
  title: string;
  /** One or two plain sentences (no markdown): the excerpt in the list, the digest and the Slack post. */
  summary: string;
  /** The full write-up in markdown: images as `/changelog/<slug>/<file>`, links to Hub pages as `/path`. */
  body: string;
  /** A screenshot shown with the summary: a path under /changelog/<slug>/. */
  image?: { src: string; alt: string };
}

export const CHANGELOG_ENTRIES: readonly ChangelogEntry[] = [
  {
    slug: "lesson-videos-in-chat-building-blocks",
    date: "2026-11-11",
    audience: "engineering",
    category: "new",
    title: "Lesson videos in chat messages: the pieces behind the flag",
    summary: "A chat message can share a course lesson's video, played in the message with the course's rules, from Hub Chat or a link pasted in Slack. It stays behind a feature flag for now.",
    body: [
      "`chat_message_videos` (`ChatVideoRepository`) points one message at one lesson; the share and its message are written together by `chat_post_shared_video`, which checks the sharer. Playback links are minted per viewer by `/api/chat/videos/<message id>` after two checks: the viewer can read the message (the share is read as them, so row-level security applies the channel rule) and may watch the lesson (`mayWatchSharedVideo`: the course, or a share an admin opened to the conversation for an open lesson of a published course). The card before play is a second light route that mints nothing. Watching goes through the lesson player and `video_watch_segments`, tagged with the message so the course stats keep chat views apart.",
      "A pasted lesson address becomes the card in Hub Chat (`extractLessonLink`) and in a message written in Slack (webhook, and the nightly chat import for what it missed). The Slack copy is then rewritten as its author through their own connected account (`rewriteInSlack`): the address becomes the links line in the same place, with the lesson's title above it, previews cleared, files kept by naming them again in the edit. Hub Chat hides that line and Slack's own preview (`stripSharedVideoLink`, `withoutLessonPreview`).",
      "Deleting a message ends its share at once: the read policy requires a live message (migration `20270701000000`) and the repository returns nothing for a deleted one. Before that, a soft-deleted open share could still be played by anyone who knew the message id.",
      "The detours it adds (sign in, connect Slack) are on the new gates standard (`lib/gates.ts`): the destination is captured when the visitor is stopped, carried through every step, and every gate page offers \"Not now\". Message permalinks (`?m=`) open the message itself and survive sign-in. The member-facing entry and the help article wait for the flag (`docs/CHAT_VIDEOS_LAUNCH.md`).",
    ].join("\n\n"),
  },
  {
    slug: "event-places-left-and-sign-up",
    date: "2026-11-11",
    audience: "product",
    category: "improved",
    title: "See how many places are left on an event, and sign up from its page",
    summary: "Events with limited places now say how many are left, or \"Sold out!\" once they are full, and an upcoming event you can buy a ticket for has a Sign up button.",
    body: [
      "On the Events page, a retreat or other event with limited places now shows how many places are left, or \"Sold out!\" when none are.",
      "Open the event and you will see the same on its page, with a **Sign up** button that takes you to the ticket page. When it is sold out, the button goes away.",
      "Places are counted from tickets bought as well as from the people already on the list, so the last place shows as taken as soon as it is paid for.",
    ].join("\n\n"),
  },
  {
    slug: "sync-segments-from-course-program-event",
    date: "2026-11-11",
    audience: "engineering",
    category: "new",
    title: "Previews: fill a segment from the people with access to a course, program or event",
    summary: "The segment dialog on the Previews page can add everyone with access to a course, program or event to a segment, so a feature flag linked to that segment reaches them.",
    body: [
      "Manage on a segment, pick a course, program or event and press Sync (`POST /api/admin/segments/[id]/sync`, the choices from `GET /api/admin/segments/sources`). It only adds: members already in the segment, added by hand or from another source, stay, and running it again later picks up whoever got access since. It does not run on its own.",
      "Who counts is read in `lib/segment-sources.ts`: a course's `course_access` rows that have started and not ended, anyone enrolled in any cohort of a program, an event's attendees. A flag still reaches people through the existing flag-to-segment link, so there is no schema change.",
    ].join("\n\n"),
  },
  {
    slug: "hedgie-care-feedback",
    date: "2026-11-12",
    audience: "engineering",
    category: "improved",
    title: "Hedgie Care: start in the past, score and last participation on each row, Open the DM",
    summary: "The community manager can enter a conversation with the day it really started, sees each member's engagement score then and now and when they last took part, and can jump to a tracked DM. The unit is now called a care period on the page.",
    body: [
      "Starting a care period asks \"When did this start?\" (the shared `DatePicker`, an Eastern calendar day, today by default and never after it), and \"Change start date\" on a row fixes ones entered with today's date (`changeEngagementStart`, `CareRepository.changeStart`, a `care.write` action wrapped in `withAction`, event `care_start_date_changed`). An earlier day is stored as noon Eastern in `opened_at`, with the first message placed at the start of that day so a real DM from that morning can replace it; the last day moves with the start and keeps the period's own length; a start can't cross the care period it continues, its renewal or its close (`lib/care.ts`); the audit log shows one delta of `opened_at` and `period_ends_on`. Tracked Slack DMs from the new day on count towards who wrote last. No migration.",
      "Each row and the Results panel show the member's engagement score and tier when the care period started and now (`engagementScoreAt`, `lib/care-scores.ts`, one batched `ActivityRepository.engagementRowsForWindows` for the whole page) and their last own activity in the community (`lib/care-participation.ts`, `ActivityRepository.lastParticipation`: `actor_kind = 'member'` and a listed type, never logins, feedback or anything staff or the system wrote). \"Open the DM\" (`lib/care-dm-link.ts`) goes to the DM in Hub Chat when she is in it there, else to Slack's `app_redirect`, with the workspace id from the optional `SLACK_TEAM_ID`.",
      "\"Engagement period\" read as confusing next to the engagement score, so every word on the page now says care period; tables, columns, routes and events keep their names. The text of tracked DMs is deliberately not shown in the tracker (`docs/TODO.md`, \"Hedgie Care: what is left\").",
    ].join("\n\n"),
  },
  {
    slug: "hedgie-care-slack-dms",
    date: "2026-11-11",
    audience: "engineering",
    category: "new",
    title: "Hedgie Care: tracked Slack DMs fill in who spoke last",
    summary: "A staff member can choose which of their 1:1 Slack DMs with members to track; who wrote last in those DMs fills in the status of their Slack DM engagements, reading only who wrote and when.",
    body: [
      "A new \"Your DMs\" tab on `/admin/care/dms` lists the staff member's own 1:1 Slack DMs with members, each with a Track switch (opt in, per DM). A DM with a staff member is never listed, group DMs are out of the first version, and starting an engagement on Slack DM tracks the DM with that member when there is one (it can be untracked). The tracked list is `care_tracked_dms` (id prefix `caredm_`, `CareTrackedDmRepository`): RLS lets a staff user read and change only their own rows, so an admin does not see another staff member's list, and it is deliberately not audited. Starting needs the `slack_dm_bridge` flag on for them and Slack connected with the DM scopes; the tab shows how to connect through the existing Slack connect flow.",
      "Only who wrote and when is read, never text, files or a payload: `SlackMessageRepository.lastWritesIn` calls the `care_dm_last_messages` database function, which reads the content-free `slack_messages_meta` view and is callable by the service role only. The list is built from the DMs the staff member's own Slack account is in, and the projection re-checks that she and the member are the two people in a tracked conversation, so a row filed for someone else's DM reads nothing. For an open Slack DM engagement, the latest message each side wrote on or after the start of the Eastern day it opened sets `last_staff_message_at` and `last_member_message_at` (`lib/care-dm.ts`, `lib/care-dm-rules.ts`): threads and file shares count, deleted messages and Slack's join and leave notices do not, a time only moves forward (`CareRepository.moveMessageTimesForward`), and running it again changes nothing. It runs when the page opens, when a DM is tracked and after the nightly DM pull (`/api/reconcile/slack-dms`), and writes no audit rows. The rows show a small \"from Slack\" hint.",
    ].join("\n\n"),
  },
  {
    slug: "conversations-became-hedgie-care",
    date: "2026-11-11",
    audience: "engineering",
    category: "improved",
    title: "Hedgie Care: the community manager's tracker, one engagement per reach-out period",
    summary: "The Conversations tracker became Hedgie Care: each reach-out is an engagement with a period, renewals link to the one before, and how it went is measured from the member's own activity.",
    body: [
      "`/admin/care` (`docs/HEDGIE_CARE.md`) replaces `/admin/conversations`, which was never announced and had no rows. The table is now `care_engagements` (id prefix `care_`): one row is one period, with `period_ends_on`, `renewed_from` (the engagement a renewal continues) and `ended_how`, her own read of how it went. The staff feature is `care.write`, the audit entity `care_engagement`, the timeline source `care`, and the events `care_engagement_started`, `care_message_logged`, `care_engagement_closed` and `care_engagement_renewed`. Tabs are paths: `/admin/care` (Active) and `/admin/care/earlier` (closed and lapsed).",
      "Nothing about the status is stored and no job moves it (`lib/care.ts`): needs reply, waiting, gone quiet, review due and lapsed follow from the dates and who spoke last. A member who wrote last stays on \"needs reply\" until she acts, however old the period, so no one is quietly dropped. The period length, the grace window, the quiet window and the three measured windows are settings in `app.config.ts` (`careEngagementDays` and the others), read through `lib/config.ts`. The period's last day is an Eastern calendar day, computed with calendar arithmetic so a daylight saving change cannot move it. Renewing is one database function (`renew_care_engagement`), safe against a double click.",
      "Results are counted when she opens them, never stored: prickles attended (distinct prickles), Slack messages, firsts and the distinct members they talked with other than staff, in a window before, during and after. They come from new repository methods (`ActivityRepository.countsBetween` and `firsts`, and the new `MemberInteractionRepository`), and a community manager may now read `member_interactions` (read only; it holds who and when, never what was said).",
      "Renewing asks for a short reason (it becomes the new period's note) and shows the results at that moment; closing offers four endings (handed to someone else, no reply, back in the community, ran its course), each with a one-line definition, and a renewal shows as \"Period N\". Every engagement has an owner (`owned_by`; a new one continues the owner of the member's latest, a renewal keeps it, anyone with `care.write` can reassign), with a Mine / Everyone filter and avatar chips on both tabs. The page opens with the lapsed and review-due counts and whose they are. The results also read how they stayed from membership history (the Membership Timeline's engine, `memberStatusTimeline`): active, on hiatus or cancelled at each checkpoint after the period (`careRetentionCheckpointDays`), the first time they went on hiatus or left (so a day-31 lapse shows even if they came back), and the programs they started or held with each one's length. Reminders to owners and alerts on lapse are not built (`docs/TODO.md`).",
    ].join("\n\n"),
  },
  {
    slug: "conversations-and-staff-write-access",
    date: "2026-11-11",
    audience: "engineering",
    category: "new",
    title: "Conversations for the community manager, and the first staff write access",
    summary: "A Conversations page where the community manager keeps track of her reach-outs to members, built on a new way for staff other than admins to write.",
    body: [
      "`/admin/conversations` (`docs/CONVERSATIONS.md`, step 1) replaces her spreadsheet with one row per conversation: member, reason (a hello, a welcome, a check-in, a writing check-in, encouragement), channel, who spoke last, a follow-up day, a next step and a short note. The status (needs reply, waiting on them, gone quiet, closed) is not stored: `lib/conversations.ts` derives it from the last-message times and a quiet window in `app.config.ts` (`conversationQuietDays`). For now she logs \"they replied\" and \"I replied\" by hand; steps 2 to 4 derive them from Slack DMs and email. No product entry: it is staff only.",
      "It is the first table a community manager may write, so three things changed with it. `requireStaffAction()` (`lib/admin-auth.ts`) lets an admin or a community manager into a server action, and the action then asks for the `conversations.write` staff feature, which only she and admins have (`lib/staff-access.ts`). RLS lets `is_admin()` or `is_community_manager()` read, insert and update `conversations` (no delete: a removed conversation keeps its row), without widening `is_admin()`. And `audit_row_change()` now counts a community manager as staff: it used to classify only `admin` and `assistant` that way, so her writes would have been logged as a member's own action.",
      "The data goes through `ConversationRepository` (`lib/data/conversations.ts`, with an in-memory twin and one contract suite). Opening and closing also write a `member_activities` row (source `conversations`, staff, engagement 0) so the member's timeline shows it, as outreach touches do; the audit log records the conversation's own change once, leaving out the last-message columns so logging a reply writes nothing.",
    ].join("\n\n"),
  },
  {
    slug: "chat-link-previews-for-hub-messages",
    date: "2026-11-10",
    audience: "engineering",
    category: "new",
    title: "Hub Chat makes link previews for messages written in the Hub, and authors can remove any preview",
    summary: "A link in a message sent from the Hub gets a preview card (or the picture itself, for a link to an image), behind a feature flag, and the author can remove a preview, Slack's included, with an X on the card.",
    body: [
      "Slack builds no preview for messages the Hub posts (it posts with unfurling off), so after a message is sent the server looks at its first three https links once, in `after()`, and stores what it found in `chat_link_previews` (`lib/chat/link-previews.ts`, `ChatLinkPreviewRepository`). Never at read time and never from a viewer's request; an edit fetches only links it added. A page is read by `fetchPage` in `lib/net/safe-fetch.ts` (same SSRF rules as the picture proxy, `text/html` only, the first 512 KB, a link straight to a picture answered from its headers) and its head is parsed by parse5 (`lib/chat/link-preview-html.ts`); texts are plain, capped, stripped of control and direction characters, and the picture must be https. Failed and blocked links are stored too, so they are not asked for again. Who gets previews is decided by the `chat_link_previews` flag for the sender.",
      "The table follows the message text's visibility through RLS (`chat_can_read_content`). The picture goes through `/api/chat/unfurl-image` as one more entry in the message's picture list. The author removes a card with `chat_hidden_unfurls` (`url:<address>` or `idx:<n>`), written as themselves under RLS (a Slack author matched to a member counts), for the Hub's previews and Slack's unfurls alike; the loader and the picture route drop it, and a fetch after an edit does not bring it back. See `docs/SLACK_BRIDGED_CHAT.md`, \"Link previews\".",
    ].join("\n\n"),
  },
  {
    slug: "chat-picture-proxy-and-csp",
    date: "2026-11-10",
    audience: "engineering",
    category: "improved",
    title: "Pictures under chat messages go through the Hub, and the app sends a Content-Security-Policy in report-only mode",
    summary: "Link previews, app cards and logos in chat are fetched by the Hub instead of by each viewer's browser, and every page now reports which pictures a stricter policy would block.",
    body: "Related to the product entry on Slack link previews and app cards in Hub chat. `GET /api/chat/unfurl-image?m=<message>&i=<position>` reads the message as the viewer (row-level security applies; a deleted message is a 404), lists its pictures with the same walk the renderer used (`lib/chat/unfurl-images.ts`) and fetches the one at that position, so the browser never names an address and no image host learns who looked. The fetch is `lib/net/safe-fetch.ts`: https only, ports 80 and 443, the name is resolved once and the connection is pinned to a public address (no DNS rebinding), every redirect hop is checked again, 5 MB cap while streaming, a time budget on `lib/clock.ts`, and the type is decided by the first bytes (PNG, JPEG, GIF, WebP, AVIF; SVG refused). The book-cover import shares its address checks. `next.config.ts` now sends `Content-Security-Policy-Report-Only` (`lib/csp.ts`: `img-src`, `object-src`, `base-uri`, `form-action`, `frame-ancestors`; violations go to Sentry); enforcing it, and covering scripts and styles with nonces, are in `docs/TODO.md`.",
  },
  {
    slug: "see-your-image-before-you-save-it",
    date: "2026-11-07",
    audience: "product",
    category: "improved",
    title: "See your image before you save it",
    summary: "When you pick a picture you now see it right away, and when you choose where the interesting part is, the event card and book cover previews change as you click.",
    body: "- After choosing or dropping a file in the image dialog, you see the picture itself, not just its name. (Some phone photos can't be shown by your browser; you'll see the file name instead.)\n- In the image editor, clicking the picture to mark the interesting part, or changing how a picture that isn't cover-shaped fits, moves the Event card and Book cover previews straight away. They are marked \"not saved yet\" until you save.\n- After you save a new focal point, pages that already show the image pick up the change within a minute.",
  },
{
    slug: "first-app-skeleton-and-prd",
    date: "2026-04-04",
    audience: "engineering",
    category: "new",
    title: "First app skeleton: Next.js, Tailwind and the product requirements doc",
    summary: "The repository starts as a Next.js App Router project with Tailwind, an internal landing page for stakeholders and a product requirements document rendered in the app.",
    body: "The first working commit adds `app/page.tsx` (a roadmap, feature preview and tech stack page for stakeholders) and `docs/PRD.md`, which `app/prd/page.tsx` renders as formatted markdown with the Tailwind typography plugin. Tailwind, PostCSS and TypeScript are configured here. At this point it is an internal admin portal for staff, not a member-facing app, which shaped the early decisions: dashboards and data hygiene came before anything members would touch.",
  },
  {
    slug: "magic-link-auth-and-local-supabase",
    date: "2026-04-04",
    audience: "engineering",
    category: "new",
    title: "Passwordless sign-in with Supabase magic links and a local Supabase stack",
    summary: "Sign-in is by emailed magic link only, with Next.js middleware protecting the dashboard and a Docker-based local Supabase with Mailpit for catching emails.",
    body: "`/login` asks for an email and Supabase Auth sends a magic link; `app/auth/callback/route.ts` exchanges it for a session and redirects to `/dashboard`. Client and server Supabase helpers use `@supabase/ssr`, and middleware redirects anonymous visitors away from protected routes. Local development runs Supabase in Docker and reads the emails in Mailpit instead of sending real ones. `SETUP.md` documents the flow. No passwords exist anywhere, which kept the later invite-only decision simple.",
  },
  {
    slug: "declarative-schema-and-prickles-naming",
    date: "2026-04-04",
    audience: "engineering",
    category: "new",
    title: "Declarative database schema in Bronze, Silver and Gold layers; sessions become prickles",
    summary: "The data model is written as a declarative schema file organised as a medallion architecture, and the community's own word, prickle, replaces session in the schema and code.",
    body: "`supabase/schemas/schema.sql` declares members, `zoom_attendees` (shaped like the Zoom API's participant report, with the full raw payload), prickles, attendance, member metrics and a CRM-style `member_activities` log with a flexible JSONB metadata column and a weighted engagement value. Hiatus periods live in `member_hiatus_history` as the single source of truth, with an `on_hiatus` status on members. Layers are Bronze (raw), Silver (transformed) and Gold (analytics views such as prickle popularity). A same-day migration then renamed `sessions` to `prickles`, including `session_id` to `prickle_id` and the popularity view, and the dashboard gained its first hedgehog mascot welcome. Migrations sit in `supabase/migrations`, generated from the schema file.",
  },
  {
    slug: "zoom-api-import",
    date: "2026-04-04",
    audience: "engineering",
    category: "new",
    title: "Zoom import: API client with retry and an immutable attendee table",
    summary: "Zoom meetings and participants can be imported by date range into a raw attendees table, with backoff on rate limits and no duplicates when ranges overlap.",
    body: "`lib/zoom/client.ts` does the OAuth flow and fetches meetings and participants; `POST /api/import/zoom` stores them in `zoom_attendees`, driven from an import page in the dashboard. Two hardening steps followed. The client retries 429 responses with exponential backoff (1s doubling up to 16s, five tries) and shorter backoff on transient network errors. The attendee table became effectively immutable: a unique constraint on meeting UUID, name and join time plus an upsert that ignores duplicates, so re-importing an overlapping range never doubles anyone. This is the opposite choice from the Kajabi snapshots, deliberately: a Zoom participant row is a fact, a Kajabi contact is a state.",
  },
  {
    slug: "kajabi-csv-import-and-snapshot-history",
    date: "2026-04-04",
    audience: "engineering",
    category: "new",
    title: "Kajabi CSV imports stored as temporal snapshots",
    summary: "Member data comes in from Kajabi CSV exports that are auto-detected, and every import is kept as a dated snapshot so changes over time can be seen.",
    body: "`POST /api/import/members` detects a Kajabi contacts export by its columns, and later a subscriptions export (customer email, status, subscription id; when one email has several subscriptions it picks Active over Paused over Canceled, and accepts two date formats). The raw rows go to `kajabi_members`, first as one row per email, then refactored the same evening to a history table: uuid primary key, `email`, `imported_at`, and the whole CSV row as JSONB, unique on email plus import time, and inserted rather than upserted. That keeps an audit trail and makes it possible to detect when tags or products changed, which is the basis for deriving hiatus periods. The subscriptions export was added because the contacts export left stale products on cancelled members.",
  },
  {
    slug: "member-status-rules-from-kajabi",
    date: "2026-04-04",
    audience: "engineering",
    category: "fixed",
    title: "Member status derived from Kajabi products and tags, with Offboarding first",
    summary: "Active, on hiatus and inactive are worked out from what a Kajabi contact has, and the Offboarding tag now wins over a lingering membership product.",
    body: "The first rules in `app/api/process/members/route.ts`: a membership product means active; the member tag without the product means the member paused (hiatus); neither, or an Offboarding tag, means inactive. Two fixes came from real data. Hiatus members lose the product but keep the tag, so checking tags alone missed them. Cancelled members could keep the product, so the Offboarding tag is now checked before products. The dashboard's total members count stopped including inactive people. The same commit added the Supabase style rules under `.claude/rules` that later agents followed.",
  },
  {
    slug: "member-name-matching-v1",
    date: "2026-04-04",
    audience: "engineering",
    category: "new",
    title: "Name matching in SQL: email, alias, normalized and fuzzy",
    summary: "Zoom display names can be matched to members in four steps of decreasing confidence, using a manual alias table and trigram similarity.",
    body: "A migration adds the `member_name_aliases` table, a `normalize_name()` function (case, whitespace, punctuation), `match_member_by_name()` and the `pg_trgm` extension. Priority is exact email, then manual alias, then normalized name (all high confidence), then trigram similarity of at least 0.4 (medium or low). Because Zoom attendees often join under a nickname, this ordering returns the most trustworthy match first and carries a confidence score forward. Tests covered each tier. Matching was briefly written into `zoom_attendees` and reverted the same day (see the medallion entry); the logic moved to TypeScript three days later.",
  },
  {
    slug: "medallion-processing-members-and-attendance",
    date: "2026-04-04",
    audience: "engineering",
    category: "improved",
    title: "Medallion split: imports write Bronze only, processing routes build Silver",
    summary: "Imports store raw data untouched and separate processing routes compute members and attendance, after matching logic was pulled back out of the raw Zoom table.",
    body: "The rule written down in `supabase/ARCHITECTURE.md`: Bronze tables hold only what the source said, Silver is inferred. Matching columns added to `zoom_attendees` were reverted for that reason. `POST /api/process/members` now builds `members` from the latest `kajabi_members` snapshot per email; `POST /api/process/attendance` reads `zoom_attendees` in a date range, matches each to a member (email, alias, normalized, fuzzy), creates prickles from Zoom meetings (with a `zoom_meeting_uuid` and a `zoom` source) and writes `attendance` rows with a confidence score, skipping unmatched people and reporting match rates. The follow-up doc commit also records data-flow dependencies between routes and the idea of moving to streaming later. This split is the basis of everything that followed.",
  },
  {
    slug: "first-engagement-dashboard-and-at-risk",
    date: "2026-04-04",
    audience: "engineering",
    category: "new",
    title: "First engagement dashboard with at-risk members",
    summary: "The admin dashboard shows member counts, recent prickles, top attendees and a list of active members who have not attended lately.",
    body: "`app/dashboard/page.tsx` queries member stats (total, active, on hiatus), prickles in the last 30 days, attendance totals and the top ten attendees, plus an at-risk list: active members with no recent attendance, fixed to include those with zero attendance ever. A dedicated at-risk page lists them all. These were computed live in the page, which is what the Gold layer meant at the time.",
  },
  {
    slug: "name-matching-report-and-alias-tools",
    date: "2026-04-05",
    audience: "engineering",
    category: "new",
    title: "Name matching tools: unmatched report, drag-and-drop game and alias search",
    summary: "Staff get pages that show which Zoom names did not match anyone and a quick way to link them to members as aliases.",
    body: "`/dashboard/name-matching` started as a report (active members with zero attendance, Zoom names seen three or more times without a match, and possible matches by email) backed by `app/api/reports/name-matching/route.ts`, written to push the match rate beyond the roughly 92 percent the automatic rules achieved. It became an interactive drag-and-drop pairing page (`MatchingGame.tsx`) saving through `app/api/aliases/route.ts`, then gained `/dashboard/aliases`, a search-and-autocomplete form that can attach a name to any member, since writers can have several identities, pen names and emails. The unmatched list was changed to use the real match function instead of a lookalike query, so it cannot disagree with processing.",
  },
  {
    slug: "google-calendar-sync-bronze-to-silver",
    date: "2026-04-05",
    audience: "engineering",
    category: "new",
    title: "Google Calendar sync into a Bronze events table, processed into prickles",
    summary: "The community calendar is read with a service account into raw calendar events, and a separate step turns those into prickles, so the schedule is rebuilt from source.",
    body: "The first version used OAuth with a stored refresh token and upserted straight into prickles; it was replaced the same day by a Google service account (the calendar is shared with it, no token expiry or user interaction). The next refactor applied the medallion rule: `POST /api/sync/calendar` writes unmodified events (full event JSON, creator and organizer) to the Bronze `calendar_events` table, idempotently by upsert, defaulting to 30 days back and 90 forward, and `POST /api/process/calendar` transforms them to prickles. Processing extracts the prickle type and host from titles shaped like a type, then w/, then a host, and normalises type spellings. `docs/CALENDAR_SETUP.md` and `CALENDAR_SYNC.md` describe the setup and automation options.",
  },
  {
    slug: "first-pagination-and-row-limit-lesson",
    date: "2026-04-05",
    audience: "engineering",
    category: "fixed",
    title: "PostgREST row limit hit: raise-the-limit abandoned for real pagination",
    summary: "Calendar processing silently saw only 1000 events; the fix was to page through results in batches rather than keep raising the server limit.",
    body: "Supabase's API returns at most `max_rows` rows no matter what `.limit()` asks for. The first fix raised `max_rows` in `supabase/config.toml` to 10000, then settled at 5000, but the real change was `/api/process/calendar` reading events in 1000-row batches with `.range()`. The reasoning recorded in the commit: a hardcoded ceiling is only a delay, while paging works for any volume. This became the project's standing rule (paginate anything that can exceed 1000 rows), and the next day regression tests were added for it.",
  },
  {
    slug: "prickle-types-and-popup-prickles",
    date: "2026-04-05",
    audience: "engineering",
    category: "new",
    title: "Prickle types table, host parsing and Pop-Up Prickles",
    summary: "Prickles now have a type from a lookup table, a host linked to a member, and unscheduled Zoom meetings become Pop-Up Prickles.",
    body: "A migration removes the free-text title from prickles in favour of `type_id` pointing at a seeded `prickle_types` table (13 types, such as Progress, Pop-Up and Heads Down), with admin screens at `/dashboard/prickle-types`. `lib/prickle-types.ts` normalises variants of a type name and parses the type and host from calendar titles; events it cannot place go into an unmatched calendar events queue for staff to review. A Zoom meeting that overlaps a calendar prickle by at least 15 minutes is matched to it; one that does not becomes a Pop-Up Prickle (PUP). Later the same day `prickles.host` changed from text to a foreign key to members, which also enabled member detail pages with attendance history and a marker on prickles they hosted.",
  },
  {
    slug: "attendance-segmentation-rules",
    date: "2026-04-05",
    audience: "engineering",
    category: "improved",
    title: "Attendance processing rewritten to split Zoom meetings into prickle segments",
    summary: "A long Zoom meeting is now cut into scheduled prickles and pop-ups by documented time rules, and each attendee is assigned by when they were actually present.",
    body: "The first matcher treated each attendee alone and produced overlapping or very long PUPs. The rewrite in `app/api/process/attendance/route.ts` follows the analytics logic of the earlier Python tool: it handles a whole meeting as a unit and splits it into segments. Early and late arrivals of up to 20 minutes are absorbed by the first and last scheduled prickle, longer ones form separate PUPs, and gaps between scheduled prickles become PUPs. A three-pass algorithm (match calendar prickles, create PUPs only from attendees who matched no calendar prickle, then write attendance) fixed PUP windows that stretched across a day. Attendance in a PUP counts only above 15 minutes, using each attendee's own join and leave times, so showing up early for the next prickle is not credited as a PUP. `docs/ATTENDANCE_RULES.md` lists every threshold (20, 15 and 5 minutes for host-late warnings) with rationale.",
  },
  {
    slug: "calendar-heatmap-and-prickle-pages",
    date: "2026-04-05",
    audience: "engineering",
    category: "new",
    title: "Weekly calendar view, prickle detail page and host warnings",
    summary: "Staff can browse a seven-day calendar of prickles with attendance, open a prickle, and see warnings where a host is missing or late.",
    body: "`app/dashboard/calendar` renders a week grid from prickles and attendance (Sunday-first), with a timezone selector, tooltips, an option to show or hide pop-ups, and detail pages at `/dashboard/prickles/[id]`. Host warnings flag prickles with no host or one who arrived late. Several fixes in the day dealt with Next.js 15 async `searchParams` and with week parameters parsed in the wrong timezone, a class of bug that recurs in later weeks.",
  },
  {
    slug: "dashboard-charts-and-kpis",
    date: "2026-04-05",
    audience: "engineering",
    category: "new",
    title: "Dashboard charts and a short list of engagement KPIs",
    summary: "The dashboard gained attendance charts and was then trimmed to five key metrics.",
    body: "Added a stacked weekly attendance bar chart with unique attendees and tooltips, a weekly engagement rate (measured over the last seven days rather than a calendar week) and median hours, and a blue and green palette for contrast. After trying several KPIs the dashboard was cut down to five. The data is still computed in the page queries rather than stored.",
  },
  {
    slug: "rls-invite-only-and-admin-shell",
    date: "2026-04-05",
    audience: "engineering",
    category: "new",
    title: "Row Level Security on every table, invite-only sign-in and a navigation shell",
    summary: "All tables got RLS and a user profile with a role, public sign-up was turned off, and the admin area got a collapsible navigation.",
    body: "A migration creates `user_profiles` (role admin, assistant or member), enables RLS on all Bronze, Silver and Gold tables, adds an `is_admin()` helper and a trigger that creates a profile on sign-up. At this stage every authenticated user was an admin with full access, with the policies written so they can be refined per role later; `docs/RLS_SECURITY.md` records the migration path. `enable_signup = false` in `supabase/config.toml` means accounts are created only by invitation (`docs/INVITING_USERS.md`). The navigation was reorganised into Data Hygiene and Data Management sections.",
  },
  {
    slug: "vercel-supabase-deployment-guide",
    date: "2026-04-05",
    audience: "engineering",
    category: "new",
    title: "Deployment to Vercel and a hosted Supabase project documented",
    summary: "A step-by-step guide covers creating the Supabase project, pushing migrations, configuring Vercel and a security checklist before going live.",
    body: "`docs/DEPLOYMENT.md` and `.env.example` describe the project setup, which environment variables are needed and where to turn off public signups, plus troubleshooting. Fixes the same evening were for TypeScript errors in chart formatters and the host relationship that only the production build caught, which led later to a pre-commit build check.",
  },
  {
    slug: "batch-processing-for-timeouts",
    date: "2026-04-06",
    audience: "engineering",
    category: "improved",
    title: "Processing routes load reference data once and write in batches",
    summary: "Calendar and attendance processing dropped from thousands of sequential queries to a few dozen, which got them under the serverless time limit.",
    body: "Production processing timed out because routes ran a query per event or attendee (about 6500 for 1337 calendar events, about 1200 for attendance, including one name-matching RPC per attendee). Both routes now load prickles, members, aliases and types up front with `Promise.all()`, match in memory with Map lookups, and write in chunks of 100 to 500 with parallel execution. Process and sync routes also declare `maxDuration = 60` (the default was 10 seconds). These became the written API performance rules in `CLAUDE.md`.",
  },
  {
    slug: "pagination-regression-tests-and-claude-rules",
    date: "2026-04-06",
    audience: "engineering",
    category: "new",
    title: "Pagination regression tests and the first CLAUDE.md architecture rules",
    summary: "After calendar processing silently dropped events past the first 1000, tests and project instructions were added so it could not happen again.",
    body: "`tests/api/process-calendar-pagination.test.ts` checks behaviour (1500 events all processed) and the code shape (range-based pagination present, a single unpaginated query absent). `CLAUDE.md` was created with the database query limit rule, the API route performance rules and a code review checklist, so that agents working in the repo load them every session. A bug found later the same day was an unmatched-events query that loaded only events matching a list of ids; it was changed to page everything by date range, and batch deletes were chunked to stay under the limit of `.in()` filters.",
  },
  {
    slug: "attendance-allows-leave-and-rejoin",
    date: "2026-04-06",
    audience: "engineering",
    category: "improved",
    title: "Attendance keeps one row per stay: multiple records per member and prickle",
    summary: "The unique constraint on member and prickle was dropped so someone who leaves and rejoins a prickle has both stays recorded.",
    body: "Deduplicating attendance on (member_id, prickle_id) first fixed an upsert failure (every row was rejected with Postgres error 21000 because two rows conflicted in one statement), but merging a stay from 9:00 to 9:30 with another at 11:00 to 11:30 would have reported a span of 150 minutes instead of 60. A migration drops the `attendance_member_id_prickle_id_key` constraint, processing uses plain inserts, and tests assert that counting uses `COUNT(DISTINCT prickle_id)` while time is the sum of the segments. The design rule is recorded in `CLAUDE.md` as a standing instruction not to reintroduce the constraint.",
  },
  {
    slug: "centralized-member-matching-library",
    date: "2026-04-06",
    audience: "engineering",
    category: "improved",
    title: "One TypeScript library for matching names to members",
    summary: "The routes that matched Zoom names to members each did it their own way; a shared library with one priority order replaced them.",
    body: "`lib/member-matching.ts` matches by email, then alias, then normalized name, in one place, with 18 tests and `docs/MEMBER_MATCHING.md`. It was introduced because a quarter of active members showed zero attendance purely from name mismatches. Seed aliases were added in a CSV for the common cases. On April 7 the SQL stored procedures were deleted in favour of this code, matching became case-insensitive, and a smart-matching step handled variants without needing an alias. The processing routes and the hygiene dashboard were moved to call the same function so the counts agree. A later fix trimmed trailing whitespace from Zoom names before the alias lookup, and calculated a meeting window from matched attendees only, which removed pop-ups with zero attendees.",
  },
  {
    slug: "reprocessability-principle-and-tests",
    date: "2026-04-06",
    audience: "engineering",
    category: "new",
    title: "Reprocessability: Silver is rebuilt from Bronze with delete and insert, with tests",
    summary: "Silver processing was changed to delete the affected rows and insert fresh ones, so a deleted source event disappears, and regression tests were added for it.",
    body: "Selective inserts and updates had left orphans: an event deleted in Google Calendar stayed in prickles. A later change switched calendar and members processing (attendance already did) to DELETE then INSERT within the scope, and the principle was documented in `CLAUDE.md` with correct and incorrect examples and a status table. Tests under `tests/api/reprocessability` verify four things: first run creates rows, reprocessing after source deletion removes them, changed source updates them, and orphans are detected. To let those integration tests call the routes, the three `/api/process/*` routes accept the service role key in the Authorization header as well as cookies, with a helper in the tests. The members route later stopped deleting all members (see the April 23 entries), because it regenerated member ids.",
  },
  {
    slug: "bronze-idempotency-tests-and-sync-race-fix",
    date: "2026-04-06",
    audience: "engineering",
    category: "new",
    title: "Idempotency tests for every Bronze import, and a calendar sync race fixed",
    summary: "Each import (calendar, Zoom, members) is tested to be safe to run repeatedly, after a concurrent sync caused duplicate key errors in production.",
    body: "Suites in `tests/api/idempotency/` check that a first import creates rows, a second with the same data creates none, changed data updates (upsert) or adds a new snapshot (append), and several cycles are stable. They cover three patterns: upsert on a natural key, upsert that ignores duplicates, and append-only snapshots. The race fix: the calendar sync checked for existing events first and then inserted, so two overlapping requests collided on `google_event_id`; the insert became an upsert on that key as the final guard. A test helper seeds reference tables, and `docs/TEST_INFRASTRUCTURE_PLAN.md` set out a phased plan (fixtures, mocked external APIs, per-suite databases) for the shared-database interference the tests suffered from.",
  },
  {
    slug: "staff-bronze-table",
    date: "2026-04-06",
    audience: "engineering",
    category: "new",
    title: "Staff table so team members who are not in Kajabi still become members",
    summary: "Owners, staff and contractors are kept in their own table and combined with Kajabi contacts when members are processed.",
    body: "The `staff` table is an internal source of truth for people who do not pay through Kajabi. Members processing reads two Bronze sources, `kajabi_members` and `staff`, into `members`, which gained a `source` column, a `staff_role` and a `user_id` that links to the auth user for admin access. Without it, staff who host or attend prickles showed up as unmatched Zoom names. The processing UI shows the breakdown by source, and a duplicate-by-email problem when combining the sources was fixed on April 10.",
  },
  {
    slug: "unmatched-calendar-events-queue-and-decisions",
    date: "2026-04-06",
    audience: "engineering",
    category: "improved",
    title: "Staff decisions on unmatched calendar events survive reprocessing",
    summary: "Events staff resolve or ignore stay that way after the calendar is reprocessed, and prickles can have a fun title separate from their type.",
    body: "Because processing now deletes and rebuilds prickles, the review queue would have asked the same questions after every run. Processing loads previous resolved and ignored decisions first: resolved events use the stored type, ignored events are skipped, and the UI reports auto-resolved and ignored counts. Related changes the same day: a partial-match fallback for type names, a `title` column for named prickles that is stored only when it differs from the type, fixing a type whose normalised name in seed data did not match what the normaliser produces, and unmatched event cleanup in batches. Orphaned aliases are removed when members are processed, since member ids changed on each run at the time.",
  },
  {
    slug: "data-hygiene-dashboard-orphans-and-ignored-names",
    date: "2026-04-07",
    audience: "engineering",
    category: "new",
    title: "Data hygiene dashboard: orphaned events and meetings, ignored Zoom names, host coverage",
    summary: "Staff get a health page that finds source data that never made it into prickles, with buttons that reprocess exactly the affected range.",
    body: "Under `/hygiene` the dashboard counts calendar events that are in neither prickles nor the unmatched queue (found to come from events imported just outside the processed date range) and Zoom meetings with no prickle, each with a button that calls the matching `/api/process/*` route over the exact range instead of a guess; a fixed six-month fallback was removed in favour of a clear error. A bug was fixed where the orphaned-meetings count used every attendee's window while processing used only matched attendees, so the number never fell to zero after processing; a regression test was added. An `ignored_zoom_names` table with `/api/zoom/ignore` lets staff mark bots and test accounts so they leave the unmatched list, the unmatched page can show the prickles a name appeared in, and a host assignment percentage was added so missing hosts become visible. The URL structure was flattened into `/calendar`, `/data/*` and `/hygiene/*`.",
  },
  {
    slug: "reprocessing-boundary-fixes-overlap-queries",
    date: "2026-04-07",
    audience: "engineering",
    category: "fixed",
    title: "Reprocessing fixed for meetings that cross midnight and for deleted source data",
    summary: "Processing now deletes and selects everything that overlaps the date range, and always cleans up before checking whether there is new data.",
    body: "Three reprocessability bugs, each with a regression test. First, the range queries used containment (start and end both inside), so a prickle from 11:30 PM to 12:30 AM was neither deleted nor selected and orphans accumulated; they became overlap queries (starts before the range ends, ends after it starts). Second, date-only inputs such as 2026-04-07 meant midnight, so the range end was normalised to the start of the next day. Third, attendance processing returned early when no attendees were found, before its DELETE statements ran, so removing Bronze data never removed the Silver pop-ups; the deletes now run first. A `test seed` fix for prickle types was needed for those tests.",
  },
  {
    slug: "member-pages-network-graph-and-attendance-calendar",
    date: "2026-04-07",
    audience: "engineering",
    category: "new",
    title: "Member detail pages gain an attendance calendar and a network graph",
    summary: "A member page can show attendance as a month calendar, and a new page draws who attends prickles together as a graph.",
    body: "`app/dashboard/members/[id]/AttendanceCalendar.tsx` adds a monthly grid with up to three prickles per day and a details panel for the chosen day, with list and calendar subtabs. `/dashboard/members/network` is a force-directed graph with its own physics simulation: node size from total attendance, edge thickness from co-attendance, the top 50 connections by default, search and click to focus one member, and pan and zoom controls. Fixes for hydration mismatches in the sidebar, a mobile navigation flicker and filtering of edges for calendar prickles accompanied it.",
  },
  {
    slug: "profile-theme-and-timezone-preferences",
    date: "2026-04-07",
    audience: "engineering",
    category: "new",
    title: "Profile settings: theme in the browser, timezone in the database",
    summary: "Users can pick light, dark or system theme and a timezone, stored in different places on purpose.",
    body: "Theme uses `next-themes` with class-based dark mode in Tailwind and is kept in localStorage because it is a device choice. The timezone preference is a `timezone_preference` column on `user_profiles` with an RLS policy so users can update their own row, set through a server action, with 40 or more zones grouped by region and defaulting to the browser's zone; calendars and timezone dropdowns use it as default. The reason for the split is documented in comments in the switcher components. The same day a bug where creating users in Studio failed was fixed: the profile-creating trigger runs as the auth admin role, which lacks the public schema in its search path, so the function now qualifies `public.user_profiles` and sets `search_path`.",
  },
  {
    slug: "kajabi-external-ids-and-api-options",
    date: "2026-04-08",
    audience: "engineering",
    category: "improved",
    title: "Kajabi and Stripe ids merged across imports; automation options researched",
    summary: "Member records pick up both a Kajabi contact id and a Stripe customer id even though they come from different CSV exports.",
    body: "Contacts exports carry the Kajabi contact id and subscriptions exports carry the Stripe customer id (as the provider id when the provider is Stripe), so using only the latest snapshot lost one of them. Processing now groups snapshots by email, takes the core fields from the latest, and the first non-null external id from any snapshot, which feeds Kajabi and Stripe links on the member page header. `docs/KAJABI_API_SETUP.md` and an analysis document compare three ways to stop exporting by hand: the Kajabi API, bulk export, and Zapier or Make versus a browser scraper.",
  },
  {
    slug: "slack-bronze-tables-and-csv-export-import",
    date: "2026-04-09",
    audience: "engineering",
    category: "new",
    title: "Slack data lands in Bronze: tables, an export script and a CSV import",
    summary: "Slack messages, reactions, channels and users are stored raw, loaded first from an exported set of CSV files.",
    body: "A migration adds `slack_messages` (unique on channel and message timestamp, with a `deleted_at` soft delete), `slack_reactions` (unique per message, reaction and user), `slack_channels` and `slack_users`, plus an `ignored_slack_users` hygiene table and a `source` column on `member_name_aliases` for Slack aliases and Slack activity types. `scripts/export-slack-data.ts` (built on `@slack/web-api`, run with tsx) exports users, channels, messages and reactions and auto-joins public channels (a `channels:join` scope in the checked-in app manifest, which holds placeholders only). `POST /api/import/slack` parses the CSVs, including fields with embedded newlines, accepts the service role key for scripts, and `SlackImportForm` uploads four files at once. The unmatched users report, manual alias creation and skip-a-non-member APIs support the next step.",
  },
  {
    slug: "slack-processing-and-member-activity",
    date: "2026-04-09",
    audience: "engineering",
    category: "new",
    title: "Slack processing into member activities, with matching and reprocessability tests",
    summary: "Slack messages and reactions become member activity rows, matched to members by a dedicated library, and shown on member pages.",
    body: "`lib/slack-matching.ts` matches Slack users to members, and `POST /api/process/slack` follows the pipeline rules: paginated Bronze reads, in-memory matching, DELETE then INSERT into `member_activities` in chunks of 500, deleted messages and removed reactions skipped, an engagement value derived from message characteristics, and `maxDuration` of 300. Reprocessability, import idempotency and matching tests were added with it. On April 10 member pages gained a Slack Activity section (message and reaction counts, last 30 days, active channels, a recent feed with emoji rendering and links), and later filters by type and channel.",
  },
  {
    slug: "bronze-schema-and-prickle-attendance-rename",
    date: "2026-04-22",
    audience: "engineering",
    category: "improved",
    title: "Bronze tables move into their own Postgres schema; attendance becomes prickle_attendance",
    summary: "Raw import tables now live in a bronze schema and each table is labelled Bronze, Local or Silver, so the layers are visible in the database.",
    body: "Following the architecture-foundation spec, migrations create a `bronze` schema and move `kajabi_members`, `calendar_events`, the Zoom tables (adding a `zoom_meetings` table), `subscription_history` and the Slack tables into it, and `attendance` is renamed `prickle_attendance` (29 files of code updated in a separate commit). Table comments declare the layer: Bronze is raw data with idempotent imports, Local is operational data this app owns and never reprocesses, Silver is derived and reprocessable. PostgREST had to be told: the `bronze` schema was added to exposed schemas and the search path, queries use `.schema('bronze').from()`, and grants were added for the new tables.",
  },
  {
    slug: "member-email-aliases-and-merged-identity",
    date: "2026-04-22",
    audience: "engineering",
    category: "new",
    title: "Email aliases so one person with several addresses is one member",
    summary: "A member who appears in Kajabi under more than one email is merged into one record, with external ids combined.",
    body: "The Local table `member_email_aliases` maps alternative emails to a canonical one. Members processing resolves aliases first, deduplicates by the canonical email and merges Kajabi and Stripe ids across all of a person's addresses. It follows the member identity management spec in the docs.",
  },
  {
    slug: "auto-processing-dependency-triggers",
    date: "2026-04-22",
    audience: "engineering",
    category: "new",
    title: "Imports and local changes now trigger Silver reprocessing automatically",
    summary: "After an import, or after staff change an alias, an ignored name or a prickle type, the affected Silver data is rebuilt without a button press.",
    body: "`lib/processing/trigger.ts` knows which Silver layers depend on which source and runs them in order. Bronze imports reprocess the date range they covered; changes to Local tables (name aliases, ignored Zoom names, prickle types, bulk alias application) reprocess the last 90 days by default. The dependency map is an ordering constraint only: a later fix noted that members changing should not force prickles and attendance to reprocess. Hiatus processing (from `subscription_history` into `member_hiatus_history`) was added after members, and Slack processing was added too. The manual process buttons on import cards were replaced by a Manual Reprocessing section for custom ranges, and import responses now wait for processing and show its results. The Zoom import fixed its conflict key to meeting, participant id and join time and began filling `zoom_meetings`.",
  },
  {
    slug: "default-hosts-and-missing-hosts-page",
    date: "2026-04-23",
    audience: "engineering",
    category: "new",
    title: "Prickle types can require a host and name a default one",
    summary: "Staff can say which prickle types need a host and who hosts by default, so the host health metric counts only real gaps.",
    body: "Migrations add `requires_host` and `default_host_id` to `prickle_types` and two more seeded types, and fix RLS policies for `prickle_attendance`, `member_name_aliases` and the Bronze tables so upserts work for signed-in users. Calendar processing falls back to the default host when a title has no host in it. A missing hosts page with member autocomplete lets staff assign defaults. The host assignment card now shows a percentage over only prickles requiring a host (93 percent instead of 53 in the commit's example). Shared `formatters` and a `Modal` component were extracted in the same pass.",
  },
  {
    slug: "daily-reconciliation-cron-jobs",
    date: "2026-04-23",
    audience: "engineering",
    category: "new",
    title: "Nightly reconciliation of calendar, Zoom and members from Vercel Cron",
    summary: "Three scheduled jobs re-fetch the last 90 days from Google Calendar and Zoom and rebuild members, as a safety net for anything live updates miss.",
    body: "`/api/reconcile/calendar`, `/api/reconcile/zoom` and `/api/reconcile/members` upsert into Bronze (calendar and Zoom from their APIs; members from the latest Kajabi snapshot, since Kajabi was imported by CSV then) and trigger Silver reprocessing. `vercel.json` schedules them at 2:00, 2:30 and 3:00, staggered so calendar data exists before attendance needs it. They authenticate with a `CRON_SECRET` bearer or a signed-in user. A README documents the jobs. This is the start of the rule that nothing may depend on webhooks alone.",
  },
  {
    slug: "realtime-webhooks-and-signature-verification",
    date: "2026-04-23",
    audience: "engineering",
    category: "new",
    title: "Webhook receivers for Google Calendar, Zoom and Slack with signature checks and tests",
    summary: "Live updates arrive at webhook endpoints that verify who sent them, write to Bronze and start processing without making the sender wait.",
    body: "`/api/webhooks/calendar`, `/zoom` and `/slack` upsert to Bronze, fire Silver processing and answer 200 quickly; the Slack route uses the service role client because no user session exists. The first version only marked verification as a TODO. Three days later it was implemented: Google channel token, Zoom HMAC-SHA256 signature, and Slack HMAC-SHA256 with a five minute timestamp window, each degrading gracefully when a secret is unset. Tests use Mock Service Worker with fixtures based on official payload documentation (27 tests, four skipped pending a test database), with `docs/WEBHOOK_TESTING.md` and setup docs.",
  },
  {
    slug: "atomic-reprocessing-functions",
    date: "2026-04-23",
    audience: "engineering",
    category: "improved",
    title: "Atomic reprocessing in SQL functions so readers never see half-rebuilt data",
    summary: "Prickles, attendance and members are replaced inside one database transaction instead of a delete followed by separate inserts.",
    body: "Migrations add `reprocess_prickles_atomic` (date-scoped calendar prickles), `reprocess_prickle_attendance_atomic` (date-scoped attendance and pop-ups, using CTEs to insert PUPs, map client-side temporary ids to real ones and insert attendance referencing both) and `reprocess_members_atomic`. They are split one function per migration file because the local migration runner cannot send several CREATE FUNCTION statements in one prepared statement; batch sizes were also reduced to stay under URI length limits. The processing routes call them through RPC.",
  },
  {
    slug: "stable-member-ids-identity-vs-event-entities",
    date: "2026-04-23",
    audience: "engineering",
    category: "fixed",
    title: "Members are upserted by email so ids and relationships survive reprocessing",
    summary: "Rebuilding members by delete and insert gave everyone a new id and orphaned aliases, hosts and attendance, so members now keep their ids.",
    body: "The earlier delete-and-insert members processing was a mistake for an identity table. The atomic function now upserts by email: the same email keeps the same id, so aliases, prickle hosts and attendance foreign keys stay valid, and people who leave are kept as inactive rather than removed. The architecture spec was updated to separate two patterns: identity entities (members, products, channels) are upserted by a stable key over the full table, event entities (prickles, attendance) are deleted and inserted by scope so orphans disappear. Alias reprocessing also now triggers calendar processing, and attendance is reprocessed when calendar prickles change.",
  },
  {
    slug: "precommit-build-hook",
    date: "2026-04-27",
    audience: "engineering",
    category: "new",
    title: "Pre-commit hook that runs the production build",
    summary: "A git hook runs the production build before each commit so type errors that only appear in a strict build are caught locally.",
    body: "`scripts/install-hooks.sh` installs a hook running `npm run build` and blocking the commit if it fails, with `--no-verify` as an escape hatch. It was added after several deployments failed on type errors that the dev server had accepted (missing interface properties, null safety, mismatches), including two fixes on April 26.",
  },
  {
    slug: "kajabi-and-slack-api-imports",
    date: "2026-04-28",
    audience: "engineering",
    category: "new",
    title: "Kajabi and Slack imported straight from their APIs",
    summary: "Production imports pull from the Kajabi and Slack APIs, and the CSV uploads moved to a separate testing page.",
    body: "`lib/kajabi/client.ts` uses the OAuth client credentials flow, caching the access token until 90 percent of its life, with paginated JSON:API fetches and a required site filter. `POST /api/sync/kajabi` imports contacts and purchases. Kajabi has no subscriptions endpoint, so subscriptions are read from purchases (a null deactivation time means active, amounts converted from cents), and customers are fetched and joined by id because the purchase lacks the email that hiatus processing groups by; purchases with no customer are skipped with a warning. `POST /api/import/slack-api` imports messages and reactions for a 7, 30 or 90 day window, auto-joining public channels, with a five minute duration. Both write Bronze idempotently and trigger processing. `/data/import` now shows API imports, and `/data/import/testing` keeps the CSV forms for development. Several commits that day only added pagination logging while diagnosing a page of 100 records.",
  },
{
    slug: "kajabi-bronze-tables-and-api-sync",
    date: "2026-05-12",
    audience: "engineering",
    category: "new",
    title: "Kajabi data imported through its API into Bronze tables",
    summary:
      "Contacts, customers, purchases and offers from Kajabi now land in their own raw tables, fetched through Kajabi's API instead of CSV uploads.",
    body: [
      "Migrations added `kajabi_contacts`, `kajabi_customers`, `kajabi_purchases` and `kajabi_offers` in the Bronze schema, and the older `subscription_history` and `member_hiatus_history` tables were marked deprecated because purchases (and later Stripe subscriptions) replace them.",
      "`lib/kajabi/client.ts` and `app/api/sync/kajabi/route.ts` talk to Kajabi with an OAuth 2.0 client-credentials token. Kajabi's responses are JSON:API with everything under `attributes`, every request needs a site filter or the API returns a 500, and the purchases endpoint gives no total page count, so paging stops when a page comes back short. A customer's email is not on the purchase, so the import fetches customers separately and joins on the customer id.",
      "Subscriptions are purchases in Kajabi, not a separate resource, which is why the later membership logic reads purchases.",
    ].join("\n\n"),
  },
  {
    slug: "stripe-bronze-layer-and-upsert-functions",
    date: "2026-05-12",
    audience: "engineering",
    category: "new",
    title: "Stripe customers, products and subscriptions imported into Bronze",
    summary:
      "A Stripe client and import route copy customers, products and subscriptions into raw tables, so we can tell active from paused or cancelled members.",
    body: [
      "Kajabi's API does not expose a paused subscription, so Stripe is treated as the authority for active, paused and cancelled. `lib/stripe/client.ts`, `app/api/sync/stripe/route.ts` and an import form on the data import page do the fetch; migrations create the Bronze Stripe tables.",
      "The data was kept Bronze-only at first, and not merged into Silver until the reconciliation rules were settled.",
      "Writes go through the SQL functions `upsert_stripe_customers`, `upsert_stripe_products` and `upsert_stripe_subscriptions`, because the PostgREST schema cache did not see the newly migrated tables right away. The subscription period dates were not on the root object in the Stripe API version used, so they were read with a cast, pending typings.",
    ].join("\n\n"),
  },
  {
    slug: "member-processing-from-kajabi-bronze",
    date: "2026-05-12",
    audience: "engineering",
    category: "improved",
    title: "Member processing rebuilt on the Kajabi Bronze tables",
    summary:
      "The members step now reads Kajabi contacts and purchases from Bronze, so it can be re-run from raw data at any time.",
    body: [
      "`app/api/process/members/route.ts` was rewritten to read `kajabi_contacts` and `kajabi_purchases` instead of the legacy CSV-import tables, which makes the Silver `members` table fully reprocessable from Bronze plus Local data.",
      "In `lib/member-matching.ts`, a member alias now carries a `source` ('zoom' or 'slack'), and `matchAttendeeToMember` returns an explicit ambiguous result when more than one member fits, instead of null, so callers must handle that case.",
    ].join("\n\n"),
  },
  {
    slug: "member-status-overrides-and-ambiguous-zoom-names",
    date: "2026-05-12",
    audience: "engineering",
    category: "new",
    title: "Local tables for status overrides and ambiguous Zoom names",
    summary:
      "Staff can record people who should count as active despite billing data (gifts, hiatus), and names that Zoom attendance cannot resolve to one member are tracked.",
    body: [
      "`member_status_overrides` is a Local-layer table, a source of truth like `member_name_aliases` and not derived from Bronze. It covers gifted or comped access (for example a program, hosting or compensation), hiatus, and other special cases. An admin page (`/dashboard/member-overrides` at the time) and `/api/member-overrides` manage it.",
      "`ambiguous_zoom_names`, with an upsert function, records Zoom display names that match several members so they can be resolved by hand later.",
      "`lib/supabase/api-auth.ts` gained a shared service-role bypass so integration tests can call protected routes without a browser session. A seed note: truncating `members` cascades into `prickle_types`, so the seed must re-create the Pop-Up Prickle type.",
    ].join("\n\n"),
  },
  {
    slug: "kajabi-stripe-reconciliation-dashboard",
    date: "2026-05-12",
    audience: "engineering",
    category: "new",
    title: "Reconciliation dashboard comparing Kajabi and Stripe",
    summary:
      "An admin report finds members whose Kajabi status and Stripe subscription disagree, so staff know where to act.",
    body: [
      "`/api/analyze/subscription-reconciliation` and a reconciliation page compare the two sources, limited to membership offers (payment plans and retreats are ignored on both sides). A paused Stripe subscription with an inactive Kajabi record is correct and is not flagged; only real mismatches are.",
      "Matching goes by email to `kajabi_customers` and then to purchases by customer id, because `members.kajabi_id` turned out to be stale. The analysis was written up in docs/STRIPE_KAJABI_COMPARISON.md and related files. Tests for the overrides and reconciliation routes were added in the same stretch, using the real database with the service-role helper.",
    ].join("\n\n"),
  },
  {
    slug: "react-email-auth-templates-and-mailpit-tests",
    date: "2026-05-13",
    audience: "engineering",
    category: "new",
    title: "Branded sign-in emails built with React Email, with client-compatibility tests",
    summary:
      "The invite, confirmation, recovery, magic link and email-change emails are now React Email components with inline styles, and tests check how well they render across email clients.",
    body: [
      "Plain HTML templates lost their style blocks in Gmail, so the templates were moved to React Email, which renders inline styles. The rendered HTML stays committed in `supabase/templates/` so a fresh clone works without credentials, and `templates:render` regenerates it locally. A sync script pushes the templates to Supabase through the Management API so they stay in source control. Supabase's Go template variables are passed through as literal strings and substituted by its mailer.",
      "Tests send each email to Mailpit over its HTTP API and read its HTML check report. One suite requires 80 percent support across all clients as a regression detector; a second covers the five biggest client families (Apple Mail, Gmail, Outlook, Samsung, Yahoo) and was raised to 95 percent. The tests skip if Mailpit is not running.",
    ].join("\n\n"),
  },
  {
    slug: "hub-rename-node-pin-and-vercel-analytics",
    date: "2026-05-14",
    audience: "engineering",
    category: "improved",
    title: "Project renamed to Hedgie Hub, Node pinned, Vercel Analytics added",
    summary:
      "The admin portal became Hedgie Hub (serving members and staff), Node 24 is pinned, and page views and web vitals are tracked in Vercel.",
    body: [
      "The package and docs moved from admin-portal to hub, with a new domain, because the app now serves members as well as staff. `.nvmrc` pins Node 24 LTS and the Vercel CLI was bumped to v54. The env sync script answers the git-branch prompt Vercel shows for preview environments.",
      "Vercel Analytics and Speed Insights were added to the root layout.",
    ].join("\n\n"),
  },
  {
    slug: "admin-and-member-route-groups-with-route-protection",
    date: "2026-05-14",
    audience: "engineering",
    category: "new",
    title: "Admin and member route groups, with auth required by default",
    summary:
      "The app is split into an admin area and a member area, and everything except public routes now requires a signed-in user with the right role.",
    body: [
      "Admin pages moved into `app/(admin)/admin/` with their own layout and `AdminNavigation`; a `(member)` group got its own layout and `MemberNavigation`, a calendar of the member's own attendance, and profile pages. The root redirect sends admins to /admin and members to the calendar. Shared pieces (`UserMenu`, `SignOutButton`, `CalendarWeekView`) moved to `components/`.",
      "`lib/supabase/middleware.ts` now redirects anonymous users on all non-public routes, but skips /api, which authenticates itself. A `requireAdmin()` helper in `lib/supabase/api-auth.ts` is applied to every non-webhook API handler. The default role in `user_profiles` changed from admin to member, and the middleware tolerates Supabase fetch failures.",
      "A fix replaced `user_profiles` row-level security policies that recursed infinitely, and the profile trigger now schema-qualifies `public.user_profiles`.",
    ].join("\n\n"),
  },
  {
    slug: "sudo-mode-signed-cookie-and-effective-identity",
    date: "2026-05-15",
    audience: "engineering",
    category: "new",
    title: "Sudo mode: admins browse as a member, via a signed cookie",
    summary:
      "An admin can view the app as a chosen member; the choice is carried in a tamper-proof cookie and a banner shows it.",
    body: [
      "`lib/sudo.ts` signs a cookie of admin id, member id and an HMAC (using `SUDO_SECRET`, compared with `timingSafeEqual`). `getEffectiveIdentity(user)` returns the sudo'd member only when the cookie's admin id matches the signed-in user and that user's `user_profiles.role` is admin; otherwise the user's own member record. It returns `memberId`, `memberName`, `memberEmail` and `isSudo`.",
      "`startSudo` and `exitSudo` server actions, a banner and a Sudo As entry in the user menu complete it. Exit clears the cookies unconditionally and validates the return URL. Member pages are expected to use the effective identity and not the raw auth user.",
    ].join("\n\n"),
  },
  {
    slug: "streak-computation-and-member-profile-pages",
    date: "2026-05-16",
    audience: "engineering",
    category: "new",
    title: "Weekly streak computation and member profile pages",
    summary:
      "A tested streak utility counts consecutive weeks of attendance, and a member profile page shows attendance history and streaks.",
    body: [
      "`lib/streaks.ts` groups join times into weeks and returns the current and longest run. The current streak is zero once the last attended week is more than a week behind, with a grace-period boundary test. The `/members/[id]` page pages through all of a member's attendance (past the 1000-row limit) to compute it, and the sidebar gained My Profile.",
      "Later, in June, `/streaks` added sister streaks and streaks scoped to a specific prickle day and time, using each member's own time zone.",
    ].join("\n\n"),
  },
  {
    slug: "kajabi-profile-fields-in-silver-members",
    date: "2026-05-19",
    audience: "engineering",
    category: "new",
    title: "Profile photo, bio and social links carried into members",
    summary:
      "Member processing now copies a profile photo, bio and social links from Kajabi onto the member record, and profile pages show them with an initials fallback.",
    body: [
      "A migration added the profile columns to `members` and the `reprocess_members_atomic` function fills them. When several Kajabi customers share an email, the most recently updated one wins. A `MemberAvatar` client component falls back to coloured initials, because a server component cannot attach an image error handler.",
      "Social and photo URLs are sanitised to block javascript: links, the Kajabi avatar CDN base is resolved, and social handles are normalised. A Gravatar fallback was tried and reverted because the API never returns Gravatar URLs.",
      "Prickle pages were consolidated into one shared `/prickles/[id]` with role-aware links that respect sudo and hide attendee emails from non-admins.",
    ].join("\n\n"),
  },
  {
    slug: "feature-previews-for-admin-opt-in",
    date: "2026-06-12",
    audience: "engineering",
    category: "new",
    title: "Feature previews: admins opt in to unfinished features",
    summary:
      "A per-user table and a settings modal let admins switch on features still being built, and navigation items and pages are hidden otherwise.",
    body: [
      "`user_feature_previews` stores each admin's choices, `lib/features.ts` and `lib/features.server.ts` define and read the features, and `/api/feature-previews` toggles them. Nav items and pages check the flag, so unfinished work can ship to production dark.",
    ].join("\n\n"),
  },
  {
    slug: "member-merge-and-duplicate-detection",
    date: "2026-06-14",
    audience: "engineering",
    category: "new",
    title: "Merging duplicate members, with detection and conflict warnings",
    summary:
      "Admins can merge two member records from a member page, in bulk, or from a Merge and Fix page that finds likely duplicates.",
    body: [
      "All three entry points call `POST /api/admin/members/merge`. It moves attendance, activities, hiatus and override rows, hosted prickles, ambiguous-name references, name aliases and email aliases to the kept member, copies `kajabi_id`, `stripe_customer_id` and `user_id` when the kept member lacks them, deletes derived metrics (recomputed later) and finally deletes the duplicate. Foreign keys are handled in a fixed order, documented in docs/MEMBER_MERGE.md. When both members have different external ids the primary's wins and the response lists the conflicts.",
      "`lib/member-duplicates.ts` (`detectDuplicates`, unit tested) groups by identical normalised name or email. On 21 June, an external-conflicts hygiene page and pre-merge warnings check Kajabi, Stripe and Slack. Reprocessing was changed so a secondary Kajabi contact cannot overwrite the primary. Staff are always active regardless of Kajabi. Dismissed duplicate groups later moved into the database, shared by all admins.",
    ].join("\n\n"),
  },
  {
    slug: "zoom-history-import-and-scoped-pagination-fixes",
    date: "2026-06-13",
    audience: "engineering",
    category: "improved",
    title: "Historical Zoom import and pagination fixes for 1000-row truncation",
    summary:
      "A script loads past Zoom meetings in batches, and several admin pages and reports that silently stopped at 1000 rows now page through everything.",
    body: [
      "The Zoom import gained a `skipProcessing` flag and a historical batch script (limited to 2026 because of the Zoom records API). Hygiene pages, the orphaned-meetings step and the report routes that silently truncated at Supabase's default 1000 rows now paginate, with a pagination test for attendance.",
      "Tiny pop-up prickles (under five minutes with one attendee) are skipped, and process handlers are called directly from import routes to avoid Vercel deployment protection.",
    ].join("\n\n"),
  },
  {
    slug: "stable-prickle-ids-across-reprocessing",
    date: "2026-06-30",
    audience: "engineering",
    category: "fixed",
    title: "Prickle ids stay the same when calendar and attendance are reprocessed",
    summary:
      "Reprocessing used to delete and recreate prickles with new ids, breaking links and attendance; prickles are now updated in place.",
    body: [
      "`reprocess_prickles_atomic` did DELETE then INSERT, so every run produced new uuids and broke /prickles URLs. Prickles now carry `calendar_event_id` (unique when set) and the function upserts on it, deleting only calendar prickles whose event is gone. Zoom-sourced pop-up prickles got the same treatment through `zoom_meeting_uuid`.",
      "The first attempt made `zoom_meeting_uuid` alone unique, which was wrong: one Zoom meeting yields several segments. The final key is the composite (`zoom_meeting_uuid`, `start_time`, `end_time`), with the upsert repeating the partial-index predicate and duplicates merged by repointing attendance first. Reprocessability tests were updated, and an unrelated `::numeric` cast on the text `confidence_score` column was removed from the attendance function. This is the base of the rule that prickle ids are safe to link.",
    ].join("\n\n"),
  },
  {
    slug: "attendance-reprocessed-after-member-changes",
    date: "2026-06-30",
    audience: "engineering",
    category: "improved",
    title: "Attendance rebuilt when member data or aliases change",
    summary:
      "Calendar prickles and attendance are reprocessed when aliases change, so historical attendance is matched to people added later.",
    body: [
      "Changing `member_name_aliases` now triggers calendar reprocessing so hosts re-match. Insights pages exclude future prickles and use a median, with a sparkline based on the chosen window. In early July, attendance matching started using `member_email_aliases` and processing every member regardless of status, and a member processing run schedules an attendance reprocess of the last 90 days in the background via `after()`. Integration tests cover that cascade.",
    ].join("\n\n"),
  },
{
    slug: "membership-history-from-kajabi-billing",
    date: "2026-07-03",
    audience: "engineering",
    category: "fixed",
    title: "Membership history built only from real membership subscriptions",
    summary: "A member's membership history now ignores one-off purchases and non-membership offers, follows email aliases, and starts from the date Kajabi first created the subscription.",
    body: [
      "The membership history for a member (`lib/kajabi/membership-history.ts`, extracted as `fetchMembershipHistory` so tests call the real implementation) had been counting non-subscription purchases and non-membership offers. A shared `isMembershipOffer` helper in `lib/membership` now decides what counts, with unit tests, and the query follows every customer id that belongs to a member's alias emails.",
      "The start date uses `created_at_kajabi` rather than `effective_start_at`: Kajabi rewrites `effective_start_at` on each renewal, so it drifts to the latest billing cycle, while `created_at_kajabi` matches the \"Started on\" date in Kajabi and never changes. On 2026-07-06 the end date followed the same billing-based logic: each subscription ends where the next one starts, and only the latest one falls back to `deactivated_at`.",
    ].join("\n\n"),
  },
  {
    slug: "auto-alias-on-kajabi-email-change",
    date: "2026-07-02",
    audience: "engineering",
    category: "new",
    title: "Old email kept as an alias when a Kajabi contact changes address",
    summary: "When a member's email changes in Kajabi, the old address is now remembered as an alias so later imports that still use it resolve to the same member.",
    body: [
      "`reprocess_members_atomic` matches members by `kajabi_id`. When it sees a matched member whose email differs, a new migration makes it insert the old email as an alias with source `auto_detected`, and redirect any existing aliases that pointed at the old canonical email to the new one, so alias chains stay consistent.",
      "A reprocessability test (`tests/api/reprocessability/member-email-change.test.ts`) covers the change. This matters because Zoom, Slack and Stripe data often still carry the old address.",
    ].join("\n\n"),
  },
  {
    slug: "reconcile-crons-use-get-and-cron-secret",
    date: "2026-07-05",
    audience: "engineering",
    category: "fixed",
    title: "Nightly reconcile jobs actually run: GET handlers, cron secret, Kajabi API",
    summary: "The three daily reconcile routes failed on Vercel Cron, and the members one did nothing; both are fixed.",
    body: [
      "Vercel Cron always calls with GET, but the `/api/reconcile/*` routes only exported POST, so every run answered 405. The shared auth helper (`lib/supabase/api-auth.ts`) also never checked the `CRON_SECRET` bearer token its README described; it now does, and `scripts/sync-to-vercel.sh` syncs the secret to production.",
      "The members job was calling a reprocess of `kajabi_members`, a table with no Silver dependents, so it was a no-op. A new `triggerKajabiSync()` in `lib/processing/trigger.ts` (mirroring the calendar one) makes `/api/reconcile/members` call the Kajabi API sync that already existed, with unit tests for auth, success and error paths.",
    ].join("\n\n"),
  },
  {
    slug: "community-stats-and-resubscription-insights",
    date: "2026-07-06",
    audience: "engineering",
    category: "new",
    title: "Admin insight pages: Community Stats and resubscriptions",
    summary: "Two admin analysis pages landed on top of the Silver data: community writing and prickle statistics, and members who cancelled and came back.",
    body: [
      "Community Stats (first named Fun Stats, renamed throughout the codebase) shows community writing metrics, an analog-clock heatmap of when prickles happen, prickle types by session count, and a date filter with year, quarter and month to date presets.",
      "`/admin/insights/resubscriptions` lists members who cancelled and rejoined, with a monthly cohort chart. The detection logic was extracted into a library function with integration tests, and resolves email aliases and duplicate Kajabi customer ids per email before grouping purchases. The page queries Supabase directly rather than fetching its own API route.",
    ].join("\n\n"),
  },
  {
    slug: "calendar-sync-prunes-deleted-events",
    date: "2026-07-07",
    audience: "engineering",
    category: "fixed",
    title: "Calendar import removes events deleted from Google Calendar",
    summary: "Deleted calendar events no longer linger in the Bronze layer and turn into ghost prickles.",
    body: [
      "The calendar sync only upserted, so an event deleted in Google Calendar stayed in `bronze.calendar_events` and was reprocessed into a ghost prickle. A `SECURITY DEFINER` function `delete_stale_calendar_events()` now removes rows in the synced date range whose Google event id is missing from the current response. It refuses to run on an empty id list, so an empty Google response cannot wipe the range, and the import reports a deleted count.",
      "The same week the calendar routes were consolidated: the import route accepts explicit `fromDate`/`toDate`, `import/calendar` became canonical, the `sync/*` namespace was removed in favor of `import/*`, and all Bronze writes use the service role. On 2026-08-06 execute on the delete function was revoked from `anon` and `authenticated`, since only the admin-gated import route calls it.",
    ].join("\n\n"),
  },
  {
    slug: "flaky-integration-tests-stabilized",
    date: "2026-07-06",
    audience: "engineering",
    category: "fixed",
    title: "Integration suite made deterministic",
    summary: "Wrong column names, missing required fields and tests that cleaned up each other's rows were fixed.",
    body: "Several integration tests selected columns that did not exist (`zoom_name`, `created_at_stripe`), omitted NOT NULL fields, or used the wrong member status. Tests that shared far-future date ranges (2099-07) deleted each other's data, so they were moved apart, and a pagination test now compares a differential count instead of a baseline that concurrent tests could change.",
  },
  {
    slug: "admin-users-page-roles-and-linked-profiles",
    date: "2026-07-06",
    audience: "engineering",
    category: "new",
    title: "Admin users page: invites, roles, feature previews and linked profiles",
    summary: "Admins can manage portal users in one place: invite, change role, set feature previews, delete, and link a user to a staff record.",
    body: [
      "`/admin/users` (`app/api/admin/users`) lists auth users with role and enabled feature previews, with inline edits and a delete that blocks self-deletion. A follow-up added a Linked Profiles column: PATCH with `staffId` sets `staff.user_id` and `members.user_id` together, matching the member by email, so no reprocess is needed.",
      "Tests in `tests/api/admin/users.test.ts` cover the auth guards, create/update/delete, feature-flag replace semantics and link/unlink. On 2026-08-27 a resend-invite button for pending users was added.",
    ].join("\n\n"),
  },
  {
    slug: "slack-engagement-insights",
    date: "2026-07-19",
    audience: "engineering",
    category: "new",
    title: "Slack engagement insights for admins",
    summary: "An admin page shows when Slack is busiest, which channels drive engagement and which have gone quiet.",
    body: "`/admin/insights/slack-engagement` is backed by `lib/slack-engagement-stats.ts`: a day-and-hour heatmap, per-channel engagement with trend sparklines, and a list of dormant channels that are candidates for archival. It has a unit test file of its own (`tests/lib/slack-engagement-stats.test.ts`).",
  },
  {
    slug: "rls-enabled-on-exposed-tables-and-function-hardening",
    date: "2026-08-05",
    audience: "engineering",
    category: "fixed",
    title: "Row level security on 17 exposed tables, and Supabase advisories cleared",
    summary: "Tables that the public API could reach without row level security now require a signed-in user, and the remaining warning-level advisories were addressed.",
    body: [
      "A migration enabled RLS on 17 tables in the `public` and `bronze` schemas that Supabase flagged as readable and writable with the anon key. Five Slack and subscription tables had policies set in the dashboard without RLS switched on; the others had neither. All got the project's usual authenticated-only policy.",
      "On 2026-08-06 a second migration pinned `search_path` on six functions, moved `pg_trgm` into the `extensions` schema, and restricted a `SECURITY DEFINER` function's execute grant. Two definer functions used by sign-up and the `is_admin()` policies were deliberately left alone to avoid breaking them, and the skipped advisories were documented in `docs/TODO.md`.",
    ].join("\n\n"),
  },
  {
    slug: "engagement-metrics-computed-from-attendance",
    date: "2026-08-23",
    audience: "engineering",
    category: "fixed",
    title: "Member engagement computed from attendance and Slack activity",
    summary: "Admin member pages now derive last attended, recent counts and risk from real data instead of static seed rows.",
    body: [
      "`member_metrics` and `member_engagement` were never refreshed, so every member read Never/0/low risk. The shared `lib/member-engagement.ts` now computes last attended, 30-day and total prickle counts (distinct `prickle_id`, as the attendance design requires), an engagement score and a risk level from `prickle_attendance`.",
      "On 2026-08-26 Slack activity from `member_activities` joined the score (last 30 days, capped at 100); risk stays based on prickle recency. A members list bug with `?filter=all` returning Bad Request and tri-state column sorting (`SortableTh`, `useTableSort`) landed alongside.",
    ].join("\n\n"),
  },
  {
    slug: "slack-webhook-bronze-writes-fixed-and-daily-reconcile",
    date: "2026-08-26",
    audience: "engineering",
    category: "fixed",
    title: "Slack webhook Bronze writes repaired, plus a daily Slack reconcile job",
    summary: "Real-time Slack messages and reactions had not been stored since the webhook was built; they are now, and a nightly import backstops them.",
    body: [
      "`processSlackEvent` upserted a `raw_data` column that does not exist (the NOT NULL column is `raw_payload`) and never checked the result, so it logged success and triggered Silver reprocessing on data that was never written. It now uses `raw_payload`, checks every Bronze write and skips reprocessing on failure; webhook tests that had been skipped were enabled, with a regression test for the failure mode.",
      "Slack was the one integration without a reconcile cron. `triggerSlackSync` and `/api/reconcile/slack` (daily in `vercel.json`) call the Slack API import in-process. The window was set to 90 days because Slack's free plan only exposes that much history, so drift older than that would be unrecoverable.",
    ].join("\n\n"),
  },
  {
    slug: "webhook-reprocessing-after-and-paginated-member-processing",
    date: "2026-08-27",
    audience: "engineering",
    category: "fixed",
    title: "Webhook follow-up work kept alive with after(), Bronze fetches paginated",
    summary: "Background reprocessing and notifications no longer get killed when the response is sent, and member processing reads all Bronze rows.",
    body: [
      "The calendar and Zoom webhooks and the feedback Slack post started work without awaiting it, which Vercel could freeze once the response went out. They now use `after()` from `next/server`.",
      "`/api/process/members` now paginates its Bronze reads past the 1000-row Supabase limit, with a reprocessability test over more than a page of rows.",
    ].join("\n\n"),
  },
  {
    slug: "member-status-lifecycle-and-overrides",
    date: "2026-08-26",
    audience: "engineering",
    category: "improved",
    title: "Member status lifecycle: lead, active, on hiatus, cancelled",
    summary: "Member status now separates people who never purchased from former members, and manual hiatus overrides survive reprocessing.",
    body: [
      "`members.status` was `active | inactive | on_hiatus`; `inactive` mixed never-purchased leads with real cancellations, and a hand-set `on_hiatus` was overwritten by the next nightly `reprocess_members_atomic`. The enum became `lead | active | on_hiatus | cancelled`, the previously unused `member_status_overrides` table is applied as a final step inside that function, and a shared `MemberStatusBadge` plus lead/cancelled filter tabs and dashboard counts were added.",
      "A planned `is_trial`/`has_trialed` split was removed the next day because the Kajabi API does not expose trial information; trial detection later moved to Stripe data (see the tenure entry).",
    ].join("\n\n"),
  },
  {
    slug: "eslint-and-husky-pre-commit",
    date: "2026-08-26",
    audience: "engineering",
    category: "new",
    title: "ESLint flat config and a husky pre-commit hook",
    summary: "Linting and the pre-commit hook are now managed by the project itself rather than a hand-installed script.",
    body: "`eslint.config.mjs` adds a flat config, and `.husky/pre-commit` replaces `scripts/install-hooks.sh`. Dependabot findings were also reduced by bumping `vercel` and adding package overrides (audit findings from 75 to 24). On 2026-08-26 the same pass gave every page a unique browser tab title through a root title template and per-page metadata.",
  },
  {
    slug: "unmatched-slack-users-and-match-suggestions",
    date: "2026-08-27",
    audience: "engineering",
    category: "new",
    title: "Data hygiene tools: unmatched Slack users and private channel access",
    summary: "Admins can match Slack accounts to members with suggested candidates and see private channels the Slack app can no longer read.",
    body: [
      "`/admin/hygiene/unmatched-slack` lists Slack users with no member and offers one-click alias creation. `suggestMemberMatches` in `lib/member-matching.ts` scores name similarity and email local parts, at token level as well as whole string (so a short Slack name is not buried by a long legal name) and requires both names to meet a length floor for substring matches. Active users sort first.",
      "`lib/private-channel-access.ts` flags private channels whose Bronze row was not refreshed in the latest nightly import, as a proxy for the Slack app having lost access. It is detection only, because an app cannot invite itself back. Slack app was also renamed and its manifest synced with the live config, and ERD and sequence diagram docs were rewritten to match the then-current schema.",
    ].join("\n\n"),
  },
  {
    slug: "feedback-widget",
    date: "2026-08-27",
    audience: "engineering",
    category: "new",
    title: "Site-wide feedback widget with screenshots",
    summary: "Signed-in users can report a bug or idea from any page, and admins review it and see it in Slack.",
    body: "`components/FeedbackWidget.tsx` is mounted in the member and admin layouts, captures a viewport screenshot, and posts to `/api/feedback`; admins review items at `/admin/feedback`, where a one-click sudo-as-reporter button and Escape-to-close lightbox were added. The Slack notification uses native file upload and runs inside `after()` so it is not dropped when the function freezes.",
  },
  {
    slug: "access-events-sessions-and-force-sign-out",
    date: "2026-08-27",
    audience: "engineering",
    category: "new",
    title: "Access history, session management and force sign-out",
    summary: "Admins can see when a user came back and what they visited, members can end their own other sessions, and admins can force a sign-out.",
    body: [
      "Middleware inserts an `access_events` row per authenticated request via `after()`, skipping prefetches. `get_access_sessions()` groups events into visits with a 30 minute gap and, from a later migration, joins them to the real `auth.sessions` row through a session id claim (`lib/supabase/session-claims.ts`).",
      "Supabase Auth cannot list or revoke a single session, so `get_my_sessions()` and `revoke_my_session()` are `SECURITY DEFINER` functions scoped to `auth.uid()`, shown in the member profile, and a `revoke_user_sessions` function powers the admin Force sign-out (sudo cannot reach a member's real session). The server clients forward the real User-Agent and forwarded IP to Supabase Auth so sessions show the actual device.",
      "A transient middleware auth-check timeout no longer redirects to /login, since the layouts re-verify the session themselves.",
    ].join("\n\n"),
  },
  {
    slug: "member-dashboard-network-and-mobile-nav",
    date: "2026-08-27",
    audience: "engineering",
    category: "new",
    title: "Member dashboard, network view and mobile drawer navigation",
    summary: "The member area gained a dashboard landing page, a network page and a hamburger menu on small screens.",
    body: "`/dashboard` shows the next seven days of prickles with a highlighted set (hosting, active streak, a streak partner's usual slot) and became the post-login landing page. `/network` draws a radial SVG map of a member's streak connections. `MemberNavigation` swaps the permanent narrow sidebar for a drawer below `md`; the admin navigation got the same on 2026-08-29. Streak week boundaries now use the member's timezone instead of UTC (`lib/streaks.ts`).",
  },
  {
    slug: "prickle-picker-and-wheel-of-wonder",
    date: "2026-08-28",
    audience: "engineering",
    category: "new",
    title: "Prickle Picker recommender and Wheel of Wonder matching",
    summary: "Two feature-flagged member tools landed: a prickle recommender and a weighted random member match.",
    body: [
      "`lib/prickle-picker.ts` is a pure scoring engine over historical attendance. `prickle_types` gained `purpose` and `solo_task_friendly`, and `prickle_host_vibes` stores host-tagged vibes. Both are behind the `prickle_picker` feature preview.",
      "Wheel of Wonder (first built as Hedgie Roulette, renamed in code and the `wheel_of_wonder_matches` table the same day) weights candidates toward members with few connections and low recent Slack activity and only offers someone a live Slack presence check says is online. A match counts as a connection only after a real back-and-forth is seen in the Slack webhook, and an admin review page was added.",
    ].join("\n\n"),
  },
  {
    slug: "member-managed-hosting-schedules",
    date: "2026-08-28",
    audience: "engineering",
    category: "new",
    title: "Hosting: member-managed monthly prickle schedules",
    summary: "Hosts can plan their monthly prickle schedule themselves, and admins can review and lock it.",
    body: "A migration creates the prickle schedule tables with RLS (a member manages only their own rows, admins bypass), and `lib/prickle-schedules.ts` holds the logic. `/hosting` has the member manager, `/admin/hosts` the admin view, and `/api/prickle-schedule-locks` locks a month. Integration tests cover the API, locks and the RLS rules, and a calendar-based bootstrap seeds the first month.",
  },
  {
    slug: "writing-projects-tracking-phases",
    date: "2026-08-29",
    audience: "engineering",
    category: "new",
    title: "Writing projects tracking: projects, entries, goals and habits",
    summary: "The data model and logic for members' writing progress landed in phases.",
    body: [
      "Phase 0 added member-owned Local layer tables (projects, dated progress entries, goals) with RLS like the schedules tables, `/writing` routes and a dashboard widget. Progress math handles add versus set-total entries and backdating, and target goals show a par-line pace.",
      "Phase 2 made `GoalRow` a union of target and habit goals (streak, longest and typical streak, hit rate) rendered through one `GoalDisplay`, with entry tags, per-project CSV export, a cumulative chart and heatmap, and opt-in display on the member's profile. On 2026-08-31 prickles attended became a goal measure, derived from `prickle_attendance` and anchored to a snapshot of a schedule; re-anchoring archives the old goal and forks a new one.",
    ].join("\n\n"),
  },
  {
    slug: "member-tenure-and-join-date-derivation",
    date: "2026-08-29",
    audience: "engineering",
    category: "improved",
    title: "Member tenure derived from billing history with join date overrides",
    summary: "First join date, time as a member and hiatus handling are computed from billing data, replacing a manual spreadsheet.",
    body: [
      "Tenure (first joined, most recent join, active months, excluding hiatus) is computed from Kajabi purchases and hiatus overrides, and drives an admin Hedgieversary page and hiatus touchpoints. Hiatus now reads from `member_status_overrides`, the table reprocessing uses.",
      "Join date is the first real transaction: `buildMembershipStints` uses the matching Stripe subscription's `trial_end` when a real trial existed. Kajabi offers never expose trial length, so on 2026-08-30 trial detection moved to Stripe's `trial_start`/`trial_end` through one shared `isRealMembershipStint`, keyed by canonical email so Kajabi contact merges do not break it. The Stripe import now requests all statuses, since the default omitted cancelled subscriptions. `member_join_date_overrides` handles members from before the 2022 Kajabi migration.",
    ].join("\n\n"),
  },
  {
    slug: "profile-badges-and-bookshelf",
    date: "2026-08-31",
    audience: "engineering",
    category: "new",
    title: "Badge system with automated badges and a bookshelf import",
    summary: "A generic badge model landed, with some badges computed and others awarded by admins.",
    body: "`badge_types`, `badge_levels` and an append-only `member_badges` log (level derived from award count) are managed at `/admin/badges`. Prickle milestones and Founding Hedgie are computed on the fly from attendance and tenure, never stored; Hostess and Published Author were later automated, with a Hedgie Bookshelf. Admins can see everyone who earned a badge, and retreat badge types were added. The member Profile page was renamed Settings the same day.",
  },
{
    slug: "trial-conversion-uses-stripe-cancel-time",
    date: "2026-09-02",
    audience: "engineering",
    category: "fixed",
    title: "Trial conversion check uses Stripe's cancel time",
    summary: "Abandoned trials were being counted as real, billed memberships. The check now trusts Stripe for when a customer actually canceled.",
    body: [
      "`isRealMembershipStint` decided whether a Kajabi purchase was a real stint or an abandoned trial by checking that Kajabi's `deactivated_at` came after the trial end. Kajabi keeps a mid-trial cancellation \"active\" until the trial's natural end and only then sets `deactivated_at`, so almost every mid-trial cancel passed the check.",
      "The check now prefers the matching Stripe subscription's `canceled_at`, which records the real cancel moment, and falls back to `deactivated_at` only when there is no Stripe match. Checked against production data at the time: 16 purchases across 16 members moved from \"real stint\" to \"abandoned trial\", and two of them explained unexplained multi-hundred-day gaps against the manually kept anniversary list.",
    ].join("\n\n"),
  },
  {
    slug: "status-override-types-and-reconciliation-checks",
    date: "2026-09-04",
    audience: "engineering",
    category: "new",
    title: "Distinct status override types and payment-legitimacy checks",
    summary: "Membership status overrides gained separate types for the 180 Program and for people who pay Stripe directly, plus a check for Kajabi access with no payment behind it.",
    body: [
      "`member_status_overrides` already had `gift` (free membership for a window). Two cases were being forced into it, which would have mislabeled real revenue as comps in any later comp reporting. A `180_program` type (one-time cohort purchase, six months included, then `cancelled` rather than `lead` if the window lapses) and a `direct_stripe` type (a paying customer on a subscription our Kajabi sync cannot see) were added as their own `override_type` values, with a migration that moved the one existing `gift` row that stood in for the second case.",
      "The reconciliation page auto-detects `direct_stripe` candidates and, as the mirror image, flags Kajabi purchases on membership offers that have no transaction or a zero amount (`/api/analyze/kajabi-grants`). A multi-customer false positive in the Kajabi/Stripe mismatch check was fixed the same day. The grants check found no matches in production when it was built; it exists so a future manual grant does not become a new invisible category.",
    ].join("\n\n"),
  },
  {
    slug: "program-cohort-tracking",
    date: "2026-09-04",
    audience: "engineering",
    category: "new",
    title: "Program cohorts, enrollments and Kajabi purchase matching",
    summary: "Programs such as the 180 Program became real data (programs, cohorts, enrollments) with admin pages, and staff can enroll people from a reviewed list of matching Kajabi purchases.",
    body: [
      "Migration `create_program_cohort_tracking` adds programs, cohorts (with start and expiry dates) and enrollments, with admin pages under `/admin/programs` and routes under `/api/admin/program-cohorts`, `program-enrollments` and `programs`. `reprocess_members_atomic` was rebuilt to apply active enrollments: an active cohort now yields `active` status, ordered before hiatus so an active hiatus still wins. Two bugs found verifying that on a local stack were fixed (step ordering, and `EXTRACT(EPOCH ...)` applied to a DATE subtraction, which Postgres returns as an integer).",
      "On 2026-09-05 a \"Find Kajabi matches\" action was added: `lib/kajabi-cohort-matching.ts` (later split into a pure, DB-free function with a regression test) lists members whose purchases of the program's configured offers have a transaction date or access-grant date inside the cohort window. It feeds a staff-reviewed bulk enroll rather than blind enrollment, because access dates can lag transaction dates by more than a week. Offer names are picked from the live Kajabi offer catalog, and the email-alias resolution that several matchers duplicated moved to `lib/email-aliases.ts`.",
    ].join("\n\n"),
  },
  {
    slug: "membership-timeline-segments",
    date: "2026-09-05",
    audience: "engineering",
    category: "improved",
    title: "Membership timeline as one non-overlapping segment list",
    summary: "The admin membership timeline is now built by a sweep-line that merges stints, hiatuses, programs and overrides, and member status is recomputed whenever a hiatus changes.",
    body: [
      "Hiatuses happen inside membership stints, not after them, so the old flat list of raw rows from each source put misleading captions under unrelated rows. `lib/membership-timeline.ts` now merges stints, hiatuses, program enrollments and status overrides into chronological segments with one rule: hiatus wins, then any active source, then a gap. Concurrent programs and overrides show as secondary tags instead of extra rows.",
      "Follow-ups the same day: `lib/member-status.ts` recomputes and saves one member's status right after any hiatus mutation (before this, only the full `/api/process/members` run did, so the badge went stale), hiatus return dates became choosable and hiatus rows editable, and DATE columns (`member_hiatus_history`, cohort dates) are parsed with `parseDateOnly` so they no longer display a day early in zones behind UTC. A `Starts At` field was added to overrides, and its start/expiry got the same off-by-one fix on 2026-09-06.",
    ].join("\n\n"),
  },
  {
    slug: "hygiene-dashboard-consolidation",
    date: "2026-09-08",
    audience: "engineering",
    category: "improved",
    title: "One data hygiene dashboard with fuzzy duplicate matching",
    summary: "Reconciliation and data hygiene were merged into one admin dashboard, and duplicate detection now scores fuzzy name matches.",
    body: [
      "Reconciliation duplicated two hygiene checks (Slack and Zoom orphans) with different scoping, and Merge and Fix claimed fuzzy duplicate detection but only matched exactly. The per-member reconciliation table moved into `/admin/hygiene`, the duplicated read-only lists became links to the real tools, and the dashboard was reorganized into Pipeline, Identity, Duplicate and Completeness sections.",
      "`lib/text-similarity.ts` and `lib/member-duplicates.ts` add confidence-scored fuzzy name matching; Unmatched Zoom Names gets ranked suggestions (shared with prickle detail pages); the External Conflicts tile shows a real count (`lib/external-conflicts.ts`). Slackbot was excluded from the Slack user queries on 2026-09-14.",
    ].join("\n\n"),
  },
  {
    slug: "activity-log-for-crm-signals",
    date: "2026-09-09",
    audience: "engineering",
    category: "new",
    title: "Activity log for attendance, outreach and logins",
    summary: "The member activity table now mirrors prickle attendance, outreach touches and sign-ins, so one table can answer what a member has been doing.",
    body: [
      "Migrations extend `member_activities` and add `reprocess`-safe mirrors: prickle attendance is mirrored into it atomically (`mirror_prickle_attendance_to_activities`), outreach touches are backfilled, `members.user_id` is backfilled, and a dedup index plus `get_recent_login_sessions` support login events (`lib/processing/login-events.ts`, `/api/reconcile/logins`, scheduled in `vercel.json`).",
      "`lib/member-engagement.ts` was rewritten to read from the activity table instead of recomputing from each source. The design is described in `docs/ACTIVITY_AND_AUDIT_LOG.md`. Attendance reprocessability and Slack reprocess tests were extended for the mirror.",
    ].join("\n\n"),
  },
  {
    slug: "member-user-id-identity-link",
    date: "2026-09-14",
    audience: "engineering",
    category: "fixed",
    title: "members.user_id becomes the durable login link",
    summary: "A member's login link was silently wiped on every Kajabi reprocess. It is now preserved and used first when working out who is signed in.",
    body: [
      "`reprocess_members_atomic` overwrote `members.user_id` unconditionally, and the payload only carried a value through `staff.user_id`, so the link was lost each run. Migration `retire_staff_user_id_add_member_id` adds `staff.member_id` as a maintained foreign key, retires `staff.user_id`, and makes the function keep an existing `members.user_id`. `getEffectiveIdentity` (`lib/sudo.ts`) now resolves by `user_id` first, which survives email changes, and falls back to email for older accounts.",
      "Before that (2026-09-08) the admin Users page gained a Member picker independent of the Staff picker, since most people given login access are paying members rather than staff. Also on 2026-09-14: an editable legal name pushed to Kajabi's contact record so the next full reprocess does not overwrite it, and a default pen name (`member_display_name` migration, `lib/member-display-name.ts`).",
    ].join("\n\n"),
  },
  {
    slug: "member-awards-table",
    date: "2026-09-15",
    audience: "engineering",
    category: "new",
    title: "member_awards table and self-reported award flow",
    summary: "Members can record outside awards and competition wins, modelled on the bookshelf self-report flow.",
    body: "Migration `create_member_awards` plus a server action (`app/(member)/awards/actions.ts`), `AwardFormModal` and a panel on the Projects page, with validation in `lib/awardValidation.ts`. Each win posts to a staff Slack channel through `notifyStaffNewAward` in `lib/slack.ts`, gated on a channel env var that was added to the Vercel sync script and `.env.example`. Submission tracking, win-rate stats and a deadline list were deferred to `docs/TODO.md`.",
  },
  {
    slug: "supabase-auth-email-via-resend",
    date: "2026-09-18",
    audience: "engineering",
    category: "improved",
    title: "Supabase auth emails sent through Resend, config as code",
    summary: "Production auth email settings are declared in config.toml and applied with supabase config push instead of a custom sync script.",
    body: "A `[remotes.prod]` block in `supabase/config.toml` now holds production SMTP (Resend) and the email template settings, replacing `scripts/sync-email-templates.ts`. `npm run config:diff` and `config:push` were added, the email footers got a support line sent from a no-reply sender, the deprecated `[inbucket]` section was renamed `[local_smtp]`, and the domain and DNS plan was written into `docs/TODO.md`. A note that config push leaves undeclared settings unchanged was corrected on 2026-09-18.",
  },
  {
    slug: "health-check-and-uptime-monitoring",
    date: "2026-09-22",
    audience: "engineering",
    category: "new",
    title: "Health check endpoint, Sentry and Checkly uptime monitoring",
    summary: "A public health endpoint, error reporting and uptime plus certificate checks now watch the production site.",
    body: [
      "`/api/health` queries Supabase so an external monitor learns the database is reachable, not just that Next.js answers. Checkly monitors are code in `__checks__/` (an uptime check on the health route and an SSL check with a 14-day expiry warning, both every 10 minutes from two regions) with `checkly.config.ts`, deployed by `.github/workflows/checkly.yml`: `checkly test` on pull requests and `checkly deploy` on pushes to main, filtered to paths that affect the checks. Sentry DSNs are synced to every environment and the build auth token to production only; Google Analytics and the integration links doc were added the same day.",
      "On 2026-09-23 Sentry's `includeLocalVariables` was turned off after traces showed the Node inspector it attaches added about 800 ms to every server render on Vercel (a login render went from roughly 850 ms to 40 ms). On 2026-09-25 the health route gained Server-Timing output and an optional `?timing=1` breakdown (DNS, TCP, TLS, warm repeat query) to chase slow Supabase calls after idle periods.",
    ].join("\n\n"),
  },
  {
    slug: "ci-test-build-migrate-deploy-pipeline",
    date: "2026-09-23",
    audience: "engineering",
    category: "new",
    title: "CI pipeline: test, push migrations, then deploy",
    summary: "Merges to main now run tests, apply database migrations and only then deploy, so new code never goes live before its schema.",
    body: [
      "`.github/workflows/ci.yml` (merged 2026-09-22) starts a local Supabase stack, builds, starts the app and runs the unit and database suites, then pushes pending migrations to production on main. `docs/CI_MIGRATION_ORDERING.md` weighs two options: leave Vercel's own git deploy running (a minutes-long window where code can hit a table that does not exist yet, as an earlier segments page outage did) or gate the deploy on CI. On 2026-09-23 Option B was adopted and Vercel's auto-deploy on main was switched off in `vercel.json`.",
      "On 2026-09-24 the deploy hook (which triggers a separate remote build and reports success the moment the hook is accepted) was replaced by `vercel pull`, `vercel build --prod` and `vercel deploy --prebuilt --prod`, so the exact commit that passed tests is the one deployed and a bad build fails the job. `.next/cache` is restored with `actions/cache`. Preview deployments still come from Vercel's git integration.",
    ].join("\n\n"),
  },
  {
    slug: "ci-speed-and-registry-fixes",
    date: "2026-09-23",
    audience: "engineering",
    category: "improved",
    title: "Faster CI and workarounds for Docker registry rate limits",
    summary: "CI start-up work now overlaps the build and pulls images from Docker Hub, cutting the database job from about six minutes to about two and a half.",
    body: "`supabase start` is backgrounded and awaited after the production build, and the CI build used Turbopack. Measured on the job \"Test (db) and build\": 6m4s before, 2m29s after (some of the drop was runner variance, since the test step also got faster). Pulls from ghcr.io hit rate limits, so CI first authenticated, then retried with backoff, and finally forced the Supabase CLI to pull its local images from Docker Hub via `SUPABASE_INTERNAL_IMAGE_REGISTRY` set at step level. Checkout and setup-node actions moved to v5 and runners were pinned to ubuntu-24.04 ahead of the `ubuntu-latest` migration (a TODO to revisit the pin was added). The Stripe API version pin was updated to match SDK 22.6.2.",
  },
  {
    slug: "nextjs-16-and-turbopack",
    date: "2026-09-23",
    audience: "engineering",
    category: "improved",
    title: "Upgrade to Next.js 16 and Turbopack production builds",
    summary: "The app moved from Next.js 15 to 16.3.6, with Turbopack as the production compiler.",
    body: [
      "The upgrade (PR 23) used the official codemods, then manual follow-ups: `middleware.ts` became `proxy.ts`; the removed `eslint.ignoreDuringBuilds` option was dropped; an explicit lint step was added to `ci.yml` because `next build` no longer lints; the React Compiler hook rules newly on in `eslint-config-next` were set to warn; and about 15 TypeScript errors that the stricter build typecheck surfaced were fixed. Two codemod side effects were reverted as out of scope (an `instant = false` opt-out on 69 files and an eslint 10 bump).",
      "`package.json`'s `build` then switched to `next build --turbopack` (same day). The investigation behind it found Turbopack's shared first-load JS about 38 kB larger on every route, and two routes (`/admin` and `/projects/[id]`) carrying an extra 90-100 kB because it inlines a copy of recharts' `AreaChart` into each route chunk where webpack shares one. That was accepted as bounded to two authenticated routes. A Next 16 follow-up plan was recorded in `docs/TODO.md`.",
    ].join("\n\n"),
  },
  {
    slug: "env-vars-manifest",
    date: "2026-09-25",
    audience: "engineering",
    category: "improved",
    title: "env-vars.config.ts as the single list of environment variables",
    summary: "Three sync scripts each kept their own hardcoded variable list. They now read one manifest.",
    body: [
      "`sync-to-vercel`, `sync-to-github` and `sync-vault-secrets` were bash scripts with separate lists that drifted apart, so some variables were missing from `.env.example`. `env-vars.config.ts` now declares each variable's destinations (Vercel environments, GitHub secret or variable, Supabase Vault) and whether it is secret; the scripts were rewritten in TypeScript on top of it, including the missing-value validation. `.env.example` and the env files were regrouped by system, and a secret rotation runbook was added.",
      "The manifest records an incident lesson that the Vercel sync enforces: variables always sync with `--type config`, because Vercel's default sensitive type can never be read back (even by `vercel pull`) and a sensitive `NEXT_PUBLIC_*` value is inlined into the client bundle as a placeholder string. A bug where `npx` resolved the wrong `vercel` binary because of PATH shadowing was fixed too.",
    ].join("\n\n"),
  },
  {
    slug: "my-prickles-hub-and-member-nav",
    date: "2026-09-24",
    audience: "engineering",
    category: "new",
    title: "My Prickles page and navigation built around intentions",
    summary: "The member navigation collapsed from about ten items to Home, My Burrow and Community, with a My Prickles page composed of tabs, including a full recurring schedule.",
    body: [
      "The nav was regrouped (My Writing, My Prickles and Streaks under My Burrow; Wheel of Wonder, Bookshelf and Events under Community; profile in the account menu) and added a My Prickles page composing attendance history, the prickle picker and hosting as tabs. The dashboard's upcoming-prickle ranking moved to `lib/upcoming-prickles.ts` so both pages share it. It also fixed the member layout and settings page resolving feature flags for admins only, which had hidden flagged pages from real members. On 2026-09-26 the standalone `/hosting`, `/prickle-picker` and `/calendar` routes were removed and their links pointed at the tabs.",
      "An All Prickles tab (`lib/prickle-schedule.ts`) groups every recurring slot by type, day of week and hour, shows who hosts next and a historical average attendance, as a table localized to the viewer's zone and later a calendar that also shows past prickles. The Projects page became My Writing with Projects, Books and Awards tabs (2026-09-26).",
    ].join("\n\n"),
  },
  {
    slug: "prickle-commitments-with-slots",
    date: "2026-09-27",
    audience: "engineering",
    category: "new",
    title: "Commitments cover several slots and rank in Upcoming",
    summary: "A commitment can now hold several recurring slots, chosen from the All Prickles table or calendar, and committed prickles rank as a personal signal in Upcoming.",
    body: [
      "On 2026-09-26 an upcoming prickle that is a week of the viewer's active commitment got its own tier just under hosting and above streaks (priorities became the named `PRIORITY` constants), using `computeCommitmentProgress` in `lib/commitments.ts`. Migration `commitment_slots` (2026-09-27, listed because it landed with the 2026-09-26 batch) moves the slot into `prickle_commitment_slots` (one or more per commitment), adds an atomic `create_prickle_commitment` function, and replaces the one-active-commitment-per-slot index with an overlap trigger that allows renewals. RLS follows the `current_member_id()` and `is_admin()` convention, covered by `tests/api/commitments/rls.test.ts`.",
    ].join("\n\n"),
  },
  {
    slug: "host-eligibility-first-join-rule",
    date: "2026-09-26",
    audience: "engineering",
    category: "improved",
    title: "Hosting eligibility counted from first join and enforced on the server",
    summary: "The one-full-month rule before hosting now counts from a member's first join, and ineligible sign-ups are refused server-side.",
    body: "Tenure counts from `first_joined_at` (falling back to `most_recent_joined_at`), so rejoiners after a cancel or hiatus do not wait again, which removed the hiatus-history query. `requestToHost` rejects ineligible members with a shared `hostEligibilityMessage` and no insert; members who already hosted or have a confirmed schedule are exempt. The admin Add Schedule form looks up the host email on blur and warns before saving; `GET /api/members?email=` returns `host_eligibility` for exact lookups. The profile Hosting card moved to a SQL aggregate, `get_hosted_prickle_attendance`, instead of paging every attendee row.",
  },
  {
    slug: "row-level-security-audit",
    date: "2026-09-26",
    audience: "engineering",
    category: "fixed",
    title: "Row-level security audit: writes, reads and self-promotion closed",
    summary: "A policy audit closed gaps where any signed-in member could write to admin tables, read other members' private rows, or make themselves an admin.",
    body: [
      "Self-promotion: the own-profile update policy plus table-wide UPDATE let a member change their own `user_profiles.role`. A column-level revoke would also have blocked admins, who change roles from their own session, so a BEFORE UPDATE trigger (`guard_user_profile_privileged_columns`) rejects changes to role, email or id unless the caller is an admin or a privileged database role, with a test in `tests/api/admin/user-profiles-role-escalation.test.ts`.",
      "Writes: an audit of `pg_policies` across `public` and `bronze` found about 45 tables whose write policies only checked for an authenticated user. They became admin-only (`is_admin()`) or owner-or-admin (`current_member_id()`), including a trigger limiting a member's own `members` update to name and birthday; event, attendee and photo writes got their own migration and RLS test. Reads: `member_directory`, a trigger-synced view of public profile fields, replaced direct reads of other members' rows; `members` is now readable only for one's own row (or by admins), bronze tables and admin note tables are admin-read, and `member_activities` reads are own-rows. App queries moved to `member_directory` and computed relationships (`prickle_host`, `attendance_member`), and member pickers stopped sending every member's email to the browser. The search path was pinned and EXECUTE restricted on the `upsert_stripe_*` functions, which were dropped on 2026-09-27.",
    ].join("\n\n"),
  },
  {
    slug: "admin-route-protection-and-role-claim",
    date: "2026-09-26",
    audience: "engineering",
    category: "new",
    title: "Admin routes protected in the proxy and next to the data",
    summary: "Admin pages and actions are checked at three layers, and the access token carries a role hint so the proxy needs no database read.",
    body: [
      "Following the Next.js authentication guide, `proxy.ts` makes an optimistic role check for `/admin`, `requireAdminPage()` runs in the admin layout and every admin page (layouts do not stop a page segment rendering), and each admin server action calls `requireAdminAction()` (the merge-fix dismiss actions previously accepted any signed-in user). Signed-in non-admins go to a terminal `/no-access` page, which avoids a `/admin` and `/dashboard` redirect loop for users without a member record. Conformance tests fail if an admin page or action skips its check.",
      "Migration `add_role_to_access_token` adds a Supabase custom access token hook, `custom_access_token_hook`, that writes `user_profiles.role` into an `app_role` claim (not `role`, which PostgREST uses as the database role). The proxy reads it from the already verified token; the claim is only as fresh as the token, so the real authorization still reads `user_profiles`. The hook swallows lookup errors and omits the claim rather than blocking sign-in. On 2026-09-27 CI began pushing `supabase/config.toml` after migrations, so the hook function always exists before config that references it. A pgTAP test covers the hook.",
    ].join("\n\n"),
  },
  {
    slug: "data-table-sorting-and-pagination",
    date: "2026-09-26",
    audience: "engineering",
    category: "new",
    title: "Shared table sorting and pagination, All Members paged in SQL",
    summary: "One hook now sorts and auto-paginates tables, and the admin members list pages in the database instead of loading everyone.",
    body: "`lib/pagination.ts` parses page, page size (capped at 100) and whitelisted sort columns, and decides where paging happens (server-side for sources that can pass 1000 rows, client-side for bounded tables, none for a single 50-row page). `useDataTable` combines sorting with auto-pagination above 50 rows, `useServerDataTable` is the URL-backed server mode, and `DataTablePager` renders the footer only when needed; about 20 existing tables were migrated and empties now sort as a true reversal. `/admin/members` used to load every member (one unpaginated select, silently capped at 1000), the whole attendance history and 30 days of activity, and compute in JS; `admin_members_page` and `admin_member_filter_counts` SQL functions now do it.",
  },
  {
    slug: "member-profile-overrides-and-trackbear-import",
    date: "2026-09-25",
    audience: "engineering",
    category: "new",
    title: "Member profile overrides and TrackBear import",
    summary: "Members' own bio and social links are stored in the Hub and win over Kajabi, and writing projects can be imported from a TrackBear export.",
    body: [
      "TrackBear import (2026-09-25): members upload TrackBear's data export on the Projects page (`/api/projects/import/trackbear`); projects, progress entries, starting balances, covers, tags and single-project goals are imported, and what Hub cannot represent is listed in the result and `docs/TODO.md`. An `external_id` column unique per member on projects, progress entries and goals makes re-imports idempotent. Export upload was chosen because TrackBear has no OAuth and its API needs a member-made key.",
      "Profile overrides (2026-09-26): Kajabi's API cannot write a customer's public bio or socials, so the Local-layer table `member_profile_overrides` (one row per member, own-row RLS, HTTP(S) and 1000-character bio checks) holds member edits. `/api/process/members` prefers a non-empty override field by field, matching on Kajabi id then email, and members reprocess when it changes. `lib/social-links.ts` validates handles and URLs. Line breaks in bios are preserved on the profile page.",
    ].join("\n\n"),
  },
{
    slug: "hub-welcome-dashboard",
    date: "2026-09-28",
    audience: "product",
    category: "new",
    title: "A dashboard that shows what is coming up",
    image: {
      src: "/changelog/hub-welcome-dashboard/01-dashboard.webp",
      alt: "The dashboard with a welcome, a Continue watching card, a How did it go? card and the first upcoming prickles.",
    },
    summary:
      "Open the Hub and see the prickles coming up in your next seven days, plus the writing goals you have starred.",
    body:
      "Your dashboard greets you by name and lists the next few prickles, with a link to find more when the week is empty. Star a writing goal on its project page and it shows here too, so your progress is one glance away.\n\nTimes are shown in your own time zone.\n\n[Open your dashboard](/dashboard)\n\n![The dashboard with a welcome, a Continue watching card, a How did it go? card and the first upcoming prickles.](/changelog/hub-welcome-dashboard/01-dashboard.webp)",
  },
  {
    slug: "browse-and-find-prickles",
    date: "2026-09-28",
    audience: "product",
    category: "new",
    title: "Browse every prickle, or let the Hub help you find one",
    image: {
      src: "/changelog/browse-and-find-prickles/01-all-prickles.webp",
      alt: "The All Prickles tab listing the weekly schedule by day with kind, host and typical turnout.",
    },
    summary:
      "My Prickles has tabs for what is coming up, every prickle on the schedule, and a short guide that helps you pick a prickle that suits you.",
    body:
      "In [My Prickles](/my-prickles) you can:\n\n- see the prickles coming up\n- browse All Prickles on the schedule, as a calendar or a table\n- use Find a Prickle to answer a few questions and get a suggestion\n- open any prickle to see what it is and who hosts it\n\n![The All Prickles tab listing the weekly schedule by day with kind, host and typical turnout.](/changelog/browse-and-find-prickles/01-all-prickles.webp)",
  },
  {
    slug: "attendance-history",
    date: "2026-09-28",
    audience: "product",
    category: "new",
    title: "Your attendance history",
    image: {
      src: "/changelog/attendance-history/01-attendance-month.webp",
      alt: "My Attendance in the month view, with the prickles attended shown on their days.",
    },
    summary:
      "Look back at the prickles you have attended, month by month on a calendar or as a list you can sort.",
    body:
      "The Attendance History tab in [My Prickles](/my-prickles/history) shows each prickle you joined, with its date and time. Switch between a month calendar and a list, and open any prickle for details.\n\n![My Attendance in the month view, with the prickles attended shown on their days.](/changelog/attendance-history/01-attendance-month.webp)",
  },
  {
    slug: "streaks-page",
    date: "2026-09-28",
    audience: "product",
    category: "new",
    title: "Streaks: celebrate showing up week after week",
    image: {
      src: "/changelog/streaks-page/01-streaks.webp",
      alt: "The Streaks page with an attendance streak, prickle streaks and streaks with other members.",
    },
    summary:
      "See how many weeks in a row you have joined a prickle, your best run so far, and the streaks you keep with a particular prickle or with another Hedgie.",
    body:
      "[Streaks](/streaks) shows three things:\n\n- your attendance streak, current and best, counted in weeks\n- Prickle Streaks, for attending the same prickle week after week\n- Sister Streaks, for showing up alongside the same Hedgie\n\nMiss a week and the streak starts again, so the page nudges you when it is time to begin a new one.\n\n![The Streaks page with an attendance streak, prickle streaks and streaks with other members.](/changelog/streaks-page/01-streaks.webp)",
  },
  {
    slug: "hosting-prickles",
    date: "2026-09-28",
    audience: "product",
    category: "new",
    title: "Host prickles and plan your hosting month",
    image: {
      src: "/changelog/hosting-prickles/01-hosting.webp",
      alt: "The Hosting tab with hosting stats and a Request to host button.",
    },
    summary:
      "If you host prickles, a Hosting tab lets you plan which weekly prickle times you take and see how your hosting is going.",
    body:
      "Hosts get a Hosting tab in [My Prickles](/my-prickles/hosting) with their schedule for the month and their hosting numbers. Hosts can also add a short note about the feel of their prickles in Settings, and a Hedgie's profile shows the prickles they host.\n\n![The Hosting tab with hosting stats and a Request to host button.](/changelog/hosting-prickles/01-hosting.webp)",
  },
  {
    slug: "my-writing-projects",
    date: "2026-09-28",
    audience: "product",
    category: "new",
    title: "My Writing: projects, goals and progress",
    image: {
      src: "/changelog/my-writing-projects/01-projects.webp",
      alt: "My Writing with project cards showing word counts and goal progress bars.",
    },
    summary:
      "Keep your projects in one place, set goals, log how much you wrote, and watch your progress on charts.",
    body:
      "In [My Writing](/projects) you can:\n\n- add a project and set goals for it\n- log your progress, by day, with a note\n- see charts of how the project is going\n- star a goal to show it on your dashboard\n- bring in progress you have been tracking in TrackBear\n\nEverything on this page is what you enter yourself.\n\n![My Writing with project cards showing word counts and goal progress bars.](/changelog/my-writing-projects/01-projects.webp)",
  },
  {
    slug: "books-and-awards",
    date: "2026-09-28",
    audience: "product",
    category: "new",
    title: "Your books and awards, and a Bookshelf for the whole community",
    image: {
      src: "/changelog/books-and-awards/02-bookshelf.webp",
      alt: "The Hedgie Book Shelf with covers, authors, genres and prices, and genre filters above.",
    },
    summary:
      "Add your published books and awards to your page, and browse the Hedgie Bookshelf to find what other members have published.",
    body:
      "Add books (with cover, description and a link to buy) and awards under the Books and Awards tabs of [My Writing](/projects). The [Bookshelf](/bookshelf) lists the books Hedgies have published, newest first, so you can discover and cheer on each other.\n\n![The Hedgie Book Shelf with covers, authors, genres and prices, and genre filters above.](/changelog/books-and-awards/02-bookshelf.webp)\n\n![My Writing, Books tab listing two books with their editions and prices.](/changelog/books-and-awards/01-my-books.webp)",
  },
  {
    slug: "wheel-of-wonder",
    date: "2026-09-28",
    audience: "product",
    category: "new",
    title: "Wheel of Wonder: meet a Hedgie who is here right now",
    image: {
      src: "/changelog/wheel-of-wonder/01-wheel-of-wonder.webp",
      alt: "The Wheel of Wonder with its empty wheel and a Spin the Wheel button.",
    },
    summary:
      "Give the wheel a spin and it picks a Hedgie who is online right now, leaning toward people who could use a new connection.",
    body:
      "Spin the [Wheel of Wonder](/wheel-of-wonder) when you would like some company. It shows who it picked and a conversation starter, and the page keeps a running count of the new connections the community has made.\n\n![The Wheel of Wonder with its empty wheel and a Spin the Wheel button.](/changelog/wheel-of-wonder/01-wheel-of-wonder.webp)",
  },
  {
    slug: "settings-and-profile",
    date: "2026-09-28",
    audience: "product",
    category: "new",
    title: "Settings: your profile, names, time zone and look",
    image: {
      src: "/changelog/settings-and-profile/01-identity.webp",
      alt: "Settings, Identity with the Real Name, Display Name and pen names fields.",
    },
    summary:
      "Make your profile yours, choose a light or dark look, set your time zone and manage where you are signed in.",
    body:
      "[Settings](/settings) has these tabs:\n\n- Account, with your email and the places you are signed in, and a button to sign out of the others\n- Profile, with your bio and links to Instagram, Facebook and X\n- Identity, with your name, birthday and the other names you are known by\n- Preferences, with a light, dark or automatic look and your time zone\n\n![Settings, Identity with the Real Name, Display Name and pen names fields.](/changelog/settings-and-profile/01-identity.webp)",
  },
  {
    slug: "personal-calendar-feed-and-commitments",
    date: "2026-09-27",
    audience: "product",
    category: "new",
    title: "Your prickles in your own calendar, and commitments across several slots",
    image: {
      src: "/changelog/personal-calendar-feed-and-commitments/01-commitments.webp",
      alt: "The Commitments tab with a Sync your prickles with your calendar card, buttons for Google, Apple and Outlook calendars and a copy link, above an active commitment covering two weekly slots.",
    },
    summary:
      "Subscribe to a private calendar feed of the prickles you host, commit to or add by hand, and make a commitment that covers more than one weekly slot.",
    body: [
      "Each member now has a private calendar link that works with Google Calendar, Apple Calendar and Outlook. It shows the prickles you host, the ones you have committed to, and any prickle or event you add yourself, with a 15 minute reminder.",
      "On /my-prickles you will find the calendar card, with copy link and generate new link. Use Add to my calendar on a prickle row, a prickle page or an upcoming event to add just that one or every week.",
      "A commitment can now cover several slots. In All Prickles, tick the times you want, then pick the weeks and a start date. The Commitments tab shows your progress on each slot.",
      "![The Commitments tab with a Sync your prickles with your calendar card, buttons for Google, Apple and Outlook calendars and a copy link, above an active commitment covering two weekly slots.](/changelog/personal-calendar-feed-and-commitments/01-commitments.webp)",
    ].join("\n\n"),
  },
  {
    slug: "member-directory-and-profile-notes",
    date: "2026-09-28",
    audience: "product",
    category: "new",
    title: "Member directory, Ask me about topics and private notes",
    summary:
      "Search the Hedgies in the new Members page, share what you love to talk about on your profile, and jot private notes about people you meet.",
    image: { src: "/changelog/member-directory-and-profile-notes/01-members-directory.webp", alt: "The Members page with a search box above a grid of member cards, each with a photo, name and bio." },
    body: [
      "![The Members page with a search box above a grid of member cards, each with a photo, name and bio.](/changelog/member-directory-and-profile-notes/01-members-directory.webp)",
      "The /members page lists current Hedgies with their bio, Ask me about topics and the writing projects they chose to show on their profile. Search matches names, bios, projects, topics and your own notes, and clicking a topic searches for it.",
      "Add your own Ask me about topics under Profile in Settings (/settings/profile).",
      "On someone else's profile you now have a My notes card for things you want to remember. Only you can see your notes.",
    ].join("\n\n"),
  },
  {
    slug: "writing-goal-titles-and-status",
    date: "2026-09-28",
    audience: "product",
    category: "improved",
    title: "Writing goals: titles, profile visibility and clearer status",
    summary:
      "Goals can have a title and description, and you choose whether each shows on your profile. Finished goals now say Achieved or Ended instead of Behind pace.",
    body: [
      "- Give a writing goal a title and a description. Both show on its card.",
      "- Choose Show on my profile for each goal and project. Your profile lists every one you chose to show.",
      "- A goal that reaches its target says Achieved, and one whose end date passed without reaching it says Ended. Pace is only shown while a goal is active.",
      "- Fixed: other members could not see the project you chose to show on your profile.",
      "![A project with an achieved goal and a goal behind pace, each with its title and description](/changelog/writing-goal-titles-and-status/01-goals.webp)",
    ].join("\n"),
    image: { src: "/changelog/writing-goal-titles-and-status/01-goals.webp", alt: "A project page with goal cards that have titles and descriptions: one marked Behind pace and one marked Achieved" },
  },
  {
    slug: "sign-in-from-slack",
    date: "2026-09-29",
    audience: "product",
    category: "new",
    title: "Sign in to the Hub from Slack",
    image: { src: "/changelog/sign-in-from-slack/01-slack-home-sign-in.webp", alt: "Billie Bot's Home tab in Slack with the Open Hedgie Hub button." },
    summary:
      "Open the Hedgie Hub straight from Slack, without waiting for an email link.",
    body: [
      "![Billie Bot's Home tab in Slack with the Open Hedgie Hub button.](/changelog/sign-in-from-slack/01-slack-home-sign-in.webp)",
      "Billie Bot's Home tab in Slack, and its /hub command, give you an Open Hedgie Hub button that signs you in. Each link works once and lasts about an hour.",
      "Slack on iPhone opens links in its own browser, so you can also ask for a link to copy and open in Safari, or paste the code on the login page.",
      "Sign-in links sent by email now stay valid for 24 hours, and an invited person who asks for a link gets the invite again.",
    ].join("\n\n"),
  },
  {
    slug: "check-ins-and-prickle-picker",
    date: "2026-10-02",
    audience: "product",
    category: "new",
    title: "Say how you feel before and after a prickle",
    image: {
      src: "/changelog/check-ins-and-prickle-picker/01-prickle-picker-feelings.webp",
      alt: "The Prickle Picker's How are you feeling? step with overall and energy scales, a feeling search and an intention list.",
    },
    summary:
      "Tell us how you are feeling and what you need before a prickle, and how it went afterwards. The Prickle Picker can use your answers to suggest prickles.",
    body: [
      "Every prickle page has a Check in card. Pick up to two feelings for how you are coming in and one thing you need, such as momentum, deep focus, accountability, company or a push to get unstuck. Once the prickle has started you can also rate how it went and how you feel now. Every question is optional, and only you and the Hub admins can see your answers.",
      "The Prickle Picker now starts with How are you feeling? Your answer suggests a mood and the picks follow. Once you have rated at least two similar sessions, it also favors the kinds of prickle you rated higher than your usual.",
      "There is no AI in the Prickle Picker, and nothing in it reads your writing. The part that gets personal only looks at your own past check-in ratings of similar sessions.",
      "![The Prickle Picker's How are you feeling? step with overall and energy scales, a feeling search and an intention list.](/changelog/check-ins-and-prickle-picker/01-prickle-picker-feelings.webp)",
    ].join("\n\n"),
  },
  {
    slug: "link-writing-to-prickles",
    date: "2026-10-02",
    audience: "product",
    category: "improved",
    title: "Link your writing progress to the prickle you wrote in",
    image: {
      src: "/changelog/link-writing-to-prickles/01-log-progress.webp",
      alt: "The Log Progress window with a During which prickle? picker beneath the project, measure and date.",
    },
    summary:
      "When you log progress you can say which prickle it was during, and your dashboard reminds you about writing prickles you have not logged.",
    body: [
      "- The Log Progress window has a During which prickle? picker for the prickles on that day. If you attended just one, it is chosen for you.",
      "- A prickle page shows Your writing in this prickle, and project pages show which prickle an entry was written during.",
      "- If you have a writing project, your dashboard has a What did you write? card listing recent prickles with nothing logged. Log from it, or use the x to dismiss one you would rather skip.",
      "- Fixed: an evening prickle no longer defaults the entry to the next day.",
      "",
      "![The Log Progress window with a During which prickle? picker beneath the project, measure and date.](/changelog/link-writing-to-prickles/01-log-progress.webp)",
    ].join("\n"),
  },
  {
    slug: "check-in-and-check-out-dms",
    date: "2026-10-03",
    audience: "product",
    category: "new",
    title: "Slack reminders to check in before a prickle and check out after",
    summary:
      "Billie Bot, our Slack helper, messages you shortly before a prickle to ask how you are feeling, and afterwards to ask how it went. You choose whether you get these, and where.",
    body: [
      "Before a prickle you get a short message asking how you are feeling coming in, and afterwards one asking how it went. Each links to the check-in or check-out itself.",
      "Choose which messages you get, and whether they come by Slack or in the Hub, under Notifications in Settings (/settings/notifications). Check-out is available on the prickle page once the prickle starts.",
      "The Slack bot is now named Billie Bot (Hedgie Hub), so searching for hub finds it.",
      "![Prickle check-ins and check-outs in Notifications settings](/changelog/check-in-and-check-out-dms/01-check-in-settings.webp)",
    ].join("\n\n"),
    image: { src: "/changelog/check-in-and-check-out-dms/01-check-in-settings.webp", alt: "Settings, Notifications, with the Prickle check-ins and Prickle check-outs rows and their channel toggles" },
  },
  {
    slug: "getting-started-tour",
    date: "2026-10-03",
    audience: "product",
    category: "new",
    title: "A Getting started tour for new members",
    summary:
      "A checklist walks new members through setting up their details, introducing themselves, setting a writing goal and finding a prickle.",
    image: { src: "/changelog/getting-started-tour/01-getting-started.webp", alt: "The Getting started checklist open in the corner of the dashboard with 0 of 6 steps done." },
    body: [
      "![The Getting started checklist open in the corner of the dashboard with 0 of 6 steps done.](/changelog/getting-started-tour/01-getting-started.webp)",
      "A Getting started checklist appears in the corner of the page for accounts under 30 days old. At each step a spotlight shows you the setting to use. Check your details covers your name, birthday, pen names and other email addresses.",
      "Finished steps can be revisited, and you can restart the tour from the user menu.",
    ].join("\n\n"),
  },
  {
    slug: "in-the-hub-notifications",
    date: "2026-10-03",
    audience: "product",
    category: "new",
    title: "Notifications inside the Hub",
    summary:
      "A bell in the header and a notifications inbox keep your check-ins and other messages in the Hub, with a banner for anything time sensitive.",
    body: [
      "Messages can now arrive In the Hub as well as Slack: a bell in the header with the latest few, and a full list at /notifications. A banner appears for what is worth acting on right now, such as a check-in before the prickle starts.",
      "![The notifications inbox listing a check-in and a check-out](/changelog/in-the-hub-notifications/01-inbox.webp)",
      "A notification counts as read once you open it, dismiss its banner or answer it. You can mark messages unread again and use Edit multiple to mark many as read or unread.",
    ].join("\n\n"),
    image: { src: "/changelog/in-the-hub-notifications/01-inbox.webp", alt: "The Notifications page listing an unread check-in and a read check-out, with Mark read and Mark unread links" },
  },
  {
    slug: "week-2026-10-03-small-fixes",
    date: "2026-10-03",
    audience: "product",
    category: "fixed",
    title: "Fixes to sign-in, notification settings and the dashboard",
    summary:
      "A handful of fixes to sign-in, notification settings and the dashboard.",
    body: [
      "- Members whose login email differs from the email on their membership can save changes again.",
      "- On the sign-in screen, duplicate Slack paste controls are merged, and the iPhone instructions lead with what to do on an iPhone.",
      "- Notification channels show as logo toggles in each row.",
      "- On your dashboard, the project title is larger than the goal in Writing Goals.",
      "- Settings pages now have their own addresses, such as /settings/notifications.",
    ].join("\n"),
  },
  {
    slug: "check-in-from-attendance-history",
    date: "2026-10-04",
    audience: "product",
    category: "improved",
    title: "Check in and out from your attendance history",
    image: {
      src: "/changelog/check-in-from-attendance-history/01-attendance-history.webp",
      alt: "Attendance History as a list, each prickle row with Check in and Check out buttons.",
    },
    summary:
      "Attendance History now has check-in and check-out buttons for each prickle, and Find a Prickle always gives you something to consider.",
    body: [
      "- Each row in Attendance History at /my-prickles/history has Check in and Check out buttons, and upcoming prickles have a Check in button. Checking out also lets you log progress for your projects.",
      "- The check-out has a star rating, and the progress questions take numbers.",
      "- Attendance History opens as a list, 25 rows at a time.",
      "- Find a Prickle always suggests something, and says what does not match what you asked for. The feelings question now comes last and is optional.",
      "",
      "![Attendance History as a list, each prickle row with Check in and Check out buttons.](/changelog/check-in-from-attendance-history/01-attendance-history.webp)",
    ].join("\n"),
  },
  {
    slug: "week-2026-10-05-fixes",
    date: "2026-10-05",
    audience: "product",
    category: "fixed",
    title: "Fractions, check-out links and simpler check-in options",
    summary:
      "Fractional amounts, check-out links and a lighter set of check-in options.",
    body: [
      "- Progress and goal amounts can now be fractions.",
      "- The check-out message links to the check-out, not the check-in.",
      "- Check-in options were trimmed: fewer feelings, and Gentle is folded into Company.",
      "- Slack messages from Billie Bot no longer show a big link preview card.",
    ].join("\n"),
  },
  {
    slug: "email-notifications",
    date: "2026-10-10",
    audience: "product",
    category: "new",
    title: "Get notifications by email",
    summary:
      "You can now choose email for any kind of Hub message, and every email has an unsubscribe link.",
    body: [
      "Under Notifications in Settings (/settings/notifications), turn on email for the messages you want. Email is off until you choose it. Each email has a link to stop that kind of message.",
      "![Notifications settings with an email toggle on each kind of message](/changelog/email-notifications/01-notification-settings.webp)",
    ].join("\n\n"),
    image: { src: "/changelog/email-notifications/01-notification-settings.webp", alt: "Settings, Notifications, with a Slack, in-Hub and email toggle on each kind of message" },
  },
  {
    slug: "notification-framework",
    date: "2026-10-03",
    audience: "engineering",
    category: "new",
    title: "Notification framework with per-kind channels",
    summary:
      "Automatic messages go through one framework with per-kind, per-channel settings for each member.",
    body: [
      "Each kind of message is registered in lib/notifications/registry.ts and sent through createNotifier in lib/notifications/notify.ts, which honors member opt-outs. Delivery adapters live in lib/channels/ (Slack, then in-app and email). A message can be marked time sensitive until a given time, and each channel decides what that means. Admin Test Notifications sends every kind on every channel. Related product entries: check-in and check-out messages, notifications inside the Hub, and email notifications.",
    ].join("\n\n"),
  },
  {
    slug: "env-config-layering",
    date: "2026-10-02",
    audience: "engineering",
    category: "improved",
    title: "Config split between app.config.ts and layered env files",
    summary:
      "Shared deployment config moved into a committed app config, and secrets are layered across shared, preview and production env files.",
    body: [
      "Values that are the same everywhere live in app.config.ts and are read through lib/config.ts. Secrets use .env.shared with .env.preview and .env.prod overrides, synced by the env:sync scripts. Analytics tracking is production only, and Sentry events are tagged by environment.",
    ].join("\n\n"),
  },
  {
    slug: "slack-manifest-from-ci",
    date: "2026-10-02",
    audience: "engineering",
    category: "improved",
    title: "Slack app manifest pushed from CI",
    summary:
      "The Slack app configuration is now code, pushed after each production deploy when it changes.",
    body: [
      "slack-app-manifest.yml is the source of truth and scripts/slack-manifest.ts pushes it after the production deploy, and only when it has changed.",
    ].join("\n\n"),
  },
  {
    slug: "activity-log-and-audit",
    date: "2026-10-06",
    audience: "engineering",
    category: "new",
    title: "Audit log and central Activity Log",
    summary:
      "Admin changes and member actions are recorded in one audit log with readable rows and per-record history.",
    body: [
      "The Activity Log page is admin only. The audit log records the net effect of a transaction rather than every intermediate write, and has a Hide system toggle. See docs/ACTIVITY_AND_AUDIT_LOG.md.",
    ].join("\n\n"),
  },
  {
    slug: "slack-bronze-capture",
    date: "2026-10-07",
    audience: "engineering",
    category: "improved",
    title: "Richer Slack capture with soft deletes",
    summary:
      "Group DMs, channel membership history, custom emoji and files are captured, deletions are marked rather than removed, and Slack message content is service role only.",
    body: [
      "Slack Bronze tables use a deleted_at column for removed messages and reactions, and aging out of the import window is never treated as deletion. Message text is readable only with the service role, admins read metadata through a view, and restricted channels are managed by admins. Activities rebuild one week per call to stay inside the statement timeout.",
    ].join("\n\n"),
  },
  {
    slug: "chat-mirror-tables",
    date: "2026-10-09",
    audience: "engineering",
    category: "new",
    title: "Chat mirror tables and live updates",
    summary:
      "A mirror of Slack conversations is projected from Bronze and updated live over Realtime, with posting back to Slack through an outbox.",
    body: [
      "Row-level security gates content separately from channel metadata. Posts from the Hub go to Slack through an outbox with retries, and are credited to their author in activity and Wheel of Wonder. See docs/SLACK_BRIDGED_CHAT.md and the Hub Chat product entry.",
    ].join("\n\n"),
  },
  {
    slug: "instagram-and-profile-links",
    date: "2026-10-12",
    audience: "product",
    category: "improved",
    title: "Instagram on your profile",
    image: { src: "/changelog/instagram-and-profile-links/01-profile-links.webp", alt: "Settings, Profile with the Instagram field filled in beside Facebook and X." },
    summary:
      "The Instagram field in Settings is now a link like Facebook and X, and it shows the handle your profile really links to.",
    body: [
      "![Settings, Profile with the Instagram field filled in beside Facebook and X.](/changelog/instagram-and-profile-links/01-profile-links.webp)",
      "Under Settings, Profile, the Instagram field shows the handle your profile points to. Clear the field and the handle comes off your profile and the directory.",
    ].join("\n\n"),
  },
  {
    slug: "universal-search",
    date: "2026-10-15",
    audience: "product",
    category: "new",
    title: "Search everything from the header",
    summary:
      "Search the Hub from the header to find members, prickles, events, pages and each settings section, with filters you can type.",
    image: { src: "/changelog/universal-search/01-search-results.webp", alt: "The search box open over the dashboard with the letters will typed, listing a matching member under Members." },
    body: [
      "Press the search box in the header (or Cmd or Ctrl K) to find members, prickles, events, pages and each section of Settings. Filters such as from: narrow results to one person, and you can limit by kind or by how recent something is. The filter bar is one compact row that wraps on a small screen instead of scrolling sideways.",
      "![The search box open over the dashboard with the letters will typed, listing a matching member under Members.](/changelog/universal-search/01-search-results.webp)",
      "Recent searches can be removed with the x. On phones the search fills the screen, and a full results page is at /search.",
    ].join("\n\n"),
  },
  {
    slug: "whos-coming-to-prickles",
    date: "2026-10-15",
    audience: "product",
    category: "new",
    title: "See who is coming to upcoming prickles",
    image: {
      src: "/changelog/whos-coming-to-prickles/01-whos-coming.webp",
      alt: "An upcoming prickle's page with a Who's coming card listing the host and a member who added it to their calendar.",
    },
    summary:
      "An upcoming prickle now shows who is planning to be there, and you can choose not to be listed.",
    body: [
      "On a prickle that has not started, the page shows Who's coming: the host, plus members who committed to it or added it to their calendar. It is a friendly sign of who is planning to join, not a reservation.",
      "![The Who's coming card on an upcoming prickle](/changelog/whos-coming-to-prickles/01-whos-coming.webp)",
      "Prefer not to be listed? Turn it off under Settings, Profile. You will still see yourself, marked as hidden from others. A prickle nobody has joined yet says to stay tuned instead of showing a zero.",
    ].join("\n\n"),
  },
  {
    slug: "add-to-calendar-from-upcoming",
    date: "2026-10-15",
    audience: "product",
    category: "improved",
    title: "Add a prickle to your calendar from the Upcoming list",
    image: {
      src: "/changelog/add-to-calendar-from-upcoming/01-upcoming-calendar-icon.webp",
      alt: "The Upcoming tab of My Prickles, a list of prickles with a small calendar icon at the right of each one.",
    },
    summary:
      "Each prickle in My Prickles, Upcoming has a calendar icon, so you no longer have to open it first.",
    body: [
      "The icon opens the same menu as the prickle page: just this one, or every week. A prickle you host or committed to shows why it is already on your calendar. Find it in [My Prickles](/my-prickles).",
      "![The Upcoming list with a calendar icon beside each prickle](/changelog/add-to-calendar-from-upcoming/01-upcoming-calendar-icon.webp)",
    ].join("\n\n"),
  },
  {
    slug: "getting-started-newcomer-steps",
    date: "2026-10-15",
    audience: "product",
    category: "improved",
    title: "Getting started: steps for newcomers",
    summary:
      "The Getting started tour now has steps for saying hello, scheduling your first prickle and syncing your calendar, and it is on for everyone.",
    image: { src: "/changelog/getting-started-newcomer-steps/01-getting-started.webp", alt: "The Getting started checklist listing Introduce yourself, Join a prickle and Sync your calendar among its steps." },
    body: [
      "![The Getting started checklist listing Introduce yourself, Join a prickle and Sync your calendar among its steps.](/changelog/getting-started-newcomer-steps/01-getting-started.webp)",
      "",
      "- Say hello in the intro channel on Slack (for members in their first 90 days). It checks off when you post there.",
      "- Schedule your first prickle, pointing at the calendar icon in Upcoming.",
      "- Sync your calendar, pointing at the sync card on Commitments. It checks off once your calendar app has fetched your feed.",
      "- The goal form now explains the difference between a Target and a Habit, and new goals start pinned to your dashboard and shown on your profile (you can untick either).",
    ].join("\n"),
  },
  {
    slug: "start-a-new-streak-nudge",
    date: "2026-10-15",
    audience: "product",
    category: "improved",
    title: "A kinder nudge when a streak lapses",
    image: {
      src: "/changelog/start-a-new-streak-nudge/01-seedling-badge.webp",
      alt: "Upcoming prickles with a seedling badge on a Plot or Plan Prickle, its tooltip reading Start a new streak: you hit 2 weeks in a row here, beat your best.",
    },
    summary:
      "The sad broken-heart badge on upcoming prickles is now a seedling that invites you to start a new streak.",
    body: [
      "Where a prickle used to show a broken heart for a streak you had lost, it now shows a seedling and says how many weeks in a row you reached there, with a nudge to beat your best.",
      "![A seedling badge on an upcoming Plot or Plan Prickle, with its tooltip about your 2 weeks in a row](/changelog/start-a-new-streak-nudge/01-seedling-badge.webp)",
    ].join("\n\n"),
  },
  {
    slug: "time-zone-choices",
    date: "2026-10-18",
    audience: "product",
    category: "improved",
    title: "Clearer time zone settings",
    image: {
      src: "/changelog/time-zone-choices/01-time-zone-settings.webp",
      alt: "Settings, Preferences with the Primary time zone picker showing Eastern Time.",
    },
    summary:
      "The auto-detect option is gone, your current location is always one click away, and the time zone prompt no longer pops up after you pick a zone yourself.",
    body: [
      "- The Settings time zone list no longer has an auto-detect option that did not stick. Your Hub keeps a real time zone and still offers to switch when it sees you are somewhere else.",
      "- Your browser's current zone is always in the list, with a Use current location button to return to it.",
      "- Picking a zone in Settings no longer immediately asks whether to change it, and the dropdown updates right away when you answer Yes.",
      "",
      "![Settings, Preferences with the Primary time zone picker showing Eastern Time.](/changelog/time-zone-choices/01-time-zone-settings.webp)",
    ].join("\n"),
  },
  {
    slug: "zoom-meeting-id",
    date: "2026-10-18",
    audience: "product",
    category: "improved",
    title: "Join details for the prickle room",
    image: {
      src: "/changelog/zoom-meeting-id/02-join-details.webp",
      alt: "The check-in window after checking in, saying Checked in, with the meeting ID, the passcode and a Join the prickle button.",
    },
    summary:
      "The check-in window, the Slack check-in message and your calendar feed now carry the prickle room's Zoom link, meeting ID and passcode.",
    body: [
      "Instead of hunting for the link, you get a Join button with the passcode in the check-in window and in the Slack check-in message, and each prickle in your personal calendar feed has the link, meeting ID and passcode in its description. This is for the main prickle room.",
      "![The check-in window after checking in, with the meeting ID, passcode and a Join the prickle button](/changelog/zoom-meeting-id/02-join-details.webp)",
    ].join("\n\n"),
  },
  {
    slug: "on-air-light",
    date: "2026-10-19",
    audience: "product",
    category: "new",
    title: "On air light",
    image: {
      src: "/changelog/on-air-light/01-on-air-popover.webp",
      alt: "The red On air light in the header with 5 Hedgies at the table, opened to a card with the running prickle, its host, who is in the room, a Join on Zoom button, the meeting ID and the passcode.",
    },
    summary:
      "A light in the header shows when the prickle room has people in it and how to join.",
    body: [
      "When people are at the table, a red On air light blinks beside the bell with a count. Click it to see the prickle and its host, who is in the room, and the Zoom link with meeting ID and passcode. When the room is empty the light is grey, and the same link is offered as a way to start a pop-up prickle.",
      "![The red On air light with 5 Hedgies at the table, opened to the prickle, who is in the room and the Zoom link](/changelog/on-air-light/01-on-air-popover.webp)",
      "A grey Off air light means nobody is at the table, and its button starts a pop-up prickle.",
      "![The grey Off air light opened to a card saying nobody is at the table, with a Start a PUP on Zoom button, the meeting ID and the passcode](/changelog/on-air-light/02-off-air-popover.webp)",
    ].join("\n\n"),
  },
  {
    slug: "display-name-and-identity",
    date: "2026-10-20",
    audience: "product",
    category: "new",
    title: "Choose your display name",
    summary:
      "Settings now says which name the community sees, and you can pick one of your pen names or write your own as your display name.",
    image: { src: "/changelog/display-name-and-identity/01-identity-settings.webp", alt: "The Identity tab in Settings with Real Name, Display Name, Pen Names and Email Aliases sections." },
    body: [
      "On [Identity](/settings/identity) the sections now run Real Name, Display Name, Pen Names, Email Aliases and Birthday. Your Real Name is for your account and records. Your Display Name is what other members see.",
      "![The Identity tab in Settings with Real Name, Display Name, Pen Names and Email Aliases sections.](/changelog/display-name-and-identity/01-identity-settings.webp)",
      "Choose a pen name from the list or Write your own. A name already used by another member is refused. Each section is its own stop in Getting started.",
    ].join("\n\n"),
  },
  {
    slug: "connect-slack-step",
    date: "2026-10-20",
    audience: "product",
    category: "improved",
    title: "Connect Slack in Getting started",
    summary:
      "Getting started has a Connect Slack step. Once connected, reading a conversation in Slack or in the Hub marks it as read in both places.",
    image: { src: "/changelog/connect-slack-step/01-getting-started.webp", alt: "The Getting started checklist open in the corner of the dashboard, listing Check your details, Connect Slack and four more steps." },
    body: [
      "![The Getting started checklist open in the corner of the dashboard, listing Check your details, Connect Slack and four more steps.](/changelog/connect-slack-step/01-getting-started.webp)",
      "Connecting Slack (Settings, Account) lets Hub Chat send as you. Once connected, reading a conversation in one place clears it as unread in the other. Connecting also makes Open Hedgie Hub in Slack find your account even if your Slack email differs from your Hub email.",
      "A tour you already finished reopens to show only the steps added since.",
    ].join("\n\n"),
  },
  {
    slug: "link-previews",
    date: "2026-10-20",
    audience: "product",
    category: "fixed",
    title: "Cleaner previews for Hub links",
    image: { src: "/changelog/link-previews/01-slack-link-preview.webp", alt: "A Hub link in Slack with its preview card: title, description and one centered picture." },
    summary:
      "A Hub link shared in Slack and elsewhere now shows a single centered picture instead of an empty or cropped image.",
    body: [
      "![A Hub link in Slack with its preview card: title, description and one centered picture.](/changelog/link-previews/01-slack-link-preview.webp)",
      "We fixed the preview image for shared Hub links so it appears and is not cropped. Slack on iPhone also no longer shows a stray ampersand code in the preview.",
    ].join("\n\n"),
  },
  {
    slug: "member-hover-card",
    date: "2026-10-22",
    audience: "product",
    category: "new",
    title: "Hover cards for members",
    summary:
      "Point at a member's name or photo in chat or on Streaks to see their profile at a glance.",
    image: { src: "/changelog/member-hover-card/01-hover-card.webp", alt: "Pointing at a member's name on Streaks opens a small card with her photo, name and a View profile button." },
    body: [
      "![Pointing at a member's name on Streaks opens a small card with her photo, name and a View profile button.](/changelog/member-hover-card/01-hover-card.webp)",
      "The card shows their photo and name, when they became a Hedgie, up to three Ask me about topics and social links, with Message and View profile buttons. It also opens from the keyboard. On [Streaks](/streaks), sister names now link to profiles.",
    ].join("\n\n"),
  },
  {
    slug: "secondary-time-zone",
    date: "2026-10-22",
    audience: "product",
    category: "new",
    title: "Show a second time zone beside prickle times",
    image: {
      src: "/changelog/secondary-time-zone/01-second-time-zone.webp",
      alt: "Settings, Preferences with Show a secondary time zone ticked and a Secondary time zone picker below it.",
    },
    summary:
      "Settings has an option to show a second time zone, such as Eastern, beside the prickle times in your own.",
    body: [
      "Turn on Also show a second time zone under [Preferences](/settings/preferences) and pick any zone. It starts at Eastern, where prickles are announced. It is off by default, and appears next to times on upcoming prickles, events and commitments.",
      "![Settings, Preferences with Show a secondary time zone ticked and a Secondary time zone picker below it.](/changelog/secondary-time-zone/01-second-time-zone.webp)",
    ].join("\n\n"),
  },
  {
    slug: "wheel-of-wonder-message-on-slack",
    date: "2026-10-22",
    audience: "product",
    category: "improved",
    title: "Wheel of Wonder waits for you",
    image: { src: "/changelog/wheel-of-wonder-message-on-slack/01-wheel-match.webp", alt: "The Wheel of Wonder after a spin: the match, with a Message on Slack button and Spin Again." },
    summary:
      "Spinning the Wheel now only picks a match; the chat and icebreaker start when you click Message on Slack.",
    body: [
      "![The Wheel of Wonder after a spin: the match, with a Message on Slack button and Spin Again.](/changelog/wheel-of-wonder-message-on-slack/01-wheel-match.webp)",
      "Before, a spin opened a Slack chat and posted the icebreaker straight away. Now you can look at your match first, and the button says what it will do.",
    ].join("\n\n"),
  },
  {
    slug: "check-in-feeling-wheel",
    date: "2026-10-24",
    audience: "product",
    category: "improved",
    title: "Check-ins with mood scales and the Feeling Wheel",
    image: {
      src: "/changelog/check-in-feeling-wheel/01-feeling-wheel.webp",
      alt: "The mood scales and the Feeling Wheel, with Joyful chosen and its more specific feelings listed below.",
    },
    summary:
      "Check-ins now use two labeled mood scales and an optional Feeling Wheel, and check-out asks whether you got what you came for.",
    body: [
      "- Before a prickle: rate how you feel overall and your energy on labeled five-step scales, optionally name the feeling from the Feeling Wheel (search works too), and choose your intention from a list.",
      "- After a prickle: say whether you got what you came for, then the same scales and the progress questions.",
      "The same questions appear in the check-in window, in Slack messages and where you log progress.",
      "",
      "![The mood scales and the Feeling Wheel, with Joyful chosen and its more specific feelings listed below.](/changelog/check-in-feeling-wheel/01-feeling-wheel.webp)",
    ].join("\n"),
  },
  {
    slug: "member-help-articles",
    date: "2026-10-24",
    audience: "product",
    category: "new",
    title: "Hedgie Help",
    summary:
      "Hedgie Help has articles on joining a prickle, planning your month, becoming a host, starting a pop-up prickle and running a prickle.",
    image: { src: "/changelog/member-help-articles/01-help-index.webp", alt: "The Hedgie Help page listing five articles, from How to join a prickle to Run a prickle." },
    body: [
      "![The Hedgie Help page listing five articles, from How to join a prickle to Run a prickle.](/changelog/member-help-articles/01-help-index.webp)",
      "Open [Hedgie Help](/help) from the question mark in the top bar beside the bell. It is also in the search. Each article walks through the real screens.",
    ].join("\n\n"),
  },
  {
    slug: "zoom-name-in-getting-started",
    date: "2026-10-24",
    audience: "product",
    category: "improved",
    title: "Getting started asks for your Zoom name",
    summary:
      "The tour explains that prickles are counted by the name Zoom shows, and refuses a name another member already uses.",
    image: { src: "/changelog/zoom-name-in-getting-started/01-zoom-name-stop.webp", alt: "The Pen Names and Zoom/Slack Names section of Identity settings highlighted, with a Getting started step asking for your Zoom name." },
    body: [
      "![The Pen Names and Zoom/Slack Names section of Identity settings highlighted, with a Getting started step asking for your Zoom name.](/changelog/zoom-name-in-getting-started/01-zoom-name-stop.webp)",
      "Change your name in Zoom to match your Real Name, or add the name you use in Zoom as a pen name. A name that is another member's pen name or real name is refused, so attendance cannot land on the wrong person.",
    ].join("\n\n"),
  },
  {
    slug: "week-calendars-on-phones",
    date: "2026-10-24",
    audience: "product",
    category: "fixed",
    title: "Week calendars scroll on phones",
    image: {
      src: "/changelog/week-calendars-on-phones/01-week-on-phone.webp",
      alt: "All Prickles in Calendar view on a phone, the week reaching past the right edge of the screen.",
    },
    summary:
      "On a phone you can now scroll sideways to Thursday through Saturday on week calendars instead of having them cut off.",
    body: [
      "This fixes All Prickles, My Attendance and the host request form. We also made secondary text easier to read, using darker or lighter greys that meet contrast guidelines in both light and dark mode, and made the closed mobile menu skip keyboard focus.",
      "In light mode, today's column is also easier to see.",
      "![All Prickles in Calendar view on a phone, the week reaching past the right edge of the screen.](/changelog/week-calendars-on-phones/01-week-on-phone.webp)",
    ].join("\n\n"),
  },
  {
    slug: "big-sisters-groundwork",
    date: "2026-10-15",
    audience: "engineering",
    category: "new",
    title: "Big Sisters program, behind a preview flag",
    summary:
      "Matching, volunteers, introductions and a Big Sisters page were built behind a preview flag that is not on for everyone.",
    body: [
      "New members would get a big sister for their first 30 days, with staff choosing the match and arrival dates and trial outcomes derived from membership data. Not yet a general product update; add a product entry when the flag goes on. See docs/BIG_SISTERS.md.",
    ].join("\n\n"),
  },
  {
    slug: "coverage-reporting",
    date: "2026-10-14",
    audience: "engineering",
    category: "new",
    title: "Test coverage reporting",
    summary:
      "Coverage is measured, API tests run in-process so route coverage counts, and new code must meet a floor.",
    body: [
      "v8 coverage with area floors; API tests call route handlers in-process; a required Coverage report check gates patches.",
    ].join("\n\n"),
  },
  {
    slug: "usage-analytics-tracking-plan",
    date: "2026-10-20",
    audience: "engineering",
    category: "new",
    title: "Usage analytics with a tracking plan",
    summary:
      "Only declared events are stored, with funnels and a usage explorer for admins.",
    body: [
      "Events are declared in lib/analytics/events.ts and funnels in lib/analytics/funnels.ts. Members can leave usage statistics from /privacy. See docs/ANALYTICS.md.",
    ].join("\n\n"),
  },
  {
    slug: "ci-and-tooling-week-1018",
    date: "2026-10-21",
    audience: "engineering",
    category: "improved",
    title: "pnpm, auto-merge, docs-only skips and container queries",
    summary:
      "The repo moved to pnpm, new PRs auto-merge on green, docs-only changes skip tests and deploy, and layouts use named container queries.",
    body: [
      "Named container sizes live in tailwind.config.ts. A production tag marks what is deployed. Migration order is checked in pre-commit and CI.",
    ].join("\n\n"),
  },
  {
    slug: "short-ids-phase-one",
    date: "2026-10-23",
    audience: "engineering",
    category: "improved",
    title: "Short prefixed ids for Tier 1 tables",
    summary:
      "Members, prickles and other visible records moved from uuids to readable prefixed ids.",
    body: [
      "new_id(prefix) generates ids like mbr_ and prkl_, and new tables follow the same rule. Links to members and prickles use the new ids. See docs/SHORT_IDS_PLAN.md.",
    ].join("\n\n"),
  },
  {
    slug: "demo-harness",
    date: "2026-10-23",
    audience: "engineering",
    category: "new",
    title: "Demo harness and help screenshots",
    summary:
      "A separate demo stack with Playwright scenes produces the screenshots used in Hedgie Help.",
    body: [
      "Every scene also runs page checks (accessibility, overflow, console), and screenshots are published before deploy. See docs/DEMO_AND_HELP.md.",
    ].join("\n\n"),
  },
  {
    slug: "data-access-layer",
    date: "2026-10-23",
    audience: "engineering",
    category: "new",
    title: "Data access layer with repositories",
    summary:
      "Tables are queried through repositories with an in-memory twin for tests, starting with attendance.",
    body: [
      "lib/data holds an interface, a Supabase class and an in-memory class per aggregate, and tests/lib/data-access-layer.test.ts guards against new direct queries.",
    ].join("\n\n"),
  },
  {
    slug: "typed-supabase-clients",
    date: "2026-10-24",
    audience: "engineering",
    category: "improved",
    title: "Typed Supabase clients and stale-type check",
    summary:
      "Every Supabase client is typed with the generated Database, and CI fails when the generated types are stale.",
    body: [
      "pnpm types:gen regenerates lib/data/database.types.ts and pnpm types:check runs in CI.",
    ].join("\n\n"),
  },
  {
    slug: "navigation-reorganized",
    date: "2026-10-25",
    audience: "product",
    category: "improved",
    title: "Clearer navigation and a footer",
    image: { src: "/changelog/navigation-reorganized/01-sidebar.webp", alt: "The sidebar with Community and Explore groups, and the footer with Privacy and Contact us." },
    summary:
      "The sidebar now separates Community, where you take part, from Explore, where you browse, and the My prefix is gone from your own pages.",
    body: [
      "![The sidebar with Community and Explore groups, and the footer with Privacy and Contact us.](/changelog/navigation-reorganized/01-sidebar.webp)",
      "Chat, Wheel of Wonder and Big Sisters stay under Community. Members, Book Shelf and Events moved to a new Explore group. My Writing and My Prickles are now Writing and Prickles in the sidebar and search (their page headings are unchanged).",
      "The member area also has a small footer with links to Privacy and Contact us.",
    ].join("\n\n"),
  },
  {
    slug: "search-and-display-names",
    date: "2026-10-27",
    audience: "product",
    category: "improved",
    title: "Search finds the names people go by",
    summary:
      "The search box in the top bar also finds the other names a member goes by and the guest speaker of a prickle, and hosts and attendees show the name people go by.",
    image: { src: "/changelog/search-and-display-names/01-search-alternate-name.webp", alt: "The search box with Jules typed, showing the member Julia Sample with the line also known as Jules Sample." },
    body: [
      "![The search box with Jules typed, showing the member Julia Sample with the line also known as Jules Sample.](/changelog/search-and-display-names/01-search-alternate-name.webp)",
      "When a search result matches a nickname, a small line under it says so (the search on the Members page matches names as before). Hosts and attendees on prickle pages, the attendance calendar, calendar feed titles and the Events page now show each person's display name instead of their legal name.",
      "Members can no longer turn their own alternate names on or off in Settings. Those names are how attendance gets matched to you, so switching one off could lose matches. Staff can still do it for you.",
    ].join("\n\n"),
  },
  {
    slug: "help-menu",
    date: "2026-10-27",
    audience: "product",
    category: "improved",
    title: "A help menu in the top bar",
    summary:
      "The help icon is now a menu with Hedgie Help and Send feedback.",
    image: { src: "/changelog/help-menu/01-help-menu.webp", alt: "The help menu open in the top bar, listing Hedgie Help, What's new and Send feedback." },
    body: [
      "Hedgie Help is at [/help](/help). Send feedback opens the feedback form in a panel, replacing the floating button.",
      "![The help menu open in the top bar, listing Hedgie Help, What's new and Send feedback.](/changelog/help-menu/01-help-menu.webp)",
    ].join("\n\n"),
  },
  {
    slug: "media-library-and-book-covers",
    date: "2026-10-29",
    audience: "product",
    category: "new",
    title: "Book covers at any size, from your own images",
    summary:
      "Upload a book cover at any size, pick it again from your own images and adjust its crop. We also offer a download in the size Amazon asks for, when your image is large enough.",
    body: [
      "The book form has one Choose cover button with a tab of your own images and an upload tab. JPEG, PNG, WebP, GIF, AVIF and iPhone HEIC photos all work, up to 4 MB. The exact-size rule is gone.",
      "![The Choose a cover window with your own images](/changelog/media-library-and-book-covers/01-choose-cover.webp)",
      "Under the cover you will see a download link for the size Amazon wants, or what is missing if the image is too small. Older covers keep working but have no Amazon version until you upload them again.",
    ].join("\n\n"),
    image: { src: "/changelog/media-library-and-book-covers/01-choose-cover.webp", alt: "The Choose a cover window over the book form, with Library and Upload tabs and two of the member's own book covers" },
  },
  {
    slug: "book-genres-as-tags",
    date: "2026-10-31",
    audience: "product",
    category: "improved",
    title: "Book genres as tags you can filter by",
    summary:
      "Genres on the book form are tags, the Book Shelf can be filtered by genre, and search finds books by genre.",
    body: [
      "Add up to five genres or tropes per book. On the [Book Shelf](/bookshelf), genre chips with counts narrow the list, and clicking one again clears it.",
      "![The Book Shelf with genre chips above the books](/changelog/book-genres-as-tags/01-shelf.webp)",
    ].join("\n\n"),
    image: { src: "/changelog/book-genres-as-tags/01-shelf.webp", alt: "The Book Shelf with genre chips and counts above five books, each listing its genres" },
  },
  {
    slug: "sidebar-modes",
    date: "2026-10-30",
    audience: "product",
    category: "new",
    title: "Choose how the side menu behaves",
    summary:
      "A button in the header lets you keep the side menu open, tuck it away until you point at it, or close it. The Hub remembers your choice.",
    body: [
      "In auto-hide the sidebar rests as a slim icon rail and opens over the page when you hover or focus it, so the page does not shift. Until you choose, the sidebar auto-hides on chat and stays open elsewhere.",
      "![The Dashboard with the side menu auto-hidden as a slim icon rail](/changelog/sidebar-modes/01-auto-hide-rail.webp)",
    ].join("\n\n"),
    image: { src: "/changelog/sidebar-modes/01-auto-hide-rail.webp", alt: "The Dashboard with the side menu tucked away as a slim rail of icons" },
  },
  {
    slug: "descriptions-keep-formatting",
    date: "2026-10-30",
    audience: "product",
    category: "fixed",
    title: "Prickle and event descriptions keep their formatting",
    image: { src: "/changelog/descriptions-keep-formatting/01-prickle-description.webp", alt: "A prickle page whose description keeps bold, italic, a bullet list, a link and a dividing line." },
    summary:
      "Descriptions imported from the calendar now keep bold, italic, links, bullet lists, paragraph breaks and dividing lines instead of running together.",
    body: [
      "![A prickle page whose description keeps bold, italic, a bullet list, a link and a dividing line.](/changelog/descriptions-keep-formatting/01-prickle-description.webp)",
      "Prickles that were already imported pick up the formatting the next time the calendar refreshes.",
    ].join("\n\n"),
  },
  {
    slug: "privacy-page",
    date: "2026-10-30",
    audience: "product",
    category: "improved",
    title: "A clearer privacy page, and a switch for usage statistics",
    summary:
      "The privacy page opens with a short summary and can be read without signing in. A switch lets you stop the Hub recording how you use it, and removes what was already recorded about you.",
    body: [
      "[/privacy](/privacy) now covers what we collect, who can see it, chat and messages, how long we keep things, your choices and the services we use.",
      "Turn off Share usage statistics and the Hub stops recording your usage and removes the usage events already stored under your account. Error recordings, used to fix crashes, continue.",
    ].join("\n\n"),
    image: { src: "/changelog/privacy-page/01-privacy.webp", alt: "The top of the privacy page: a short summary, then a table of what we collect" },
  },
  {
    slug: "projects-past-and-delete",
    date: "2026-10-31",
    audience: "product",
    category: "improved",
    title: "Set-aside projects, deleting, and goals that ended",
    summary:
      "Projects you have set aside are listed apart from the ones you are working on, you can delete a project from its details, and goals that ended unmet no longer show as a standing score.",
    body: [
      "On My Writing, projects you have set aside move to a collapsed Hibernating section, apart from the ones you are working on. They still open as usual, and changing a project's status brings it back.",
      "![My Writing with the current projects and a collapsed section for a set-aside project](/changelog/projects-past-and-delete/01-past-projects.webp)",
      "Delete is in the project's Edit details. Its goals and entries go with it, and a book published from it stays on the shelf. Deleted items are kept until you ask us to remove them, as [/privacy](/privacy) explains.",
      "A goal whose end date passed before its target now moves to Past goals on the project page and leaves the project list, the dashboard and your profile.",
      "Deleting a project hides it. We keep a copy until you ask us to remove it.",
    ].join("\n\n"),
    image: { src: "/changelog/projects-past-and-delete/01-past-projects.webp", alt: "My Writing listing current projects, with a collapsed section below holding a set-aside project" },
  },
  {
    slug: "fixes-2026-10-31",
    date: "2026-10-31",
    audience: "product",
    category: "fixed",
    title: "Cleaner event names, a working past-events page and tabs that refresh",
    summary:
      "Cleaner event names, a past-events page that works, and tabs left open across an update reload themselves.",
    body: [
      "- Event names drop the calendar's label and category and keep who the event is with.",
      "- The past events page no longer crashes.",
      "- A tab left open while the Hub updates now reloads instead of failing on its next action.",
    ].join("\n"),
  },
  {
    slug: "course-builder",
    date: "2026-10-31",
    audience: "engineering",
    category: "new",
    title: "Course editor for Hub-owned courses, first parts",
    summary:
      "Staff can create and edit a course in the Hub, add, rename, duplicate, delete and reorder modules and lessons, and play a lesson's video in the builder.",
    body: [
      "This is staff-only and not visible to members yet. Reorders write a single audit entry with the order before and after. Courses are read and written through CourseRepository and CourseProgressRepository.",
    ].join("\n\n"),
  },
  {
    slug: "google-calendar-live-sync",
    date: "2026-10-28",
    audience: "engineering",
    category: "improved",
    title: "Google Calendar syncs from push notifications",
    summary:
      "The calendar sync opens and renews its push channel on its own and syncs only what changed.",
    body: [
      "Deletions outside the watched window are caught, and the admin calendar refreshes itself when the sync changes prickles. See CalendarSyncStateRepository in lib/data/calendar-sync-state.ts.",
    ].join("\n\n"),
  },
  {
    slug: "data-layer-rollout",
    date: "2026-10-31",
    audience: "engineering",
    category: "improved",
    title: "More tables behind repositories, and migration safety",
    summary:
      "Courses, billing, events, books, Zoom, Slack and the people and profile tables moved behind repositories, and a check now fails migrations that drop or rename what live code still uses.",
    body: [
      "The guard test parses the source and fails on a new direct query. Squawk runs in the Check migrations job, so removals ship in two pull requests: stop using it, then drop it.",
    ].join("\n\n"),
  },
  {
    slug: "alerts-and-monitoring",
    date: "2026-10-30",
    audience: "engineering",
    category: "improved",
    title: "Alerts for crashes, failing page sections and monitors",
    summary:
      "The team is alerted when a page crashes in the browser, a page section fails or times out, or a synthetic monitor fails.",
    body: [
      "Section failure alerts link to the error search. Video playback has a nightly end-to-end check and its configuration lives in code, and the error-tracking organization settings are now code too.",
    ].join("\n\n"),
  },
  {
    slug: "privacy-retention",
    date: "2026-10-30",
    audience: "engineering",
    category: "improved",
    title: "Privacy retention job and usage rollups",
    summary:
      "A nightly job removes exact IP addresses and browser strings after 90 days, and usage events are rolled up into totals before older ones are removed after 13 months.",
    body: [
      "The device type is parsed once when a visit is recorded and kept, along with the approximate place. Usage rollups are built from now; nothing reaches 13 months until late 2027. Session Replay for ordinary visits follows consent and the usage-statistics switch, while error-only recording stays on. This backs the promises on [/privacy](/privacy).",
    ].join("\n\n"),
  },
  {
    slug: "chat-open-to-everyone",
    date: "2026-11-01",
    audience: "product",
    category: "new",
    major: true,
    title: "Hub Chat: our Slack conversations, in the Hub",
    summary:
      "Read and join our Slack conversations from the Hub, reply in threads, react, share files and format your messages. What you write here appears in Slack too.",
    image: {
      src: "/changelog/chat-open-to-everyone/01-conversation.webp",
      alt: "The chat page showing a channel with threads and reactions",
    },
    body: [
      "Hub Chat brings our Slack conversations into the Hub, and it is now open to every member.",
      "Chat is in the sidebar under Community. It lists the conversations you are in first, with a Browse channels button for the public channels you could join, and a lock on private ones. Conversations, threads and reactions update on their own.",
      "![The chat page showing a channel with threads and reactions](/changelog/chat-open-to-everyone/01-conversation.webp)",
      "- Write messages and replies in the Hub and they appear in Slack. By default Billie Bot, our Slack helper, posts them with your name and photo. Connect your Slack account under Account in Settings and they go out as you; you can disconnect at any time from the same place.",
      "- A message that Slack has not accepted after a few retries is marked as failed, so you can see it did not go through.",
      "- Edit or delete your own messages, and the change reaches Slack too.",
      "- Attach files with the paperclip, paste an image or drag it in. Images show right in the conversation, and they reach Slack too.",
      "- Pick from a full emoji picker, mention people with @ and channels with #, and format your message with bold, italics, lists and more. Unsent text is kept as a draft for each conversation.",
      "- Each day has a marker, times follow your time zone, and Copy link on a message gives a link that opens right on it.",
      "![The chat message box with its formatting toolbar and a quote being written](/changelog/chat-open-to-everyone/02-message-box.webp)",
    ].join("\n\n"),
  },
  {
    slug: "events-open-to-everyone",
    date: "2026-11-01",
    audience: "product",
    category: "new",
    title: "Events in the Hub",
    image: { src: "/changelog/events-open-to-everyone/01-events.webp", alt: "The Events page: special events and educational sessions as picture cards, with November at a glance below." },
    summary:
      "See what is coming up, with a picture on each event and a month-at-a-glance list that shows the time of day.",
    body: [
      "Events are now open to every member in the Hub.",
      "![The Events page: special events and educational sessions as picture cards, with November at a glance below.](/changelog/events-open-to-everyone/01-events.webp)",
      "At [/events](/events), upcoming special events and educational sessions sit on top as picture cards. Below them, pick this month, next month or the one after to see everything by day, with times shown in your own time zone.",
      "Past events have their own page at [/events/past](/events/past), a month at a time.",
    ].join("\n\n"),
  },
  {
    slug: "reminders-for-everyone",
    date: "2026-11-01",
    audience: "product",
    category: "new",
    title: "Gentle reminders to say hello and to plan a prickle",
    summary:
      "Newcomers get a nudge to say hello in the intro channel, and anyone with nothing planned can get a reminder to put a prickle on their calendar. You choose where they arrive, or turn them off.",
    body: [
      "- Introduction reminders go to members in their first 90 days who have not yet said hello in the intro channel.\n- Prickle reminders go to members with nothing on their calendar and no recent prickle. They are off until you turn them on, except in your first 90 days, and they come less often the longer they go unanswered.",
      "Choose which channels they come on, or turn them off, under [Notifications](/settings/notifications).",
      "![Notifications settings, with the introduction and prickle reminders](/changelog/reminders-for-everyone/01-reminder-settings.webp)",
    ].join("\n\n"),
    image: { src: "/changelog/reminders-for-everyone/01-reminder-settings.webp", alt: "Settings, Notifications, listing the introduction and prickle reminders with a Slack, in-Hub and email toggle on each" },
  },
  {
    slug: "courses-open-to-everyone",
    date: "2026-11-02",
    audience: "product",
    category: "new",
    major: true,
    title: "Courses in the Hub",
    summary:
      "Watch your course lessons right in the Hub, mark them complete and pick up where you left off.",
    image: {
      src: "/changelog/courses-open-to-everyone/01-courses-list.webp",
      alt: "The Courses page with three course cards, one showing progress",
    },
    body: [
      "Courses now live in the Hub, and they are open to every member.",
      "Find them under [Courses](/courses): cards with cover images and your progress, a page for each module, and lesson pages with the video, its text and downloadable files.",
      "![The Courses page with course cards and progress](/changelog/courses-open-to-everyone/01-courses-list.webp)",
      "- A lesson completes by itself when you have watched about 90 percent, or you can press Mark complete under the video. A card then points you to the next lesson.",
      "- The Hub remembers where you stopped, and your dashboard has a Continue watching card that takes you straight back to it.",
      "![The dashboard with a Continue watching card showing a lesson, its course and a progress bar.](/changelog/courses-open-to-everyone/02-continue-watching.webp)",
      "- A course you pre-ordered shows its launch date and opens on that day.",
      "- A course or lesson link shared with someone who is not signed in shows a preview with its title, a short teaser and a cover. The video and full text stay behind sign-in.",
    ].join("\n\n"),
  },
  {
    slug: "sign-in-with-an-emailed-code",
    date: "2026-11-02",
    audience: "product",
    category: "new",
    title: "Sign in with a code from your email",
    image: { src: "/changelog/sign-in-with-an-emailed-code/01-sign-in-email.webp", alt: "The sign-in email, with the Sign in button and a code to type on the sign-in page." },
    summary:
      "Your sign-in email now includes a one-time code you can type in, so signing in works even if the link opens in the wrong app.",
    body: [
      "![The sign-in email, with the Sign in button and a code to type on the sign-in page.](/changelog/sign-in-with-an-emailed-code/01-sign-in-email.webp)",
      "Go to [/login](/login), enter your email and the code from the sign-in email. The code also works if the link opens in a different browser than the one you asked from, such as a phone's mail app.",
      "If you ask for a link twice within a minute, the page now tells you one was just sent and to check your inbox.",
    ].join("\n\n"),
  },
  {
    slug: "allow-animations",
    date: "2026-11-02",
    audience: "product",
    category: "new",
    title: "Turn down moving images and motion",
    summary:
      "In Settings, Preferences, choose whether the Hub follows your device, always shows animations, or tones them down. With motion reduced, animated emoji stay still.",
    body: [
      "Find it in [Settings](/settings), under Preferences. System follows your device. With animations reduced, interface motion stops, animated emoji show a still, and GIF attachments in chat play and pause when you click them. The choice is saved on this device, like the theme.",
      "![The Animations choice in Settings, Preferences](/changelog/allow-animations/01-animations-setting.webp)",
    ].join("\n\n"),
    image: { src: "/changelog/allow-animations/01-animations-setting.webp", alt: "Settings, Preferences, showing the Animations choice set to System" },
  },
  {
    slug: "check-in-and-check-out",
    date: "2026-11-02",
    audience: "product",
    category: "improved",
    title: "Check in or out at any time during a prickle",
    image: {
      src: "/changelog/check-in-and-check-out/01-running-prickle-check-out.webp",
      alt: "The Upcoming list in My Prickles with the running Progress Prickle showing both a Check in and a Check out button beside it.",
    },
    summary:
      "You can check in until a prickle ends, and the running prickle in your list now has a Check out button. You get a check-out message a few minutes before the end, and you do not need a writing goal to use either.",
    body: [
      "Check-in now stays open until the prickle ends, and it is offered if you are in the prickle's Zoom room even without a commitment or a calendar item. The check-out message comes 5 to 10 minutes before a prickle ends, so you can check out before you leave for your next thing.",
      "You no longer need a writing goal to be asked to check in or check out. Without a goal you get the usual questions, plus a short tip about setting one.",
      "![A running prickle in the Upcoming list with Check in and Check out buttons](/changelog/check-in-and-check-out/01-running-prickle-check-out.webp)",
    ].join("\n\n"),
  },
  {
    slug: "calendar-feed-one-day-events",
    date: "2026-11-02",
    audience: "product",
    category: "fixed",
    title: "Events on your calendar show at the right time",
    summary:
      "One-day events you add to your own calendar now show their real start and end time instead of sitting all day. Longer events, like retreats, stay all day.",
    body: [
      "Multi-day events, such as retreats, stay all-day. The search button in the header is also a steady square on phones instead of a clipped sliver.",
    ].join("\n\n"),
  },
  {
    slug: "my-books-multiple-formats",
    date: "2026-11-03",
    audience: "product",
    category: "improved",
    title: "One book, print and ebook",
    summary:
      "A book on your shelf can have a print edition and an ebook edition, each with its own link and price, on one card.",
    body: [
      "In the book form, switch on Print, Ebook or both. The shelf, your profile and the project card show one link per edition, such as Print $17.99 and Ebook $4.99, with genres on their own line below. Existing books keep their single edition.",
      "![My Books listing a book with Print and Ebook prices](/changelog/my-books-multiple-formats/01-my-books.webp)",
    ].join("\n\n"),
    image: { src: "/changelog/my-books-multiple-formats/01-my-books.webp", alt: "My Books with a book showing both a Print and an Ebook price on one line" },
  },
  {
    slug: "fixes-2026-11-03",
    date: "2026-11-03",
    audience: "product",
    category: "fixed",
    title: "Fixes to chat, course videos, check-in messages and sign-in",
    summary:
      "Fixes to chat, course videos, Slack check-in messages and the sign-in page.",
    body: [
      "- Chat: Enter sends a message from inside a list or code block (Shift+Enter starts the next line), and several attached pictures wrap instead of running off the pane.",
      "- Course videos say what failed and retry once if the playback link expired while the page sat open.",
      "- The Slack check-in and check-out messages have a Submit button that closes them.",
      "- The sign-in page has one Sign-in code box for an email code or a Slack code or link.",
    ].join("\n"),
  },
  {
    slug: "hub-chat-direct-messages",
    date: "2026-11-02",
    audience: "engineering",
    category: "new",
    title: "Direct messages between members, behind a feature flag",
    summary:
      "Members can start a Hub-only direct message from a profile's Message button, switched off for everyone until it is rolled out.",
    body: [
      "These conversations stay in the Hub and nothing goes to Slack. They are private and restricted, so staff can see that one exists but not its text. The chat_dms feature decides who can start one. It becomes a product entry when it is on for everyone.",
    ].join("\n\n"),
  },
  {
    slug: "slack-dm-bridge",
    date: "2026-11-03",
    audience: "engineering",
    category: "new",
    title: "Slack DM bridge, switched off",
    summary:
      "One-on-one Slack DMs can be pulled into chat for the members a feature flag covers, read with each member's own Slack token.",
    body: [
      "It has live delivery of new messages, a nightly pull, and a way to start a Slack DM from a profile's Message button. The feature is off for everyone as of this entry. /privacy describes what is read and kept, and the choice is to disconnect Slack. It becomes a product entry when it is on for everyone.",
    ].join("\n\n"),
  },
  {
    slug: "ci-speed-and-repos",
    date: "2026-11-01",
    audience: "engineering",
    category: "improved",
    title: "Faster CI and repository-based tests",
    summary:
      "Lint and type checks overlap with tests, and many tests use the in-memory repositories instead of faked database calls.",
    body: [
      "The notifier, channels, reminders and check-in messages now take repositories instead of database clients, and 176 PostgREST casts were removed by typing the boundary once. pnpm seed:local loads a typed seed profile into the local database.",
    ].join("\n\n"),
  },
  {
    slug: "launch-tooling",
    date: "2026-11-02",
    audience: "engineering",
    category: "new",
    title: "Launch tooling",
    summary:
      "Sign-in accounts were created in advance for members, then released and emailed in batches, each with its own sign-in code.",
    body: [
      "pnpm auth:precreate and pnpm launch:email did the rollout. Both default to a dry run and take --limit and --only to trial it first, and the email can be re-run safely because each sent member is marked.",
    ].join("\n\n"),
  },
  {
    slug: "removal-requests-and-community-manager",
    date: "2026-11-03",
    audience: "engineering",
    category: "new",
    title: "Member data removal routine and a Community Manager role",
    summary:
      "A routine removes a member's data on request, and a read-only Community Manager role opens a fixed set of admin pages.",
    body: [
      "The removal routine has a staff entry point and a decision for every table that holds member data. Admins can preview the admin area as a Community Manager, and new admin pages stay closed to that role until they are added on purpose.",
    ].join("\n\n"),
  },
  {
    slug: "whats-new-changelog",
    date: "2026-11-04",
    audience: "product",
    category: "new",
    title: "A changelog for the Hedgie Hub",
    summary:
      "See what is new and fixed in the Hub on a What's new page, and choose how you hear about it: a weekly roundup on Slack, in the Hub or by email.",
    body: [
      "Every improvement and fix you might notice now gets a short write-up on the [What's new](/changelog) page, newest first, each with its own link. Find it under the **?** menu in the top bar, or search for it.",
      "![The What's new page, with the latest updates](/changelog/whats-new-changelog/01-whats-new-list.webp)",
      "A weekly roundup of the new entries reaches you on the channels you choose. Slack and the Hub's own notifications are on by default; you can turn on email, or switch any of them off, under [Notifications](/settings/notifications) in Settings, in Product updates. We also post new updates in the announcements channel on Slack.",
    ].join("\n\n"),
    image: { src: "/changelog/whats-new-changelog/01-whats-new-list.webp", alt: "The What's new page, with the latest updates" },
  },
  {
    slug: "changelog-and-notification-log",
    date: "2026-11-04",
    audience: "engineering",
    category: "new",
    title: "Changelog system, weekly digest and one notification log",
    summary:
      "Changelog entries live in one typed file that feeds the What's new pages, the admin Changelog, the weekly digest and the announcements post.",
    body: [
      "`lib/changelog/entries.ts` is the single source. Each entry is for the `product` audience (members: the pages, the digest, the announcements post and the admin Changelog) or the `engineering` audience (staff only, on the admin Changelog). A test fails when an entry is malformed or shows an image that is not there. The in-app pages search and filter the entries; there is no generated file to keep in sync.",
      "The weekly digest is the `changelog_digest` notification kind, sent by `/api/internal/changelog-digest` from Vercel Cron (Tuesdays 14:00 UTC) behind the `changelog_digest` feature flag, so it starts in dry run. Each member gets the entries from the last 30 days they have not had, as one message on the channels they chose, and nothing dated before `changelogDigestStartsOn` in `app.config.ts` is ever sent.",
      "`notification_log` is one log of what the app sent, for every kind: a row per recipient (a member, or a shared place such as a Slack channel), kind and dedup key. A send is claimed before it is made and released when nothing was delivered, so a retry or an overlapping run never sends twice. `NotificationLogRepository` has an in-memory twin and one contract suite run against both.",
      "Screenshots are taken from the demo scenes: `pnpm changelog:capture <slug>` runs an `@changelog` scene and writes small WebP files into `public/changelog/<slug>/`.",
    ].join("\n\n"),
  },
  {
    slug: "members-search-alternate-names",
    date: "2026-11-06",
    audience: "product",
    category: "improved",
    title: "The Members page finds the names people go by",
    summary:
      "Search on the Members page now also finds a member by a nickname or pen name, and says so with a line under their name.",
    image: { src: "/changelog/members-search-alternate-names/01-members-search-alias.webp", alt: "The Members page with Jules typed in the search box, showing Julia Sample with the line also known as Jules Sample." },
    body: [
      "![The Members page with Jules typed in the search box, showing Julia Sample with the line also known as Jules Sample.](/changelog/members-search-alternate-names/01-members-search-alias.webp)",
      "Type a nickname or pen name in the Members search and the member shows up, with a small line under their name that says also known as and the name you typed. It uses the same names as the search in the top bar, so the two always agree about who a name belongs to.",
    ].join("\n\n"),
  },
  {
    slug: "admin-search-matches-all-aliases",
    date: "2026-11-06",
    audience: "engineering",
    category: "fixed",
    title: "Admin member search matches every active alias",
    summary: "The admin Members list now finds a member by any active alias, and no longer by one that has been switched off.",
    body: [
      "`admin_member_engagement` (behind `admin_members_page`) matched aliases only when their source was `zoom` and never checked `active`, so an alias an admin added or a member wrote found nobody, while a switched-off Zoom alias still did. It now uses the rule the top-bar search (`search_member_aliases`) and the member directory (`member_directory_aliases`) already share: any active name alias; a Slack-source alias is a user id, not a name, so it never matches.",
      "Migration `20270515000000_admin_search_matches_all_aliases.sql` replaces only that condition; `admin_search_matches_all_aliases.test.sql` covers each alias source and a switched-off alias, and fails on the old function.",
    ].join("\n\n"),
  },
  {
    slug: "check-in-usual-feelings",
    date: "2026-11-06",
    audience: "product",
    category: "improved",
    title: "Your most-used feelings come first when you check in",
    summary:
      "The feelings you name most often now sit at the top of the feeling question, so naming how you feel takes one tap instead of a search through the whole Feeling Wheel.",
    body: [
      "When you check in or out, the feelings you pick most often show up first, under Frequently used. Tap one to choose it, tap it again to step back. Nothing to set up: the list follows what you pick, the way frequent emojis do, and the full Feeling Wheel is still right below it.",
      "In the Slack check-in and check-out messages your top three are listed first in the feeling menu.",
    ].join("\n\n"),
  },
  {
    slug: "searchable-member-aliases-view",
    date: "2026-11-06",
    audience: "engineering",
    category: "improved",
    title: "One definition of a searchable alias",
    summary: "The top-bar search, the Members page and the admin Members list now read the same view of name aliases, so they cannot drift apart again.",
    body: [
      "The rule for which aliases identify a person by name lived in three SQL functions and had already diverged once. `searchable_member_aliases` (a `security_invoker` view over `member_name_aliases`) now holds it: active, and never a Slack-source alias, which is an opaque user id. `search_member_aliases`, `member_directory_aliases` and `admin_member_engagement` all select from it.",
      "Row level security still applies to anyone reading the view directly; the two `SECURITY DEFINER` functions run as the owner as before. `searchable_member_aliases.test.sql` checks the view and that the three searches agree on active, switched-off and Slack aliases. As a side effect, the top-bar search and the Members page no longer match Slack user ids.",
    ].join("\n\n"),
  },
  {
    slug: "check-in-skip-questions",
    date: "2026-11-06",
    audience: "product",
    category: "improved",
    title: "Skip any check-in question",
    summary:
      "Every question in a check-in or check-out now has a Skip, so you can leave one out without the check-in staying unfinished.",
    body: [
      "Not every question fits every day. On the site each question has a Skip button, and in the Slack messages each one has a Skip button or a Skip this question choice. Skipped counts as done: once you have answered or skipped every question, the check-in or check-out is finished and we stop asking.",
      "Changed your mind? Pick an answer and the skip goes away, or tap Skipped again.",
    ].join("\n\n"),
  },
  {
    slug: "goals-follow-their-project-on-profile",
    date: "2026-11-07",
    audience: "product",
    category: "fixed",
    title: "Your goals and their project now show up together on your profile",
    summary:
      "A goal on your profile always showed its project's title and progress, so now the project is on your profile whenever the goal is, and new projects start out on your profile.",
    body: [
      "Showing a goal on your profile already showed the project it belongs to, with its title and how far along you are. We stopped treating them as two separate choices. Turning a goal on now puts its project on your profile too, and taking a project off your profile takes its goals off with it, until you put the project back.",
      "New projects start out on your profile, and a new goal starts the same way as its project. You can still turn either off on the project page.",
      "If you had a goal on your profile but not its project, the project is on your profile now. Take it off from the project page if you would rather keep it to yourself.",
      "We also fixed a mismatch where a goal on your profile could show less progress than your dashboard. Your profile now counts the words you started with, like your dashboard does.",
    ].join("\n\n"),
  },
  {
    slug: "settings-devices-list",
    date: "2026-11-07",
    audience: "product",
    category: "improved",
    title: "Your signed-in devices are easier to recognize",
    summary: "In Settings, Devices now names each one, like Chrome 156 on macOS or Safari on iPhone (iOS 18.7), so you can tell which to log out.",
    body: [
      "The old Active Sessions list showed a long block of browser code. It is now called Devices and shows a plain name for each device, when it was last used, roughly where it connected from (a city and country), and a Log out button. The device you are on is marked This device.",
      "Every device is listed, however many you have.",
      "The place is approximate, taken from the network a device connects through, so a VPN or a phone carrier can make it off. We already record it when you visit the Hub, and this list shows it back to you; your IP address is not shown. The privacy page explains how long we keep it.",
    ].join("\n\n"),
  },
  {
    slug: "chat-link-previews-and-app-cards",
    date: "2026-11-10",
    audience: "engineering",
    category: "new",
    title: "Hub Chat draws Slack's link previews and app cards",
    summary: "Messages that Slack gave a link preview, and messages posted by apps such as deploy notices, now show as cards in Hub Chat, with the app's own name and logo.",
    body: [
      "`chat_message_contents.attachments` (legacy attachments, which is where Slack puts a link preview) and the Block Kit `blocks` of an app's message are now read by the chat loader and drawn under the message by `components/chat/MessageUnfurls.tsx`. `lib/chat/unfurls.ts` parses and sanitizes them: http(s) links only, https pictures only, capped lengths and counts, and Slack text still goes through the chat's own mrkdwn renderer so entities and mentions read correctly.",
      "Block Kit is a registry of per-type parsers and renderers (header, section, context, divider, image, link buttons). A block type without one shows one \"Open in Slack\" link. An app's message is drawn from its blocks, and its fallback text is hidden, only when it has no `rich_text` block; people's messages stay text.",
      "A new `chat_message_contents.bot` column ({name, icon}) is filled by a trigger from the Bronze payload, so apps show by their own name and logo instead of \"Slack app\" without opening Bronze to members. A `message_changed` that only adds a preview no longer clears the time of an earlier edit.",
      "Related product entry: none yet. Shared messages shown as quoted cards are the next slice.",
    ].join("\n\n"),
  },
];
