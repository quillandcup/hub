# Writers' public pages

A member can opt in to a page of their own on the open web, at an address they choose: `/w/<handle>`. Anyone can open it without signing in, and search engines list it. It is the writer's home on the web. This document is the foundation: who a page is for, the handle, the name, and which items of the profile a member opens to the internet, and how a visitor is served. It shows no writing, goals, books or awards yet; those need the three-level visibility control and come in later packages (see `docs/TODO.md`, "Writer profiles: public author pages, Finishers, three-level visibility").

**Default is off for everyone.** A page exists once the member picks a handle, and stays private until they switch it on in Settings, Profile, "Your writer page on the web". On top of that the whole feature is behind a feature flag (below): until it is on for a member, they do not see the section at all.

## The feature flag

`writer_pages` ("Writers' pages on the web", `lib/features.ts`; switched at `/admin/previews`) decides who can have a page. It is decided **for the page's owner**, never the visitor (an anonymous visitor has no flag), with the same rules as every flag: on for everyone with the global switch, otherwise for members in a linked segment or with their own preview (`membersWithFeature`, `lib/features.server.ts`; the helper is `lib/writer-pages-access.ts`).

| Place | Flag off for the owner |
|---|---|
| Settings, Profile, "Your writer page on the web" and the globe on each item | the block is not shown, and the globe is not offered or accepted (`getWriterPageSettings` says `available: false`); universal search leaves it out (`feature` in `sections.ts`) |
| Claiming an address, saving the name or the separate bio, a level set to the globe, switching the page **on** | refused in the action (`WRITER_PAGES_NOT_AVAILABLE`). Switching **off** is always allowed |
| `/w/<handle>` and `generateMetadata`, also a given-up handle's redirect | the same 404 as a page nobody has |
| `/writer-page/preview` | the same 404 |
| `/w/sitemap/<n>.xml` | the page is left out; the owners of one file's pages are checked together (`writerSitemapEntries`: one batched `membersWithFeature` call per file, never a query per page) |
| `/robots.txt` | lists only the sitemap files; it never names a page. The number of files comes from `publicCount`, which does not know the flag, so a file can be empty (valid) |

**The flag never deletes or changes data.** The row, its handle, name, separate bio, every item's level and `is_public` stay exactly as the member left them; the page stops being served and comes back when the flag is on again. The one read that carries the owner is `PublicLookup.ownerId` (and `memberId` in a sitemap entry): server-only, never part of `PublicWriterProfile`. A flag that is on only for some members means a public page can disappear for the others, which is the point of a staged rollout, but it also means a page that was public before the flag existed is hidden until the flag is on for its owner.

## What a visitor sees

Only these, and only what the member chose. The page shows an item only when **all three** are true: the page is on, the `writer_pages` flag is on for its owner, and the item's level is the globe (`public`; see "Who sees what" below).

