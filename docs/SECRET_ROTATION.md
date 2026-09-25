# Secret Rotation Runbook

When to use this: after any credential exposure (a leaked `.env` file, a secret dumped into
a session log, a compromised laptop, etc.), or routine rotation hygiene. Written up after a
real incident on 2026-09-25 where `.env.prod` was accidentally dumped in full, in plaintext,
into 16 local Claude Code session transcripts going back to late August.

See `env-vars.config.ts` at the repo root for the full list of vars, which are secrets, and
where each one is synced. See `docs/INTEGRATION_LINKS.md` for dashboard links to every
integrated service (this doc only covers rotation-specific steps, not general account
management).

## General process (every var)

1. **Rotate on the provider's side first.** Don't invent a new value yourself unless the var
   is self-generated (see below) -- most of these are provider-issued and won't authenticate
   until the provider's side actually changes too.
2. **Update `.env.prod`** (and `.env.devel` too, if the same external credential is shared
   across environments -- check whether the var already exists there).
3. **Sync:**
   ```bash
   # Scoped sync -- just the vars you rotated, production only (fast, low blast radius)
   npm run env:sync -- --only=NAME1,NAME2 --target=production

   # Full Vercel sync -- every var, every environment (only if .env.devel changed too)
   npm run env:sync

   # GitHub Actions secrets (CHECKLY_*, SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD, VERCEL_*)
   npm run env:sync:github

   # Supabase Vault (CRON_INTERNAL_SECRET only, read by pg_cron -- not covered by the above)
   npm run env:sync:vault
   ```
4. **Trigger a deploy** -- push a commit to `main` (even a trivial one) or re-run the `CI`
   workflow. This is the actual test: `vercel pull`/`build`/`deploy` in the `deploy` job will
   fail loudly if a rotated value doesn't work, `push-migrations` will fail loudly if
   `SUPABASE_ACCESS_TOKEN`/`SUPABASE_DB_PASSWORD` don't work.
5. **Verify**: CI green, `curl https://hub.quillandcup.com/api/health`, and spot-check
   whatever feature actually exercises the rotated credential (see per-service notes below
   for how to confirm each one is genuinely working, not just present).

## Per-service rotation steps

### Stripe
- https://dashboard.stripe.com/apikeys -> Developers -> API keys -> Roll key.

### Supabase
- Personal access token (CI): https://supabase.com/dashboard/account/tokens
- DB password: https://supabase.com/dashboard/project/bxwtougjidectvjegdlr/settings/database
  -> **Reset database password**. The new password only works once you've actually clicked
  this -- pasting a self-invented value into `.env.prod` without resetting it on Supabase's
  side first fails with `password authentication failed for user "postgres"`.
- Anon / service role keys: https://supabase.com/dashboard/project/bxwtougjidectvjegdlr/settings/api
  -- **verify the rotation actually happened**, these are JWTs and it's easy to just copy the
  same unrotated value back. Decode the `iat` claim and confirm it's recent:
  ```bash
  node -e "console.log(new Date(JSON.parse(Buffer.from(process.argv[1].split('.')[1],'base64')).iat*1000))" "$KEY"
  ```

