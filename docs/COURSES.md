# Courses in the Hub

Plan for moving Quill & Cup's courses from Kajabi into the Hub, starting with **The Ready Writer**, which launches in about two weeks (target: early November 2026). Written 2026-10-18; update it as decisions land.

## Decisions so far

- **The Ready Writer goes first and launches in the Hub.** It's an **evergreen** program, not cohort-based. Its first run launches together, and lessons are released as they're finished (a release schedule for content, not drip for its own sake).
- **Member experience first, course builder later.** Ania keeps authoring in Kajabi's editor, **including after launch, until the Hub's course builder is good enough to replace it.** So the Kajabi → Hub migration isn't a one-off: it's an **ongoing sync**, safe to re-run any time, and run once more right before launch.
- **The full course outline is visible from day one.** Unreleased lessons show as "Coming soon" (see the lesson-state rules under Silver).
- **Access is configured per course.** The Ready Writer is **one year from purchase and includes membership**. Other courses may be lifetime or not include membership.
- **The Ready Writer's existing `programs` row is linked** to the course (or replaced, if it doesn't fit), so Big Sisters and membership status keep working from one record.
- **Evergreen courses only, for now.** The data model leaves room for cohort-based courses (Self-Editing Academy, the 180) without building them.
- **Kajabi stays the checkout.** Buying the offer in Kajabi is what grants access in the Hub.
- **Video host: Mux.** Our own themed player on top (Video.js v10 if a half-day test passes, Vidstack otherwise) and our own per-member watch tracking. See "Video" below.
- **Captions are burned into the existing videos** (Descript), so nothing caption-related blocks launch.

## Scope

### Launch (The Ready Writer)

1. **Migration:** Kajabi course → Hub, re-runnable and idempotent. Covers structure, lesson text, PDFs and videos.
2. **Access:** members with an active Kajabi purchase of the course's offer (plus manual grants) can open it; admins always can.
3. **Member pages:** a courses list, a course outline with progress, and a lesson page with video, text, downloads, mark-complete and previous/next.
4. **Player:** themed, speed menu remembered per member, keyboard shortcuts, resume where you left off, lock-screen/headphone controls, members-only playback links.
5. **Watch tracking:** one row per continuous stretch watched. This drives resume, completion and admin stats.
6. **Feature flag `courses`**, off until launch day.

### Soon after launch (in priority order)

