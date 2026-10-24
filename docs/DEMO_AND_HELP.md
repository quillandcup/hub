# Reproducible Demo and Help Docs

One mechanism, two outputs: a fictional demo community seeded into a local stack, and Playwright scenes that drive the app and capture screenshots and clips.

1. **Newsletter / showcase** (short term): screenshots and short videos of what's being built, for the RayhausCapital newsletter.
2. **Member help site** (longer term): app-specific help articles (how to join a prickle, check in, host, find a BFF) whose screenshots are regenerated from the same scenes, so they don't go stale as the UI changes.

Status: the harness, two scenes, the `/help` route and the first article ("How to join a prickle") exist (`docs/TODO.md`, "Reproducible demo and help docs").

## Layout (proposed)

```
demo/
  seed/            fictional community, built from Bronze + Local inputs
  scenes/          one Playwright spec per help article or feature
  playwright.config.ts
  out/             captured screenshots and videos (gitignored)
help/         the articles (markdown), one per topic, images by scene name
```

Commands, run from the repo root:

1. `pnpm demo:stack up`: a separate local Supabase stack (project `hub-demo`, ports shifted by 2000: API 56321, DB 56322, mail 56324), built from this branch's migrations with no `seed.sql`, so it always matches the schema and never touches the shared dev database. Its config is generated from `supabase/config.toml` (`demo/stack.ts`); URLs and the standard local keys go to the gitignored `demo/.env.demo`. `down` stops it, `reset` deletes its data.
2. `pnpm demo:app`: the app on port 3100 against that stack.
3. `pnpm demo:seed`: the fictional community (`demo/personas.ts`), then the app's own `/api/process/calendar`. Safe to run again.
4. `pnpm demo:publish [--verify | --prod]`: uploads the desktop light screenshots the articles use into the current set, or with `--verify` only checks they were all captured (see Decisions). `pnpm demo:stack migrate` applies migrations added since `up`.
5. `pnpm demo:capture [--project=desktop-light]`: runs every scene in `demo/scenes/` across the matrix and writes `demo/out/<scene>/<project>/NN-step.png`. `DEMO_VIDEO=1` records video.

Notes from the first run: the phone project is Chromium at the iPhone's size and user agent (WebKit isn't installed; add it for Safari-accurate checks); the browser's time zone and locale are pinned to the org's, because members see times in their own zone and the host's would leak in; the Next.js dev badge is hidden in screenshots.

## Seed data