### Vercel
- https://vercel.com/account/tokens -> revoke the old token, create a new one **scoped to the
  Quill and Cup team, not to a specific project**. Project-scoped tokens can't run `vercel
  pull` (it needs to resolve org/user identity; only `vercel deploy` has a fallback for
  project-scoped tokens) -- this cost a full failed deploy cycle the first time. Verify before
  wiring it in:
  ```bash
  vercel whoami --token=<new-token>   # must print your username, not "User not found."
  ```

### Zoom
- https://marketplace.zoom.us/develop/apps/gcFgx-76S8aaL4AiYqaHng/credentials -- log in as
  **ania@quillandcup.com** -- regenerate Client Secret.
- Webhook Secret Token: same app, Event Subscriptions page (currently blank in `.env.prod` --
  nothing to rotate until one's actually issued).

### Kajabi
- https://app.kajabi.com/admin/settings/public_api

### Google Cloud (service account + OAuth)
- Service account key: https://console.cloud.google.com/iam-admin/serviceaccounts?project=quillandcup
  -> `quill-cup-admin-portal@quillandcup.iam.gserviceaccount.com` -> **Keys** tab -> **Add Key**
  -> download the new JSON, paste its full contents into `GOOGLE_SERVICE_ACCOUNT_KEY` ->
  confirm the new key works -> only then delete the old key ID from that page.
- Want to rename the account (e.g. to something Hedgie-Hub-specific instead of
  `admin-portal`)? Do that as its **own separate task**, not bundled into an urgent rotation --
  Google Calendar access is granted by sharing the calendar with a specific service account
  email, so a new account needs the calendar re-shared, and it's easy to forget that step and
  quietly break calendar sync.
- OAuth client secret: https://console.cloud.google.com/apis/credentials?project=quillandcup
  -> find the OAuth 2.0 Client ID -> reset/add a secret.

### Slack
- **Reinstalling the app to the workspace does NOT rotate the bot token** if scopes haven't
  changed -- classic Slack bot tokens (`xoxb-...`) don't expire and Slack only revokes them
  when the app is actually uninstalled. Force it with `auth.revoke`, using the *current*
  (soon-to-be-dead) token as auth:
  ```bash
  curl -X POST https://slack.com/api/auth.revoke -H "Authorization: Bearer $OLD_SLACK_BOT_TOKEN"
  # {"ok":true,"revoked":true} confirms it's dead -- this also fully uninstalls the app
  ```
- Then reinstall to get a fresh token:
  https://app.slack.com/app-settings/T01NPHKSMA9/A0AS93BKT09/oauth -> **Reinstall to
  Workspace**.
- Slack-dependent features (feedback widget notifications, new book/award pings, writing
  nudge DMs) are down between the revoke and the reinstall+resync+redeploy -- do this in one
  sitting.

### Sentry
- https://quillandcup.sentry.io/settings/auth-tokens/ (org slug is `quillandcup` -- matches
  `next.config.ts`'s `withSentryConfig({ org: "quillandcup" })`).
- Org-level tokens only offer one scope preset, `org:ci` (bundles Source Map Upload + Release
  Creation + Code Mappings) -- there's no picker, that's the only option.
- **A token existing and being wired in does not mean uploads are working** -- failures here
  are silent by design (see the comment above `withSentryConfig(...)` in `next.config.ts`).
  Verify by checking the next deploy's `Build project artifacts` CI log for a real
  `Source Map Upload Report` listing files with debug IDs. If you instead see `Warning: No
  auth token provided` or the report step is just missing, the token isn't actually working
  even if the build succeeds.

### Checkly
- https://app.checklyhq.com/settings/user/api-keys

### Resend
- https://resend.com/api-keys

### Self-generated secrets (no external dashboard)
`SUDO_SECRET`, `CRON_SECRET`, `CRON_INTERNAL_SECRET` aren't tied to any provider -- just
generate a fresh one and paste it in:
```bash
openssl rand -hex 32
```
`CRON_INTERNAL_SECRET` additionally needs `npm run env:sync:vault` (pg_cron reads it from
Supabase Vault, not from Vercel's `process.env`).

## Gotchas learned the hard way (2026-09-25 incident)

1. **A file-editing tool with no prior read baseline can dump an entire file into the session
   transcript.** The harness shows a full diff when it has nothing to diff against -- this is
   how `.env.prod` ended up in plaintext across 16 local session logs from one `sed` call.
   Read a file once, safely, before any edit tool touches it for the first time in a session.
2. **Vercel's `env add` defaults to `Secret`/`Sensitive` type (CLI 59+), which is never
   retrievable again by anyone, including `vercel pull`.** `NEXT_PUBLIC_*` vars get inlined
   into the client bundle at build time, so a Sensitive `NEXT_PUBLIC_*` var ships the literal
   string `"[SENSITIVE]"` to every visitor's browser. Always pass `--type config` explicitly
   (`scripts/sync-to-vercel.ts` does this automatically).
3. **This project has `vercel@^56.3.2` pinned as a devDependency.** Running any script via
   `npx` from a directory with `node_modules` silently shadows the global Vercel CLI with that
   ancient local one (no `--type` flag support at all) -- bit us mid-rotation, briefly leaving
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` unset in production. `sync-to-vercel.ts` now strips
   `node_modules/.bin` from `PATH` before spawning `vercel` to guard against this; be aware if
   you ever write a new ad hoc `vercel` command by hand.
4. **Vercel tokens must be team-scoped, not project-scoped**, for the CI `pull`/`build`/
   `deploy` pattern -- see the Vercel section above.
5. **`SUPABASE_DB_PASSWORD` must actually be reset on Supabase's side**, not just edited in
   `.env.prod` -- see the Supabase section above.
6. **Supabase anon/service-role keys' `iat` claim is the only reliable freshness signal** --
   see the Supabase section above.