1. "Continue watching" on the dashboard.
2. Admin course stats: who's where, drop-off per video, a per-viewing heatmap.
3. Audio-only "listen like a podcast" mode (Mux's per-video `audio.m4a`).
4. Mux config as code (webhook URL, allowed playback domains) and a nightly Mux end-to-end check with a free test video.

### Later

- **Access-ending reminder:** a notification some weeks before a course's access ends, prompting the member to switch to or opt in to membership billing.
- **Video phases 1–2:** Whisper transcripts with search and a follow-along panel; then re-exported clean videos with toggleable caption tracks.
- **Course builder in the Hub,** so Ania stops authoring in Kajabi.
- **Cohort-based courses:** Self-Editing Academy (reflection quizzes, level progression), the 180.
- **Other courses:** BFF Mindset Training, Hedgies on First, then the membership video library.
- **Mini player and pop-out window.**

### Not planned

- Lesson comments (Slack and Hub chat cover discussion).
- Kajabi's quizzes and assessments before Self-Editing Academy moves.
- Moving checkout off Kajabi.
- Importing Kajabi per-lesson progress. The Ready Writer's first run starts in the Hub, and Kajabi's API has no per-lesson progress.

## What Kajabi gives us

Verified 2026-10-17 against the Ready Writer, 180, Self-Editing Academy and membership courses.

| Piece | Where it comes from |
|---|---|
| Courses, modules (including nested "weeks"), lessons, order, draft/published/locked status, video length, offers | **Kajabi public API**: `/v1/courses/{id}?include=modules,lessons,lessons.media,offers` (client credentials, the same ones the purchase sync uses). Modules nest through `parent_module`. |
| Lesson text (rich HTML), PDF downloads, lesson thumbnails, module posters | **Not in the API.** The admin lesson editor (`/admin/posts/{id}/edit`) shows them. |
| Video files | **Not in the API.** Each lesson's "Video actions → Download video" link in the admin editor. There is no bulk export. |
| Quizzes (e.g. Self-Editing Academy's reflections) | Admin quiz editor; out of scope for now. |

So the migration has two kinds of steps: **API steps** that can run anywhere (including a cron), and **session steps** that need a logged-in Kajabi admin browser. The session steps are a local script that Ania or Cody runs; they log in themselves, and the script reuses that browser session. The script never handles a password.

**Day-1 spike:** confirm how to read a lesson's text, attachments and video download link from the admin session, either from the editor's own JSON requests (preferred) or from the page. Also confirm whether the download link is a time-limited URL Mux can fetch directly; that avoids downloading hundreds of MB per video locally.

## Data model

This follows the medallion rules in `CLAUDE.md`: Bronze mirrors Kajabi, upserted on Kajabi's IDs and soft-deleted with `deleted_at` when gone from a fully successful fetch; Silver is rebuilt from Bronze plus Local; Local is ours.

### Bronze (raw Kajabi)

- `bronze.kajabi_courses`, `bronze.kajabi_course_modules`, `bronze.kajabi_course_lessons`: from the API. Each has `kajabi_id` (unique), the parent ID, `position`, `publishing_option`, `title`, `raw_payload`, `fetched_at` and `deleted_at`.
- Lesson content, from the session script: `body_html`, `thumbnail_url`, `video_source` (Kajabi's media ID and length), `content_fetched_at` and `content_hash`.
- `bronze.kajabi_lesson_files`: PDFs and other downloads per lesson, by Kajabi file ID.
- `bronze.kajabi_course_offers`: which offers grant which course.

### Silver (what members see)

- `courses`, `course_modules` and `course_lessons`. **Upserted on their source key and orphans removed, like `prickles`,** so IDs and URLs (`/courses/the-ready-writer/lessons/<id>`) stay stable across re-runs.
  - Each row has `source` (`kajabi` now, `hub` once the builder exists), so the Kajabi reprocess never touches Hub-authored rows.
  - `course_modules.parent_id` handles weeks inside modules.
- **Lesson state** from Kajabi's publishing option (modules follow the same rules, and a lesson is never more visible than its module):
  - `published` → open.
  - `locked`/`drip` → **"Coming soon"**: the title (and module) is visible but can't be opened. This is how the full course plan appears from day one.
  - `draft` → hidden. Drafts are work in progress, and some of The Ready Writer's are still leftovers copied from the 180, so they must not leak.
  - **Convention for Ania:** a planned lesson that should appear as "Coming soon" is set to *Locked* in Kajabi; publishing it in Kajabi opens it in the Hub on the next sync.
- `course_lessons.body_html`: **sanitized on import** with an allowlist (headings, lists, links, emphasis, images), never rendered raw.
- `course_access`: who can open which course, with `starts_at` and `ends_at`.
  - Derived from active Kajabi purchases of the course's offers (`deactivated_at IS NULL`), plus `course_access_grants`.
  - Rebuilt on every member/purchase reprocess, so a refund removes access.
  - `starts_at` is the purchase date (the same coalesced date cohort matching uses: `created_at_kajabi`, else `effective_start_at`). `ends_at` is `starts_at + courses.access_duration`, or null for lifetime.
  - A member whose access has ended still sees the course in `/courses`, marked as ended, with their progress. Lessons don't open.
- **Per-course access settings on `courses`:**
  - `access_duration` (an interval, null = lifetime). The Ready Writer: 1 year.
  - Whether the course includes membership. This lives on the linked `programs` row (`includes_membership`, which Big Sisters and member status already read), not duplicated on `courses`.
  - **Includes membership** means an active `course_access` counts as active membership in member status (`reprocess_members_atomic`) for the length of the access, the way program enrollment does today.
- `courses.program_id` links a course to its `programs` row. The Ready Writer links to (or replaces) its existing row; the migration upserts that link by program slug, so it survives re-runs.
- `courses.kind` (`evergreen` | `cohort`), so cohort courses can later use `member_program_enrollments` without a schema change. Only `evergreen` is built now.

### Local (ours, never reprocessed)

- `course_access_grants`: comps and staff access. Admin-written and audited.
- `videos`: one row per Mux asset.
  - Fields: `mux_asset_id`, `mux_playback_id` (signed policy), `status`, `duration`, `source_kind` (`kajabi` | `upload`) and `source_key` (the Kajabi media ID; unique).
  - This is how re-runs skip videos already uploaded. Lessons point at it with `course_lessons.video_id`.
  - Local rather than Silver because uploading is an external side effect we must not repeat.
- `course_lesson_files`: PDFs copied into a private Supabase Storage bucket, keyed by Kajabi file ID and content hash. Served through short-lived signed URLs after an access check.
- `lesson_progress` (`member_id`, `lesson_id`, `completed_at`, `last_position_seconds`). Member-written, admin-readable, **read-only in sudo**.
- `video_watch_segments` (`member_id`, `video_id`, `session_id`, `start_seconds`, `end_seconds`, `playback_rate`, `started_at`). Append-only, one row per continuous stretch. **Not written in sudo**, so admins previewing as a member don't create viewing history. Admin-readable.

RLS:
- Course content is readable by members with a `course_access` row, and by admins.
- Progress and segments are the member's own, plus admins.
- Videos are never public. Playback links are minted server-side only after the access check.

## Migration pipeline

One command, `npm run courses:migrate -- --course <slug>`, runs all four steps in order. Every step is safe to re-run and only does new work.

| Step | Runs where | What it does | Idempotency |
|---|---|---|---|
| **A. Structure** (`/api/import/kajabi-courses`) | Server; nightly cron + admin button | API → Bronze courses, modules, lessons, offers | Upsert on Kajabi ID; soft-delete what a *complete* fetch no longer returns |
| **B. Content** (`scripts/kajabi-course-content.ts`) | Local, with the admin's Kajabi session | Lesson HTML, file list, video source → Bronze | Skips lessons whose content hash is unchanged |
| **C. Process** (`/api/process/courses`) | Server | Bronze → Silver courses/modules/lessons/access | Upsert on source key, delete orphans; IDs stay stable |
| **D. Media** (`scripts/course-media.ts` or a route) | Local or server | Videos → Mux (from URL if allowed, else download and upload); PDFs → Storage | `videos.source_key` / file ID + hash unique; skips existing; re-uploads only if the source changed |

Tests, per `CLAUDE.md`:
- Bronze idempotency tests in `tests/api/idempotency/`: first import, re-import with no duplicates, a changed lesson, a removed lesson.
- Silver reprocessability tests in `tests/api/reprocessability/`: create, a deleted source removes the lesson, a changed source updates it, and IDs stay stable.
- Media tests with Mux mocked: a re-run uploads nothing new, and a changed source re-uploads.

**Launch rehearsal:** run the full migration against production at least twice before launch day, the second time after Ania's final edits. The launch-day run should then be a no-op except for her last changes.

## Video

- **Mux:**
  - Signed playback policy.
  - `basic` video quality, capped at 1080p (720p is cheaper if talking-head quality allows).
  - Free auto-captions off for now (captions are burned in).
  - Audio-only static rendition once audio mode is built.
- **Keys:** `MUX_TOKEN_ID`/`MUX_TOKEN_SECRET` (Video read+write, Data read, High priority), `MUX_SIGNING_KEY_ID`/`MUX_SIGNING_KEY_PRIVATE`, and `MUX_WEBHOOK_SECRET` (declared in `env-vars.config.ts`). The bulk migration should use a separate Low-priority token so it doesn't compete with member traffic.
- **"Video ready":** production uses the Mux webhook at `/api/webhooks/mux`, verified with `MUX_WEBHOOK_SECRET`. The route **rejects every request while that secret is unset** (`webhookSecretRequired()` in `lib/webhook-auth.ts`, PR #105), instead of skipping verification. Preview deployments have changing URLs, so they poll Mux for status instead.
- **Player:** a half-day test of Video.js v10 (GA 2026-10-01) against a Mux stream. It must have a speed menu, keyboard shortcuts, seek previews (Mux storyboards) and theming; fall back to Vidstack if it doesn't. Watch tracking listens to the underlying video element, so the choice doesn't affect data.
- **Watch tracking:**
  - The player records each continuous stretch (start, end, speed) and saves on pause, seek, speed change, tab hide and page leave (`navigator.sendBeacon`).
  - Resume position and lesson completion come from these rows. A lesson completes automatically at ~90% of the video watched, or when the member clicks "Mark complete".
- **Cost:** The Ready Writer is about 650 minutes, roughly $2/month of storage, inside Mux's $20/month usage credit. Viewing is free under 100,000 minutes a month.

## Member experience

Routes, under `app/(member)/`, all using `getEffectiveIdentity`:
- **`/courses`**: courses the member has access to, each with progress ("7 of 12 available lessons done") and "Continue".
- **`/courses/[slug]`**:
  - Outline by module and week, with checkmarks, durations and "Coming soon" for unreleased lessons.
  - A "Start" or "Continue" button.
  - Shows a friendly "how to get access" page, not a 404, when the member can't open the course.
- **`/courses/[slug]/lessons/[lessonId]`**:
  - Player, then text, then downloads.
  - Mark complete, previous/next, and an outline sidebar on desktop (a drawer on mobile).
  - Resumes at the last position.

Progress is counted against *available* lessons, since the course grows as lessons are released. Light and dark themes, keyboard access and mobile layout are part of "done", not polish.

## Timeline (two-week target)

| Days | Work |
|---|---|
| 1–2 | Spikes (Kajabi content extraction; player against a Mux test video). Schema migration. Mux helper (upload, signing) and webhook. |
| 2–5 | Migration steps A–D with idempotency and reprocessability tests. First full run of The Ready Writer into local and preview. |
| 4–9 | Member pages, player, watch tracking, progress, access (`course_access`, RLS, signed playback). |
| 9–11 | Ania reviews in preview (sudo as a member). Fixes, mobile and accessibility pass. |
| 11–13 | **Dress rehearsal:** full migration into production with the flag off; test members check it. |
| 14 | Launch: final migration re-run, flag on, announce. |

**Fallback:** if the member pages aren't solid by about day 10, launch the first run in Kajabi as usual and keep building. The migration and data stay useful either way.

## Ongoing sync after launch

Ania publishes in Kajabi until the builder replaces it, so the sync runs for months, not once:
- **Steps A, C and D** run on the server: nightly in the reconcile cron, plus an admin "Sync courses now" button. A lesson Ania publishes then opens in the Hub by the next morning, or right away if someone presses the button.
- **Step B** (lesson text, PDFs, new videos) needs a logged-in Kajabi admin session, so it can't run in Vercel's cron without storing a Kajabi login. Until that's decided, it's a one-command local run (`npm run courses:migrate`) whenever Ania finishes a batch. The admin page shows when each course's content was last pulled, and flags lessons whose API data changed since then (a sign step B needs a run).

## Open decisions

None right now.

## Decided (2026-10-18)

- Ania keeps publishing in Kajabi after launch, until the builder is good enough. → "Ongoing sync after launch".
- Show the full course plan, with unreleased lessons as "Coming soon". → Lesson-state rules.
- Access is per-course configurable. The Ready Writer is one year and includes membership. → `course_access`, `courses.access_duration`, `programs.includes_membership`.
- Link to (or replace) the existing The Ready Writer `programs` row. → `courses.program_id`.
- **Lesson-text step stays manual** (a local run when Ania finishes a batch); automating it with a stored Kajabi login is not planned. → "Ongoing sync after launch".
- **Released lessons appear in the outline only**, with no notification when they open. The "New lesson" notification is dropped from the post-launch list.
- **Access ending:** membership continues only if the member has subscribed separately, as today. A reminder before access ends, with a prompt to switch to or opt in to membership billing, is wanted but comes later (see "Later").

## Prerequisites (Cody)

- [ ] Mux keys in `.env.preview` too (currently only `.env.local` and `.env.prod`). `npm run env:sync` exits with an error for any target missing a value.
- [ ] Merge the env var PR (#102), then run `npm run env:sync` (all values filled in).
- [ ] After the webhook route deploys: create the production Mux webhook pointing at `/api/webhooks/mux` and put its secret in `.env.prod`.
- [ ] A separate Low-priority Mux token for the migration (`hub-migration`); revoke it after launch.
- [ ] Billing alert in Mux (Organization Settings → Billing → Alerts; needs a paid plan).
- [ ] GA: Reporting identity → Observed.
