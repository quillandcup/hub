# Route handlers: inventory and who may call each

> **Status:** living. **Last reviewed:** 2026-11-24. Review: yearly. Kept up to date with the code; if it is wrong, fix it.

Every HTTP route handler under `src/app` (the API routes, the sign-in endpoints under `src/app/auth` and the two member download routes), with its path, the methods it answers and the credential its caller must present. The table is generated from the code and a test fails when it is out of date, so it cannot drift from the routes.

This is an inventory and a guard, not a description of the interfaces: it says who may call a route, not what to send or what comes back. Most routes are called only by the app's own pages (a staff or member session). The ones other systems call are the webhooks (`docs/infrastructure/WEBHOOK_SETUP.md`), the cron routes, the public forms and the sign-in links; describing those in detail is open (`docs/TODO.md`, "OSPS Baseline: what is left").

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

- [How it stays true](#how-it-stays-true)
- [Who may call a route](#who-may-call-a-route)
- [Inbound webhooks](#inbound-webhooks)
- [Outbound integrations](#outbound-integrations)
- [Routes](#routes)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## How it stays true

- `scripts/api-route-inventory.ts` is the one place a route is classified. It reads each `src/app/**/route.ts`, takes the exported methods, and looks for the recognised credential step in the file (comments ignored; for a thin route that only calls a module, in the module too).
- `pnpm docs:api-routes` rewrites the table below. `tests/lib/api-route-inventory.test.ts` fails when the committed table differs from what the code renders, and `tests/lib/api-route-auth.test.ts` (same data) fails on a route with no credential step, unless it is listed as public on purpose with a reason.
- A new route therefore needs a recognised credential step, then `pnpm docs:api-routes`. Nothing else is written by hand.
- **Each handler is checked on its own** (`scripts/api-route-handlers.ts`, `tests/lib/api-route-handlers.test.ts`), so a guarded `POST` does not cover an unguarded `GET` in the same file. With the TypeScript parser it requires, per exported handler: a recognised step in the handler or a function of the same file it calls; a result that is not thrown away (`await requireApiPermission(...)` as a bare statement checks nothing; `requirePermission` is exempt, it redirects itself); `auth.forbidden` read before anything else but `auth.user` is taken from the `requireApiPermission` verdict (the guard sets `forbidden` when there is no user, so it is enough to refuse an anonymous caller); and the check before the first `.from(`, `.rpc(` or `createRepos(`. A handler that is public on purpose while its file has a step goes in `PUBLIC_HANDLERS` with the reason (shrink-only, like `PUBLIC_ROUTES`).
- This is still static analysis: it proves the check is there, first and read, not that every branch returns. Each route's own test (`tests/api/`) covers the refusal. The threat-model view is in `docs/trust/THREAT_MODEL.md` (A01).

## Who may call a route

The proxy treats all of `/api/` as public (`src/lib/supabase/middleware.ts`), and the sign-in endpoints must be reachable before there is a session, so each route authenticates itself. The kinds:

| Kind | Meaning |
|---|---|
| `admin` | Staff: a signed-in account holding the route's permission (`requireApiPermission`, `docs/architecture/PERMISSIONS.md`); the scheduled-job secret also passes. |
| `session` | Member: a signed-in session. |
| `internal-secret` | Scheduled jobs: the shared secret of our own jobs, refused when unset. |
| `webhook-signature` | Provider webhook: the provider's signature or shared token over the request. |
| `signed-token` | A token we signed that names the member and the action (unsubscribe links). |
| `url-secret` | A secret in the URL, looked up on the server (calendar feeds). |
| `oauth-state` | The state cookie of an OAuth round trip, consumed once. |
| `one-time-token` | Sign-in link (`/auth/confirm`, `/auth/slack`): a single-use token checked and spent on the server (`verifyOtp`, `consumeSlackSignIn`). A GET only spends it for a real browser navigation; anything else gets a Continue page whose button (a POST) spends it. |
| `pkce-code` | Sign-in link (`/auth/callback`): a PKCE code only the browser holding the matching verifier cookie can exchange. |
| `public` | No credential, on purpose: the uptime check (`/api/health`, returns only up or down and timings) and the public opt-in form of a published landing page (`/api/landing/opt-in`: honeypot, rate limits, target looked up in the published page). |

A route with more than one kind accepts either (for example a staff account or the scheduled-job secret).

## Inbound webhooks

The routes under `/api/webhooks/` (calendar, Mux, Resend, Slack, Zoom) are the interfaces providers call. Each verifies the provider's signature or token. How to register them with each provider and test them: `docs/infrastructure/WEBHOOK_SETUP.md` and `docs/infrastructure/WEBHOOK_TESTING.md`. How the data they bring in is processed: `docs/architecture/SEQUENCE_DIAGRAMS.md`.

## Outbound integrations

What the app calls on other servers, and the `User-Agent` it sends, is in `docs/infrastructure/OUTBOUND_REQUESTS.md`.

## Routes

<!-- START api-routes generated: run `pnpm docs:api-routes` to update, don't edit by hand -->

176 routes.

| Path | Methods | Who may call it |
|---|---|---|
| `/api/admin/aliases/[id]` | DELETE | `admin` |
| `/api/admin/apply-aliases` | POST | `admin` |
| `/api/admin/events` | GET, POST | `admin` |
| `/api/admin/events/[id]` | GET, PATCH, DELETE | `admin` |
| `/api/admin/events/[id]/attendees` | POST | `admin` |
| `/api/admin/events/[id]/attendees/[memberId]` | PATCH, DELETE | `admin` |
| `/api/admin/events/[id]/kajabi-matches` | GET | `admin` |
| `/api/admin/events/[id]/not-attending` | POST | `admin` |
| `/api/admin/events/[id]/not-attending/[memberId]` | DELETE | `admin` |
| `/api/admin/events/[id]/offers` | GET, POST | `admin` |
| `/api/admin/events/[id]/offers/[offerId]` | PATCH, DELETE | `admin` |
| `/api/admin/events/[id]/photos/[photoId]` | PATCH | `admin` |
| `/api/admin/events/[id]/photos/import/commit` | POST | `admin` |
| `/api/admin/events/[id]/photos/import/status` | GET | `admin` |
| `/api/admin/events/[id]/visibility` | POST | `admin` |
| `/api/admin/events/calendar` | POST | `admin` |
| `/api/admin/feature-flags` | GET | `admin` |
| `/api/admin/feature-flags/[key]` | PATCH | `admin` |
| `/api/admin/feature-flags/[key]/segments` | POST | `admin` |
| `/api/admin/feature-flags/[key]/segments/[segmentId]` | DELETE | `admin` |
| `/api/admin/feedback` | GET | `admin` |
| `/api/admin/feedback/[id]` | PATCH | `admin` |
| `/api/admin/kajabi-offers` | GET | `admin` |
| `/api/admin/landing-pages/import` | POST | `admin` |
| `/api/admin/members/[id]` | PATCH | `admin` |
| `/api/admin/members/[id]/delete-empty-kajabi-contact` | POST | `admin` |
| `/api/admin/members/[id]/owned-data` | GET | `admin` |
| `/api/admin/members/external-status` | GET | `admin` |
| `/api/admin/members/merge` | POST | `admin` |
| `/api/admin/members/move-aliases` | POST | `admin` |
| `/api/admin/members/split` | POST | `admin` |
| `/api/admin/outreach-leads` | PATCH | `admin` |
| `/api/admin/outreach-touches` | POST | `admin` |
| `/api/admin/program-cohorts` | POST | `admin` |
| `/api/admin/program-cohorts/[id]` | PATCH, DELETE | `admin` |
| `/api/admin/program-cohorts/[id]/kajabi-matches` | GET | `admin` |
| `/api/admin/program-enrollments` | POST | `admin` |
| `/api/admin/program-enrollments/[id]` | DELETE | `admin` |
| `/api/admin/programs` | GET, POST | `admin` |
| `/api/admin/programs/[id]` | GET, PATCH, DELETE | `admin` |
| `/api/admin/segments` | GET, POST | `admin` |
| `/api/admin/segments/[id]` | GET, DELETE | `admin` |
| `/api/admin/segments/[id]/invite` | POST | `admin` |
| `/api/admin/segments/[id]/members` | POST | `admin` |
| `/api/admin/segments/[id]/members/[memberId]` | DELETE | `admin` |
| `/api/admin/segments/[id]/sync` | POST | `admin` |
| `/api/admin/segments/sources` | GET | `admin` |
| `/api/admin/users` | GET, POST | `admin` |
| `/api/admin/users/[id]` | PATCH, DELETE | `admin` |
| `/api/admin/users/[id]/access-history` | GET | `admin` |
| `/api/admin/users/[id]/resend` | POST | `admin` |
| `/api/admin/users/[id]/revoke-sessions` | POST | `admin` |
| `/api/admin/work-queue/complete` | POST | `admin` |
| `/api/admin/work-queue/complete/[id]` | DELETE | `admin` |
| `/api/aliases` | POST | `admin` |
| `/api/aliases/slack` | POST | `admin` |
| `/api/analyze/kajabi-grants` | GET | `admin` |
| `/api/analyze/kajabi-stripe-comparison` | GET | `admin` |
| `/api/analyze/resubscriptions` | GET | `admin` |
| `/api/analyze/slack-reconciliation` | GET | `admin` |
| `/api/analyze/stripe-orphans` | GET | `admin` |
| `/api/analyze/subscription-reconciliation` | GET | `admin` |
| `/api/analyze/zoom-access` | GET | `admin` |
| `/api/badge-types/[id]` | DELETE | `admin` |
| `/api/badge-types/[id]/update` | PATCH | `admin` |
| `/api/badge-types/create` | POST | `admin` |
| `/api/bookshelf/cover` | GET, POST | `session` |
| `/api/bookshelf/cover/[assetId]` | GET, PATCH | `session` |
| `/api/calendar/feed/[token]` | GET | `url-secret` |
| `/api/chat/files/[messageId]/[fileId]` | GET | `session` |
| `/api/chat/files/[messageId]/zip` | GET | `session` |
| `/api/chat/hub-links` | GET | `session` |
| `/api/chat/unfurl-image` | GET | `session` |
| `/api/chat/videos/[messageId]` | GET, POST | `session` |
| `/api/client-errors` | POST | `session` |
| `/api/courses/image/[kind]/[id]` | GET | `session` |
| `/api/courses/playback-tokens` | POST | `session` |
| `/api/courses/watch` | POST | `session` |
| `/api/data-hygiene/slack-users/skip` | POST | `admin` |
| `/api/email/unsubscribe` | POST | `signed-token` |
| `/api/events/[eventId]/photos/[photoId]` | GET | `session` |
| `/api/events/past-prickles` | GET | `session` |
| `/api/feature-previews` | GET, POST | `admin` |
| `/api/feedback` | POST | `session` |
| `/api/health` | GET | `public` |
| `/api/import/calendar` | POST | `admin` |
| `/api/import/kajabi` | POST | `admin` |
| `/api/import/kajabi-courses` | POST | `admin` |
| `/api/import/kajabi-product-progress` | POST | `admin` |
| `/api/import/members` | POST | `admin` |
| `/api/import/slack` | POST | `admin` |
| `/api/import/slack-api` | POST | `admin` |
| `/api/import/stripe` | POST | `admin` |
| `/api/import/subscriptions` | POST | `admin` |
| `/api/import/zoom` | POST | `admin` |
| `/api/internal/book-visibility-notice` | GET | `admin` |
| `/api/internal/changelog-digest` | GET | `admin` |
| `/api/internal/csp-health` | GET | `admin` |
| `/api/internal/lesson-comment-notifications` | GET | `admin` |
| `/api/internal/member-reminders` | POST | `internal-secret` |
| `/api/internal/prickle-checkins` | POST | `internal-secret` |
| `/api/landing/opt-in` | POST | `public` |
| `/api/live-room` | GET | `session` |
| `/api/media` | GET, POST | `admin` |
| `/api/media/[id]` | GET, PATCH, DELETE | `admin` |
| `/api/media/[id]/[preset]` | GET | `session` |
| `/api/media/from-event-photo` | POST | `admin` |
| `/api/media/uploads` | POST | `admin` |
| `/api/member-badges/[id]` | DELETE | `admin` |
| `/api/member-badges/award` | POST | `admin` |
| `/api/member-hiatus` | POST | `admin` |
| `/api/member-hiatus/[id]` | PATCH, DELETE | `admin` |
| `/api/member-overrides` | GET, POST | `admin` |
| `/api/member-overrides/[id]` | PATCH, DELETE | `admin` |
| `/api/members` | GET | `admin` |
| `/api/members/network` | GET | `admin` |
| `/api/milestone-photos` | POST, DELETE | `session` |
| `/api/milestone-photos/[token]` | GET | `session` |
| `/api/oauth/google/callback` | GET | `admin` + `oauth-state` |
| `/api/oauth/google/start` | GET | `admin` |
| `/api/oauth/slack/bot/start` | GET | `admin` |
| `/api/oauth/slack/callback` | GET | `admin` + `session` |
| `/api/oauth/slack/start` | GET | `session` |
| `/api/prickle-schedule-locks` | GET, POST | `admin` |
| `/api/prickle-schedules` | GET, POST | `admin` |
| `/api/prickle-schedules/[id]` | PATCH, DELETE | `admin` |
| `/api/prickle-schedules/bootstrap` | POST | `admin` |
| `/api/prickle-types/create` | POST | `admin` |
| `/api/prickle-types/ignore` | POST | `admin` |
| `/api/prickle-types/ignore-batch` | POST | `admin` |
| `/api/prickle-types/resolve` | POST | `admin` |
| `/api/prickle-types/resolve-batch` | POST | `admin` |
| `/api/prickle-types/update` | POST | `admin` |
| `/api/process/attendance` | POST | `admin` |
| `/api/process/calendar` | POST | `admin` |
| `/api/process/chat` | POST | `admin` |
| `/api/process/course-comments` | POST | `admin` |
| `/api/process/course-files` | POST | `admin` |
| `/api/process/course-media` | POST | `admin` |
| `/api/process/course-progress` | POST | `admin` |
| `/api/process/courses` | POST | `admin` |
| `/api/process/member-interactions` | POST | `admin` |
| `/api/process/members` | POST | `admin` |
| `/api/process/slack` | POST | `admin` |
| `/api/profile/photo` | POST, DELETE | `session` |
| `/api/projects/export` | GET | `session` |
| `/api/projects/import/trackbear` | POST | `session` |
| `/api/reconcile/calendar` | GET | `admin` |
| `/api/reconcile/email` | GET | `admin` |
| `/api/reconcile/logins` | GET | `admin` |
| `/api/reconcile/media` | GET | `admin` |
| `/api/reconcile/members` | GET | `admin` |
| `/api/reconcile/retention` | GET | `admin` |
| `/api/reconcile/slack` | GET | `admin` |
| `/api/reconcile/slack-dms` | GET | `admin` |
| `/api/reconcile/stripe-billing` | GET | `admin` |
| `/api/reconcile/zoom` | GET | `admin` |
| `/api/reports/name-matching` | GET | `admin` |
| `/api/reports/unmatched-slack-users` | GET | `admin` |
| `/api/track/events` | POST | `session` |
| `/api/track/page-view` | POST | `session` |
| `/api/webhooks/calendar` | GET, POST | `webhook-signature` |
| `/api/webhooks/mux` | POST | `webhook-signature` |
| `/api/webhooks/resend` | POST | `webhook-signature` |
| `/api/webhooks/slack` | GET, POST | `webhook-signature` |
| `/api/webhooks/slack/commands` | POST | `webhook-signature` |
| `/api/webhooks/slack/interactions` | POST | `webhook-signature` |
| `/api/webhooks/zoom` | GET, POST | `webhook-signature` |
| `/api/zoom/ignore` | POST, DELETE | `admin` |
| `/api/zoom/prickles` | GET | `admin` |
| `/api/zoom/resolve-ambiguous` | POST | `admin` |
| `/auth/callback` | GET | `pkce-code` |
| `/auth/confirm` | GET, POST | `one-time-token` |
| `/auth/slack` | GET | `one-time-token` |
| `/courses/[slug]/lessons/[lessonId]/files/[fileId]` | GET | `session` |
| `/help/images/[scene]/[file]` | GET | `session` |

<!-- END api-routes -->
