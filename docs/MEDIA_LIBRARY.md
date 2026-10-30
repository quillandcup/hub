# Media library

Status: **foundation built** (table, bucket, repository, upload and serving routes, presets; no UI yet). Decisions made with the owner: ids are `media_`; events and the Bookshelf will be public later, so an asset has `is_public`; Amazon ebook covers only for now; the courses workstream is paused, so the foundation lands first. One place for the images the Hub shows, so an image is uploaded once, picked again anywhere, and turned into whatever size a screen or a store needs without anyone cropping by hand.

## Why

Images are handled four different ways today, and none of them can be reused:

| Where | What exists | Problem |
|---|---|---|
| Book covers | Public `book-covers` bucket, `member_books.cover_url`, `lib/bookCover.ts` | The upload is rejected unless it is *exactly* 145x215 px. A member whose cover is Amazon-sized (or any other size) can't use it. |
| Event photos | Private `event-photos` bucket, `event_photos` rows, imported from Google Photos | A gallery per event, not a library: there is no event image to show on the events list and detail page, and nothing to pick twice. |
| Course images | Private `course-images` bucket, `*_path` / `*_source` columns on `courses`, `course_modules`, `course_lessons`, copied from Kajabi by `lib/courses/images.ts` (now in the library; see below) | One bucket and three sets of columns for one job. Every new place that shows an image would add another. |
| Help screenshots | `help-images` bucket | Build artifacts, not content. **Stays out of the library.** |

## Shape

**One table, one private bucket, derived renditions.**

- `media_assets` (a table we own, so a text id from `new_id`; see below): `storage_path` of the **original, never modified** (`originals/<owner member id or shared>/<sha256>.<ext>`, so a retry lands on the same object); `width`, `height`, `mime_type`, `bytes`, `sha256` (the same file uploaded twice is one asset); `title`, `alt_text`, `tags text[]`; `focal_x`, `focal_y` (null = let the cropper decide); `owner_member_id` (null = shared, staff-managed; set = that member's own, e.g. their book cover); `is_public` (served to signed-out visitors too: off until the Bookshelf and events pages are public); `source` (`upload`, `kajabi`, `video_frame`) and `source_key` (the Kajabi URL without its query string, later `<video id>@<seconds>`), which together make imports idempotent; `deleted_at`; `created_by`.
- **Uses are foreign keys, not a join table**: `events.image_id`, `member_books.cover_asset_id`, `courses.thumbnail_asset_id`, `course_modules.poster_asset_id`, `course_lessons.thumbnail_asset_id`, all `ON DELETE RESTRICT`. "Where is this used" is a view over them; deleting an asset that is in use is refused with the list of places. The pages ask for `asset + preset`, never a path.
- **Renditions** are made with `sharp` (already a dependency) from the original the first time a preset is requested, stored under `renditions/<asset id>/<preset>-<hash of the crop settings>.webp`, and served with `Cache-Control: immutable`. Changing a focal point changes the hash, so nothing needs purging. Presets are a typed table in `lib/media/presets.ts` (`event_card`, `event_hero`, `book_cover_shelf`, `book_cover_kdp_ebook`, `thumb`, ...), each with width, height, fit and format.
- **Serving** is `/api/media/<id>/<preset>`; add `?download=1` to save the file. Besides the presets there are `custom` (any size: `?width=&height=` with `&format=jpeg|webp|png` and `&fit=crop|extend|white`, up to 8000 px a side and 40 megapixels, signed-in callers only, rendered each time and not cached) and `original` (the file as uploaded, staff only). Reads are checked per caller: row-level security for signed-in members, or an asset marked public for anyone. Public-bucket URLs stay out: a copyable link is a link we can't change. Gated cases keep their own route (the course image route hides a draft lesson's image from members), which now resolves `asset id` and streams from the media bucket.

### Ids

