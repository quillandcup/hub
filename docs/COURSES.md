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

## Terms: program, course, Kajabi product

Kajabi's "product" is broad: a course, community, coaching, podcast, newsletter. The Hub already splits that into separate ideas, and the course work keeps them separate:

| Term | What it is | Lives in |
|---|---|---|
| **Program** | Something a member buys or enrolls in, as the business tracks it: its Kajabi offers (`kajabi_offer_names`), whether it includes membership, cohorts and enrollments, badges, Big Sisters, the leakage report. Exists today. | `programs`, `program_cohorts`, `member_program_enrollments` |
| **Course** | The curriculum a program delivers: modules, weeks, lessons, videos, downloads, and member progress. New in this plan. | `courses`, `course_modules`, `course_lessons` |

- **A program may have no course.** BFF is matching and coaching; retreats are `events`; the membership itself is subscription logic, not a program.
- **A course belongs to at most one program** (`courses.program_id`), and the program is where access and membership rules live (`programs.includes_membership`), so those rules stay in one place.
- **We don't build a separate `kajabi_products` catalog** (the old idea in `KAJABI_DATA_MODEL.md`). `programs` plus its Kajabi offer names covers it. Communities (Hub chat replaces them), podcasts and newsletters aren't enrollments we track. If a non-course program needs to be told apart later, add `programs.kind` then.

## Scope

### Launch (The Ready Writer)

