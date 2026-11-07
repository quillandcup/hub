## sentry-resolve-in-release

When a change fixes what a Sentry issue reports, resolve the issue **in the release that ships the fix**, once it is deployed. Sentry then reopens it only if an event arrives from a *newer* release; old tabs and old builds still running the previous release don't count. So an issue that stays quiet is the proof the fix worked, and one that comes back says so by itself. Leaving a fixed issue unresolved "until we see it stop" makes the list noise that hides the next real one.

**When**
- After the PR is merged and its `main` run has deployed (`ship-via-pr.md`, step 7: the `production` tag contains the squash commit). Not before: the release doesn't exist yet, and a fix that never shipped must not close the issue.
- Only the issues whose cause the change removed. If the cause isn't known, or the change only mitigates (a notice, a retry), leave the issue open, or resolve it and expect it to reopen, and tell the user which you did.
- Never mute or ignore an issue to quiet it; that hides the evidence.

**How** (the org is in Sentry's EU region: `appConfig.sentry` in `app.config.ts` has org `quillandcup`, project `hub`, API `https://de.sentry.io`)
- The release version is the full commit SHA of the squash commit (`git rev-parse <short-sha>`): the build uploads source maps under it. Check it exists first: `GET /api/0/organizations/quillandcup/releases/<sha>/`.
- `sentry-cli` can't be used for this: its config points at the US `sentry.io` while the org is in the EU, and it ignores the token when the URL comes from elsewhere. Call the API with the token already in `~/.sentryclirc`, without ever printing it: write the header to a file and pass that to curl.

```bash
awk -F= '/^token=/{print "Authorization: Bearer " $2}' ~/.sentryclirc > /tmp/sentry_hdr
curl -s -X PUT -H @/tmp/sentry_hdr -H "Content-Type: application/json" \
  -d '{"status":"resolved","statusDetails":{"inRelease":"<full sha>"}}' \
  "https://de.sentry.io/api/0/organizations/quillandcup/issues/<numeric issue id>/"
```

- The numeric issue id is in the issue's URL, or in `GET /api/0/projects/quillandcup/hub/issues/?query=is:unresolved` (the short id such as `HUB-6` is `shortId`). The response echoes the signed-in user's profile; don't paste it into chat.
- Find the cause from the events before guessing: `GET .../issues/<id>/events/`, then each event (breadcrumbs, browser, OS, release). What the events show, not the title, is what turns "it crashed" into a cause; report it.
- Resolving is a write to the user's Sentry account. It is the expected last step after a fix, but only for the issues the change addresses; say which in the follow-up ("resolved HUB-T, HUB-5, HUB-D in release 1d820d36").

Issues the fix doesn't cover stay as they are. A `docs/TODO.md` entry about an issue names its id (HUB-n), so the next person can find it.
