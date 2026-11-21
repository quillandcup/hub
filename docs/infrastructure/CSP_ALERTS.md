# CSP rollout alerts

> **Status:** living. **Last reviewed:** 2026-11-20. Review: yearly. Kept up to date with the code; if it is wrong, fix it.

The Content-Security-Policy is moving to a strict, nonce-based script policy (`src/lib/csp.ts`, `docs/TODO.md`, "CSP for scripts and styles (nonces)"). Two things can go wrong without anyone noticing, so two layers watch for them:

1. **Sentry alert rules** (`config/sentry.yml`, `alerts:`) email when a CSP violation is new, comes back, or floods in.
2. **A daily health check** (`/api/internal/csp-health`, `src/lib/csp-health.ts`) reads the access log and, when browsers are not running our scripts, sends a Sentry event per failing check. A fourth Sentry rule emails about those. It sends nothing when all is well. Everything arrives by Sentry email: one channel, nothing goes to Slack.

Neither pushes anything to production by itself: the Sentry rules are applied by CI after a deploy (`docs/infrastructure/SENTRY_CONFIG.md`), the check is a Vercel cron (`vercel.json`, 15:00 UTC daily; an admin can open the URL to run it now).

## Sentry alert rules

The first three match CSP reports only (the tag `logger=csp`, which every report carries) and email the issue owners, or the active members when an issue has no owner. Sentry's own default alerts are left alone: only rules named `Hub: ...` are managed, and deleting one from the file deletes it from Sentry.

