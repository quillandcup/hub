# Writer profiles

> **Status:** living. **Last reviewed:** 2026-11-20. Review: yearly. Kept up to date with the code; if it is wrong, fix it.

A member can opt in to a page of their own on the open web, at an address they choose: `/w/<handle>`. Anyone can open it without signing in, and search engines list it. It is the writer's home on the web. This document is the foundation: who a page is for, the handle, the name, and which items of the profile a member opens to the internet, and how a visitor is served. It shows no writing, goals, books or awards yet; those need the three-level visibility control and come in later packages (see `docs/TODO.md`, "Writer profiles: public author pages, Finishers, three-level visibility").

**Default is off for everyone.** A page exists once the member picks a handle, and stays private until they switch it on in Settings, Profile, "Your writer profile on the web". On top of that the whole feature is behind a feature flag (below): until it is on for a member, they do not see the section at all.

## The feature flag

`writer_profiles` ("Writer profiles on the web", `src/lib/features.ts`; switched at `/admin/previews`) decides who can have a page. It is decided **for the page's owner**, never the visitor (an anonymous visitor has no flag), with the same rules as every flag: on for everyone with the global switch, otherwise for members in a linked segment or with their own preview (`membersWithFeature`, `src/lib/features.server.ts`; the helper is `src/lib/writer-profiles-access.ts`).

| Place | Flag off for the owner |
|---|---|
| Settings, Profile, "Your writer profile on the web" and the globe on each item | the block is not shown, and the globe is not offered or accepted (`getMyWriterProfile` says `available: false`); universal search leaves it out (`feature` in `sections.ts`) |
| Claiming an address, saving the name or the separate bio, a level set to the globe, switching the page **on** | refused in the action (`WRITER_PROFILES_NOT_AVAILABLE`). Switching **off** is always allowed |
| `/w/<handle>` and `generateMetadata`, also a given-up handle's redirect | the same 404 as a page nobody has |
| `/writer-profile/preview` | the same 404 |
| `/w/sitemap/<n>.xml` | the page is left out; the owners of one file's pages are checked together (`writerSitemapEntries`: one batched `membersWithFeature` call per file, never a query per page) |
| `/robots.txt` | lists only the sitemap files; it never names a page. The number of files comes from `publicCount`, which does not know the flag, so a file can be empty (valid) |

**The flag never deletes or changes data.** The row, its handle, name, separate bio, every item's level and `is_public` stay exactly as the member left them; the page stops being served and comes back when the flag is on again. The one read that carries the owner is `PublicLookup.ownerId` (and `memberId` in a sitemap entry): server-only, never part of `PublicWriterProfile`. A flag that is on only for some members means a public page can disappear for the others, which is the point of a staged rollout, but it also means a page that was public before the flag existed is hidden until the flag is on for its owner.

## What a visitor sees

Only these, and only what the member chose. The page shows an item only when **all three** are true: the page is on, the `writer_profiles` flag is on for its owner, and the item's level is the globe (`public`; see "Who sees what" below).

