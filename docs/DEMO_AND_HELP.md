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
4. `pnpm demo:publish [--prod]`: uploads the desktop light screenshots the articles use (see Decisions). `pnpm demo:stack migrate` applies migrations added since `up`.
5. `pnpm demo:capture [--project=desktop-light]`: runs every scene in `demo/scenes/` across the matrix and writes `demo/out/<scene>/<project>/NN-step.png`. `DEMO_VIDEO=1` records video.

Notes from the first run: the phone project is Chromium at the iPhone's size and user agent (WebKit isn't installed; add it for Safari-accurate checks); the browser's time zone and locale are pinned to the org's, because members see times in their own zone and the host's would leak in; the Next.js dev badge is hidden in screenshots.

## Seed data

- **Fictional only.** The repo is public (`public-repo-hygiene.md`): invented names, `@example.com` emails, no real Slack, Zoom or Kajabi ids.
- **Seed the inputs, not the results.** Write Bronze (calendar events, Zoom attendees, Kajabi members) and Local rows, then run the real `/api/process/*` routes to build Silver. The demo then exercises the same pipeline production does, and a change to Silver logic can't leave the demo showing something the app wouldn't produce.
- **Relative dates.** Server code reads the real clock (`lib/clock.ts`), so the seed is generated relative to "today in `ORG_TIMEZONE`" (a prickle tomorrow at 9am, last week's attendance, a 12-week streak) instead of frozen dates. Captures are reproducible in content, not in calendar dates.
- **Cast.** A handful of personas that map to articles: a new member in their trial, a regular with a streak, a prickle host, a big sister, an admin.
- **Safety.** The script refuses to run unless the Supabase URL is local, and never touches production (`verify-against-prod.md`).
- **Typed rows (TODO).** There are no generated database types, so seed rows are plain objects and break at runtime when a column changes. Generate types (`supabase gen types typescript --local`) and type the seed with them; until then the capture run is the check that the seed still fits.

## Scenes

- Signing in: create the demo users with the service role (as in the local sign-in recipe) and set the session in the browser context once in a Playwright setup project, instead of going through Mailpit for every run. Sudo ("Sudo As…") gives member views from the admin account where that is simpler.
- Fixed viewport (1280x800 desktop, plus a phone size where a mobile layout matters), light theme, animations off, `page.clock` for client-side time, masked or avoided elements that vary (relative times, avatars from external hosts).
- A small `shot(page, name, { highlight })` helper names files `NN-name.png` and can outline the control the article talks about.
- A scene is a spec file; a failing selector is the signal that an article is out of date.

## Help articles

- Static markdown in `help/`, first pass covering the topics members already get in Kajabi's "Hedgie Help!" section (how to join a prickle, planning your month, hosting a PUP, becoming a host, running a prickle, if you can't host, the BFF program, suggesting a webinar or coaching topic, submitting a daily coaching video).
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

## Integration mockups

Not everything happens in the browser. Notification scenes also render what members get elsewhere, from the real message builders (`createNotifier`, `sampleMessages` in `lib/notification-test.ts`) with fictional data:

- **Slack**: a local renderer, no third-party service. It takes the same Block Kit JSON the notifier sends and draws it in a Slack-style frame (avatar, app name, timestamp), built as a small component set in the app's own stack and screenshotted by Playwright. Scope it to the block types our messages use today (header, section, context, divider, actions with buttons) and reuse `lib/chat/render.ts` for mrkdwn (`*bold*`, links, `<@U…>` mentions, `&amp;` escapes), which already exists for the chat mirror. Before writing one, evaluate `slack-blocks-to-jsx` (React components that render Block Kit with Slack-like styling and a dark mode; check its license, maintenance, block coverage and fidelity against our messages) and use it inside the frame if it holds up; the other npm packages (`jsx-slack`, `slackblock`, `slack-block-builder`) build Block Kit JSON and don't render it. Either way it will not be pixel-identical to Slack, so keep it honest: a test fails when a message uses a block type the renderer doesn't know, and the first time, compare a mockup with a real screenshot of the same message sent from Admin → Test Notifications. Block Kit Builder stays an optional manual check, with fictional content only, since pasting a message there sends it to Slack.
- **Email**: the React Email templates in `emails/notifications/`, or the message in Mailpit on the local stack.
- **Browser push and in-app**: the in-app banner and bell are plain pages; push needs a mock frame.

## Decisions

- **Help site**: `/help/<topic-slug>` inside the app, gated by sign-in (the proxy checks first; the article pages themselves are built ahead of time and carry normal caching headers, because the content is the same for every member; anything per-member is `private` or `no-store`, and Vercel won't cache a response that varies on `Cookie`). Slugs are stable and named by topic (`join-a-prickle`), not by title, so a reworded title never changes a link; a renamed slug keeps a redirect. Contact is the `SUPPORT_EMAIL` address (`lib/config.ts`), not typed into the page. Not a `help.` or `support.` subdomain: gated content shares the app's session, and a subdomain would need DNS, a rewrite and a cross-subdomain cookie for no benefit. `support.` stays free for a ticketing tool later, and can alias `/help` meanwhile. No attempt to mimic a vendor's URL scheme.
- **Public pages**: a small set for members who can't sign in (login trouble, how to reach support), with no member data. Any public page gets `noindex` and `robots.txt` rules for crawlers, which are requests, not enforcement. Which pages are public is still open.
- **Screenshots**: not committed. The desktop light captures are uploaded (`pnpm demo:publish`) to the private `help-images` Storage bucket, which has no policies; `/help/images/<scene>/<file>` checks sign-in and streams the file. Articles refer to them as `![alt](img:<scene>/<file>.png)`. Uploading to production writes to production storage, so `pnpm demo:publish --prod` is run by a person after reviewing `demo/out`. Dark and phone variants of article images are not published yet.
- **CI**: not yet. Get the first slice and the matrix working locally, then decide.
- **Slack mockups**: local renderer (evaluate `slack-blocks-to-jsx` first), no third-party service.
- **Where the files live**: member-facing articles in a top-level `help/` directory (images next to them by scene name, or published artifacts), developer docs stay in `docs/`. The route that renders them is `app/(member)/help/`, which reads `help/<slug>.md` at build time (`generateStaticParams`, `react-markdown` and `remark-gfm`, both already dependencies). Because code reads `help/` at build time, it must not count as documentation in `scripts/docs-only.ts`: otherwise a PR that only edits an article skips the build and the deploy, and the change never reaches members. Take it out of the allowlist and update `tests/lib/docs-only.test.ts` in the PR that adds the route (`docs-only-changes.md`).