- **The name.** Always shown: the display name (`getMemberDisplayName`: the chosen display name), or one of the member's pen names that they marked for the page. The settings never offer the name on the account (for many members the legal name), and a page cannot be switched on until a display name or a pen name is chosen. (A page that was switched on before this rule keeps the name it had.)
- **The photo,** only when its level is the globe. A photo is published only if it is `https` and not from a host listed in `appConfig.writerProfiles.unpublishablePhotoHosts` (Gravatar: its address carries a hash of the member's email). The photo address is whatever member processing stores (a copy in our storage, a Slack or Kajabi picture); all of those hosts are already in the page's image policy (`appConfig.csp.imageHosts`).
- **The bio.** If the member wrote a separate public bio (`writer_profiles.public_bio`, up to `bioMaxLength` characters, from config), the page uses it, whatever the level of the member bio. Otherwise it uses the member bio, only when its level is the globe. Rendered as text, never as markup.
- **The social links** (Instagram, Facebook, X), each only when its level is the globe, and only over `https`. They are links, drawn with `MemberSocialLinks`, and listed as `sameAs` in the page's structured data.
- **A footer link** back to Quill & Cup (`appConfig.siteUrl`).

Nothing else from the member record is read into the page: not the email, status, id, birthday, "Ask me about" topics, writing, goals, prickles or awards.

## Routes

| Path | Who | What |
|---|---|---|
| `/w/<handle>` | anyone | the page; indexed (`index, follow`), canonical URL, Open Graph and Twitter card, JSON-LD `Person` |
| `/w/sitemap/<n>.xml` | anyone | the public pages, `sitemapPageSize` addresses per file (`app/w/sitemap.ts`, `generateSitemaps`) |
| `/robots.txt` | anyone | allows crawling, keeps `/api/` and `/admin/` out, lists the sitemap files (`app/robots.ts`) |
| `/writer-page/preview` | the signed-in member (sudo shows the member's) | "View as a visitor": the same page as a visitor gets, whether or not it is on, with a banner; never indexed |
| Settings, Profile, "Your writer page on the web" | the member, when the flag is on for them | switch, address, name, preview link; the items the page shows are chosen one by one above it |

`/w/` was chosen as a short namespace of its own: it cannot collide with a handle at the top level, so the words a handle may not be are only the ones that would be confusing or official-sounding, not every route. A handle in the first path segment (`/<handle>`) would have meant reserving every route and every future route.

### What a visitor's request gets

- **A current handle of a public page:** the page.
- **A handle the member gave up:** a permanent redirect (`permanentRedirect`, status 308, which search engines treat as a 301) to the page's current address, but only while the page is public.
- **Capital letters in the address:** a permanent redirect to the lowercase one.
- **Anything else** (a page that is off, deleted, a handle nobody has, an address that cannot be a handle): the same 404. Nothing says that a hidden page exists. `generateMetadata` answers the same for both, too.

The route is public in `lib/supabase/middleware.ts` (`/w/` and `/robots.txt`), like `/p/<slug>` (landing pages, `docs/LANDING_PAGES.md`).

## Data

- **`writer_profiles`** (id prefix `wpage_`, Tier 2: the address is the handle, so the id is never in a URL): one live row per member (`member_id`), `handle`, `is_public`, `public_name_alias_id` (null means the display name), `public_bio` (the separate public bio), `published_at` (the first time it went public), soft delete (`deleted_at`). `show_photo` is still there but nothing reads or writes it any more: the photo's level replaced it (see "Who sees what"; dropping it is a contract step in `docs/TODO.md`).
- **`writer_profile_handles`** (`whand_`): handles a member gave up: `handle`, `member_id`, `released_at`, `reserved_until`.
- **`member_name_aliases.is_public`** (default `false`): the member allows this name on their page. A check constraint allows it only for a name the member added themselves (`source = 'member'`), so a Zoom or Slack name matched by staff can never be public, whatever someone sends to the table. The row-level policies of the alias table are unchanged.

Row-level security: a member reads and changes their own row, an admin reads and changes any. The grants are narrow: a member can update only `is_public`, `public_name_alias_id`, `show_photo` and `public_bio`; they cannot insert a row, write the handle or the removal mark. There is no anonymous grant on either table. A trigger refuses a name shown that is not a public, active pen name of the same member.

### The repository

`WriterProfileRepository` (`lib/data/writer-profiles.ts`; `docs/DATA_ACCESS_LAYER.md`). A member's own reads and changes use their own repositories; everything a visitor reads runs with the service role (`getServiceRepos()`), as `app/p/[slug]` does, and returns `PublicWriterProfile`, which holds only `handle`, `name`, `photoUrl`, `bio`, `links`, `publishedAt` and `updatedAt`. `toPublic` is the one place the fields become public: a pen name only when it is the member's own, marked public, active and added by them (anything else falls back to the display name), a photo only at the globe and with a publishable address, the bio and each link only at the globe (a separate public bio always wins), a link only over https. The in-memory twin and the database pass one contract suite (`tests/helpers/writer-profile-contract.ts`).

### Handles

- Lowercase letters, digits and single hyphens (no hyphen at either end or twice in a row); `handleMinLength` to `handleMaxLength` characters (3 to 30), from `config/app.ts` `writerProfiles`. The table checks the shape; the length and the words are the app's (`validateHandle`, `lib/writer-profile.ts`).
- **Unique, whatever the case,** among live pages and among old handles (unique indexes on the lowercased value; a handle is always stored lowercase).
- **Reserved words** (`writerProfiles.reservedHandles`): the community and the product, staff and official-sounding words, places in the app and on the site. Compared with hyphens left out, so `quill-and-cup` is held by `quillandcup`. A list in config, tested for shape and duplicates.
- **Changing a handle** is one database function, `set_writer_handle` (service role only; the server checks who is asking and the reserved words first). It returns `created`, `changed`, `unchanged`, `taken` or `reserved`. On a change the old handle goes to `writer_profile_handles` with `reserved_until = now + handleReservationDays` (90 days, config). During that time nobody else can take it and it redirects to the new one. The previous owner can take it back at any time. After it, someone else can have it, and the redirect then ends. The caller passes "now" (`lib/clock`), so tests choose it.
- A removed page (soft delete) frees its handle at once.

## The name policy

Owner decision: the display name by default, never the legal name. `public_name_alias_id` lets the member choose the display name or a pen name. Pen names are in `member_name_aliases`, which is private and also holds names we matched from Zoom and Slack; only a name the member added themselves can be made public, with a switch next to it in Settings, Identity ("Show on my writer page"). Turning a name off also takes it off the page if the page used it, and the read falls back to the display name if a name stops being public or active. Settings nudge the member to check which name is shown, and say when the page would use the name on the account because no display name is set.

## Who sees what

Every item of the profile has one of three levels, the same lock, house and globe as a writing project (`components/writing/VisibilityControl.tsx`, `lib/writing-visibility.ts`): **private** (only the member), **community** (signed-in members; what every item was before levels existed, and the default) and **public** (the open internet, on the writer page). The control sits beside each item in Settings, Profile, and a click saves at once (`setProfileVisibility`, `profileVisibilityActions.ts`).

| Item | Levels | Stored in |
|---|---|---|
| Bio, photo, Instagram, Facebook, X | private, community, public | `member_profile_overrides.<item>_visibility` (`twitter_visibility` for X) |
| "Ask me about" topics | private, community (never the globe: the page does not show them) | `member_ask_me_about.visibility` |

- **The globe is offered only where it is true:** on the items the page shows, and only when the `writer_pages` flag is on for the member (`levelsFor`, `lib/profile-visibility.ts`; the server refuses `public` otherwise, and for the topics). A globe item while the page is off shows a plain note ("Shown on the web once your writer page is on"), and while pages on the web are closed to the member another ("Not shown on the web: pages on the web are not open to you yet"). With a separate public bio, the member bio has no globe: the page uses the separate one.
- **Private is honored by every member-facing reader.** The member directory (`member_directory`, the synced copy every member-facing page and search reads) holds NULL for a private item, so no member and no admin sees it there: `refresh_member_directory` builds a row from `members` and the levels, called by the trigger on `members` and by one on `member_profile_overrides`. That covers the profile page, the hover card, Hub Chat's cards and avatars, search, the Members page, and the places that read the directory for a photo (the Wheel of Wonder reel, Big Sister matches through `my_mentorships`). The topics are hidden by the table's read policy (owner, admins and members for a shared list) and by `member_ask_me_about_shown`, the function `MemberProfileRepository.askMeAbout` uses, which hides a private list from everyone but its owner, an admin included. A member's own Settings read their own row and `members`, so they always see what they have. Staff tools that read `members` or the tables directly keep the access they always had.
- **Level changes are audit entries as the member** (`member_profile_visibility`, and the existing `member_ask_me_about` trigger), with the old and new level and never the text (the trigger redacts the bio, the links and the photo path). A row created for another reason with every item at the default writes none.
- **Expand only.** The new columns default to community, so code running during a deploy keeps working. The photo's old switch, `writer_profiles.show_photo`, became the photo's public level in the migration (a photo shown on a page stays shown); the column is no longer read or written (`docs/TODO.md`, "Drop writer_profiles.show_photo once the photo level is the only reader").
- **Known limit.** A private photo is left out of the directory for everyone, so the member's own avatar in Hub Chat shows initials too while it is private (`docs/TODO.md`, "Show a member their own private photo").

## The choke point

`isProfilePubliclyServable` (`lib/writer-profile.ts`) is called by every read that serves or lists a page (the page, the redirect from an old handle, the sitemap). Today it serves a page unless it was removed. **The owner has not decided what happens to the page of a former member or one on hiatus** (`docs/TODO.md`, "What may leads, former members and members on hiatus do?"); that decision goes in this one function, which already receives the member's status.

## Settings, analytics and the Activity Log

- Actions: `app/(member)/settings/writerPageActions.ts` (the address, the name, the separate public bio, the switch) and `profileVisibilityActions.ts` (the level of each item), for the effective identity (sudo works). Turning the page off, changing the address and removing a separate public bio ask first (`ConfirmDialog`). The switch refuses a page without an address or without a chosen name, and the settings ask for them first.
- Analytics: the outcome of each action is recorded (`writer_page_handle_set`, `writer_page_switched`, `writer_page_settings_saved`, `profile_visibility_set`, `name_alias_public_set`; `lib/analytics/actions.ts`).
- Activity Log: turning the page on or off, the name shown and the bio are audit entries as the member (the bio is logged as changed, never its text; `describeRow` in `lib/activity-feed.ts`). The handle is written with the service role, so the server records "Chose / Changed the address of their public writer page" in the member's own activity instead (as staff when an admin acts through sudo), without the address in the sentence.

## Not here yet

Writing items, goals, books, awards and facts on the page; a staff takedown and a way to report a page; rate limiting; the handle-squatting policy; custom domains; and the former-member decision. Each is an entry in `docs/TODO.md`.
