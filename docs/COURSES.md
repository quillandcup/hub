# Courses in the Hub

Plan for moving Quill & Cup's courses from Kajabi into the Hub, starting with **The Ready Writer**, which launches in about two weeks (target: early November 2026). Written 2026-10-18; update it as decisions land.


**Two independent axes.** Where a course is authored is `courses.source` (`kajabi`: read-only here, rebuilt on sync; `hub`: edited in the builder). Whether members can open it is `courses.is_draft`, for every course whatever its source. A new course (imported or Hub-made) starts as a draft; **Publish** and **Unpublish** on the course's admin page (`setCoursePublished`) flip it. Publishing a Kajabi course also builds its access (the people who bought it get it); unpublishing keeps the rows but opens nothing. A draft is hidden from members and from staff in sudo, and visible to staff acting as themselves (marked "Draft") to preview. Syncing is separate from availability: the Kajabi import gives every course a row (`ensureDraftCourses`) and processing syncs the content of every imported course, drafts included, so lessons have Hub ids and the builder pages work before publishing; only access follows `is_draft`. The Import Data publish step posts `publish: true` to `/api/process/courses`; without it processing never publishes.

**Admin addresses use Hub ids, never Kajabi's.** `/admin/courses/<crs_ id>`, `/lessons/<les_ id>`, `/stats` and `/roster` all take our ids; the Kajabi id stays the importers' natural key and is resolved server-side (`kajabiIdOfCourse`). A course imported before its row exists is listed without a link until the next import.

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