Asset ids appear in URLs (`/api/media/<id>/...`), so by `CLAUDE.md` ("Resource ID Tiers") the table is **Tier 1**. The prefix is `media_`, not `img_`, because the table is the catalog for more than images (next section). It is in `ID_PREFIXES` and `docs/SHORT_IDS_PLAN.md`.

### One catalog

`media_assets` is the one place for everything a person picks, searches, tags and reuses. `kind` says what a row is (`image`, `video`, `file`); only `image` exists today, and the app creates nothing else yet. What is shared by every kind: the id, title, tags, owner, `is_public`, `source` / `source_key`, soft delete, the usage view and the picker. What is kind-specific stays out of the way:

- **Image**: the bytes in the `media` bucket, `width`, `height`, `focal_*`, `fits`, and the renditions.
- **Video** (course videos, Mux): the bytes and playback stay in Mux and `videos` (status, quality, captions, signed playback). The catalog row is 1:1 with a `videos` row (`videos.media_asset_id`, or the reverse) and adds what the library gives everything: a title, tags, an owner, usage tracking and the picker. The migration that brings videos in relaxes the image-only `NOT NULL`s (`storage_path`, `sha256`, `bytes`, `mime_type`, `width`, `height`) with a `CHECK` per `kind`, so an image still must have them. A video's poster is an image asset (`source = 'video_frame'`).
- **File** (PDF downloads, lesson attachments): bytes in the bucket like an image, no renditions.

So there is no second library to merge later: a new kind adds one migration and one repository branch, and the picker and `/admin/media` take a `kind` filter. The existing `videos` and `course_lesson_files` tables are not rewritten by the library; they gain a catalog row when their feature (the course builder) needs to pick them.

## Automatic sizing, and book covers for Amazon

The goal is that nobody opens a cropping tool. Upload one cover; the Hub makes every size from it.