| Rule | Fires when | What to check |
|---|---|---|
| `Hub: CSP violation, new issue` | A violation of a kind not seen before (a new blocked host or directive). | Open the issue: the blocked host and directive are in the title. Is it ours (add the host to `config/app.ts` `csp.*Hosts`) or a browser extension (ignore, or filter)? |
| `Hub: CSP violation, came back after being resolved` | A resolved CSP issue gets a new event (a regression). | The fix did not hold: compare with the release it was resolved in. |
| `Hub: CSP violation, more than 100 events in an hour` | One CSP issue gets more than 100 events within an hour (at most one email an hour per issue). | A policy change now blocks something every page loads, or a loop is reporting. Look at the newest events (URL, browser). |
| `Hub: CSP health check failed` | The daily health check sent an event (it carries the plain custom tag `csp_health_check`, set to the check name, and the rule matches on that tag being set; CSP reports have no such tag, and these events are tagged `logger=csp-health`, not `csp`, so the three rules above never match them). The first event of an issue emails at once; after that at most one email a day per issue (`frequencyMinutes: 1440`, the workflow's pause between two notifications for the same issue). | See "The daily health check" below: the issue's title says which check, its event has the counts and browsers. |

**Why 100 an hour.** Measured in Sentry on 2026-11-20 (14 days): the noisiest issue, a font host blocked on every page builder load, had 847 events in two days (about 18 an hour on average), the next 660 in eight hours (about 80 an hour), and every deploy to a preview URL produces a burst of 30 events within seconds. 100 stays quiet on those and still catches a policy that starts blocking something on every page view of the 90 or so active members.

**Email only, one channel.** Our Sentry plan cannot send to Slack, and the owner wants no second channel: the health check does not post to Slack either. The emails go to the issue's owners (ownership rules), or, when an issue has no owner, to the active members of the project's teams.

## The daily health check

Over the last 24 hours (`config/app.ts` `cspHealth`; every threshold below lives there). It reads one SQL aggregate (`csp_rollout_activity`, one row per user and user agent, about a hundred rows) and never the request log row by row. When a check trips, the route calls `Sentry.captureMessage` (level error, tags `csp_health_check=<stranded|lost-google-cookie|unsupported-browser>` (the one the alert rule matches, because a plain custom tag is indexed whatever the SDK does with Sentry's own `logger` field), plus `check` with the same value and `logger=csp-health` for people reading the issue (nothing depends on those two), a fixed message and fingerprint per check, so a problem that lasts is one issue) and waits for `Sentry.flush` before it answers. The event's extra data has counts and browser family and major version only, never names, emails, ids or user agents. The check reads nothing from Sentry. User agents `node` and anything with `HeadlessChrome` (our test runs) are ignored.

### 1. Members load pages but never run our scripts

A member has requests the server logged (`is_page = false`) but no page view from the browser beacon (`is_page = true`), and nothing that only running scripts do (calls to our own API, or the router prefetching three or more pages in one second). **Alerts at 2 members or 5% of the active members, whichever is more.**

Means: a browser that ignores nonces gets pages whose scripts are blocked, so it never hydrates and never sends the beacon. **Check:** the browsers named in the post. If it is one family and version, load a page in it and read the console for blocked scripts. Compare the policy the proxy sends with the previous deploy's.

Why the script-request condition: the proxy cannot tell a page load from a tab left open for days (Next strips its prefetch headers first), and such a tab keeps prefetching and polling without a new page view. Without the condition, 11 of the last 14 daily windows would have alerted (3 of 18 members on 2026-11-20, all in a tab last loaded 33 to 80 hours earlier). With it, 1 of 14 would, at exactly the threshold. A member whose scripts are blocked is still caught: their requests are page loads only.

### 2. The Google tag stopped working

Members with at least **3 page views** in the window, and the `_ga` cookie on none of them, though it was on some page view in the 30 days before. Each member is compared with **their own history**, because about 13 of 91 members never get the cookie in any browser (content blockers, tracking protection) and that is steady day to day. **Alerts at 4 such members that are at least 25% of the members who had the cookie before.**

Means: the page runs, but the Google tag the page injects is blocked: a browser without `'strict-dynamic'` support, or a host missing from `connect-src` or `script-src`. **Check:** the browsers named; whether the Sentry issues for `googletagmanager.com` or `google-analytics.com` are new; Google Analytics real-time for your own visit.

### 3. Unsupported browsers

Any request or page view from a browser below what nonces plus `'strict-dynamic'` need: Chrome or Chromium under **52**, Edge under **79**, Firefox under **52**, Safari under **15.4**, and any browser on an iPhone or iPad under iOS **15.4** (they all run WebKit, so the iOS version decides). **Alerts on any.** Other browsers (Opera, Samsung Internet, DuckDuckGo, and so on) are not judged: their version numbers don't map onto these.

Means: a member's browser cannot run the policy at all. **Check:** the browser named; whether that member needs a nudge to update, and whether to keep a looser policy for them (there is no way to do that per browser today).

### Baselines (production, measured 2026-11-20)

- 30 days: **0 of 91** active members loaded pages without running our scripts; in daily windows about 1 of 20 does by the script-request rule above.
- About **13 of 91** members never get the `_ga` cookie in any browser, steady.
- No unsupported browser. The oldest seen: Chrome 150, Firefox 153, Edge 155, iOS 18.5, desktop Safari 18.
- Reading the aggregate takes about 0.25 s on production (533k rows); the first version, which let the planner walk the per-user index, took 3.5 s against the 8 s statement timeout, so the function sets `enable_indexscan = off`.

### Verify after the first deploy

An alert that fails silently is the worst kind, so check the path once, end to end:

1. **The rules exist.** After CI's `push-sentry-config` job has run for the merge, `pnpm sentry:config:diff` (read-only) must print "No differences." Four `+ alert ... (create)` lines mean the push did not happen or failed: read that job's log first. In Sentry, Alerts should list the four `Hub: ...` rules.
2. **A real event matches the health check rule.** Open the daily route once as an admin (`/api/internal/csp-health`) on a day when a check is tripped, or ask for a test event: in Sentry, open the event of an issue titled "CSP health check: ..." and confirm it has the tag `csp_health_check`; the alert email for the first event should arrive. If an event has the tag and no email comes, the rule's filter or the integration's permissions are wrong, not the check. When no check is tripped nothing is sent, so there may be no event to look at: that is the normal state, and then only step 1 can be verified.
3. **The CSP report rules.** A real report such as the ones already in Sentry carries `logger=csp`; the "new issue" rule fires on the first report of a kind not seen before.

### When it alerts

The cron runs once a day and sends the same event again each day an unfixed problem lasts. Sentry groups them into one issue (the fixed fingerprint), and the rule emails once for the issue and then at most once a day. Resolve the issue in Sentry once fixed; it reopens, and emails, only if the problem returns. If the cron itself fails (the access log could not be read) the route answers 500 and logs `[csp-health]`; look there in the Vercel logs. It has no Checkly monitor yet, like the other jobs held back by the plan limit (`src/lib/cron-heartbeats.ts`).