- **A program may have no course.** BFF is matching and coaching; retreats are events (`community_events`); the membership itself is subscription logic, not a program.
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
2. Admin course stats: who's where (built: `/admin/courses/<course id>/roster`, `lib/courses/roster.ts`: each member with access, open lessons completed, last lesson and last activity from `lesson_progress`, sortable and paged), drop-off per video and a per-viewing heatmap (built, see Staff watch stats). Still open: last activity from watch segments rather than only progress rows, a per-member stats view.
3. Audio-only "listen like a podcast" mode (Mux's per-video `audio.m4a`).
4. ~~Mux config as code and a nightly Mux end-to-end check~~ (built: `docs/MUX_CONFIG.md`). Still open: enforcing the playback restriction in the signed tokens, and a webhook-delivery check (`docs/TODO.md`, "Mux configuration as code").
5. A "Sync courses" admin button, and a nightly structure-and-access sync, once step B is automated (see "Ongoing sync after launch").

### Later

- **Access-ending reminder:** a notification some weeks before a course's access ends, prompting the member to switch to or opt in to membership billing.
- **Video phases 1–2:** Whisper transcripts with search and a follow-along panel; then re-exported clean videos with toggleable caption tracks.
- **Course builder in the Hub,** so Ania stops authoring in Kajabi. **Editing model (decided 2026-10-31): Hub-owned courses, plus a one-time "take over" per Kajabi course.** A course the Hub owns is `courses.source = 'hub'` (the Kajabi reprocess never touches those rows, which is why `source` exists); admins write it with their own client, never the service role, so the audit log names them (policies and audit triggers in migration `20270315000000`, covering only Hub-owned rows; a course imported from Kajabi is rebuilt from Kajabi on every sync and stays read only). A Kajabi course is **never edited in place** (that would mean merging two live sources); instead a later step, "Take over from Kajabi", copies it into a Hub-owned course with the same ids (so progress and links keep working) and stops syncing it. Ania keeps authoring in Kajabi until then, and nothing about the launch changes. Order of work, each its own PR: (1) **built:** the write path and creating a blank course (`/admin/courses/new`, `createCourse` and `updateCourseDetails` in `app/(admin)/admin/courses/actions.ts`, validation in `lib/courses/editor.ts`; an imported course's page is still the read-only builder below, a Hub-owned one's page, `/admin/courses/crs_…`, edits its name, address, description, access length, opening day and program); (2) **built:** modules, submodules and lessons of a Hub-owned course: add, rename, duplicate, delete and reorder, from the outline on its page (`BuilderOutline` with `editable`; actions in `app/(admin)/admin/courses/outline-actions.ts`; migration `20270317000000`). New items are drafts (`state = 'hidden'`) until the status menu exists. Reordering is by dragging a row's handle, or Move up and Move down for keyboards, within one list (a course's modules, a module's submodules, or a module's lessons), and is one database call (`reorder_course_children`) that refuses a list that isn't exactly the current one; duplicating a lesson or a module (with its submodules and lessons) is one call too (`duplicate_course_lesson`, `duplicate_course_module`), copying text, thumbnail and the link to the same video, but not the downloads. Deleting asks first and says what goes with it, and is refused for anything a member has progress in (hide it instead). The database keeps the structure sound: a lesson's module and a module's parent are in the same course, and a Hub-owned module nests one level at most (modules have submodules, submodules have lessons); (3) the status menu and lesson details, in two PRs: **3a built**: each course, module and lesson stores its own setting, one rule works the state out (see "One model for imported and Hub-owned courses" under Data model), the Kajabi sync stores Kajabi's setting on every row, and the repository and server actions to change a setting (`setCourseStatus`, `setCourseItemStatus`) exist; **3b** is the controls (a course-wide switch and the per-row status menus, enabled for a Hub-owned course) and the lesson details page, which reads the Hub's own rows for both owners; (4) lesson text and downloads; (5) video upload to Mux, replace and remove, and the captions manager; (6) take over from Kajabi, with a dry run. **Prototype built (2026-10-30), the read-only view of an imported course:** `/admin/courses/<id>` is the builder (`app/(admin)/admin/courses/CourseBuilderForm.tsx`), showing the course as last imported from Kajabi (details, modules, lessons with their Open / Coming soon / Hidden state, when it was last imported), and `/admin/courses/new` is the blank form. Every field is disabled behind a banner that sends admins to support for a manual Kajabi import; the Hub settings form (access length, launch day) and the video and file panels still work. The outline copies Kajabi's: collapsible modules and submodules with Expand all and a search; per row a drag handle on the left, hover actions on the right (edit, duplicate, comments, preview, delete) and a quick status menu (Draft, Publish, Schedule, Drip, Lock) where Publish is blocked under a draft module (`lib/courses/status-choices.ts`; Kajabi does allow a published week inside a *locked* module, so only drafts block it). Each lesson has its own builder page, `/admin/courses/<id>/lessons/<kajabi lesson id>` (details, module, media, text, downloads, status, thumbnail, comments), with the staff watch-tracking tools (record my watching in a preview, clear my progress), which no longer sit under the video on the member lesson page. **Still open:** saving (a `source = 'hub'` write path), editing lesson text and video, reordering, the Schedule status (the import doesn't store it), comment counts and comment settings (not imported from Kajabi), and Kajabi's "Use current frame as thumbnail" (the lesson page plays the video with the members' player, `components/courses/LessonPlayer.tsx`, but the button needs saving first, and a way to hand the player's current time to an image upload).
- **Cohort-based courses:** Self-Editing Academy (reflection quizzes, level progression), the 180.
- **Other courses:** BFF Mindset Training, Hedgies on First, then the membership video library.
- **Mini player and pop-out window.**
- **Lesson comments:** see "Lesson comments" below (design proposal, open questions pending).

### Not planned

- Kajabi's quizzes and assessments before Self-Editing Academy moves.
- Moving checkout off Kajabi.
- Importing Kajabi per-lesson progress for The Ready Writer: its first run starts in the Hub, so there is nothing to import. Other courses are different; see "Importing Kajabi per-lesson progress".

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

## Importing Kajabi per-lesson progress

**Wanted** (decided 2026-10-28): a member who is halfway through a Kajabi course arrives in the Hub with those lessons complete in `lesson_progress`, and ideally the last-watched position. The Ready Writer starts fresh in the Hub, so the likelier users are the courses that move later (Self-Editing Academy, BFF Mindset Training, Hedgies on First). Status: **the Product Progress report import is built** (percent per student, Bronze only, see "Product Progress report import" below); the member-confirmed catch-up that turns it into marked lessons is not built yet.

### What Kajabi exposes

**Verified 2026-10-28 (read-only, client credentials, public API v1; counts and field names only).** The spec in `lib/kajabi/openapi.yaml` and live probes agree: **there is no per-lesson progress in the public API.**

| Endpoint | Result |
|---|---|
| `GET /v1/contacts` (952 contacts) | Profile fields only (name, email, address, phone, `subscribed`, `external_user_id`, timestamps). Relationships: `site`, `offers`. |
| `GET /v1/customers` (300 customers) | Adds `sign_in_count`, `last_sign_in_at`, `last_request_at`, `net_revenue`, public profile. Relationships: `site`, `contact`, `offers`, `products`. No course data. |
| `GET /v1/purchases`, `/v1/order_items`, `/v1/offers`, `/v1/courses`, `/v1/products` | Who bought what and when (already used by the purchase and course sync). `products` has `members_aggregate_count` (a count per product, not per member). `courses` has modules and lessons, no student data. |
| `GET /v1/contacts?filter[completed_assessment_id]=…` (also `passed_` and `failed_`, and the same on `/v1/customers`) | Answers 200. A **quiz-level** yes/no per assessment, but the API has no endpoint that lists assessments and their ids, so the ids would have to come from the admin app. Not lesson progress. |
| `/v1/enrollments`, `/progress`, `/lesson_progress`, `/lesson_completions`, `/completions`, `/assessments`, `/quizzes`, `/quiz_results`, `/assessment_submissions`, `/activity`, `/events`, `/reports`, `/lessons`, `/posts`, `/members`, `/v1/courses/{id}/enrollments`, `/progress`, `/students`, `/relationships/contacts`, `/v1/contacts/{id}/progress`, `/relationships/courses`, `/enrollments` | **404** (not endpoints). |
| `/v1/course_progress`, `/v1/hooks` | **403** with our credentials. `/v1/hooks` is webhooks, which the spec lists only for tags, forms, purchases, payments and orders, none for lesson completion. `course_progress` was a guess that answered differently from the 404s, so ask Kajabi whether it is a real, permission-gated endpoint. |

The one usable signal is coarse: `last_sign_in_at` / `last_request_at` per customer (when they last visited Kajabi at all, not which lesson).

**Unverified (needs a logged-in Kajabi admin browser, which an agent cannot do).** Kajabi's admin app very likely has the data, since a product's Students page shows per-student progress, and the editor's own JSON API (`/api/admin/...`, see "What Kajabi gives us") is what such pages call. By analogy with `/api/admin/products/{id}/posts` we would expect a per-product students list with a completion percentage and a per-student view with completed lessons, but **the paths, fields and whether per-lesson completion dates exist are guesses.** Expect the same auth constraint as the editor JSON (not cookie-replayable, 401 outside the page), so a script would have to drive the real pages and record responses, as `scripts/kajabi-course-content.ts` does.

### What the user checks (about 15 minutes, in their own logged-in browser)

1. Open the product (e.g. Self-Editing Academy) in Kajabi admin, then its **Students** (or **Contacts**, filtered by the product) page. Is there a per-student **progress %** column? Does a student's detail page list lessons with a completed mark or date?
2. Open dev tools, Network, filter on `Fetch/XHR`, reload that page, then open one student. Note the request URLs and the JSON field names that carry completion. Do not paste any student's name or email anywhere public; field names and one redacted sample are enough.
3. Look for **Reports**/**Analytics** (course completion, quiz results) and an **Export CSV** button on the Students page. A CSV with one row per student and lesson (or one column per lesson) would be enough on its own.
4. Ask Kajabi support: "Is there an API or export for per-student, per-lesson completion and last position? Is `/v1/course_progress` a real endpoint?"
5. Check whether Kajabi records completion per lesson for each course at all: it only does when students click "Complete and continue", and a video-only course may show nothing.

### Options, in the order to prefer them

1. **Kajabi export or admin JSON (best, if checks 1 to 3 find it).** Same shape as the other session steps: a local script (`pnpm courses:progress --course <slug>`) run by Ania or Cody in their own logged-in browser; it never sees a password. It reads progress from the page's own responses (or ingests a CSV the user downloads) into Bronze.
2. **Coarse import from what the public API has.** Treat a lesson as done only for members with a clear signal (a passed assessment via the `completed_assessment_id` filter, once ids are known) and otherwise start at zero. Cheap and safe, but only useful for quiz-bearing courses (Self-Editing Academy).
3. **Self-service "catch me up".** A one-time prompt on the course outline when a migrated member has access and no progress: "Mark everything up to here as done" (a lesson or module picker). It writes ordinary `lesson_progress` rows as the member, needs no Kajabi data and is honest about being self-reported. Good as the fallback for every course and as the repair path when an import is partial.
4. **Derive from Hub signals.** Not possible before the member has used the Hub (no watch segments yet), so it only helps after migration. Do not infer completion from a purchase date.

Recommended: run the checks above; if a usable source exists build option 1 (with option 3 as the member-facing repair), otherwise build option 3 alone. Nothing in The Ready Writer launch depends on this.

### Product Progress report import (built)

**The source is known (decided 2026-10-28):** Kajabi's admin has a **Product Progress** report per product (with an **Export** button). The CSV has one row per student with `Name, Email, Product Progress, Logins, Start Date, Last Activity At`. `Product Progress` is a 0 to 100 percentage of the **whole product**, not per lesson; the start date reads "Not Started" for people who have not begun. The file does not say which product it is for, so the admin picks the course when uploading. It needs no browser session and no script.

**Per-lesson detail exists (confirmed 2026-10-29 from a screenshot).** Each student has a "Customer Progress" page in the Kajabi admin (click a name in the Product Progress report): their overall percent and last activity, a list of modules and weeks with a percent or check each, and, after clicking a module or week, the lessons in it, each with a check and a "Completed: date" or a percent for one in progress. So Kajabi does record per-lesson completion with a date. The page loads a week's lessons only when it is clicked, so the capture has to open each module for each student. **Decided: this is part of `npm run courses:content`** (a `--progress` mode sharing its browser login), not a manual download and upload: it reads the report page for the roster (percent, logins, start date, last activity) and each student's page for the lessons, and writes Bronze like the other steps (dry run unless `--apply`). The CSV upload above stays as the fallback. **First step, built:** `courses:content --probe <page address>` opens a page in the logged-in browser, records the JSON it loads while you click around (open a week, a module), and prints request paths and field names and types, never values. Run it on the Product Progress page and on one student's page, paste what it prints, and the capture is written from those facts.

**What the import does** (admin Import Data page, "Kajabi Course Progress"; `app/api/import/kajabi-product-progress/route.ts`, `lib/courses/product-progress.ts`):

- Writes **`bronze.kajabi_product_progress`** only: natural key (Kajabi course id, lowercased email), `percent`, `logins`, `started_on`, `last_activity_on` (the report gives dates, not times), `import_batch`, `source_file`, `imported_at`, `deleted_at`. The student's **name is not stored** (matching is by email, and the admin who uploads already has the file). Admin read, service role write. It **does not write `lesson_progress`**.
- **Re-runnable per course.** A new report replaces the course's snapshot: new and changed rows are upserted, rows the file no longer lists get `deleted_at`, identical rows are left untouched (re-importing the same file changes nothing), other courses are never touched. Any invalid row rejects the whole file (422, with line numbers and reasons, nothing written), so a malformed line can never soft-delete a student.
- **Parser** (`lib/courses/product-progress-csv.ts`): columns by header name (case-insensitive, any order, extras ignored; Email and Product Progress required), tolerates a BOM, CRLF, quoted fields with commas, quotes and line breaks, a percent with or without `%` or decimals, and "Not Started", blank or missing dates.
- **Matching** is by email only, never by name: the member's email, or an active email alias that resolves to it (`member_email_aliases`), through the members and aliases repositories. The response gives counts (rows read, imported, matched, unmatched, ambiguous = one email, several members) and lists the unmatched emails back to the admin (not logged). Unmatched and ambiguous rows are still kept in Bronze, so they apply later if the member appears or the duplicate is merged.
- **Read for the catch-up:** `memberProductProgress(db, repos, memberId, courseKajabiId)` returns a member's imported percent, logins and dates for a course (or null). If the report lists several of the member's addresses, the highest percent wins.

**Turning a percentage into marked lessons is a separate step, not built** (docs/TODO.md, "Catch-up from imported Kajabi progress"): when Self-Editing Academy migrates, the member sees what Kajabi said (for example 62%) on the course outline and confirms "mark everything up to here as done". The percentage never completes lessons on its own, because it cannot say which ones were done.

### Per-lesson capture and Silver step (built; the capture dry-ran on a real product 2026-10-30)

**What `--probe` showed (2026-10-29; field names and types only).** Both are session-authenticated `/api/client/...` calls on `app.kajabi.com`, the ones the Product Progress report pages make:

- **Roster:** `GET /api/client/reports/product_progress/{productId}?productId=…&send_to_background=…&site_id=…` returns `{ count, filters, segments, status, members[] }`; each member has `contact_id`, `member_id`, `email`, `name`, `percent_complete`, `sign_in_count`, `start_date`, `last_request_at`. Whether it pages is unknown, so the capture compares `count` with what it got.
- **One student:** the same path plus `/members/{memberId}` returns `{ member, product{ title, total_progress, categories[] } }`. Each `categories[]` entry (a module or week, nested by `parent_category`) has `posts[]` with `id`, `title`, `completed`, `completed_date` (a date or a timestamp), `progress_percent`. One response already holds every week, so nothing is clicked.

**What the first real dry run showed (2026-10-30, a product with 41 students; counts only).** All 41 students were captured with no failures, 2,132 lessons listed (1,088 completed), and none of the lessons was missing from Bronze, so Kajabi's post id does match `kajabi_course_lessons.kajabi_id`. Two things the probe could not show, learned the hard way and now handled: (1) Kajabi builds the roster report in the background, so the page's first roster answer can be empty (`send_to_background`, a `status`), and the capture waits for a response that has students and asks again at the same address; (2) the per-student request answers 401 to a plain in-page `fetch` even when the window is logged in, so the capture copies the headers of the page's own successful roster request (never logging their values) onto each student request. Roster paging was not an issue at 41 students; whether a much larger product pages is still unknown (the capture warns when `count` differs from what arrived).

**Capture: `npm run courses:content -- --course <kajabi-course-id> --progress [--apply]`** (`scripts/kajabi-course-content.ts`, `lib/kajabi/progress-run.ts`, `lib/kajabi/progress-capture.ts`). Same browser login as the lesson capture, dry run unless `--apply`. It opens `/admin/sites/{KAJABI_SITE_ID}/reports/product_progress_report?productId={courseId}`, records the roster response the page makes (this also gives the exact URL and query string), then fetches each student's URL (same origin, path + `/members/{id}`, same query) with `fetch` inside that page, two at a time with a short pause, one retry, and stops on a 401. It prints counts only (students, lessons, rows written, unchanged, removed, failures), never names or emails. **The in-page `fetch` is unverified**: no one could log in to Kajabi while it was written. If Kajabi refuses it, the message names the status and the path (with the student id masked) and nothing for that student is written; the first dry run is the test.

**Bronze.** The roster goes to the existing `bronze.kajabi_product_progress` through the same save function as the CSV upload (`lib/courses/product-progress-store.ts`), so the two cannot disagree and the CSV card stays as a fallback. A roster whose `count` differs from what it sent removes no one. Lessons go to the new **`bronze.kajabi_lesson_progress`** (`course_kajabi_id, email, kajabi_lesson_id`, Kajabi contact and member ids as text, `completed`, `completed_at`, `percent`, `captured_at`, `deleted_at`; admin read, service role write). Each student is a snapshot: changed lessons are updated, lessons no longer listed are soft-deleted, an unchanged capture writes nothing, and a student whose report failed, lists no lessons or is for another student writes nothing. A bare completion date is read as noon in `ORG_TIMEZONE`. The Kajabi post id is expected to equal `kajabi_course_lessons.kajabi_id`; the summary counts captured lessons Bronze does not have, so a mismatch shows up as a large number there.

**Silver: `POST /api/process/course-progress`** `{ "course": "<slug>", "dryRun": true }` (admin; `lib/courses/progress-import.ts`). Insert-only, because Hub progress is member-written:

- For each completed, live Bronze row it finds the member by email or active alias (never by name; an email several members share is skipped), requires a `course_access` row that has not ended, and finds the lesson by Kajabi source key.
- It inserts a `lesson_progress` row with Kajabi's `completed_at`, position 0 and `imported_from = 'kajabi'` (so imported rows can be told apart and removed), only when the member has no row for that lesson. Any existing row, completed or not, is left alone: an incomplete one may be one the member un-completed, which cannot be told from a started one. It never lowers, overwrites or removes anything, writes no `member_activities`, and running it twice inserts nothing the second time.
- Counted, not written: students with no Hub member, ambiguous emails, no or ended access, completed lessons with no Silver lesson (they apply on a later run once synced).
- Imported completions count wherever `lesson_progress.completed_at` is read (course progress, the roster and continue-watching views). No badge rule reads `lesson_progress` today.

Order: run step A and `/api/process/courses` (so lessons and `course_access` exist), `--progress`, then this.

### Design, if per-lesson data is found


- **Bronze `bronze.kajabi_lesson_progress`**: one row per `(contact reference, kajabi_lesson_id)` with `completed_at` (nullable), `position_seconds` (nullable), `percent` (nullable, if only that is given), `raw_payload`, `fetched_at`, `deleted_at`. Upserted on the natural key; a row missing from a fully successful fetch is soft-deleted, and a failed or partial fetch deletes nothing (as in the other Bronze imports). Service role only, since it is member data.
- **Identity**: Kajabi contact id (or email as a fallback) to `members` through the members repository (`kajabi_id`, then canonical email), **never by name**. Rows that match no member are counted and kept in Bronze, not guessed; they apply later if the member appears.
- **Silver**: a step after `course_access` (so a member only gets progress for a course they can open) maps Kajabi lesson ids to `course_lessons` and **inserts missing `lesson_progress` rows only**. It never overwrites a row the member already has, never lowers or removes a `completed_at`, and keeps the earlier `completed_at` when both exist. Hub progress is member-written and Local (never reprocessed), so this is an insert-if-absent merge, not DELETE + INSERT; re-running is a no-op. Mark imported rows (a `source` column, `kajabi_import` or `hub`, via a migration) so they can be told apart and a bad import is reversible.
- **Orphans**: a Kajabi lesson with no Silver lesson (deleted, or still a draft) is skipped and counted; once that lesson is synced, the next run picks up its progress.
- **Access and launch**: only for members with a `course_access` row. For a course not yet open in the Hub (`launch_at`), the import can run early so members arrive with progress on day one, but nothing shows before launch. Cohort courses (`courses.kind = 'cohort'`) would also need the member's cohort and level, which an import does not carry; defer that until a cohort course is built.
- **"Complete" means Kajabi's mark, not 90%.** Kajabi completion is an explicit "Complete" click (or the lesson's own rule); the Hub completes at 90% of the playhead or by the button. Take Kajabi's completed flag as complete, with `completed_at` from Kajabi if given, else the fetch date. Never convert a percentage into complete. A last position is imported only if Kajabi gives seconds, and only when the Hub row has none.
- **Activity and analytics**: imported rows do not write `member_activities` (they are not Hub viewing), so the engagement score and Activity Log are not inflated.
- **Privacy**: progress is member data. Nothing real in the repo, PR or docs; tests use fake members; reports are counts and shapes. The import takes its input from outside the repo (the browser session or a downloaded CSV kept out of git).
- **Tests** (per `CLAUDE.md`): Bronze idempotency (first import, re-import without duplicates, changed data updates, soft delete only after a full fetch); Silver reprocessability (insert-if-absent, never overwrites newer Hub progress, orphan lessons and unmatched members skipped, no access means no rows); a parser test over a fake fixture; and a pgTAP check that the Bronze table is service role only.

### Questions (decided 2026-10-28)

1. **Which course moves first after The Ready Writer?** Self-Editing Academy.
2. **Is there a per-student source?** Yes, the Product Progress report CSV: percent, logins, start date and last activity. Not per lesson (per-lesson detail on a student's page is unverified; see above).
3. **Is the member-facing "catch me up" acceptable on its own where there is no per-lesson source?** Yes. For percent-only data it is the way, with the member confirming.
4. **Should imported completion count toward badges and course-completion nudges?** Yes. This applies when the catch-up writes `lesson_progress`.

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
- **One model for imported and Hub-owned courses: settings in, state out** (migration `20270401000000`). A module and a lesson each store their **own setting** (`publishing_option`), and the **state** members get (`open`, `coming_soon`, `hidden`) is worked out from them by one rule, the same for both owners; only `courses.source` differs, and it is the switch that locks editing (the database policies key on it). Whether a **course** is available to members at all is a separate switch, `courses.is_draft` (Publish / Unpublish on the course page, for both owners), and is not part of the item rule: items work out their state as if the course were open, and a draft course is simply not reachable. A module or lesson can **follow** what is above it (`inherit`: what a new Hub-owned item starts as, so nothing is set row by row), or have its own (`draft`, `published`, `locked`; `scheduled` and `drip` are kept for imported rows, and need a date or delay before the editor offers them: `docs/TODO.md`). **The rule:** an item's own setting gives its visibility (published is open; locked or drip is coming soon; a draft, no setting or anything unknown is hidden), `inherit` is whatever is above it, and nothing is more visible than what is above it (for a top-level module or a lesson in no module there is nothing above, so it is limited by nothing). It is `itemState` and `planFullTree` in `lib/courses/visibility.ts` for the Kajabi sync, and `course_item_state` and `recompute_course_states` in the database for Hub-owned courses, with the same cases tested in both (`tests/lib/courses-visibility-rule.test.ts`, `supabase/tests/database/course_publishing_settings.test.sql`). Kajabi rows keep whatever Kajabi says (the sync stores it in `publishing_option` beside the state); the editor changes a Hub-owned item with `set_course_item_status` (admin, Hub-owned only, `unsupported_status` for what isn't offered). **Nothing is refused for what is above an item**: a lesson, or a whole section, can be marked Published under a draft module, and waits, hidden, until what is above it is switched on. That is the workflow: prepare a section, mark everything in it Published, then open or close all of it with the section's own setting alone (and Kajabi does the same: "Meet Your Instructor" is Published inside the draft module "Welcome to the Quill & Cup 180!"). The row says what is holding it ("Inside “Welcome…” (Draft)"). Changing a setting is **one audit entry for the thing changed**; the states underneath that merely follow are not audited row by row (`docs/ACTIVITY_AND_AUDIT_LOG.md`, "Record the intent, not the noise"). The Hub outline of a Hub-owned course is explained by the same `explainCourse` as an imported one's, so the reasons read alike ("Follows “Module 1”", "Inside “Module 2” (Locked)").
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
- **D, media: images** (`lib/courses/images.ts`, same button and route as the downloads). Kajabi's course cover (`courses.thumbnail_url`), module posters (`course_modules.poster_url`) and lesson thumbnails (`course_lessons.thumbnail_url`) were hotlinked; the step stores each as a shared **media library** image (`docs/MEDIA_LIBRARY.md`; tags `kajabi` and the course slug, the Kajabi link as its source) and records it as `thumbnail_asset_id` / `poster_asset_id` on the row, plus `*_source` (the Kajabi URL without its query string). A re-run skips an image whose source is unchanged (links are signed, so the query string is ignored), stores a new image when it changed (removing the old one from the library once nothing shows it), clears the image Kajabi dropped, and removes this course's Kajabi images that no row shows. A lesson and its module that use the same link share one library image, fetched once. Silver reprocessing never writes the asset columns, so images survive it. Members never touch the bucket: pages show `/api/courses/image/<kind>/<id>`, which needs a courses user and keeps a draft's image for staff acting as themselves; until the copy has run, the pages fall back to the Kajabi URL (`courseImageSrc`). The first version copied into a private `course-images` bucket (`*_path` columns); those images were moved into the library on 2026-10-30 and the columns dropped (migration `20270305000000`); the empty bucket is deleted through the Storage API or the dashboard, since SQL can't. **The course's "hero" banner** (behind its title in Kajabi; not the thumbnail, and not in the public API or the admin product page) has a pipeline but no source yet: `bronze.kajabi_courses.hero_image_url` (migration `20270221000000`; the API import never writes it) is copied by processing to `courses.hero_url`, then stored like the cover (`hero_asset_id`/`hero_source`, served as `/api/courses/image/hero/COURSE_ID`), and the course page draws it behind the title under a dark overlay (a course without one, like The Ready Writer, keeps the plain band). Where it would come from is in the TODO "Course Hero Image".
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
  - **Staff watch stats (built):** `/admin/courses/<course id>/stats` lists each lesson with a video (viewers, average share watched, viewers who covered 90%+, a small engagement graph), and `/admin/courses/<course id>/stats/<lesson id>` has the full view: the numbers, an **Engagement panel** (`EngagementPanel`: Kajabi's heatmap and a Wistia-style engagement graph in one). Per moment of the video it shows three counts on one axis, each stricter than the last, so **people <= plays <= times watched**: **times watched** (every pass over the moment, a rewind or replay counting each time: the area), **plays** (visits, i.e. player sessions, that watched it, so rewinding inside a visit is still one) and **people** (different members, each once however often or on however many visits). One person watching a part twice in one visit is 2, 1, 1; coming back another day is 2, 2, 1; with nothing replayed the three lines coincide. The video's own frames are the backdrop (signed Mux thumbnails, one token per slice since Mux wants a signed still's `time` inside the token's claims, not the URL): moving the pointer or the arrow keys shows the still from that moment, a vertical line, and a tooltip with the time, the three counts and the share of plays that watched it. The frames can be switched off with the panel's checkbox or the `showFrames` prop (a plain dark panel with the same chart; also what it falls back to when stills can't be signed), and a table view has every value. All three counts are measured the same way, as how much of the slice was covered (a slice covered half by one person is 0.5 on each, not a whole person), which is what keeps people from ever exceeding times watched. Also shown: how it was watched (playback speeds, captions on, playing in the background). Each stat tile opens to its definition. A **play** is one visit (player session) in which the video was played, so the Total plays tile counts visits, and the same member returning another day is another play (and still one *unique* play over the range). **Engagement** is Kajabi's: total watch time / (total plays x video length), where a **play** is a player session (one visit to the lesson) with at least one stretch, so a member returning another day is another play. **Play rate** is plays / views, where a *view* is the player appearing for a session: the player sends a **`viewed` marker** when it mounts (a row in `video_watch_segments` with `kind = 'viewed'`, a point at 0, `client_segment_id` = the player session id so a resend is a no-op, and the browser's `user_agent`), whether or not anything is played. Anything counting stretches filters on `kind = 'watched'`; a session with stretches counts as viewed even without a marker, so a marker that never arrived (a dropped request) can't push play rate above 100%. The lesson page also lists the **views** (`ViewerList`): one row per player session, newest first, with the **member's name**, a bar of which parts of the video they covered and the percent, and on opening a row the device (from the user agent, via `describeDevice`) and how long they played; "Load more" asks for another 20 (`?limit=`). Opening a row also shows **where the visit came from** (place and raw IP): not stored with the video data, but looked up from the access log as the member's latest located `access_events` row before the visit (see `docs/ANALYTICS.md`, "Course viewing data"), "Not recorded" when there is none. The marker is first-party course data like the stretches, not a consent-gated analytics event (see `docs/ANALYTICS.md`, "Course viewing data"). **Over time** (`TimeSeriesSection`, `lib/courses/watch-timeseries.ts`, pure): like Kajabi's Analytics modal, one metric by day, week (Sunday first) or month over a date range: Today, Last 7/30 days, Last and This month/quarter, This year, Last 12 months, All time, or custom dates, all in the organisation's timezone as whole local days. The metrics: **Total plays** (visits with a stretch), **Unique plays** (different members who played, each once), **Unique viewers** (different members who opened the video, played or not), **Play rate** (plays / views), **Engagement rate** (watch time / (plays x video length)) and **Hours watched**. Each visit counts on the local day it *began*; the header total is for the whole range (unique counts and rates don't add up from the points); every day in the range is a point, zero where nothing happened; a daily range over 400 days is shown by week. It is a plain GET form (`?metric=&range=&by=&from=&to=`), so a view is a shareable link, and "Load more" keeps the settings. Kajabi's "location" filter (which page the video is on) has no equivalent: our segments belong to a video, not to a lesson. The maths is `lib/courses/watch-stats.ts` (pure; times are video time, stretches are clipped to the video's length, and the graph is at most 100 slices), the reads are `lib/courses/watch-stats-data.ts` (service role behind `requireAdminPage()`, paginated). Staff members' own viewing (admins' member records) is left out by default, since it is test data (`?staff=1` includes it). A per-member view is a follow-up.
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

**Public lesson preview** (built 2026-10-31): a link to a lesson shows a good card even to someone signed out, to whet the appetite. The proxy (`lib/supabase/middleware.ts`) rewrites a signed-out visit to `/courses/<slug>/lessons/<lesson id>` to `/lesson-preview/<slug>/<lesson id>` (`app/lesson-preview/`, outside the member route group; the address in the browser doesn't change, and it still remembers the lesson so signing in brings them back). That page shows the course title, the lesson title, its excerpt (about 160 characters of the text) and its thumbnail with a "Sign in to watch" button, and carries the Open Graph and Twitter tags (large image card) that Slack, iMessage and social previews read; it is `noindex`. **Never** the video or the full text. A lesson is public only when a member could open it today (`lib/courses/public-preview.ts`): the `courses` feature is on **for everyone** (the global switch, not a segment or a preview), the course's opening date has passed, and the lesson and every module above it are open (not coming soon, not a draft). Otherwise the visitor gets the login page, as before, so nothing is exposed that wasn't. `/api/courses/image/lesson/<id>` serves the thumbnail to anyone under the same rule (cached publicly for an hour, so a lesson that stops being open can still be fetched for up to an hour); every other image stays behind sign-in. Kajabi's own thumbnails are public CDN images, so this exposes no more than Kajabi did. The builder's "Copy link with thumbnail" copies the lesson address as a clickable picture, enabled exactly when the lesson is public.

**Built:** the three pages, behind the `courses` feature flag (off; migration `20261111000200`). They read through a service-role client scoped to the *effective* member (`lib/courses/member.ts`), not RLS, because sudo acts for another member and an ended-access member still sees their course; staff open every course only as themselves, and in sudo the member's own access applies. Mark complete is a server action that checks access itself, writes as the member, and is read-only in sudo. Lessons that can't be opened (no access, ended, coming soon) redirect to the course page, which explains why. The player is signed Mux playback with speed and captions remembered per browser, resume position and watch segments (see Watch tracking). **Not built yet:** the speed setting per member, completion from the segments, a per-member stats view, downloads (they need step D's file copy), the "Videos" admin screen. "Continue watching" on the dashboard is built (`loadContinueWatching` in `lib/courses/member.ts`, `components/courses/ContinueWatchingCard.tsx`). `/admin/player-spike` can be deleted once the lesson player has been seen working with a real video.

Progress is counted against *available* lessons, since the course grows as lessons are released. Light and dark themes, keyboard access and mobile layout are part of "done", not polish.

## Lesson comments

_Status: design proposal, not built. Reverses the earlier "Not planned" call: Ania wants comments on lessons, mainly so instructors can see and answer questions where they are asked. The open questions at the end need a decision before any build._

### Recommendation: their own Local tables

Three options were weighed:
- **Own Local tables (recommended).** Comments belong to a lesson, follow course access, and need instructor badges, an "unanswered" view and rules tied to access. Those are course rules, not chat rules.
- **Reuse `chat_*`.** Chat mirrors Slack channels (`docs/SLACK_BRIDGED_CHAT.md`): its membership, privacy (restricted channels, break-glass) and bridge model don't fit "everyone with course access", and a channel per lesson would flood the sidebar.
- **A Slack thread per lesson.** Needs a channel and bot posts per lesson, shows content only to people who connected Slack, and ties course access to Slack membership.

We still copy chat's good parts: soft delete, tombstones, and the escaping and name-resolution helpers (`lib/chat/render.ts`, `lib/chat/names.ts`). Nothing is bridged to Slack; staff hear about new comments through notifications and the admin queue.

### Data model

New Local tables (never reprocessed), text ids per `CLAUDE.md` "New Tables and Ids", grants and RLS in the same migration (`supabase-table-grants.md`):
- **`lesson_comments`**: `id` (`cmnt_`), `lesson_id` (text FK to `course_lessons`), `member_id` (author, text FK to `members`), `parent_id` (null for a top-level comment), `body` (plain text, 1 to 4,000 characters), `is_staff_reply` (set by the server from the author's role when posted, so the badge survives a later role change), `created_at`, `edited_at`, `hidden_at`, `deleted_at`, `deleted_by`.
- **`lesson_comment_reports`**: `id`, `comment_id`, `reporter_id`, `reason`, `created_at`, `resolved_at`, `resolved_by`. One open report per reporter and comment.
- **`lesson_comment_follows`**: `(member_id, lesson_id, following)`. Posting or replying follows implicitly; rows exist only for explicit choices and unfollowing is `following = false`.
- **`lesson_comment_reads`** (phase 3): last-seen per member and lesson, for unread counts.

Decisions:
- **Prefix and tier.** Notifications link to a comment, so its id is shown to people. A Tier 2 id must not be exposed (`CLAUDE.md` "Resource ID Tiers"), so `lesson_comments` needs a Tier 1 prefix agreed with the owner (`cmnt_`: `cmt_` is already `prickle_commitments`); reports, follows and reads stay Tier 2.
- **Threading depth: one level.** A reply points at a top-level comment; replying to a reply attaches to the same parent, quoting the author's name. Alternatives: flat; unlimited nesting (unreadable on a phone).
- **Edit window: 15 minutes**, then locked (the author can still delete). Edits set `edited_at` and show "edited". Alternative: always editable, which leaves replies out of context.
- **Soft delete** with `deleted_at`. A deleted comment with replies shows a tombstone ("Comment removed"); without replies it disappears. Text is cleared by a retention job (below), not at delete time, so staff can undo.
- **RLS.** Read: members with *current* `has_course_access(course_id)` for the lesson's course, and admins. Insert: the same members as themselves. Update/delete: own rows (edit window, soft delete); admins act through server actions. Reports: insert own, read admin only. Follows and reads: own rows. Everything is **read-only in sudo** (an admin previewing as a member can read, never post, report or follow). Server actions write through the service-role client scoped to the effective member like `lib/courses/member.ts`, with RLS as the second layer.
- A lesson the member can't open ("Coming soon", hidden) shows no comments.
- Lessons already upsert on their source key, so comments stay attached across migration re-runs.

### Who can comment

- **Members with current access to the course.** Admins can always read and comment. A per-course instructor list is a later option, if Ania wants non-admin helpers.
- **Ended access: the whole course is hidden** (decided 2026-10-28), so its comments go with it. This is stricter than today's course pages, where an ended course still lists with its progress and closed lessons; decide whether that card should go too.
- **Instructor replies** carry an "Instructor" badge from `is_staff_reply`. Alternative: badge by current role at render time, which relabels old comments if a role changes.

### Moderation

- **Report**: any member can report a comment with a short reason; the author is never told who.
- **Hide vs delete**: staff can hide (reversible, tombstone for members) or delete (soft delete). Both write the audit log (`docs/ACTIVITY_AND_AUDIT_LOG.md`): who, which comment, which action, why. Authors can delete their own.
- **Rate limits** in the server action, not the client: 5 comments a minute and 30 an hour per member.
- **Spam and links**: links render as plain links with `rel="nofollow noopener"`; a comment with more than two links is held for staff review (visible to its author only). No profanity filter in phase 1: reports and the queue cover it, and filters mangle writing talk ("kill your darlings"). Alternative: a blocklist that holds, never rejects.
- Admin pages start with `requireAdminPage()` and staff actions with `requireAdminAction()` (`CLAUDE.md` "Admin Route Protection").

### Safety of rendered text

- **Store plain text, render as text.** No HTML and no Markdown in phase 1; React escapes it. Line breaks are kept; only `http(s)` URLs are auto-linked.
- **Mentions** (phase 4): `@name` autocompletes through `EntitySearch` (`reuse-ui-components.md`) and is stored as a token holding the member id, resolved to the current display name at render, as Slack tokens are (`lib/chat/names.ts`). Only people with access to the course can be mentioned; a mention is a notification.
- **Escaping lessons from `CLAUDE.md`**: store text as typed, escape only where a target needs it (Slack: `&`, `<`, `>`), never decode on display. Tests use a name containing `&` and `<`, so a literal `&amp;` on screen fails.
- Comment text never goes into analytics events, logs or Sentry (`docs/ANALYTICS.md`).

### Notifications

Every event is a registry kind sent through `createNotifier` (`lib/notifications/registry.ts`, `sampleMessages` in `lib/notification-test.ts`, an email template in `emails/notifications/`):
- **`lesson_comment_reply`**: someone replied to my comment. Immediate; in-app and Slack on by default, email off.
- **`lesson_comment_instructor_reply`**: an instructor replied to me. A distinct kind so a member can mute others' replies but keep instructors'.
- **`lesson_comment_activity`**: new comments on a lesson I follow. **Daily digest**, opt-in through a "Follow" button, so a busy lesson can't spam.
- **Staff** get new top-level questions in the admin queue and an instructor digest, not a DM per comment.
- Links go to the exact comment (`/courses/<slug>/lessons/<id>?comment=<cmnt_...>`, which scrolls to and highlights it). Not time-sensitive; no link previews. Check the link with the test message (`/admin/notifications`).
- **Rollout**: a new automated sender starts in dry run. A `lesson_comment_notifications` flag with `liveFor` (as in `lib/member-reminders.ts`) logs member id, kind, channels and message and writes no dedup row; then widen: Cody, then staff, then everyone. A member with no reachable channel doesn't consume a dedup claim.
- Opening the thread calls `resolveInAppNotifications` for its notifications.

### UI

- **Where**: a "Comments (N)" section below the downloads on the lesson page, composer first, top-level comments newest first (a new question is seen), replies oldest first. Alternative: a tab beside the outline, which hides comments on mobile.
- **Layout** follows `CLAUDE.md`: a `@container` wrapper and mobile-first styles, no viewport breakpoints inside the content area, check widths either side of each breakpoint. Nothing `fixed` inside an `@container` ancestor.
- **Components**: a shared `CommentThread` in `components/courses/` with a component test; `EntitySearch` for mentions; the existing avatar and relative-time pieces.
- **Accessibility**: a labelled region; the composer has a visible label and a polite character counter; a new comment is announced via `aria-live`; all actions are real buttons reachable by keyboard; focus returns to the composer after posting; tombstones read "Comment removed".
- **Empty state**: "No questions yet. Stuck on something in this lesson? Ask here."
- **Video timestamps** ("at 3:42"): not in phase 1. Useful for questions, but needs a `video_seconds` column and a player seek hook. Add later if Ania mostly teaches through video.
- Relative dates with the full date on hover, in the viewer's zone (`dates-and-timezones.md`).
- In sudo the thread shows with the composer disabled ("Read-only while previewing").

### Analytics

Declared in `lib/analytics/events.ts` with no names, emails or text as properties; posting wrapped with `withAction`:
- `lesson_comment_posted` (`course_id`, `is_reply`, `has_mention`, `is_staff`), `lesson_comment_edited`, `lesson_comment_deleted`, `lesson_comment_reported`, `lesson_comments_viewed` (`course_id`, a count bucket), `lesson_follow_toggled`; notifications are tagged by `createNotifier`.
- **Funnel** in `lib/analytics/funnels.ts`: lesson viewed, comments seen, comment posted, instructor replied. Admin measures: share of lessons with a question, median time to an instructor reply, share of questions answered within 48 hours.

### Admin view

Under `/admin/courses/<id>/comments`, every page starting with `requireAdminPage()`:
- **Unanswered questions** (the likely reason Ania asked): top-level comments with no staff reply, oldest first, per course and lesson, linking to the thread, with "Mark handled" for comments that need no answer.
- **Moderation queue**: open reports and held comments with Hide, Delete and Dismiss, each audited.
- **Per-lesson counts** (total, unanswered) beside the course outline for staff, using `SortableTh` and `DataTablePager`.
- Staff answer on the lesson page itself; the admin view only finds work.

### Kajabi migration

**Kajabi lesson comments are imported (decided 2026-10-30)**, so a course that moves keeps its discussion. Not built: it needs phase 1 (the `lesson_comments` table) first, and a source nobody has looked at yet.

- **Source.** Kajabi's public API has no comments (`lib/kajabi/openapi.yaml`). Like progress, they come from pages a logged-in browser can open, so the capture is a mode of `courses:content` (same browser, dry run unless `--apply`). **What is known (2026-10-30, from screenshots).** Each lesson's member-facing page (`SITE/products/PRODUCT-SLUG/categories/MODULE-ID/posts/LESSON-ID`) has a Comments section with a total (52 on one welcome lesson), a box to post, the comments newest first with the author's name and avatar and a date shown without a year ("on Jun 27"), replies nested one level, and a "Show More" button, so the page pages them. The admin's "Open video comments" and "Open video preview" buttons both open that page. **Not known:** which requests carry the comments, whether they include the author's email (the member page shows only names, and authors are matched by email, never by name), the real timestamps, whether Kajabi marks a comment hidden or awaiting approval, **First step: `courses:content --probe`** on one lesson page (clicking Show More while it records) and on the admin page that lists or moderates comments, then a `--comments` capture written from what they show. The member site is a different address from `app.kajabi.com`, so the browser window may ask for a member login there. **First probe (2026-10-30) of a lesson page:** it made no JSON request for comments, only for the lesson's videos, so the comments are most likely in the page's HTML and \"Show More\" loads an HTML fragment, which the probe did not record (it listed JSON only). The probe now also lists a page's HTML and script requests (by type and path) and describes the structure of the part of the page that mentions comments (element and attribute names, never text), so the next run shows how they are loaded. **Second probe (2026-10-30):** the typed-in address redirected to a login screen; the member page opens only through the admin's preview link. **Decided: there is no admin page that lists comments** (the admin's "Open video comments" and "Open video preview" buttons are both just a link to the lesson's member page), so the member lesson page, reached through that link, is the only source, and the capture would go lesson by lesson: open the lesson in the admin, follow the link, read the page's comments, press "Show More" until it is gone. The probe now records every tab (the link opens a new one), samples the page structure while it records, and says so when it ends on a login. **Third probe (2026-10-31, started from the lesson's admin editor, clicking Preview and Show More).** (1) The preview link is `/products/SLUG/categories/ID/posts/ID?preview_token=...`, which redirects twice; the admin's posts list (`/api/admin/products/ID/posts`, seen in the progress probe) carries each lesson's `urls.previewUrl` and `urls.viewCommentsUrl`, so every lesson's link is available from one admin request, no clicking. (2) The first comments are in the page's HTML; \"Show More\" is `GET /posts/ID/comments/show_more?desc_from=...&per=...`, answered with JavaScript (`text/javascript`), not JSON: a cursor (`desc_from`) and a page size (`per`). (3) The page-structure function returned nothing, a bug (`tsx` injects a `__name` helper the browser lacks), now fixed, and the probe also describes the markup inside any HTML or script response (`describeMarkup`: element, class and attribute names and link paths only), which is where the comment markup should show. **The decisive unknown** is whether the comment markup carries anything that identifies the author beyond the displayed name (a Kajabi member or contact id would map to an email through the Product Progress roster, which has both); without it every imported comment is a name only, which is the decided fallback.
- **Bronze** (raw, replaceable): one row per Kajabi comment (Kajabi id, course, lesson, parent, author email and display name as Kajabi has them, body, posted at, status) with `deleted_at`, re-captured idempotently like lesson progress (changed rows updated, comments Kajabi no longer lists soft-deleted, an unchanged capture writes nothing).
- **Silver** (into `lesson_comments`, never overwriting what members wrote in the Hub): rows with `source = 'kajabi'` and Kajabi's comment id as `source_key` (unique), so a re-run inserts nothing twice. `posted_at` keeps Kajabi's date. Threading follows Kajabi's parent, flattened to the Hub's one level. Author found by email or active alias through the members repository, never by name; an author who is staff gets the instructor badge. Imported comments are not held for review and do not notify anyone, and write no activity.
- **Authors with no Hub member** (left Kajabi, never joined the Hub): **shown by the name Kajabi has** (decided 2026-10-30), the comment kept so the thread reads. If the source gives no email, the author cannot be matched to a Hub member at all (never by name), so every comment would show as a name only, with no profile link and no instructor badge unless Kajabi marks the author as staff; this is why the admin source with emails is preferred.
- **Lessons.** A comment on a lesson the Hub does not have is counted and skipped, not guessed.
- **Counts.** Until the import has run for a course, an admin view of its comments shows "not imported" and not 0, so an unknown is never shown as none.
- **Consent.** The earlier objection was that there is no consent trail for moving a member's words. These were posted by members on the course they bought, to the course's own audience, and move with the course; say so in the launch announcement, and give a member the same delete as for a Hub comment.

### Privacy and retention

- When a member leaves, their comments stay for the thread's sake but show as "Former member" with no profile link after 90 days. On a deletion request the author and text are cleared and replies keep a tombstone.
- Deleted comments keep their text 30 days (staff undo, report evidence), then a retention job clears `body`. Reports, follows and reads are deleted with the member.
- The privacy page and data export list lesson comments. Comments are visible to course members and staff only, never public or indexed, and admins can read them (no break-glass); say so under the composer.

### Phased build plan

1. **Read, post, reply (smallest useful):** `lesson_comments`, RLS, pgTAP, the thread on the lesson page, plain text, one-level replies, edit window, delete own, rate limit, a `lesson_comments` feature flag, analytics events, the unanswered-questions admin list.
2. **Moderation:** reports, hide/delete by staff with the audit log, the queue, held-link review.
3. **Notifications:** follows, reply and instructor-reply kinds in dry run then live, the follow digest, unread counts.
4. **Polish:** mentions, video timestamps, instructor list, counts in the outline, Realtime updates.

### Tests it will need

- `supabase/tests/database/lesson_comments.test.sql` (pgTAP): access-gated read, own-row writes, no anon access, ended access sees nothing, grants (fails without them).
- A repository contract suite run against the Supabase class and the in-memory twin, including more than 1,000 rows.
- Server action tests: unauthenticated, no access, ended access, sudo blocked, rate limit, edit window, length, `&` and `<` in text and names.
- Component tests for the thread (empty state, reply, tombstone, disabled in sudo, keyboard use) and page tests under `tests/components/pages/`.
- Admin auth coverage (`tests/components/pages/admin-auth.test.tsx`), notification kind and `sampleMessages` tests, a dry-run `liveFor` test, analytics declarations, and a retention-job test across a day boundary with the fake clock.

### Decisions (2026-10-28)

1. **Ended access:** the whole course is hidden, so the thread goes with it (see "Who can comment").
2. **Id prefix:** `lesson_comments` is Tier 1 (notification links expose the id), but `cmt_` is already `prickle_commitments` (`lib/ids.ts`, `docs/SHORT_IDS_PLAN.md`). Use **`cmnt_`** instead (chosen by the owner, 2026-10-29; `cmnt_` is not used anywhere). Reports, follows and reads stay Tier 2.
3. **Instructors:** admins only to start; a per-course list later if Ania wants non-admin helpers.
4. **Mentions and video timestamps:** after the first release (phase 4; `docs/TODO.md`, "Lesson Comments on Courses").
5. **Notification defaults:** direct and instructor replies on in Slack and in-app, email off. The daily digest is for members who press "Follow" on a lesson's thread: one summary a day of new comments on the lessons they follow, and nothing unless they follow.
6. **Moderation:** hold comments with more than two links for review; no profanity filter.

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

- **What a member sees after access ends** (to discuss with Ania). Today an ended course still lists on `/courses` with its progress, a note that access ended, and its lessons closed (their links are switched off, so a member can see the outline and their progress but not open a lesson). Lesson comments are hidden with the course. The owner is fine showing the course and its progress indicators, and expects the right answer to vary by course: access for a limited time versus access forever. Needs a per-course setting if it does.

## Decided (2026-10-18)

- Ania keeps publishing in Kajabi after launch, until the builder is good enough. → "Ongoing sync after launch".
- Show the full course plan, with unreleased lessons as "Coming soon". → Lesson-state rules.
- Access is per-course configurable. The Ready Writer is one year and includes membership. → `course_access`, `courses.access_duration`, `programs.includes_membership`.
- Link to (or replace) the existing The Ready Writer `programs` row. → `courses.program_id`.
- **Lesson-text step stays manual** (a local run when Ania finishes a batch); automating it with a stored Kajabi login is not planned. → "Ongoing sync after launch".
- **Released lessons appear in the outline only**, with no notification when they open. The "New lesson" notification is dropped from the post-launch list.
- **Access ending:** membership continues only if the member has subscribed separately, as today. A reminder before access ends, with a prompt to switch to or opt in to membership billing, is wanted but comes later (see "Later").

## Prerequisites (Cody)

All done as of 2026-10-28:

- [x] Mux keys in `.env.preview` too, and the Mux variables synced to Vercel (Preview and Production).
- [x] The env var PR (#102) merged and `pnpm env:sync` run.
- [x] The production Mux webhook for `/api/webhooks/mux` (production logs show its POSTs answering 200). Now declared in `mux-config.yml` (`pnpm mux:config:diff`; `docs/MUX_CONFIG.md`).
- [ ] Create the playback restriction (`pnpm mux:config:push`) and the Mux "checks" environment's test asset for the nightly check (`docs/MUX_CONFIG.md`); neither blocks launch.
- [x] A separate migration token (`MUX_MIGRATION_TOKEN_ID`/`MUX_MIGRATION_TOKEN_SECRET` in `.env.prod`); revoke it after launch.
- [x] Billing alerts in Mux (above $10, $25 and $75).
- [x] GA: Reporting identity is **Blended** (user ID, device ID, then modeled data), not Observed. GA says modeling is unavailable for this property; it turns on by itself once GA allows it, so there is nothing to do.
- [x] Course images copied into the Hub (85 copied) with the admin course page's "Copy images" button.
