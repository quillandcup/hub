# Media library

Status: **foundation built** (table, bucket, repository, upload and serving routes, presets; no UI yet). Decisions made with the owner: ids are `img_`; events and the Bookshelf will be public later, so an asset has `is_public`; Amazon ebook covers only for now; the courses workstream is paused, so the foundation lands first. One place for the images the Hub shows, so an image is uploaded once, picked again anywhere, and turned into whatever size a screen or a store needs without anyone cropping by hand.

## Why

Images are handled four different ways today, and none of them can be reused:

| Where | What exists | Problem |
|---|---|---|
| Book covers | Public `book-covers` bucket, `member_books.cover_url`, `lib/bookCover.ts` | The upload is rejected unless it is *exactly* 145x215 px. A member whose cover is Amazon-sized (or any other size) can't use it. |
| Event photos | Private `event-photos` bucket, `event_photos` rows, imported from Google Photos | A gallery per event, not a library: there is no event image to show on the events list and detail page, and nothing to pick twice. |
| Course images | Private `course-images` bucket, `*_path` / `*_source` columns on `courses`, `course_modules`, `course_lessons`, copied from Kajabi by `lib/courses/images.ts` | One bucket and three sets of columns for one job. Every new place that shows an image would add another. |
| Help screenshots | `help-images` bucket | Build artifacts, not content. **Stays out of the library.** |

## Shape

**One table, one private bucket, derived renditions.**

- `media_assets` (a table we own, so a text id from `new_id`; see below): `storage_path` of the **original, never modified** (`originals/<owner member id or shared>/<sha256>.<ext>`, so a retry lands on the same object); `width`, `height`, `mime_type`, `bytes`, `sha256` (the same file uploaded twice is one asset); `title`, `alt_text`, `tags text[]`; `focal_x`, `focal_y` (null = let the cropper decide); `owner_member_id` (null = shared, staff-managed; set = that member's own, e.g. their book cover); `is_public` (served to signed-out visitors too: off until the Bookshelf and events pages are public); `source` (`upload`, `kajabi`, `video_frame`) and `source_key` (the Kajabi URL without its query string, later `<video id>@<seconds>`), which together make imports idempotent; `deleted_at`; `created_by`.
- **Uses are foreign keys, not a join table**: `events.image_id`, `member_books.cover_asset_id`, `courses.thumbnail_asset_id`, `course_modules.poster_asset_id`, `course_lessons.thumbnail_asset_id`, all `ON DELETE RESTRICT`. "Where is this used" is a view over them; deleting an asset that is in use is refused with the list of places. The pages ask for `asset + preset`, never a path.
- **Renditions** are made with `sharp` (already a dependency) from the original the first time a preset is requested, stored under `renditions/<asset id>/<preset>-<hash of the crop settings>.webp`, and served with `Cache-Control: immutable`. Changing a focal point changes the hash, so nothing needs purging. Presets are a typed table in `lib/media/presets.ts` (`event_card`, `event_hero`, `book_cover_shelf`, `book_cover_kdp_ebook`, `thumb`, ...), each with width, height, fit and format.
- **Serving** is `/api/media/<id>/<preset>`, behind the same caller checks as the feature that shows the image. Public-bucket URLs stay out: a copyable link is a link we can't change. Gated cases keep their own route (the course image route hides a draft lesson's image from members), which now resolves `asset id` and streams from the media bucket.

### Ids

Asset ids appear in URLs (`/api/media/<id>/...`), so by `CLAUDE.md` ("Resource ID Tiers") the table is **Tier 1**. The owner chose `img_` (a video frame is still an image; videos stay their own aggregate). It is in `ID_PREFIXES` and `docs/SHORT_IDS_PLAN.md`.

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

## One plan with the Kajabi course-content work

`lib/courses/images.ts` (`copyCourseImages`) already does the hard part: download, validate type and size, skip when the source is unchanged, remove when Kajabi dropped it, sweep orphans. The plan is to **keep that logic and change where it writes**:

