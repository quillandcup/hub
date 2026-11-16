# Landing pages (the page builder)

Status: **slice 1 built**: the model, the editor, the blocks, publishing with history, the public route. The opt-in form block (sign-ups into Kajabi) is built too; the rest is in `docs/TODO.md`, "Landing pages (page builder)".

Kajabi has landing pages with a block editor. The Hub has the same, on [Puck](https://puckeditor.com) (`@puckeditor/core`, MIT): a page is Puck's JSON, `{ content: [...], root: { props } }`, and the same React components render in the editor's canvas and on the public page. We chose an open source editor over writing our own: the drag and drop, the outline, undo and redo, the viewport preview and the iframe canvas are Puck's; the blocks, the shell around it, the model and the rules are ours.

Puck 0.24 peers on React 18 or 19 and was checked against this app's Next 16 and React 19: the editor is a client component, and the public page renders through Puck's `rsc` entry (the package's `react-server` export), which has `Render` and no editor code. Nothing about it needed patching. The editor needs a real browser (it uses dnd-kit and `ResizeObserver`); its tests mock Puck, and the blocks are tested on their own.

## Model

- `landing_pages` (`lpg_`, Tier 2): `slug` (unique among live pages), `title`, `status` (`draft` or `published`), `draft_data`, `published_data`, SEO title and description, a social image (a media asset), `first_published_at`, `published_at`, soft delete (`deleted_at`). `landing_page_versions` (`lpgv_`): one row per publish, insert-only.
- **Autosave writes `draft_data` only.** Publishing is a separate, explicit step: `publish_landing_page(id)` copies the draft to `published_data` and writes a version in one transaction (a `SECURITY INVOKER` function, so row-level security applies). `restore_landing_page_version(id)` puts a version into the draft and does not publish it. Taking a page down sets the status back to `draft`; the published copy and the versions stay.
- **Ids are never in a URL.** Page ids are Tier 2 (`docs/SHORT_IDS_PLAN.md`), so the public address is `/p/<slug>` and the editor is `/admin/pages/<slug>` (an admin URL counts as exposed). `new` is a reserved slug. The ids travel only between our own client and server actions and are checked at the door (`isLandingPageId`).
- **Row-level security: admins only.** There is no anon policy and no anon grant. A signed-out visitor never touches the table: the public route reads a published page on the server with the service role (`getServiceRepos().landingPages.published(slug)`), and that one method returns a page only when it is published and not deleted. We chose this over a narrow anon policy because the only way to leak a draft is a bug in one method with a test, not a policy that could be widened by a later migration. Community managers have no access (opt-in rule for new roles).
- **Audit: the intent, not the keystrokes.** The row trigger leaves `draft_data`, `updated_at` and `updated_by` out of its `WHEN`, so autosave writes nothing. Create, publish, unpublish, restore (`restored_at` changes), rename, address and SEO changes, and delete are audited as the admin. The two documents are logged as changed, never with their content (the `redact` argument); the versions hold the content. `supabase/tests/database/landing_pages.test.sql` tests both halves.

## The editor

`/admin/pages/<slug>` (`app/(admin)/admin/pages/[slug]/LandingEditor.tsx`) puts Puck in our shell: our header replaces Puck's (back, title, **Saved / Unsaved changes / Saving…**, device buttons, undo and redo from Puck's history, Details, History, Preview, Publish), and the Puck panels follow the theme through CSS variables in `app/globals.css`.

- **Autosave**: 1.2 s after typing stops, the draft is sent to `saveLandingDraft`; a failed save says so and retries every 5 s; Ctrl/⌘ S saves at once; leaving with unsaved changes asks first. "Changes not published yet" shows on a live page whose draft differs.
- **Publish** opens a dialog: it runs the accessibility checks (below), lists what must be fixed or checked, and only then publishes. The server runs the same checks and refuses on errors. Publishing sends the draft the editor shows, so nothing typed a moment before is left out.
- **Versions**: History lists the last 20 publishes; Bring back replaces the draft (after a confirm), and the editor reopens on it. It never goes live until published again.
- **Details**: title, address (a warning when the page is live), search title and description, the picture shown when shared.
- **Preview** opens `/admin/pages/<slug>/preview`, the draft rendered as a visitor would see it; drafts never render on the public route.
- Device preview uses Puck's viewports (desktop 1280, tablet 768, phone 390). Blocks lay out with container queries (`@container` on the page frame, named sizes), so the phone preview reflows as a phone does.

## Accessibility checks (`lib/landing/a11y.ts`)

Errors stop a publish: an empty page, no page title (an `h1`), a picture with no description (unless marked as decoration), a button or card button with no usable link, a countdown with no date, a video from a host that isn't allowed. Warnings are shown and let through: more than one `h1`, a skipped heading level, vague link text ("click here"), text over a picture with no shade, a video with no title. Contrast cannot fail by construction: backgrounds come from a short list of theme colours, each with the text colour that is readable on it (`components/landing/theme.ts`), and a picture's text colour follows its shade. Free colours are deliberately not offered.

## Pictures and public assets

Pictures come from the media library through the same `MediaPicker` (surface `landing_page`) and are referenced by asset id in props named `*AssetId`. A signed-out visitor is served only assets marked `is_public` (`docs/MEDIA_LIBRARY.md`), so **publishing marks every asset the page uses (and its social image) public**, through the admin's own client. Unpublishing does not turn it back (the asset may be used elsewhere); a sweep for assets no page shows is in the TODO. Pictures are requested at the existing presets, which crop; see the TODO for presets that keep the shape.

## Safety

- Rich text is TipTap, stored as HTML in a prop named `html`, and cleaned to an allowlist (`lib/landing/sanitize.ts`: paragraphs, headings, lists, quotes, emphasis, links; no images, styles, classes, scripts or handlers) on every save and **again before a public render** (`LandingRender`), whatever the database holds. Never raw HTML.
- A prop named `href` or `url` is a link and goes through `safeHref` (http, https, mailto, a path on this site, an anchor; nothing else) on save, on render, and in the block itself.
- Video accepts only YouTube, Vimeo and Mux player links; the iframe address is built from the extracted video id, with `sandbox`, so a pasted link can't point the frame elsewhere (`parseEmbed`).
- Sections can fade in; it is a CSS animation inside `prefers-reduced-motion: no-preference`.
- The public page sends nothing to an analytics provider and records no visitor. The site's consent banner and Google Analytics rules apply as on every page. There is no anonymous usage event yet (TODO).

## Blocks

Section (background colour or picture with a shade, width, space, optional white card, fade in; holds other blocks), Text (rich), Heading, Button (solid or outline, pill or rectangle, three colours), Image, Image and text (reversible), List (emoji or check markers), Testimonials, FAQ (native `details`), Countdown (an instant stored in UTC, entered as a wall time in `ORG_TIMEZONE`; at zero: a message, nothing, or zeros; fixed-size cells, no layout shift, read as one labelled timer), Card grid (image, title, price, button; up to 2, 3 or 4 columns by the room), Link list, Divider, Spacer, Video. The page frame has optional header (logo, links) and footer (text, links) as root fields.

### Adding a block

1. A presentational component in `components/landing/blocks.tsx`: no hooks or browser APIs (a client part gets its own file, like `Countdown.tsx`), container-query layout from the named sizes, links through `safeHref`, pictures from `*AssetId` props with the alt text from a prop.
2. Its default props in `BLOCK_DEFAULTS`, its label in `BLOCK_LABELS`, its renderer in `RENDERERS` and a category in `renderConfig` (`components/landing/config.tsx`).
3. Its fields in `components/landing/editor-config.tsx` (every field has a label; `image(...)` is the media picker, `richText(...)` the TipTap field, `dateTime(...)` a zoned date).
4. If it can be wrong in a way a visitor can't work around, a rule in `lib/landing/a11y.ts`.
5. Tests: the block in `tests/components/landing-blocks.test.tsx`; the config test already fails for a block with no fields.

### Changing a block's props

Stored pages (draft, published copy, every saved version) keep the props they were saved with, so renaming or reshaping a prop needs a migration step, not just a code change. Append a step to `LANDING_MIGRATIONS` in `lib/landing/migrations.ts` (`version` is the next number; `blocks` maps a block name to a function from old props to new; `root` does the same for the page frame). Never edit or remove an earlier step, and write each one so running it twice changes nothing more.

- The document carries `schemaVersion` (unmarked data is 0). `normalizeLandingData` runs the steps above the document's version wherever stored data is read, so the editor, the public page, preview, restore and copy all see current props, and the next save writes them back with the new version. Blocks nested in a slot (a Section's `content`) and in zones are migrated too.
- The save and publish actions stamp what the editor sends as current (`stampLandingVersion`), because the editor only ever holds migrated data and Puck may drop the marker.
- Adding a prop with a default needs no step (the block's `defaultProps` cover it); only renames, removals and changes of meaning do.
- Tests: add a case for the step to `tests/lib/landing-migrations.test.ts` (old shape in, new shape out, run twice).

## Opt-in forms

The Sign-up form block (name, email, optional Instagram handle, button label, a line under the button, a success message or a thank-you page) sends sign-ups to Kajabi. The decision (owner) is that during the migration the mailing list, tags and automations stay in Kajabi, so **the Hub stores no submission**: there is no table, and nothing about the person reaches a log, an analytics event or Sentry.

- **How Kajabi takes it.** Kajabi's public API: `POST /v1/forms/{id}/submit` (JSON:API, bearer token) with `name` and `email` (required) and optional `custom_1` to `custom_3`; Kajabi checks deliverability and does the rest of what the form is set up for (double opt-in, tags, offers, sequences, automations, webhooks). It uses the same client credentials as the Kajabi imports (`KajabiClient.submitForm`, no new variable, no new host). The reference is at `help.kajabi.com/api-reference/forms/submit-form`. Kajabi's other documented way, the one-line JavaScript embed, was not used because it brings Kajabi's own styling and scripts onto our page; it remains the fallback if the API ever stops accepting submissions.
- **The block names a form, not an address.** "Kajabi form" is the form's id (Marketing, Forms), stored in the page data (`kajabiFormId`); no id or host is in code. The Instagram handle goes to the Kajabi custom field the block names (`instagramField`), or the question is left out (the default).
- **The relay** (`POST /api/landing/opt-in`, public): the browser sends the page address, the form id and the fields; the server reads the **published page** and forwards only if that page really has an opt-in block for that form, so the route can't be used to post to any other form on the account. A hidden field is the honeypot (a bot gets a normal success and nothing is sent); two rate limits through `RateLimitRepository` (per visitor address and per form); calm messages. The visitor's address is the rate-limit key and nothing else.
- **`OptInDestination`** (`lib/landing/opt-in.ts`: `submit(target, fields)`) is the extension point: `KajabiOptInDestination` is the only implementation, chosen in `lib/landing/opt-in-destination.ts`. A Hub destination (or a dual write) plugs in there; the migration steps are in `docs/TODO.md`.
- **Editor and preview** send nothing: the form reads the page address in the browser and is disabled, with a note, anywhere but `/p/<address>`.
- **Verified and not.** Verified from Kajabi's documentation: the endpoint, auth, body and side effects. Not verified: a live submission (never made, so nothing was added to the real account), which custom field the owner's Kajabi has set up (the block defaults to leaving Instagram out), and the exact status for a refused address (Kajabi documents only 401 and 403; the destination treats 400 and 422 as "check your details" and anything else as "try again").

## Tests

Repository contract both ways (`tests/helpers/landing-page-contract.ts`), pgTAP for row-level security and audit, the actions, the opt-in relay (valid, honeypot, rate limit, a form the page doesn't show, malformed body, a failing destination) against a mocked Kajabi endpoint, the public route (a draft, a deleted page and an unknown address are the same 404), the proxy allowlist for `/p/`, every block, the editor shell with Puck mocked, the list and the new-page form, the sanitizer and link rules, the checks and the countdown across daylight saving changes.