- **Fictional only.** The repo is public (`public-repo-hygiene.md`): invented names, `@example.com` emails, no real Slack, Zoom or Kajabi ids.
- **Seed the inputs, not the results.** Write Bronze (calendar events, Zoom attendees, Kajabi members) and Local rows, then run the real `/api/process/*` routes to build Silver. The demo then exercises the same pipeline production does, and a change to Silver logic can't leave the demo showing something the app wouldn't produce.
- **Relative dates.** Server code reads the real clock (`lib/clock.ts`), so the seed is generated relative to "today in `ORG_TIMEZONE`" (a prickle tomorrow at 9am, last week's attendance, a 12-week streak) instead of frozen dates. Captures are reproducible in content, not in calendar dates.
- **Cast.** A handful of personas that map to articles: a new member in their trial, a regular with a streak, a prickle host, a big sister, an admin. Ten more invented members fill the room without signing in, and a deterministic Zoom attendance history (`demo/attendance.ts`: who comes by their own rate, joins a few minutes in, sometimes leaves early or steps out and back) goes through the real attendance processing, so the schedule shows typical crowds and hosts have show-up and on-time rates.
- **Safety.** The script refuses to run unless the Supabase URL is local, and never touches production (`verify-against-prod.md`).
- **Typed rows (TODO).** There are no generated database types, so seed rows are plain objects and break at runtime when a column changes. Generate types (`supabase gen types typescript --local`) and type the seed with them; until then the capture run is the check that the seed still fits.

## Scenes

- Signing in: create the demo users with the service role (as in the local sign-in recipe) and set the session in the browser context once in a Playwright setup project, instead of going through Mailpit for every run. Sudo ("Sudo As…") gives member views from the admin account where that is simpler.
- Fixed viewport (1280x800 desktop, plus a phone size where a mobile layout matters), light theme, animations off, `page.clock` for client-side time, masked or avoided elements that vary (relative times, avatars from external hosts).
- A small `shot(page, name, { highlight })` helper names files `NN-name.png` and can outline the control the article talks about.
- A scene is a spec file; a failing selector is the signal that an article is out of date.

## Help articles

- Static markdown in `help/`, covering the topics members already get in Kajabi's "Hedgie Help!" section that the Hub has screens for: joining a prickle, planning your month, becoming a host, starting a PUP, running a prickle (which includes what to do if you can't host). The BFF program, suggesting a webinar or coaching topic and submitting a daily coaching video are processes outside the Hub (external forms), so they stay in Kajabi until the Hub has the feature (`docs/TODO.md`, "Kajabi help topics left in Kajabi").
- Kajabi stays the source of the existing lessons; none of their text is copied into the repo. Read the relevant lesson there when drafting its Hub version, for tone and for the non-app parts (prickle types, etiquette, hosting norms). Its steps predate the Hub: joining is described through Slack's `#prickle-times` posts, a shared Zoom link and password, and a monthly "Prickle Times" spreadsheet, so every app-specific step is rewritten against the real screens. Of the ten "Hedgie Help!" lessons, two are drafts (what to expect in the BFF program, suggesting a webinar or coaching topic; the second is empty), and the daily coaching video lesson is a short video page.
- Publishing is a later decision (a `/help` route in the app, a static site such as Trackbear's help site, or Kajabi itself). Markdown plus images is portable to all three.
- Images are fictional by construction, but still review them before committing: a screenshot is the likeliest place for real data to leak.

## Decisions to make

- Where the help site lives (above).
- Whether captured PNGs are committed (reviewable diffs, repo growth) or published as build artifacts (smaller repo, not visible in PRs).
- Whether to run capture in CI on a schedule to catch stale scenes (needs the local stack, as the db test job already has).

## Scenes are also browser tests

Each scene is a key user journey (join a prickle, check in, host, find a BFF), so it doubles as an end-to-end test. One scene definition, two modes:

- **verify**: runs the journey with assertions across the whole matrix below; fails on a broken flow, a missing control or a failed accessibility check.
- **capture**: runs the same journey for the chosen project only and writes the screenshots and video.

A stale article and a broken flow are then the same failure.

**Matrix** (Playwright projects): phone, tablet portrait, tablet landscape, desktop, each in light and dark. Widths include sizes just either side of the shell breakpoints (`CLAUDE.md`, "Responsive Layout"), not only device presets. Dark mode is `next-themes` with Tailwind's `darkMode: "class"`, so a scene sets the theme explicitly (stored preference) as well as emulating `prefers-color-scheme` for the "system" setting. Cheap per-page checks run on every combination: axe contrast and a11y scan, no horizontal overflow, no console errors. Screenshots of the verify run can be compared against a baseline later; the first pass is assertions only.

**Fidelity of the demo users.** The service role only creates the accounts and rows. The browser then signs in as each demo user through the real auth flow, so every page query runs as that user under RLS, and `requireAdminPage` and the sudo rules apply as they do in production. The service role key never reaches the browser. Demo users are created in the states real people are in (trial member, active, on hiatus, cancelled, big sister, host, admin, signed-in non-member), with `user_profiles`, `members` and membership history written the way the app's own sign-up and processing write them. A scene signs in as the persona the article is about, and a permissions scene checks that a member can't reach `/admin` (`/no-access`) and sees only their own data.

## Page checks (every scene, every size, light and dark)

Each `shot()` also checks the page it just captured (`demo/checks.ts`), so a scene is an accessibility, overflow and console test at all eight size and theme combinations without extra code:

- **a11y and contrast**: axe at WCAG 2.0/2.1 A and AA. Colour contrast is the check that catches a missing dark-mode colour: it runs against the real theme of each run.
- **overflow**: the page scrolls sideways, or an element sticks out past the screen edge (outside a container that is meant to scroll).
- **edge**: a dialog, menu, listbox, tooltip or popover is cut off by the screen, is taller than it with no scrolling of its own, or sits within 8 px of a side without being a full-width sheet. This is what catches a modal clipped on a phone.
- **console**: an error logged, or an uncaught exception.

`demo/selftest/checks.spec.ts` builds small pages that each trip one check (and a clean one that trips none), so a detector that quietly stopped working can't pass for an app with no problems.

**A ratchet, not a wall.** The app has existing findings, so `demo/baseline.json` lists today's (per size and theme, per step) and a run fails only on a **new** one: a finding known at any size in the same theme counts as known, because axe is not consistent about elements below the fold on a short screen, while a new element or rule still fails, with the rule, the element and the numbers. Identities leave out row positions, so a list that is one longer today doesn't count as new. After fixing something, `DEMO_CHECKS=report pnpm demo:capture --grep-invert @published && pnpm demo:baseline` shrinks the file; a new finding that is deliberate is added the same way, in a reviewed diff. `DEMO_CHECKS=report` writes the findings without failing and `off` skips the checks.

## Integration mockups

Not everything happens in the browser. `demo/scenes/notification-mockups.spec.ts` draws what members receive when the Hub reaches out, for every notification kind (so a new kind appears in it by itself), from the real message code with the demo community's data:

- **Slack**: the blocks as the Slack channel assembles them (`slackBlocks()`, including footer links), rendered locally by [slack-blocks-to-jsx](https://github.com/themashcodee/slack-blocks-to-jsx) (MIT; every block type our messages use, with a light and a dark theme) in a desktop direct-message frame and a phone frame (Slack's phone app: status bar, conversation header, message box; the screen grows to show a long message in full). **The phone frame is an approximation:** the blocks are the real ones, but how they lay out is the renderer's CSS at phone width, not Slack's own, so how Slack's iPhone app arranges a row of buttons (wrap, stack or scroll) is NOT verified by it. Compare with a real screenshot (Admin → Test Notifications, sent to your phone) before relying on it, for example to judge how an answer scale looks, with the bot's name and colour read from `slack-app-manifest.yml`. No third-party service: Block Kit Builder would mean sending the message to Slack.
- **Email**: the React Email template as `renderNotificationEmail()` makes it, with the unsubscribe link a real send adds, inside an email client frame with the real sender.
- **Browser push** (web push): the payload `pushPayload()` builds, on a laptop, an Android phone and an iPhone. Web push reaches desktop Chrome, Edge, Firefox and Safari and Android Chrome; on iPhone only once the Hub is added to the Home Screen (iOS 16.4 and later), which the iPhone frame says.
- **In-app**: the bell and banner are part of the app itself, so the other scenes already show it.

Messages come from `sampleMessages(supabase, kind, now, { test: false })` (`lib/notification-test.ts`), the admin test send's builder without its "[Test]" marking. Only the frames are drawn (`demo/mockups/frames.tsx`): the content is the app's, the surroundings plausible rather than pixel-identical to each client. The page checks are off for these pages, since they aren't the app's own. They are captured at every size and theme like any scene.


## Decisions

- **Help site**: `/help/<topic-slug>` inside the app, gated by sign-in (the proxy checks first; the article pages themselves are built ahead of time and carry normal caching headers, because the content is the same for every member; anything per-member is `private` or `no-store`, and Vercel won't cache a response that varies on `Cookie`). Slugs are stable and named by topic (`join-a-prickle`), not by title, so a reworded title never changes a link; a renamed slug keeps a redirect. Contact is the `SUPPORT_EMAIL` address (`lib/config.ts`), not typed into the page. Not a `help.` or `support.` subdomain: gated content shares the app's session, and a subdomain would need DNS, a rewrite and a cross-subdomain cookie for no benefit. `support.` stays free for a ticketing tool later, and can alias `/help` meanwhile. No attempt to mimic a vendor's URL scheme.
- **Public pages**: a small set for members who can't sign in (login trouble, how to reach support), with no member data. Any public page gets `noindex` and `robots.txt` rules for crawlers, which are requests, not enforcement. Which pages are public is still open.
- **Screenshots**: not committed, and paired with the build that shows them. They live in the private `help-images` Storage bucket (no policies), one folder per **set**, named by an id derived from the source that produces the screens: a hash of git's tree hashes for `app/`, `components/`, `lib/`, `demo/`, `public/`, the migrations, the styles and the lockfile (`scripts/help-images-version.ts`). `next.config.ts` bakes the id into the build, and `/help/images/<scene>/<file>` serves `<id>/<scene>/<file>`, after a sign-in check. So a deploy always reads the set captured from its own source; an older deploy still reads its own, so a rollback shows matching images. A commit that changes nothing the screens depend on (docs, tests, article text, CI) has the same id as its parent: nothing is captured or uploaded again. Articles refer to images as `![alt](img:<scene>/<file>.png)`.
- **CI**: the capture runs inside the required `Test (db) & build` job, after its tests: the job resets its own local database to empty (no `seed.sql`, so no db-test fixture can appear in a picture; the only people on screen are the demo's), seeds the demo community, and runs every scene at every size in light and dark with the page checks. It fails when a scene fails, a page check finds a new problem, or an article shows a screenshot no scene captured, and it uploads the `demo-screenshots` artifact. It runs there, not in a job of its own, because a second Supabase stack per run doubled the Docker Hub image pulls and the shared runners' rate limit could not take it (the runs failed with `toomanyrequests`). `Help screenshots` (also a required check) is a small gate that re-verifies the uploaded set; the preview and publish jobs wait for it. On a pull request, `Help screenshot preview` puts the article images on the `help-previews` branch (outside main; fictional data) and keeps one comment updated with them inline; a workflow removes them when the PR closes. On main, `Publish help screenshots` uploads the commit's set to production (additive; nothing existing is overwritten), keeps the newest 5 sets and deletes the rest, and `deploy` needs it, so a deploy can't go out with a missing picture. It reads `NEXT_PUBLIC_SUPABASE_URL` (a GitHub variable) and `SUPABASE_SERVICE_ROLE_KEY` (a GitHub secret), synced with `pnpm env:sync:github --only=NEXT_PUBLIC_SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY`.
- **By hand**: `pnpm demo:publish` (the demo stack, the "local" set), `--verify` (no upload), `--prod` (production, for a person to run; CI does it on main). Dark and phone variants of article images are not published yet.
- **Slack mockups**: local renderer (evaluate `slack-blocks-to-jsx` first), no third-party service.
- **Entry point**: a question mark in a circle in the top bar, beside the notification bell (`components/HelpLink.tsx`), not a sidebar entry; the page is titled "Hedgie Help" ("How things work in the Hedgie House"). It is also findable in the search palette. Shown in the member area only.
- **Where the files live**: member-facing articles in a top-level `help/` directory (images next to them by scene name, or published artifacts), developer docs stay in `docs/`. The route that renders them is `app/(member)/help/`, which reads `help/<slug>.md` at build time (`generateStaticParams`, `react-markdown` and `remark-gfm`, both already dependencies). Because code reads `help/` at build time, it must not count as documentation in `scripts/docs-only.ts`: otherwise a PR that only edits an article skips the build and the deploy, and the change never reaches members. Take it out of the allowlist and update `tests/lib/docs-only.test.ts` in the PR that adds the route (`docs-only-changes.md`).