- It creates or finds a `media_assets` row by `(source = 'kajabi', source_key = <url without query>)` instead of writing `*_path` / `*_source`, and sets `*_asset_id` on the course, module or lesson. The skip-if-unchanged check becomes "an asset with this source key exists and is the one referenced".
- The orphan sweep becomes "assets with `source = 'kajabi'` that nothing references", via the usage view, instead of listing a folder.
- **Stop adding columns.** `thumbnail_path` / `poster_path` and their `*_source` twins are the shape to avoid copying (they are in `20270214000300_course_images_bucket.sql`). If the course workstream needs another image slot before the library exists, it adds an `*_asset_id` column pointing at `media_assets`, not another path pair.
- **Data move**: existing objects in `course-images` are re-registered as assets (the files are copied once into the media bucket; Storage can't rename a bucket), the new columns are filled, then the old columns and bucket are dropped in a later migration after the proxy has read from the new place for a release.
- Course image access (draft hidden from members) stays in `/api/courses/image/...`; it only changes where it reads the bytes from.

**Needs agreeing with whoever owns `courses:content`**: that the foundation PR below lands first, and that its next image work targets `media_assets`.

## Later: poster and thumbnail from a video frame

No schema change. The course builder's picker gets a "from the video" tab that asks Mux for a frame (`image.mux.com/<playback id>/thumbnail.jpg?time=<s>`, see `docs/MUX_CONFIG.md`), stores it as an asset with `source = 'video_frame'`, `source_key = '<video id>@<seconds>'`, and sets the poster or thumbnail from it. The same frame twice is one asset.

## Upload safety

- Decide the type from the bytes (`sharp(...).metadata()`), not the browser's `Content-Type` or the file name. Accept JPEG, PNG, WebP, GIF, AVIF. **No SVG**: it can carry script. Reject a HEIC upload with a message to export as JPEG unless the sharp build in production reads it (check; iPhone photos are the likely source).
- Apply EXIF orientation, then **strip metadata**: phone photos carry GPS. The original keeps its bytes as uploaded in storage, but the renditions are always stripped, and nothing serves the original to a page.
- Cap input (bytes and pixels: `limitInputPixels`) before decoding, so a decompression bomb can't take down the function.
- `POST /api/media` takes `multipart/form-data` for files that fit a request body (Vercel allows about 4.5 MB). Bigger ones go to a signed URL from `POST /api/media/uploads` and are then confirmed with `POST /api/media { uploadPath }`, which validates what was stored and moves it into the library.

## Build order

Step 1 is done (this PR).

Each is its own PR, small enough to review.

1. **Foundation**: migration (`media_assets`, bucket, grants, RLS, usage view), `MediaRepository` (interface, Supabase class, in-memory twin, contract suite, guard-test entry), `lib/media/` (validate, presets, render), upload route, `/api/media/<id>/<preset>`, tests with fixture images (including an EXIF-rotated one and an oversize one), pgTAP for the table and bucket.
2. **Picker, `/admin/media`, events**: `MediaPicker`; `events.image_id`; the image on the events list and event detail page; analytics events (`media_uploaded`, `media_picked`, `media_reused`) declared in `lib/analytics/events.ts`.
3. **Book covers**: upload creates an asset owned by the member; `book_cover_shelf` and the Amazon download; remove the exact-size rule; backfill `book-covers`.
4. **Kajabi unification**: `copyCourseImages` writes assets (above), with the idempotency tests in `tests/api/courses/images.test.ts` carried over.
5. **Course lesson thumbnails** through the picker, then the video-frame tab when the course builder exists.

## Open questions

- Is `img_` the right readable prefix (Tier 1, owner sign-off)?
- Are the events list and detail pages members-only? If any part is public, event images need a public-safe route rather than the signed-in check.
- Amazon: ebook only for now, or is paperback/hardcover wrap needed soon enough to design the cover template into step 3?
- Who owns `courses:content`, and are they happy with step 1 landing before they add more image columns?