1. **Migration:** Kajabi course → Hub, re-runnable and idempotent. Covers structure, lesson text, PDFs and videos.
2. **Access:** members with an active Kajabi purchase of the course's offer (plus manual grants) can open it; admins always can.
3. **Member pages:** a courses list, a course outline with progress, and a lesson page with video, text, downloads, mark-complete and previous/next.
4. **Player:** themed, speed menu remembered per member, keyboard shortcuts, resume where you left off, lock-screen/headphone controls, members-only playback links.
5. **Watch tracking:** one row per continuous stretch watched. This drives resume, completion and admin stats.
6. **Captions for new videos:** the player's captions menu, caption tracks attached to Mux, Mux's auto-generated captions as a fallback, and a small admin "Videos" screen to upload an SRT/VTT file for a video (so Ania's Descript files have somewhere to go without the full course builder).
7. **Feature flag `courses`**, off until launch day.

### Soon after launch (in priority order)

1. "Continue watching" on the dashboard.
2. Admin course stats: who's where (built: `/admin/courses/<kajabi id>/roster`, `lib/courses/roster.ts`: each member with access, open lessons completed, last lesson and last activity from `lesson_progress`, sortable and paged), drop-off per video and a per-viewing heatmap (built, see Staff watch stats). Still open: last activity from watch segments rather than only progress rows, a per-member stats view.
3. Audio-only "listen like a podcast" mode (Mux's per-video `audio.m4a`).
4. Mux config as code (webhook URL, allowed playback domains) and a nightly Mux end-to-end check with a free test video.
5. A "Sync courses" admin button, and a nightly structure-and-access sync, once step B is automated (see "Ongoing sync after launch").

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

So the migration has two kinds of steps: **API steps** that can run on the server, and **session steps** that need a logged-in Kajabi admin browser. The session steps are a local script that Ania or Cody runs; they log in themselves, and the script reuses that browser session. The script never handles a password.

**Day-1 spike result (2026-10-18, on a duplicate draft of a Ready Writer lesson; nothing published):**

- **Lesson text, video and downloads come from the editor's own JSON.** Opening a lesson loads `GET /api/admin/posts/{postId}` (JSON:API): `body` (the lesson HTML), `title`, `position`, `status`, `posterImageUrl`, and an included `video` object. `GET /api/admin/posts/{postId}/downloads` lists the attachments. The course outline is `GET /api/admin/products/{productId}/posts`.
- **That JSON API is not cookie-authenticated.** A plain `fetch` from the page, or any script replaying the cookies, gets 401. The editor sends its own auth. So step B must **drive the real editor** and record the responses as each lesson loads (Playwright response listeners), not call the API itself, and it must not read tokens out of the page.
- **The video object carries what step D needs:** Kajabi media `id`, `wistiaId`, `originalVideo` (an `.mp4` path), `status`, `mediaLibraryAssetId` (set for videos uploaded through the newer Media Library) and `urls.downloadUrl`. The lessons' videos are **hosted on Wistia**; the S3 original is what we download.
- **`downloadUrl` is an S3 presigned URL** (AWS signature v4, host `kajabi-storefronts-production.s3.amazonaws.com`, `X-Amz-Expires=604800`, i.e. 7 days). The editor mints a fresh one on every load, so step B should capture it right when step D needs it (or run D soon after B). Downloads (PDFs) use the same kind of presigned S3 link (also readable with no cookie), with the original file name in the path. A `/downloads` item is `{ id, type: "download", attributes: { name, displayName, displayAssetName, position, assetUrl, mediaLibraryAssetId } }`, and the response's `meta.uploadConfig` is the uploader's own config, which the script should ignore. **Confirmed:** it needs no cookie, and **Mux ingests straight from it** (`POST /video/v1/assets` with `inputs: [{ url }]`, `video_quality: "basic"`, signed playback policy): a 156 MB, 9:05 lesson video was `ready` about 10 seconds after the request, with the right duration, so nothing is downloaded locally. **The link is signed for `GET` only:** a `HEAD` returns 403. For the change fingerprint, use `GET` with `Range: bytes=0-0` instead: it returns 206 with the total size in `Content-Range`, plus `ETag`, `Last-Modified` and `Accept-Ranges`.
- **A replaced video gets a new media ID.** Removing a lesson's video and attaching another one changed the video `id` (and `wistiaId`). **Duplicating a lesson also creates a new media ID** (and a new `wistiaId`) for the copy of the same file. So the fingerprint in "Telling whether a video changed" works for replacements, and the SHA-256 reuse step matters for duplicates.
- **A transcript uploaded in Kajabi can be read back.** "Video actions → Closed captions → Upload transcript" takes an SRT. `GET /api/admin/media/video_localizations/{mediaId}/transcriptions` then lists it (`languageCode`, `status`, `manual: true`) but not the text. The text comes from Wistia's public embed JSON, **`https://fast.wistia.com/embed/medias/{wistiaId}.json`** (the `captions` entry holds `language` and `text`), with no login. It is the plain text, so the Kajabi route works for Ania, but the Hub's Videos screen stays the primary path since it keeps the timed `.vtt` and the file itself.
- **A transcript doesn't follow the video.** The replacement video (new media ID) started with no transcript, so a replaced video needs its caption re-uploaded.
- **Capture gotchas:** the editor caches `/downloads` and the post JSON within a page session, so a script that opens a lesson a second time in one session sees no new request. And a *direct* load of a lesson's edit URL doesn't request the post JSON at all; reach it through the app's router (see "Step B in practice").
- **Not yet checked:** a lesson from the real course that has PDFs (the shape above is from a test attachment on the duplicate).

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
  - `draft` → hidden. Drafts are work in progress, and some of The Ready Writer's are still leftovers copied from the 180, so they must not leak. They *are* stored in the Hub (`state = 'hidden'`) so staff can preview them, and members never get them: the member loaders leave hidden rows out of every read (`loadStructure`), row-level security backs that up for lessons and modules (migration `20261129000100`), and a hidden lesson answers "not found", not "coming soon", so even its title isn't confirmed.
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
  - Fields: `mux_asset_id`, `mux_playback_id` (signed policy), `status`, `duration`, `quality` (Mux tier), `source_kind` (`kajabi` | `upload`), `source_key` (the Kajabi media ID), `source_fingerprint` and `source_sha256`. A row is unique per `(source_kind, source_key)`; the hash lets two media IDs share one Mux asset.
  - This is how re-runs skip videos already uploaded (see "Telling whether a video changed"). Lessons point at it with `course_lessons.video_id`.
  - Local rather than Silver because uploading is an external side effect we must not repeat.
- **Captions and other per-video assets.** Captions are per video, not a Mux account setting:
  - `videos.has_burned_in_captions` (boolean): the picture itself contains captions, as the existing videos do. For those, track files default to off so viewers don't see them twice. (Named for what it means, since "includes captions" could be read as "has caption tracks".) New videos from Descript are exported **without** burned-in captions, plus a separate subtitle file.
  - `video_text_tracks`: one row per caption, subtitle or transcript file on a video.
    - `kind` separates what the file is for: **`captions`** (with sound cues) and **`subtitles`** (dialogue only) are timed text the player shows, so they're attached to Mux; a **`transcript`** is text for search and the follow-along panel (plain, or timed per line or word) and is never attached to the player. One Descript SRT can serve both: store it as `captions`, and derive the transcript lines from it.
    - Fields: `video_id`, `kind`, `language`, `label`, `source` (`descript` | `whisper` | `mux_auto` | `manual`), `is_default`, the file in the private storage bucket (`.vtt`, kept in the Hub), and `mux_track_id` once attached to the Mux asset.
    - A track is attached to the Mux asset through its API (Mux reads the file from a short-lived link) so the player gets it with the stream. The stored file stays the source of truth: re-ingesting a video re-attaches it.
    - A track from Descript replaces an automatic one in the same language; the automatic one is removed.
  - **Safety net:** new videos are created with Mux's free auto-generated captions, so a video never ships with no captions at all if Ania's file isn't attached yet (her new Ready Writer lessons won't have burned-in captions).
  - Whisper transcripts (video phase 1) go in the same table, with timed lines for search and the follow-along panel.
  - Other per-video assets use the same pattern: thumbnails and posters, the audio-only file (Mux generates it per video), and downloads (`course_lesson_files`).
- `course_lesson_files`: PDFs copied into a private Supabase Storage bucket, keyed by Kajabi file ID and content hash. Served through short-lived signed URLs after an access check.
- `lesson_progress` (`member_id`, `lesson_id`, `completed_at`, `last_position_seconds`). Member-written, admin-readable, **read-only in sudo**.
- `video_watch_segments` (`member_id`, `video_id`, `session_id`, `start_seconds`, `end_seconds`, `playback_rate`, `started_at`). Append-only, one row per continuous stretch. **Not written in sudo**, so admins previewing as a member don't create viewing history. Admin-readable.

RLS:
- Course content is readable by members with a `course_access` row, and by admins.
- Progress and segments are the member's own, plus admins.
- Videos are never public. Playback links are minted server-side only after the access check.
- Schema is in `20261111000100_create_courses.sql`, tested by `supabase/tests/database/courses.test.sql`. Content policies use `has_course_access(course_id)`, which requires *current* access, so a member whose access ended gets their `/courses` listing and outline from the service role after the app's own check, not from RLS.

## Migration pipeline

One command, `pnpm courses:migrate --course <slug>`, runs all four steps in order. Every step is safe to re-run and only does new work.

| Step | Runs where | What it does | Idempotency |
|---|---|---|---|
| **A. Structure** (`/api/import/kajabi-courses`) | Server, triggered by the migrate command | API → Bronze courses, modules, lessons, offers | Upsert on Kajabi ID; soft-delete what a *complete* fetch no longer returns |
| **B. Content** (`scripts/kajabi-course-content.ts`) | Local, with the admin's Kajabi session | Lesson HTML, file list, video source → Bronze | Skips lessons whose content hash is unchanged |
| **C. Process** (`/api/process/courses`) | Server | Bronze → Silver courses/modules/lessons/access | Upsert on source key, delete orphans; IDs stay stable |
| **D. Media** (`scripts/course-media.ts` or a route) | Local or server | Videos → Mux (from URL if allowed, else download and upload); PDFs → Storage | Skips a video whose source fingerprint is unchanged; re-uploads when it changed (see "Telling whether a video changed") |

**Built (steps A and C):**
- **A, `/api/import/kajabi-courses`.** Body `{ "courseIds": [...] }` limits the run, otherwise every course on the site is imported. It fetches everything before writing, so a failed Kajabi call writes and soft-deletes nothing. It never lists step B's columns, so a re-import leaves lesson text and video sources alone. The result reports `unplacedLessons` per course: the OpenAPI spec doesn't say how included lessons point at their module, so parents are resolved from either side (a lesson's `module`/`category`, a module's `lessons`) and a count above zero means the live response differs from what's assumed. **Not yet checked against the live API** (the local credentials couldn't get a token): run it once and look at that number.
- **C, `/api/process/courses`.** Body `{ "course": "<slug>", "accessDuration": "1 year" }`. A new course takes the slug of its Kajabi title (`the-ready-writer`) and keeps it if the title changes; `accessDuration` is stored on the course when given (`null` = lifetime) and left alone when omitted; omit `course` to refresh every Kajabi course already in Silver. The program is linked on creation when a `programs` row has the same slug. Lesson text goes through an allowlist sanitizer (`sanitize-html`, `lib/courses/sanitize.ts`). `course_access` is upserted and its stale rows deleted, so members never see a gap mid-run.
- **Part of the standard sync.** The admin "Sync from Kajabi API" button (and the nightly member reconciliation) runs step A for every course and then step C for the courses already published, after the member import, so `course_access` is rebuilt from fresh purchases (`lib/courses/sync.ts`). A courses problem is reported in the result and never fails the member sync. A new course is never published by itself: the result lists it under "Not published in the Hub yet" with a required access length and a Publish button, which calls step C.
- **Pre-orders: access starts at launch.** `courses.launch_at` (set when publishing or from the admin Courses page; the route takes `launchOn` as a day in the organisation's timezone) moves anyone who bought earlier to start at launch, and their access length runs from then (`starts_at` is the later of purchase and launch). Until then the member's `/courses` shows "Opens <date>" and the course page says when it opens, with none of the course visible (access state `upcoming`, which can't open lessons).
- **Staff preview of "Coming soon" lessons.** Staff acting as themselves (not in sudo) can open lessons members see as "Coming soon", from the outline or from the lesson's "Preview" link on the admin course page; a banner says so, progress isn't tracked, and previous/next step through unreleased lessons too. **Drafts open the same way**, with a banner that says "Draft" instead of "Coming soon" and "Draft" badges in the outline: they are stored as `hidden` (a lesson under a draft module is hidden too) and only staff acting as themselves are given them, so they need a sync (step C) to appear. A lesson that is drafted again after being published stays as the same row (same id, members' progress kept) instead of being deleted. Drafts never count as available lessons. Members read only *open* lessons through row-level security (migration `20261112000300`): before it, a member could read a coming-soon lesson's text and video link through the API even though the app never showed it.
- **D, media: lesson downloads** (`lib/courses/files.ts`, `POST /api/process/course-files`, the "Downloads" panel on the admin course page, migration `20261112000500` for the private `course-files` bucket). For the files of every lesson, **drafts' included** (marked "Draft" in the panel; files cost nothing to keep and staff preview those lessons), in a *published* course, "Copy N files" fetches each file from the presigned link the content step recorded and stores it as `course-files/<course>/<lesson>/<kajabi file id>-<name>`, with a `course_lesson_files` row (filename, type, size, SHA-256, position). It costs nothing, so there's no confirm step. A file already copied is never copied again, a file Kajabi no longer lists (or whose lesson is gone) is removed from storage and the table, a file over 50 MB is reported, and an expired or missing link is reported ("run the Kajabi content step again"). Members never touch the bucket: the lesson page's Downloads card (beside the video on a wide screen, below the text on a phone) links to `/courses/<course>/lessons/<lesson>/files/<file>`, which applies the lesson page's access rule (staff also preview coming-soon lessons) and redirects to a signed link that expires in a minute and saves the file under its own name; anything else is a plain 404. **A draft's files stay staff-only** with no extra rule: a draft is a hidden Hub lesson, members' row-level security reads only files of *open* lessons, and the route refuses anyone who can't open the lesson (members get "Coming soon"/404, staff acting as themselves get the preview). **Not done:** noticing that a file kept its Kajabi id but changed its content (a replaced file is only picked up if Kajabi gives it a new file id).
- **D, media: videos to Mux (drafts)**: a video used only by Kajabi drafts is planned too, marked `draft`, and listed in its own "Draft lessons' videos" section of the Videos panel. The normal upload never sends it (every upload is billed, and some drafts are leftovers); the draft list has a checkbox per video (none ticked to start, "Select all" and "Clear" above it; a video that can't be uploaded, say its link expired, can't be ticked), and a separate "Upload N selected draft videos" button (`action: "upload_drafts"` with `mediaIds` on `/api/process/course-media`, with its own confirmation naming the ticked videos' minutes) uploads exactly those, so staff can preview just the lessons they care about. `mediaIds` is also accepted by the normal `upload`; an empty or malformed list is a 400, never read as "all", and ids the action doesn't cover come back as `notAvailable`. A draft's downloads are copied with the rest (see above). The Kajabi content step (lesson text and video links, run with a Kajabi session) has to include drafts for their text and videos to arrive.
- **D, media: videos to Mux** (`lib/courses/media.ts`, `POST /api/process/course-media`, the "Videos" panel on the admin course page). An explicit button, not part of the automatic sync, because every upload is billed: it lists the course's videos, says how many minutes it's about to upload, and asks first. Only videos of lessons members can see (open or coming soon) are uploaded, never drafts. For each, Mux fetches the presigned download link the content step recorded (no local download), the quality is `plus`, the `videos` row records the Kajabi media id, the source fingerprint (size, ETag, Last-Modified from a one-byte ranged GET) and `has_burned_in_captions`, and the Mux asset id is saved straight away. A video already in Mux is never uploaded again; an errored one is retried into the same row; a lesson whose link has expired is reported ("run the Kajabi content step again") instead of failing. "Update status" reads Mux directly, for when the webhook hasn't delivered. Afterwards step C links each lesson to its video. **Not done:** reusing one Mux asset for the same file under two media ids (that needs the file's SHA-256, and Mux fetches the link itself so we never hold the bytes), copying lesson PDFs to Storage, and uploading new videos of an already-published course automatically.
- **Completing a lesson:** the player completes the lesson itself once the playhead passes 90% *while playing* (jumping a paused playhead to the end doesn't count), the button changes from a white, outlined "Mark as complete" to a filled "Complete" in the Hub's color, and a "Great job! Keep going!" card previews the next lesson (thumbnail, title, link). Pressing "Complete" clears it, and once a member has pressed the button themselves, watching on never completes it behind their back. It's one shared state (`LessonCompletion.tsx`), read-only in sudo and in a staff preview. This is a playhead threshold, not the watch-segment tracking planned later, so a lesson can be completed by jumping ahead while it plays; the segments will make "watched" exact. The section list also has a "Next Module" button (to the next module's first open lesson) when there is a next module.
- **Lesson page layout** (modelled on Kajabi's): a breadcrumb (course / module / week / lesson), then the video and this section's lessons as **one component** (a dark panel flush against the player, the same height, scrolling if long; hidden on a phone), then Back / Mark complete / Next under the video, then the title and text, with the Downloads card beside the text. The section list shows each lesson's number (a check when done, a marker for the current one), an aligned thumbnail and a wide title, dimmed and unlinked when unreleased and with no "Coming soon" label. The staff preview notice is a plum strip under the header, the same strip as the notification banners (`components/PageBanner.tsx`) but not a stored notification, since it describes the page, not an event; Mark complete stays visible but disabled in a preview.
- **Admin Courses page** (`/admin/courses`, behind the `courses` flag in the sidebar): every Kajabi course with its Hub state, access length, launch date, lesson counts and who has access (current / upcoming / ended). A course's page explains each module and lesson (open, coming soon or hidden, and which Kajabi setting or module above it decides that, from the same rule members get), shows whether the content step has fetched its text and video, and has the access length and launch date form for a published course.
- **Both routes write with the service role** after checking the caller is an admin: signed-in admins can read the Bronze and Silver course tables but not write them.
- **Not built yet:** "includes membership" counting as active membership in `reprocess_members_atomic`.

Tests, per `CLAUDE.md`:
- Bronze idempotency tests in `tests/api/idempotency/`: first import, re-import with no duplicates, a changed lesson, a removed lesson.
- Silver reprocessability tests in `tests/api/reprocessability/`: create, a deleted source removes the lesson, a changed source updates it, and IDs stay stable.
- Media tests with Mux mocked: a re-run uploads nothing new, and a changed source re-uploads.

### Step B in practice

`npm run courses:content -- --course <kajabi-course-id> [--apply] [--env .env.prod]` (or `--lesson <id>`). Logic is in `lib/kajabi/lesson-content.ts`; the browser part is `scripts/kajabi-course-content.ts`.

- **It needs a login, once.** It opens Chrome with its own profile (`~/.hub-kajabi-profile`), waits while you log in to Kajabi, and reuses that login on later runs. It never sees a password or token. It records the two JSON responses each lesson's editor loads (see the spike result under "What Kajabi gives us"). **It reaches each lesson through the app's own router, not by loading the lesson's URL:** a direct load of `/admin/posts/{id}/edit` never makes the `/api/admin/posts/{id}` request (it only fetches `/downloads`), so each worker loads the course's admin page once and then does `history.pushState` + `popstate` to each lesson, which fires both requests every time. After the first login, `--headless` works with the saved login.
- **Dry run by default.** Without `--apply` it captures and reports (`updated`, `unchanged`, `urls_refreshed`, `missing`, `failed`) and writes nothing. Exit code 1 if any lesson failed.
- **Only fills in what step A imported.** It updates the content columns of existing Bronze lessons (`body_html`, `thumbnail_url`, `video_media_id`, `video_source`, `content_hash`, `content_fetched_at`) and never creates one; a lesson Bronze doesn't have comes back as `missing`. A step A re-run doesn't touch those columns. Draft lessons are captured too, since staff preview them (`state = 'hidden'` in Silver); `--skip-drafts` leaves them out. (`--include-drafts`, the old opt-in, is still accepted and does nothing.)
- **`content_hash`** covers the text, thumbnail (without its query string), video media/Wistia IDs and the file list, not the expiring links, so reloading an unchanged lesson changes nothing.
- **Downloads** go to `bronze.kajabi_lesson_files`: upserted on Kajabi's file ID (restoring one that had been soft-deleted), and any the editor no longer lists are soft-deleted.
- **Expiring links are stored, for step D.** `video_source.download_url` and each file's `source_url` are presigned S3 links valid for 7 days (`download_url_expires_at`). Bronze is admin-readable, so those links are readable by admins for that week. A lesson whose links are within 36 hours of expiry is refreshed on the next run even if nothing else changed; step D should run soon after B, or B re-run first.

**Launch rehearsal:** run the full migration against production at least twice before launch day, the second time after Ania's final edits. The launch-day run should then be a no-op except for her last changes.

### Telling whether a video changed

Re-hashing every file on every run would mean downloading hundreds of GB each time, so it's layered, cheapest first:

1. **Fingerprint, every run, no download:** Kajabi's media ID and duration (from the API), plus the download link's total size, `ETag` and `Last-Modified` (a one-byte ranged `GET`; the link is signed for `GET`, so a `HEAD` is rejected). Stored on `videos` as `source_key` and `source_fingerprint`. Replacing a lesson's video in Kajabi produces a new media ID, which this catches (confirmed in the day-1 spike).
2. **SHA-256, only when we download:** computed while streaming the file to Mux and stored as `videos.source_sha256`. If a new media ID has the same hash as an existing row (a lesson duplicated between the 180 and The Ready Writer, say), **reuse that Mux asset** instead of uploading and paying to store it again.
3. **When it did change:** upload a new Mux asset, repoint the lesson once it's `ready` (members never see a gap), and retire the old asset once nothing references it.

## Video

- **Mux:**
  - Signed playback policy, 1080p cap.
  - **Quality tier** (`video_quality`) is a per-video setting, set when the asset is created. *Basic* uses a reduced encoding ladder at a lower target quality and has no encoding charge. *Plus* uses per-title AI encoding (raises bitrate where the picture is complex, lowers it where it isn't) and costs about $0.03/min once at upload. Basic is the default in new Mux accounts.
  - **Slides with small text are what basic tends to soften,** and webinars are mostly slides. So: course lessons use *plus* (The Ready Writer is about 650 minutes, roughly $20 once); the webinar archive starts as *basic* and moves to *plus* only if a side-by-side test of a few replays shows a difference.
  - **Changing the tier later means re-ingesting:** the docs describe the tier only as a create-time setting, so a quality change is a new asset from the same source, then repointing the lesson (the same swap as a changed video) and deleting the old asset. It isn't a config toggle on existing videos. Storage cost is the same either way.
  - Free auto-captions off for now (captions are burned in).
  - Audio-only static rendition once audio mode is built.
- **Keys:** `MUX_TOKEN_ID`/`MUX_TOKEN_SECRET` (Video read+write, Data read, High priority), `MUX_SIGNING_KEY_ID`/`MUX_SIGNING_KEY_PRIVATE`, and `MUX_WEBHOOK_SECRET` (declared in `env-vars.config.ts`). The bulk migration should use a separate Low-priority token so it doesn't compete with member traffic.
- **"Video ready":** production uses the Mux webhook at `/api/webhooks/mux`, verified with `MUX_WEBHOOK_SECRET`. The route **rejects every request while that secret is unset** (`webhookSecretRequired()` in `lib/webhook-auth.ts`, PR #105), instead of skipping verification. Preview deployments have changing URLs, so they poll Mux for status instead. Built: `lib/mux.ts` (asset creation, signed playback tokens, webhook verification) and `app/api/webhooks/mux/route.ts`, which marks the matching `videos` row ready or errored (idempotent). It answers 500 for an asset with no `videos` row yet, so Mux redelivers; the media step must save `mux_asset_id` right after creating the asset.
- **Player:** a half-day test of Video.js v10 (GA 2026-10-01) against a Mux stream. It must have a speed menu, keyboard shortcuts, seek previews (Mux storyboards) and theming; fall back to Vidstack if it doesn't. Watch tracking listens to the underlying video element, so the choice doesn't affect data.
  - **Spike result (2026-10-18, `/admin/player-spike`, `@videojs/react` 10.1.0 with `MuxVideo`):** playback, the speed menu, keyboard shortcuts and Mux storyboard seek previews work. A `<track kind="captions">` child of `MuxVideo` adds the captions button and shows cues; with several tracks the gear menu gets a Captions submenu (Off, one entry per track) and the `c` key toggles captions. Theming works through the skin's public CSS properties (`--media-accent-color`, `--media-accent-text-color`, `--media-border-radius`, `--media-font-family`), set on `VideoSkin`; the Hub's plum is applied in the spike.
  - **Signed playback (checked 2026-10-18 against a signed-policy test asset):** the server mints three JWTs per lesson view with `@mux/ts` (`mux.jwt.signPlaybackId(id, { type: ["video", "thumbnail", "storyboard"], expiration })`) and passes them as `source.playback.token`, `source.poster.token` and `source.storyboard.token`. Mux answers 403 without a token, and 200 with the right one for the manifest, poster and storyboard; **a token is only good for its own type** (the video token on a poster gets 403), so all three are needed. The spike page mints them behind the admin check (`/admin/player-spike?signed=<playbackId>`). Playback, the poster before play, seek previews on hover, captions and watch segments all work in a real browser with the signed asset (checked by hand 2026-10-18), so the spike has nothing left to check.
  - **Watch segments work from the media element:** `useMedia()` returns the attached media, which takes `addEventListener` for `playing`, `pause`, `seeking`, `seeked`, `ratechange`, `timeupdate` and `ended` (plus `visibilitychange` and `pagehide` on the page). The spike opens a segment on play and closes it on pause, seek, speed change, tab hide, page leave or end; a seek of +10s with the arrow key produced two segments (`0.0s to 4.7s (seek)`, `14.9s to 19.0s (pause)`). Speed-change and page-leave closing are wired but weren't exercised by hand.
  - **Segments carry the captions state** (`captions_language`, null = off), and toggling captions closes the segment and opens a new one, like a speed change. Checked: pressing `c` mid-playback gave `captions Spanish (captions)` then `captions off (pause)`.
  - **Segments carry `visible` too** (was the tab on screen), and both hiding and showing the tab close the segment and open a new one if the video is still playing. Hiding must not end tracking (audio keeps playing, and no `playing` event fires on return), and it separates watching from playing in the background, which audio mode will need. Batch these small rows before sending.
  - The captions button is the skin's own "subtitles" icon (a rectangle with lines), not the "CC" glyph viewers know from YouTube, and `c` is the same toggle: it shows or hides the most recently chosen language.
  - **Captions aren't remembered either:** `useCaptionsOptions` gives the options and `setValue`. Save the chosen option's *label* (track ids change per video) and restore it once `canPlay`, skipping saves until the restore has landed.
  - **Speed isn't remembered by the player:** we save it (per member) and restore it ourselves. Store actions throw `NO_TARGET` until the media element is attached, so wait for `selectSource` → `canPlay` before calling them.
  - **Needs `@videojs/mux-video`** installed alongside `@videojs/react`.
  - **Skin CSS and Tailwind v3 (settled):** the skin stylesheet uses native `@layer base|components`, which Tailwind v3 rejects ("no matching `@tailwind base` directive"). `postcss-tailwind-skip-vendor-layers.mjs` wraps the Tailwind plugin and skips files under `node_modules/@videojs/`, so the skin is imported normally (`import "@videojs/react/video/skin.css"`) and keeps its native cascade layers. Turbopack resolves PostCSS plugin names from inside `.next`, so `postcss.config.mjs` gives the plugin by absolute path. The stale copy in `public/` is gone.
- **Watch tracking (built):**
  - The lesson player (`LessonPlayer.tsx`) records each continuous stretch (start, end, speed, captions language, tab visible) from the media element, as the spike did. It opens on play and closes on pause, seek, speed or captions change, tab hide or show, page leave or the end, and drops stretches under a quarter second.
  - Stretches are batched and sent to `POST /api/courses/watch` on pause, end, tab hide and page leave (`fetch` with `keepalive`, so it finishes while the page unloads), and checkpointed every 30 seconds while playing, so a crash loses at most that much.
  - **Retries are safe:** the player gives each stretch an id (`client_segment_id`) when it closes, unique per member, and the route inserts with `ON CONFLICT DO NOTHING`, so a resend of a save that already arrived (its response was lost) is stored once. A save that fails for a passing reason (offline, a 5xx) goes back in a queue (newest 200) and is resent with the next one, in batches of at most 50; a refusal (4xx) is dropped. A save lost while the page unloads can't be retried, since the page is gone.
  - The route checks like Mark complete does (courses on, access, an open lesson) and that the lesson has a video, takes the video from the lesson (never from the request), and writes as the member. It writes **nothing in sudo**, and the player doesn't track in a staff preview of a "Coming soon" lesson. It also stores the playhead in `lesson_progress.last_position_seconds`, leaving `completed_at` alone.
  - **Resume:** the lesson page passes the saved position (ignored under 10 seconds) and the player seeks to it once the length is known, unless that is 95% or more of the video (then it starts over).
  - **Staff watch stats (built):** `/admin/courses/<kajabi id>/stats` lists each lesson with a video (viewers, average share watched, viewers who covered 90%+, a small engagement graph), and `/admin/courses/<kajabi id>/stats/<lesson id>` has the full view: the numbers, an **Engagement panel** (`EngagementPanel`: Kajabi's heatmap and a Wistia-style engagement graph in one). Per moment of the video it shows three counts on one axis, each stricter than the last, so **people <= plays <= times watched**: **times watched** (every pass over the moment, a rewind or replay counting each time: the area), **plays** (visits, i.e. player sessions, that watched it, so rewinding inside a visit is still one) and **people** (different members, each once however often or on however many visits). One person watching a part twice in one visit is 2, 1, 1; coming back another day is 2, 2, 1; with nothing replayed the three lines coincide. The video's own frames are the backdrop (signed Mux thumbnails, one token per slice since Mux wants a signed still's `time` inside the token's claims, not the URL): moving the pointer or the arrow keys shows the still from that moment, a vertical line, and a tooltip with the time, the three counts and the share of plays that watched it. The frames can be switched off with the panel's checkbox or the `showFrames` prop (a plain dark panel with the same chart; also what it falls back to when stills can't be signed), and a table view has every value. All three counts are measured the same way, as how much of the slice was covered (a slice covered half by one person is 0.5 on each, not a whole person), which is what keeps people from ever exceeding times watched. Also shown: how it was watched (playback speeds, captions on, playing in the background). Each stat tile opens to its definition. A **play** is one visit (player session) in which the video was played, so the Total plays tile counts visits, and the same member returning another day is another play (and still one *unique* play over the range). **Engagement** is Kajabi's: total watch time / (total plays x video length), where a **play** is a player session (one visit to the lesson) with at least one stretch, so a member returning another day is another play. **Play rate** is plays / views, where a *view* is the player appearing for a session: the player sends a **`viewed` marker** when it mounts (a row in `video_watch_segments` with `kind = 'viewed'`, a point at 0, `client_segment_id` = the player session id so a resend is a no-op, and the browser's `user_agent`), whether or not anything is played. Anything counting stretches filters on `kind = 'watched'`; a session with stretches counts as viewed even without a marker, so a marker that never arrived (a dropped request) can't push play rate above 100%. The lesson page also lists the **views** (`ViewerList`): one row per player session, newest first, with the **member's name**, a bar of which parts of the video they covered and the percent, and on opening a row the device (from the user agent, via `describeDevice`) and how long they played; "Load more" asks for another 20 (`?limit=`). Opening a row also shows **where the visit came from** (place and raw IP): not stored with the video data, but looked up from the access log as the member's latest located `access_events` row before the visit (see `docs/ANALYTICS.md`, "Course viewing data"), "Not recorded" when there is none. The marker is first-party course data like the stretches, not a consent-gated analytics event (see `docs/ANALYTICS.md`, "Course viewing data"). **Over time** (`TimeSeriesSection`, `lib/courses/watch-timeseries.ts`, pure): like Kajabi's Analytics modal, one metric by day, week (Sunday first) or month over a date range: Today, Last 7/30 days, Last and This month/quarter, This year, Last 12 months, All time, or custom dates, all in the organisation's timezone as whole local days. The metrics: **Total plays** (visits with a stretch), **Unique plays** (different members who played, each once), **Unique viewers** (different members who opened the video, played or not), **Play rate** (plays / views), **Engagement rate** (watch time / (plays x video length)) and **Hours watched**. Each visit counts on the local day it *began*; the header total is for the whole range (unique counts and rates don't add up from the points); every day in the range is a point, zero where nothing happened; a daily range over 400 days is shown by week. It is a plain GET form (`?metric=&range=&by=&from=&to=`), so a view is a shareable link, and "Load more" keeps the settings. Kajabi's "location" filter (which page the video is on) has no equivalent: our segments belong to a video, not to a lesson. The maths is `lib/courses/watch-stats.ts` (pure; times are video time, stretches are clipped to the video's length, and the graph is at most 100 slices), the reads are `lib/courses/watch-stats-data.ts` (service role behind `requireAdminPage()`, paginated). Staff members' own viewing (admins' member records) is left out by default, since it is test data (`?staff=1` includes it). A per-member view is a follow-up.
  - Completion is still the 90%-playhead rule in `LessonCompletion.tsx`; moving it to "90% of the video actually watched", from these rows, is not done. Neither is the per-member speed setting or a per-member stats view.
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

**Built:** the three pages, behind the `courses` feature flag (off; migration `20261111000200`). They read through a service-role client scoped to the *effective* member (`lib/courses/member.ts`), not RLS, because sudo acts for another member and an ended-access member still sees their course; staff open every course only as themselves, and in sudo the member's own access applies. Mark complete is a server action that checks access itself, writes as the member, and is read-only in sudo. Lessons that can't be opened (no access, ended, coming soon) redirect to the course page, which explains why. The player is signed Mux playback with speed and captions remembered per browser, resume position and watch segments (see Watch tracking). **Not built yet:** the speed setting per member, completion from the segments, a per-member stats view, downloads (they need step D's file copy), the "Videos" admin screen. "Continue watching" on the dashboard is built (`loadContinueWatching` in `lib/courses/member.ts`, `components/courses/ContinueWatchingCard.tsx`). `/admin/player-spike` can be deleted once the lesson player has been seen working with a real video.

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

Ania publishes in Kajabi until the builder replaces it, so the sync is used for months, not once. **It's manual for now:** run `pnpm courses:migrate --course <slug>` when she finishes a batch. It runs steps A–D in order, skips anything unchanged, and prints what changed (lessons added, updated, removed; videos uploaded or reused).

Steps A and C also run with the standard Kajabi sync (the admin button and the nightly reconciliation), so structure and access stay current without anyone running them. Lesson text and new videos still need step B, which needs the Kajabi session, so that stays manual.

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

- [ ] Mux keys in `.env.preview` too (currently only `.env.local` and `.env.prod`). `pnpm env:sync` exits with an error for any target missing a value.
- [ ] Merge the env var PR (#102), then run `pnpm env:sync` (all values filled in).
- [ ] After the webhook route deploys: create the production Mux webhook pointing at `/api/webhooks/mux` and put its secret in `.env.prod`.
- [ ] A separate Low-priority Mux token for the migration (`hub-migration`); revoke it after launch.
- [ ] Billing alert in Mux (Organization Settings → Billing → Alerts; needs a paid plan).
- [ ] GA: Reporting identity → Observed.