- **The name.** Always shown: the display name (`getMemberDisplayName`: the chosen display name), or one of the member's pen names that they marked for the page. The name on the account (for many members the legal name) is offered in "Name shown" as a choice of its own, labeled "the name on your account", and is never picked for them (`writer_profiles.use_account_name`, one choice at a time with a pen name). The list is the display name (if set), the pen names marked for the profile, and the account name; "Add a pen name" under it adds one marked for the profile without leaving Settings. A profile cannot be switched on until one of them is chosen. (A page that was switched on before this rule keeps the name it had.)
- **The photo,** only when its level is the globe. A photo is published only if it is `https` and not from a host listed in `appConfig.writerProfiles.unpublishablePhotoHosts` (Gravatar: its address carries a hash of the member's email), so the public read never carries a Gravatar address. A Gravatar photo reaches the web only as **our own copy**: choosing the globe for it is the member's consent to fetch it once (`copyGravatarPhoto`, `src/lib/members/photo.ts`: the address is built from the member's own email on `appConfig.memberPhoto.gravatarHost` with `d=404`, fetched with the pinned, size-capped `fetchImage`; a 404 means no Gravatar, nothing is stored and the row points to the upload), re-encode it like an upload, store it in `member-photos` at `<member id>/gravatar-<hash>.webp` and write it to `photo_path`. Going back to the lock or house keeps the copy (it is the member's photo from then on, and `Remove photo` deletes it); the public page stops using it because the level is no longer the globe. The photo address is whatever member processing stores (a copy in our storage, a Slack or Kajabi picture); all of those hosts are already in the page's image policy (`appConfig.csp.imageHosts`).
- **The bio.** If the member wrote a separate public bio (`writer_profiles.public_bio`, up to `bioMaxLength` characters, from config), the page uses it, whatever the level of the member bio. Otherwise it uses the member bio, only when its level is the globe. Rendered as text, never as markup.
- **The social links** (Instagram, Facebook, X), each only when its level is the globe, and only over `https`. They are links, drawn with `MemberSocialLinks`, and listed as `sameAs` in the page's structured data.
- **Switching on, said once.** When the member switches the page on, a short note shows the address, says that anything marked with the globe is on the page (name, photo, bio, links, milestones and books), where each is changed, and links "View as a visitor" (`WriterProfileOnNote`, `docs/product/FINISHERS.md`). It lists and controls nothing: each item has its own lock, house or globe where it lives.
- **The milestones,** each one only when its own level is the globe (a "Milestones" strip: the title it earns, the work, the day, the story and the photo the member added; `member_milestones.visibility`, `member_works_pictured_on_web`, which also returns the photo of each step: a private bucket, served by a route that checks the viewer, see "Photos"; a confirmed milestone starts at the globe, and Published comes from the live Bookshelf books at the globe, so a page is good enough the day it is switched on). The levels, the one marketing consent and the caching are in `docs/product/FINISHERS.md`, "Where it shows".
- **A footer link** back to Quill & Cup (`appConfig.siteUrl`).

Nothing else from the member record is read into the page: not the email, status, id, birthday, "Ask me about" topics, writing, goals, prickles or awards (a milestone shows only its title, the work, the day and the story at the globe).

## Routes

| Path | Who | What |
|---|---|---|
| `/w/<handle>` | anyone | the page; indexed (`index, follow`), canonical URL, Open Graph and Twitter card, JSON-LD `Person` |
| `/w/sitemap/<n>.xml` | anyone | the public pages, up to `sitemapPageSize` (10,000; the protocol allows 50,000) addresses per file (`src/app/w/sitemap.ts`, `generateSitemaps`); a file is read in batches of 1000 rows (`fetchRowWindow`, `src/lib/supabase/paginate.ts`), since one query returns at most 1000 |
| `/robots.txt` | anyone | allows crawling, keeps `/api/` and `/admin/` out, lists the sitemap files (`src/app/robots.ts`) |
| `/writer-profile/preview` | the signed-in member (sudo shows the member's) | "View as a visitor": the same page as a visitor gets, whether or not it is on, with a banner; never indexed |
| Settings, Profile, "Your writer profile on the web" | the member, when the flag is on for them | switch, address, name, preview link; the items the page shows are chosen one by one above it |

`/w/` was chosen as a short namespace of its own: it cannot collide with a handle at the top level, so the words a handle may not be are only the ones that would be confusing or official-sounding, not every route. A handle in the first path segment (`/<handle>`) would have meant reserving every route and every future route.

### What a visitor's request gets

- **A current handle of a public page:** the page.
- **A handle the member gave up:** a permanent redirect (`permanentRedirect`, status 308, which search engines treat as a 301) to the page's current address, but only while the page is public.
- **Capital letters in the address:** a permanent redirect to the lowercase one.
- **Anything else** (a page that is off, deleted, a handle nobody has, an address that cannot be a handle): the same 404. Nothing says that a hidden page exists. `generateMetadata` answers the same for both, too.

The route is public in `src/lib/supabase/middleware.ts` (`/w/` and `/robots.txt`), like `/p/<slug>` (landing pages, `docs/product/LANDING_PAGES.md`).

## Data

- **`writer_profiles`** (id prefix `wpage_`, Tier 2: the address is the handle, so the id is never in a URL): one live row per member (`member_id`), `handle`, `is_public`, `public_name_alias_id` (a pen name), `use_account_name` (the member picked the name on their account; with neither, the display name), `public_bio` (the separate public bio), `published_at` (the first time it went public), soft delete (`deleted_at`). The photo's old switch, `show_photo`, was dropped: the photo's level replaced it (see "Who sees what").
- **`writer_profile_handles`** (`whand_`): handles a member gave up: `handle`, `member_id`, `released_at`, `reserved_until`.
- **`member_name_aliases.is_public`** (default `false`): the member allows this name on their page. A check constraint allows it only for a name the member added themselves (`source = 'member'`), so a Zoom or Slack name matched by staff can never be public, whatever someone sends to the table. The row-level policies of the alias table are unchanged.

Row-level security: a member reads and changes their own row, an admin reads and changes any. The grants are narrow: a member can update only `is_public`, `public_name_alias_id`, `use_account_name` and `public_bio`; they cannot insert a row, write the handle or the removal mark. There is no anonymous grant on either table. A trigger refuses a name shown that is not a public, active pen name of the same member.

### The repository

`WriterProfileRepository` (`src/lib/data/writer-profiles.ts`; `docs/architecture/DATA_ACCESS_LAYER.md`). A member's own reads and changes use their own repositories; everything a visitor reads runs with the service role (`getServiceRepos()`), as `src/app/p/[slug]` does, and returns `PublicWriterProfile`, which holds only `handle`, `name`, `photoUrl`, `bio`, `links`, `publishedAt` and `updatedAt`. `toPublic` is the one place the fields become public: a pen name only when it is the member's own, marked public, active and added by them (anything else falls back to the display name), a photo only at the globe and with a publishable address, the bio and each link only at the globe (a separate public bio always wins), a link only over https. The in-memory twin and the database pass one contract suite (`tests/helpers/writer-profile-contract.ts`).

### Handles

- Lowercase letters, digits and single hyphens (no hyphen at either end or twice in a row); `handleMinLength` to `handleMaxLength` characters (3 to 30), from `config/app.ts` `writerProfiles`. The table checks the shape; the length and the words are the app's (`validateHandle`, `src/lib/writer-profile.ts`).
- **Unique, whatever the case,** among live pages and among old handles (unique indexes on the lowercased value; a handle is always stored lowercase).
- **Reserved words** (`writerProfiles.reservedHandles`): the community and the product, staff and official-sounding words, places in the app and on the site. Compared with hyphens left out, so `quill-and-cup` is held by `quillandcup`. A list in config, tested for shape and duplicates.
- **Changing a handle** is one database function, `set_writer_handle` (service role only; the server checks who is asking and the reserved words first). It returns `created`, `changed`, `unchanged`, `taken` or `reserved`. On a change the old handle goes to `writer_profile_handles` with `reserved_until = now + handleReservationDays` (90 days, config). During that time nobody else can take it and it redirects to the new one. The previous owner can take it back at any time. After it, someone else can have it, and the redirect then ends. The caller passes "now" (`src/lib/clock`), so tests choose it.
- A removed page (soft delete) frees its handle at once.

## The name policy

Owner decision: the display name by default, never the legal name. `public_name_alias_id` and `use_account_name` let the member choose the display name, a pen name or (explicitly) the name on their account. Pen names are in `member_name_aliases`, which is private and also holds names we matched from Zoom and Slack; only a name the member added themselves can be made public, with a switch next to it in Settings, Identity ("Show on my writer profile"). Turning a name off also takes it off the page if the page used it, and the read falls back to the display name if a name stops being public or active. Settings nudge the member to check which name is shown. Nobody is left without a choice: the account name is always in the list, labeled as such.

## Who sees what

Every item of the profile has one of three levels, the same lock, house and globe as a writing project (`src/components/writing/VisibilityControl.tsx`, `src/lib/writing-visibility.ts`): **private** (only the member), **community** (signed-in members; what every item was before levels existed, and the default) and **public** (the open internet, on the writer profile). The control sits beside each item in Settings, Profile, and a click saves at once (`setProfileVisibility`, `profileVisibilityActions.ts`).

| Item | Levels | Stored in |
|---|---|---|
| Bio, photo, Instagram, Facebook, X | private, community, public | `member_profile_overrides.<item>_visibility` (`twitter_visibility` for X) |
| "Ask me about" topics | private, community (never the globe: the page does not show them) | `member_ask_me_about.visibility` |

- **The globe is offered only where it is true:** on the items the page shows, and only when the `writer_profiles` flag is on for the member (`levelsFor`, `src/lib/profile-visibility.ts`; the server refuses `public` otherwise, and for the topics). A globe item while the page is off shows a plain note ("Shown on the web once your writer profile is on"), and while pages on the web are closed to the member another ("Not shown on the web: pages on the web are not open to you yet"). With a separate public bio, the member bio has no globe: the page uses the separate one.
- **Private is honored by every member-facing reader.** The member directory (`member_directory`, the synced copy every member-facing page and search reads) holds NULL for a private item, so no member and no admin sees it there: `refresh_member_directory` builds a row from `members` and the levels, called by the trigger on `members` and by one on `member_profile_overrides`. That covers the profile page, the hover card, Hub Chat's cards and avatars, search, the Members page, and the places that read the directory for a photo (the Wheel of Wonder reel, Big Sister matches through `my_mentorships`). The topics are hidden by the table's read policy (owner, admins and members for a shared list) and by `member_ask_me_about_shown`, the function `MemberProfileRepository.askMeAbout` uses, which hides a private list from everyone but its owner, an admin included. A member's own Settings read their own row and `members`, so they always see what they have. Staff tools that read `members` or the tables directly keep the access they always had.
- **Level changes are audit entries as the member** (`member_profile_visibility`, and the existing `member_ask_me_about` trigger), with the old and new level and never the text (the trigger redacts the bio, the links and the photo path). A row created for another reason with every item at the default writes none.
- **Expand only.** The new columns default to community, so code running during a deploy keeps working. The photo's old switch, `writer_profiles.show_photo`, became the photo's public level in the migration (a photo shown on a page stays shown); the column was dropped in a second step once nothing read or wrote it.
- **Known limit.** A private photo is left out of the directory for everyone, so the member's own avatar in Hub Chat shows initials too while it is private (`docs/TODO.md`, "Show a member their own private photo").

## The photo

Settings > Profile > Photo (`ProfilePhoto`) shows the picture in use, says where it comes from (`photoSource`: uploaded, a copy of the Gravatar picture, Gravatar, Slack, the one from joining), and lets the member upload, replace or remove their own.

- **Where it comes from.** `members.photo_url` is rebuilt by member processing from the Kajabi avatar, then Slack, then Gravatar. A photo of the member's own is remembered as `member_profile_overrides.photo_path` (`<member id>/<hash>.webp` in the `member-photos` bucket, `src/lib/member-photo.ts`), which processing prefers, and `photo_url` is pointed at it. Uploads and the Gravatar copy both write it this way, the same as `pnpm photos:adopt` does for the Kajabi copies.
- **Upload** (`POST /api/profile/photo`, field `photo`; `DELETE` removes). JPEG, PNG or WebP up to `appConfig.memberPhoto.maxUploadBytes` (4 MB, under the request size a Vercel function takes). The type is decided from the bytes (`inspectImage`), never the name or the browser's type, and the picture is re-encoded to a WebP of at most 512 pixels a side, which drops EXIF (including location) and any other metadata. Always the signed-in member's own photo (`getEffectiveIdentity`); staff acting as a member (sudo) can look, and the route refuses to change anything. A replaced or removed photo's file is deleted. After a removal the address falls back to Gravatar and member processing finds a Kajabi or Slack photo again at its next run.
- **Storage.** Only the server writes to the bucket: it has no storage policy for members, it takes only `image/webp` up to 2 MB, and `member_profile_overrides.photo_path` must be in the member's own folder (a check, since members can write their own override row). Tests: `supabase/tests/database/storage_buckets.test.sql`, `tests/lib/profile-photo-route.test.ts`, `tests/lib/member-photo-upload.test.ts`.
- **The lock, the house and the globe.** The lock: other members see initials, because `member_directory` holds no photo for a private one and every member-facing reader (chat, the member directory and profile, search, Big Sister matches, the wheel, hover cards, link cards, streaks) reads the directory. The house: other members see the photo. The globe: also anyone on the web, on the profile, once it is on and the flag is on for its owner. (Known limit: the member's own avatar in chat shows initials while the photo is private; see `docs/TODO.md`.)

## The choke point

`isProfilePubliclyServable` (`src/lib/writer-profile.ts`) is called by every read that serves or lists a page (the page, the redirect from an old handle, the sitemap). Today it serves a page unless it was removed. **The owner has not decided what happens to the page of a former member or one on hiatus** (`docs/TODO.md`, "What may leads, former members and members on hiatus do?"); that decision goes in this one function, which already receives the member's status.

## Settings, analytics and the Activity Log

- Actions: `src/app/(member)/settings/writerProfileActions.ts` (the address, the name, the separate public bio, the switch) and `profileVisibilityActions.ts` (the level of each item), for the effective identity (sudo works). Turning the page off, changing the address and removing a separate public bio ask first (`ConfirmDialog`). The switch refuses a page without an address or without a chosen name, and the settings ask for them first.
- Analytics: the outcome of each action is recorded (`writer_profile_handle_set`, `writer_profile_switched`, `writer_profile_settings_saved`, `writer_profile_pen_name_added`, `profile_visibility_set`, `name_alias_public_set`; `src/lib/analytics/actions.ts`).
- Activity Log: turning the page on or off, the name shown and the bio are audit entries as the member (the bio is logged as changed, never its text; `describeRow` in `src/lib/activity-feed.ts`). The handle is written with the service role, so the server records "Chose / Changed the address of their public writer profile" in the member's own activity instead (as staff when an admin acts through sudo), without the address in the sentence.

## Not here yet

Writing items, goals, books, awards and facts on the page; a staff takedown and a way to report a page; rate limiting; the handle-squatting policy; custom domains; and the former-member decision. Each is an entry in `docs/TODO.md`.
