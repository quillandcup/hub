# Threat model and OWASP Top 10 review

Done 2026-11-17 for the "Threat review" item of the [Supabase production security checklist](https://supabase.com/docs/guides/security/production-checklist) (`docs/SUPABASE_SECURITY_CHECKLIST.md`). It is a review of the code and configuration in this repository, not a penetration test: nothing was attacked, and production was only read. Where a line says "checked" it names what was read; where it says "not checked" nobody has looked yet. Findings that need work are in `docs/TODO.md`, "Threat model follow-ups".

Public repo: no names, emails or ids here (`.claude/rules/public-repo-hygiene.md`).

## What we protect

| Asset | Why it matters |
|---|---|
| Members' writing (projects, goals, progress, books) | The thing members care about most. Only they, and staff acting through the audited paths, should read it. |
| Member personal data (names, emails, billing status, attendance, Slack content) | Personal data; Slack content is service-role only (`.claude/rules/data-architecture.md`). |
| Staff powers (admin pages, sudo "view as member", imports, flags) | Whoever holds them can read or change anything. |
| Service credentials (Supabase service role, Stripe, Slack, Zoom, Kajabi, Resend, Mux, Google) | Each one is a way around row-level security or into a provider account. Rotation: `docs/SECRET_ROTATION.md`. |
| Availability of sign-in and the live prickle pages | Members arrive at the same few minutes. |

## Who might attack, and what they have

| Actor | Starting point |
|---|---|
| Anonymous visitor | The public site, `/login`, landing pages, and every `/api/*` route (the proxy treats all of `/api/` as public; each route must authenticate itself). |
| Signed-in member | A valid session. Wants another member's data, staff powers, or to spam others. |
| Someone who gets hold of a member's link | A magic link, a calendar feed URL, an unsubscribe link, a forwarded email. |
| A compromised account (member, staff, or a Supabase or GitHub account) | The largest blast radius; see A07 and the account items in `docs/SUPABASE_SECURITY_CHECKLIST.md`. |
| A compromised or malicious provider or dependency | Webhook senders, npm packages, GitHub Actions. |

## Entry points and how each is guarded

Every `app/api` route file is classified by credential kind in `tests/lib/api-route-auth.test.ts` (2026-11-18: admin 129, member session 22, provider signature or token 7, internal secret 2, signed token 1, secret URL token 1, OAuth state 1, public on purpose 2; a file with two kinds counts in both). A new route without a recognised check fails that test.

| Entry point | Guard | Checked |
|---|---|---|
| Member and admin pages | The proxy redirects signed-out visitors to `/login`; `/admin` paths are checked in the proxy and again by `requireAdminPage()` / `requireAdminAction()` (`.claude/rules/admin-route-protection.md`). | Proxy read. |
| Member data in pages | RLS on every public and bronze table (0 without it, prod); member pages read through `getEffectiveIdentity`. | Prod query. |
| Provider webhooks (Slack, Zoom, Mux, Resend, Google Calendar) | Signature or shared-token check; a deployed build rejects every request while the secret is unset (`lib/webhook-auth.ts`, constant-time compare). | Each handler contains a verification step; Calendar, Mux and the Zoom/Slack/Resend paths were read only as far as that. |
| Cron and internal routes (`/api/internal/*`) | `Authorization: Bearer` with `CRON_INTERNAL_SECRET`, refused when unset. | `member-reminders` and `prickle-checkins` check the secret; `changelog-digest` and `lesson-comment-notifications` use `requireAdmin` (the cron secret passes it). Classified by the route test. |
| Public routes with their own credential | Calendar feed (secret token in the URL, looked up server-side, 404 when unknown); unsubscribe (signed token, POST only so scanners cannot unsubscribe anyone); landing opt-in (hidden honeypot field, two rate-limit buckets, the form is looked up in the published page, so it cannot post to a form the page does not show); `media/[id]/[preset]` and course images (private bucket, served only to the caller RLS allows, or to anyone only for assets marked public). | Read. |
| Member-callable API routes | `getCurrentUser()` / `getCoursesCaller()`, then checks for the specific object (course access, message readable); several have rate limits (`lib/rate-limit.ts`). | Sampled: `courses/watch`, `courses/playback-tokens`, `chat/*`, `track/events`, `client-errors`. |
| Server fetches of addresses people choose (chat link previews, pictures, book covers) | `lib/net/safe-fetch.ts`: http(s) only, ports 80/443, every resolved address must be public, connection pinned to the checked address, redirects followed by hand and re-checked, size and time caps. | Read the design; tests exist. Every caller using it was not enumerated. |
| Rich text shown as HTML (lesson bodies, landing blocks) | Three `dangerouslySetInnerHTML` sites; content goes through `sanitize-html` (`lib/courses/sanitize.ts`, `lib/landing/sanitize.ts`). | Sanitizer files exist and are imported; allow-lists not reviewed line by line. |
| Browser protections | CSP (report-only for scripts and styles, with a per-request nonce), and the other headers in `SECURITY_HEADERS` (`next.config.ts`, `lib/csp.ts`). | Config read. |
| Sessions | Supabase cookies, `SameSite=Lax`, `Secure` in deployed builds, exact host only. Not HttpOnly (the browser client reads the session for chat and uploads), so an injected script could read it; see `lib/security.ts` and `docs/TODO.md`, "Make the sign-in cookies HttpOnly". | Read. |

## OWASP Top 10 (2021 list)

Status: **Covered**, **Partial**, **Gap**, **Not checked**.

| # | Category | Status | Evidence, and what is missing |
|---|---|---|---|
| A01 | Broken access control | Partial | Strong base: RLS on every table today (a pgTAP test fails CI for a new table without it, and one for a new `SECURITY DEFINER` function with no caller check: `docs/RLS_SECURITY.md`), admin checks in the proxy and in each page and action, ids are unguessable short ids (`.claude/rules/resource-ids.md`), every `/api` route checks for itself. `/api/` is public in the proxy, so a route that forgets to authenticate is open; `tests/lib/api-route-auth.test.ts` (2026-11-18) lists all 163 `app/api` route files with their credential kind and fails on one with none (only `health` and the landing opt-in are listed as public on purpose) and on a stale entry. It is static text: it proves a recognised check is in the file, not that every code path reaches it. Service-role clients are used in 13 files (RLS does not protect those; each must check the caller first). |
| A02 | Cryptographic failures | Covered | TLS to the app and SSL enforced on the database (prod). Secrets in env vars and the Supabase vault; stored provider tokens are encrypted (`docs/TODO.md`, "Secrets at Rest" for what remains). Webhook and token comparisons are constant-time. Member-facing wording is in `lib/security.ts`. |
| A03 | Injection | Covered, with one check outstanding | All queries go through PostgREST and the repositories (no string-built SQL in app code was found by the data-access guard test). Stored HTML is sanitised before it is rendered. Not checked: the allow-lists in the two sanitizers, and whether each `SECURITY DEFINER` function is correct (51 are executable by signed-in users; each was read on 2026-11-18 and has a caller check or is a reviewed read, and a test requires one for new ones; the test cannot show a check is correct; `docs/TODO.md`, "Supabase Security Advisories"). |
| A04 | Insecure design | Partial | Good patterns: soft deletes, sudo is audited, accept-to-transfer hand-overs, one notifier for anything sent to members. Missing: this document is the first written threat model; abuse cases beyond the rate-limited routes (below) were not enumerated. |
| A05 | Security misconfiguration | Partial | Sign-ups off, email confirmations on, custom SMTP, RLS on, SSL enforced. Deviations are recorded in `docs/SUPABASE_SECURITY_CHECKLIST.md` (24 h link expiry, open network restrictions, Realtime without Broadcast authorisation). CSP for scripts and styles is report-only, so it blocks nothing yet (`docs/TODO.md`, "CSP for scripts and styles"). One finding fixed with this review: the Google Calendar webhook wrote its secret channel token to the logs on every call; it now logs only whether one was sent. Anyone who had log access could have replayed it, so `GOOGLE_CALENDAR_WEBHOOK_TOKEN` was rotated on 2026-11-18 (new channel opened, old one stopped, first push accepted). |
| A06 | Vulnerable and outdated components | Covered | Dependabot weekly for npm and GitHub Actions, auto-merge for minor and patch only, CodeQL on pull requests, secret scanning (`lib/security.ts`). `pnpm audit --prod --audit-level=high` runs in its own non-required workflow (`.github/workflows/audit.yml`: weekly, and on a change to `package.json` or the lockfile) and only warns. Checked 2026-11-18: 9 findings in transitive packages, one high with no patched version (`docs/TODO.md`, "Threat model follow-ups"). |
| A07 | Identification and authentication failures | Partial | Invite only, magic link or code, per-address email limit, 150 sign-in emails an hour. Gaps: links stay valid 24 hours; no CAPTCHA (low risk with sign-ups off); TOTP is on in prod but the Hub has no screen to enrol in or require it, so staff accounts in the Hub are not required to use it. Closed on 2026-11-18 (owner-reported): MFA is required for the database, hosting and code provider organizations, each with a second owner. A takeover of one of those accounts remains the highest-impact risk in this document, now with a second factor in front of it. |
| A08 | Software and data integrity failures | Covered | One CI pipeline deploys; Vercel's own git deploys are off for `main`; `main` is protected and needs checks; migrations are pushed by CI before the deploy. Webhook payloads are verified before use. Not checked: third-party scripts loaded in the browser (the CSP report-only data will show them). |
| A09 | Security logging and monitoring failures | Partial | Sentry for errors, an audit log and Activity Log for staff actions and sudo, operations alerts to Slack, Checkly monitors. Gaps: no alert on repeated failed webhook verification or on a burst of sign-in emails; the secret-in-logs bug above showed that log content was never reviewed. Reviewed 2026-11-18 (`app/` and `lib/`): one more leak fixed (the Kajabi OAuth failure logged the whole response body) and Sentry events now have credentials in addresses redacted (the calendar feed token is in its path, sign-in and unsubscribe links in their query; `lib/sentry-scrub.ts`). `tests/lib/no-secret-logging.test.ts` fails on a log call that passes a whole headers object, the environment or a serialised request. Vercel's own request logs still record paths, which cannot be scrubbed from the code. |
| A10 | Server-side request forgery | Covered | `lib/net/safe-fetch.ts` (above) and `docs/OUTBOUND_REQUESTS.md`. `tests/lib/safe-fetch-callers.test.ts` lists every server file that makes a request and says why its address is fixed (a provider host, our own project, an operator's variable) or sends it through `safe-fetch`; a new caller or a stale entry fails it. Checked 2026-11-18: no member-chosen address bypasses it. |

## Abuse cases worth planning for

| Abuse | Today | Gap |
|---|---|---|
| Someone floods sign-in emails for a member's address | 60 s per-address limit, 150/hour overall. | The overall cap is shared: a flood from one source can block everyone else's sign-in for an hour. Monitor; CAPTCHA if it happens. |
| A member scrapes other members' data | RLS limits what a session can read. | No per-user rate limit on read routes in general; the `lib/security.ts` item "Limits on abuse" already says not every route was reviewed. |
| A member uses chat to reach internal addresses | `safe-fetch`. | Callers are enumerated and guarded by a test (A10). |
| A staff account is taken over | Admin checks, audit log. | MFA is required on the provider organizations (owner-reported 2026-11-18); Hub staff accounts have no MFA requirement. Sudo and imports are powerful, so this stays the highest-impact item. |
| A leaked calendar feed or unsubscribe URL | Feed token can be replaced with "Generate new link"; unsubscribe can only turn emails off. | Feed URLs can end up in logs of calendar apps and proxies; acceptable, since the feed carries only that member's schedule (confirm what it includes). |
| A provider webhook is forged | Verified, secrets required in production. | Secrets must not appear in logs (found and fixed once). |

## Review again when

A new public route, webhook or provider is added; sign-ups open; a staff capability is added (imports, sudo, flags); a new place renders stored HTML or fetches a user-chosen URL; or after any security incident.