1. **Same shape (within ~5%)**: scale and centre-crop. Done.
2. **Different shape**: don't guess silently, because a crop can cut the title. Show the three results side by side and preselect one: *crop* (sharp's `attention` strategy finds the busiest region, or the focal point if the uploader set one), *fit with extended edges* (pad to the target ratio with a background taken from the image's own edge colour, so nothing is cut), or *fit on white*. The choice is saved on the asset per preset, so it is one click once.
3. **Too small**: say so ("Amazon wants at least N px on the shortest side; yours is M") rather than upscaling. A blurry cover accepted silently is worse than a message.
4. **Output**: for the book page, a "Download for Amazon" button on the book that returns the `book_cover_kdp_ebook` rendition as a JPEG.

KDP numbers are checked against [Amazon's cover guidelines](https://kdp.amazon.com/en_US/help/topic/G6GTK3T3NUHKLEFX) (2026-10-29) and live only in `lib/media/presets.ts`: JPEG preferred, ideally 2560 px high by 1600 wide (1.6 : 1), at most 10000 px a side and 50 MB. KDP's own pages disagree on the smallest size (500 px on the longest side on one, 1000 x 625 on an older one), so the stricter is enforced: a smaller source gets a 422 with the reason instead of a blown-up cover. **Paperback and hardcover are a different problem**: the printer needs a full wrap (back, spine, front) whose spine width comes from page count and paper type. Cropping a front cover can't produce that. Out of scope for v1; it would be a cover template that takes the front cover plus page count. Note it in `docs/TODO.md` when v1 ships.

The 145x215 rule goes away. `book_cover_shelf` (2x for retina) is derived from whatever was uploaded, and existing covers are backfilled as assets so the Bookshelf keeps working.

## Picking and reusing

- `components/media/MediaPicker.tsx`: a dialog with a grid, search over title and tags, an Upload tab, and recently used first. It follows `reuse-ui-components`: it takes props (`value`, `onChange`, `scope`, `preset`, the aspect it will be shown at) and never reaches into app state; the preview uses the preset, so you see the crop you will get.
- **Scope**: staff pick from the shared library and upload to it. A member picking a book cover sees only their own uploads, never the shared library.
- **"Hedgies on First", pick it again**: tags and a title do this in v1 (search "hedgies"). A default per recurring series (so each week's event gets it without anyone choosing) is a follow-up; it wants an image on the series or the prickle type, with the event overriding it. Decide where when events are next touched.
- `/admin/media`: browse, rename, tag, set a focal point, see where each is used, delete the unused. Admin pages follow `requireAdminPage()`.

## The Kajabi course images (done)

`lib/courses/images.ts` (`copyCourseImages`) keeps its logic (download, validate type and size, skip when the source link is unchanged, clear what Kajabi dropped, sweep leftovers) and now writes to the library:

- Each image is a shared library image (`source = 'kajabi'`, `source_key` = the Kajabi link without its query string, tags `kajabi` and the course slug), recorded on the course, module or lesson as `thumbnail_asset_id`, `hero_asset_id` or `poster_asset_id`; `*_source` stays as the cheap "has it changed" check. The same link on a lesson and its module is one library image, fetched once.
- A changed source stores the new image and removes the old one from the library once nothing shows it. An image Kajabi dropped is cleared the same way. Leftovers (this course's Kajabi images that no course, module or lesson shows) are removed at the end of a run. The library's usage list includes courses, modules and lessons, so a course image can't be deleted in `/admin/media` while it is shown, and the nightly sweep never clears the files of one that is.
- **The move**: a row that still has an old copy in the `course-images` bucket (`*_path`) gets that copy moved into the library on the next run, with no request to Kajabi, and the old object removed. So nothing depends on Kajabi staying up for this.
- Access is unchanged: members only ever see `/api/courses/image/<kind>/<id>`, which needs a courses user and keeps a draft's image for staff acting as themselves; it now reads from the library when the row has an asset, falls back to the old bucket copy, and `courseImageSrc` falls back to the Kajabi link before the step has run.
- Because course images are shared library images, they show up in `/admin/media` and the picker (search `kajabi`, or a course's slug). That is the point: a lesson thumbnail or poster can be replaced with any library image once the course builder exists.

Still to do, once every course has been through the step: drop the `*_path` columns and the `course-images` bucket, and the code that reads them (`docs/TODO.md`).

## Older covers

Covers uploaded before the library were cropped to 145 x 215 into the `book-covers` bucket, or are a link to a picture somewhere else. `pnpm covers:adopt --env <file>` (`scripts/adopt-book-covers.ts`, `lib/media/adopt-covers.ts`) moves them in: each becomes its member's own library image (the same picture twice is one image) and the book or project is pointed at it, only if its cover hasn't changed meanwhile. Without `--apply` it reads every cover and reports counts: how many came from the old bucket and from links, how many are big enough to be an Amazon cover as they are (a 145 x 215 cover isn't; a link to a bigger picture often is), and which can't be read and why. A link is fetched with care (`lib/media/fetch-cover.ts`: public addresses only, checked on every redirect, a size and time limit, and the result must still decode as an image). The old file in the bucket is left. Safe to run again.

## Housekeeping

`/api/reconcile/media` runs nightly (`lib/media/sweep.ts`): it removes uploads started through the signed URL and never confirmed (over a day old), and the files of images deleted over 30 days ago (original and renditions; the row stays, with `files_removed_at` set, so a title and tags aren't lost). An image something still shows is skipped. Deleting in `/admin/media` is therefore undoable by staff (clear `deleted_at`) for 30 days.

## Later: poster and thumbnail from a video frame

No schema change. The course builder's picker gets a "from the video" tab that asks Mux for a frame (`image.mux.com/<playback id>/thumbnail.jpg?time=<s>`, see `docs/MUX_CONFIG.md`), stores it as an asset with `source = 'video_frame'`, `source_key = '<video id>@<seconds>'`, and sets the poster or thumbnail from it. The same frame twice is one asset.

## Upload safety

- Decide the type from the bytes (`sharp(...).metadata()`), not the browser's `Content-Type` or the file name. Accept JPEG, PNG, WebP, GIF, AVIF.
- **HEIC (iPhone photos) is converted to JPEG on upload** (`heic-convert`, libheif in JavaScript, which runs in Node without native code). The JPEG is then the stored original; the HEIC is not kept. A file that claims to be HEIC and can't be decoded is refused.
- **No SVG, for now.** SVG is XML that can carry `<script>`, and a stored file served from our own origin would run it. We never serve originals to pages (renditions are re-encoded rasters), so accepting it to rasterize would be safe, but sharp's SVG decoder (librsvg) also follows references inside the file, which wants a hardening pass first; and nothing needs it yet (photos, covers, thumbnails). It becomes worth doing for logos on the marketing site, where the vector itself should be served: then it needs sanitizing (strip scripts and external references) and a `Content-Security-Policy: sandbox` response.
- Apply EXIF orientation, then **strip metadata**: phone photos carry GPS. The original keeps its bytes as uploaded in storage, but the renditions are always stripped, and nothing serves the original to a page.
- Cap input (bytes and pixels: `limitInputPixels`) before decoding, so a decompression bomb can't take down the function.
- `POST /api/media` takes `multipart/form-data` for files that fit a request body (Vercel allows about 4.5 MB). Bigger ones go to a signed URL from `POST /api/media/uploads` and are then confirmed with `POST /api/media { uploadPath }`, which validates what was stored and moves it into the library.

## Build order

Steps 1, 2 and 3 are done (book covers, below): the picker, event covers, and `/admin/media` (search, upload, edit title, alt text, tags and public flag, click to set the focal point, choose how a picture that isn't cover-shaped fits, see where it's used, download the original, the Amazon cover or any size, delete with a refusal while something shows it).

Each is its own PR, small enough to review.

1. **Foundation**: migration (`media_assets`, bucket, grants, RLS, usage view), `MediaRepository` (interface, Supabase class, in-memory twin, contract suite, guard-test entry), `lib/media/` (validate, presets, render), upload route, `/api/media/<id>/<preset>`, tests with fixture images (including an EXIF-rotated one and an oversize one), pgTAP for the table and bucket.
2. **Picker, `/admin/media`, events**: `MediaPicker`; `events.image_id`; the image on the events list and event detail page; analytics events (`media_uploaded`, `media_picked`, `media_reused`) declared in `lib/analytics/events.ts`.
3. **Book covers** (done): the cover upload on the Bookshelf and Projects forms takes any size and keeps it as the member's own library image. `cover_url` still holds the URL every page shows (`/api/media/<id>/book_cover_shelf` for a new cover; older covers keep their own link), and `member_books.cover_asset_id` / `writing_projects.cover_asset_id` say which asset it is. A published book's cover is readable by every signed-in member (the Bookshelf shows it to all), and by visitors who aren't signed in once `bookshelfPublic` is turned on in `app.config.ts` (the shelf size only); a project's pre-publish cover stays private to its owner. The book form shows the cover's size and a **Download for Amazon** link (the 1600 x 2560 JPEG), or what is missing when it is too small. Replacing a cover removes the old one from the member's library once nothing uses it. The Trackbear import stores each project's cover the same way, at its original size. Older covers were not moved by the upload change: they stay as links until adopted (below), and one that is 145 x 215 cannot be turned into an Amazon cover.
4. **Kajabi unification** (done): `copyCourseImages` writes library images (above), with the idempotency tests in `tests/api/courses/images.test.ts` carried over and extended.
5. **Course lesson thumbnails** through the picker, then the video-frame tab when the course builder exists.

## Open questions

- Events and the Bookshelf are members-only for now and become public with the marketing site: `is_public` and the public path in `/api/media` are ready for it; an asset is switched public when the public page that shows it ships.
- Amazon: ebook covers only (decided); the paperback and hardcover wrap is in `docs/TODO.md`.
- The courses workstream: step 4 is done. Its next image slot (a course builder's poster or thumbnail) is an `*_asset_id` column pointing at `media_assets`, never another path pair.
