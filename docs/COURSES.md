# Courses in the Hub

Plan for moving Quill & Cup's courses from Kajabi into the Hub, starting with **The Ready Writer**, which launches in about two weeks (target: early November 2026). Written 2026-10-18; update it as decisions land.

## Decisions so far

- **The Ready Writer goes first and launches in the Hub.** It's an **evergreen** program, not cohort-based. Its first run launches together, and lessons are released as they're finished (a release schedule for content, not drip for its own sake).
- **Member experience first, course builder later.** Ania keeps authoring in Kajabi's editor. The Hub gets content through a **re-runnable Kajabi → Hub migration**, run as often as needed and once more right before launch.
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

1. "New lesson" notification kind (in-app, Slack DM or email, following each member's settings).
2. "Continue watching" on the dashboard.
3. Admin course stats: who's where, drop-off per video, a per-viewing heatmap.
4. Audio-only "listen like a podcast" mode (Mux's per-video `audio.m4a`).
5. Mux config as code (webhook URL, allowed playback domains) and a nightly Mux end-to-end check with a free test video.

### Later

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
- **Lesson state** from Kajabi's publishing option:
  - `published` → visible.
  - `draft` → hidden.
  - `locked`/`drip` → shown as **"Coming soon"**: the title is visible but it can't be opened. This fits "released as they're finished". (Open decision 2.)
- `course_lessons.body_html`: **sanitized on import** with an allowlist (headings, lists, links, emphasis, images), never rendered raw.
- `course_access`: who can open which course. Derived from active Kajabi purchases of the course's offers (`deactivated_at IS NULL`) plus `course_access_grants`. Rebuilt on every member/purchase reprocess, so a refund removes access.
- `courses.kind` (`evergreen` | `cohort`) and a nullable `courses.program_id`, so cohort courses can later use `member_program_enrollments` without a schema change. Only `evergreen` is built now.

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
- **"Video ready":** production uses the Mux webhook at `/api/webhooks/mux`, verified with `MUX_WEBHOOK_SECRET`. Preview deployments have changing URLs, so they poll Mux for status instead.
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

## Open decisions

1. **After launch, where does Ania author new lessons?** Builder deprioritized implies Kajabi. Then step B (content) has to keep running after launch: by hand each time she publishes, or automated in CI with a stored Kajabi login (see `KAJABI_SCRAPER_DESIGN.md`). That's a credentials decision for Cody.
2. **Locked/drip lessons:** show them as "Coming soon" with the title (proposed), or hide them entirely?
3. **Release dates:** does a lesson appear when Ania publishes it in Kajabi (next migration run), or should Hub hold a scheduled "available from" date?
4. **Access window:** is The Ready Writer access lifetime (evergreen), or does it end when a membership lapses, given the offer includes membership?
5. **The Ready Writer program row:** `programs` already has Big Sister rules (`includes_membership`). Link the course to it (`courses.program_id`) now, so the first run's launch group can also be tracked as a cohort for Big Sisters?

## Prerequisites (Cody)

- [ ] Mux keys in `.env.preview` too (currently only `.env.local` and `.env.prod`). `npm run env:sync` exits with an error for any target missing a value.
- [ ] Merge the env var PR (#102), then run `npm run env:sync` (all values filled in).
- [ ] After the webhook route deploys: create the production Mux webhook pointing at `/api/webhooks/mux` and put its secret in `.env.prod`.
- [ ] A separate Low-priority Mux token for the migration (`hub-migration`); revoke it after launch.
- [ ] Billing alert in Mux (Organization Settings → Billing → Alerts; needs a paid plan).
- [ ] GA: Reporting identity → Observed.
