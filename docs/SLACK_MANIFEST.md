# Slack app manifest as code

`config/slack-app-manifest.yml` is the source of truth for the Slack app (Billie Bot): its name and description, bot scopes, the `/hub` slash command, event subscriptions and request URLs.

On a run on main where `config/slack-app-manifest.yml` or `scripts/slack-manifest.ts` differs from the last commit pushed (the `slack-manifest-pushed` tag, moved after each successful push; a busy main cancels the run for the merge that changed the manifest, so a later run picks the change up), after the production deploy, CI's `push-slack-manifest` job runs `scripts/slack-manifest.ts push`, which prints the difference between the manifest and the live app and then replaces the live configuration (it skips the update when there is no difference). Runs where neither file differs from the last push skip the job's steps, so they don't spend the refresh token (see [If the job fails on the token](#if-the-job-fails-on-the-token)). A manual run (`gh workflow run ci.yml --ref main`) always pushes.

**The push replaces everything.** Anything set in the Slack dashboard but absent from the manifest is removed on the next manifest push. Change the manifest, not the dashboard.

## Before merging a manifest change

```bash
SLACK_CONFIG_TOKEN=xoxe.xoxp-... pnpm slack:manifest:diff
```

Read-only. Make sure it shows only the change you intend. A `-` line is something the live app has that the manifest doesn't: the push would remove it, so add it to the manifest if it should stay.

`SLACK_CONFIG_TOKEN` is an app configuration **access** token from [api.slack.com/apps](https://api.slack.com/apps) → "Your App Configuration Tokens" (valid 12 hours). `SLACK_APP_ID` comes from `.env.shared`/`.env.prod`. `pnpm slack:manifest:push` does a manual push the same way.

Two things a push can't do for you:

- **Scope changes need a reinstall.** The job prints a warning when scopes changed; reinstall the app to the workspace (Install App → Reinstall) for them to take effect.
- **Request URLs are verified by Slack.** That's why the job runs after the deploy.

## One-time setup

The job fails until all three exist.

1. **`SLACK_APP_ID`** (GitHub variable): the app's `A...` id, in `.env.shared` (the app uses it too); `pnpm env:sync:github` sets it.
2. **`GH_TOKEN_SLACK_MANIFEST`** (GitHub secret): a fine-grained personal access token limited to this repository with **Secrets: Read and write**. Put it in `.env.shared` and run `pnpm env:sync:github`. It expires on the date you pick; rotate it then.
3. **`SLACK_CONFIG_REFRESH_TOKEN`** (GitHub secret): at api.slack.com/apps → "Your App Configuration Tokens", generate a token for the workspace and copy the **refresh** token (`xoxe-...`):

   ```bash
   gh secret set SLACK_CONFIG_REFRESH_TOKEN --repo quillandcup/hub
   ```

   Paste it at the prompt. Don't put it in `.env.prod`, and it isn't in `config/env-vars.ts`: see below.

## The #hub-alerts webhook

Billie Bot also holds the incoming webhook the weekly dependency audit (`.github/workflows/audit.yml`) uses to post one line to #hub-alerts. It is the `incoming-webhook` bot scope in `config/slack-app-manifest.yml`; the workflow does a plain `curl` POST to the URL in the `SLACK_ALERTS_WEBHOOK_URL` GitHub secret, with no bot token involved. A webhook URL can only post to the one channel picked when it was added. (It used to be a second Slack app; the free plan allows only 10 installed apps, so it moved here.)

The webhook is created in the Slack dashboard, not by the manifest, so a manifest push never creates one. After the first push with the `incoming-webhook` scope (a scope change):

1. **Reinstall Billie Bot** (a scope change needs a manual reinstall; the push job prints a warning). Billie Bot has token rotation on, so the dashboard has no Reinstall button: sign in as an admin and open `/api/oauth/slack/bot/start`, approve in Slack, and the Hub stores the new token pair (see "If the refresh token is lost" in [docs/SECRET_ROTATION.md](SECRET_ROTATION.md); `lib/slack-bot-install.ts` asks for the manifest's bot scopes, a test keeps the two equal). Slack may ask which channel the incoming webhook posts to during that approval; the Hub ignores that webhook, so use step 2 for the one the audit uses.
2. **Add the webhook**: the same app -> Incoming Webhooks -> Add New Webhook to Workspace -> pick **#hub-alerts** -> Allow. Copy the webhook URL.
3. **Store it**:

   ```bash
   gh secret set SLACK_ALERTS_WEBHOOK_URL --repo quillandcup/hub
   ```

   Paste the URL at the prompt. It is not in `config/env-vars.ts` and not in any env file.
4. **Check it**: `gh workflow run audit.yml` posts only if the audit finds something, so test the webhook with a one-off `curl` of your own, or wait for the next finding.

Check after the first manifest push that the webhook still exists (Incoming Webhooks page lists it) and is not wiped by a later push; manifest pushes are meant to leave it alone, but verify once. To rotate it, revoke it on the Incoming Webhooks page, add a new one for #hub-alerts and repeat step 3.

## How the token rotates

Slack's configuration access tokens last 12 hours, so CI stores the refresh token instead. Each run trades it for a fresh access token (`tooling.tokens.rotate`), and Slack hands back a **new** refresh token at the same time. The script writes that new one to the `SLACK_CONFIG_REFRESH_TOKEN` secret straight away, before touching the manifest. The secret therefore changes on every run, which is why it can't be synced from a file.

Configuration tokens belong to a user and workspace, not to the app, so the job acts as whoever generated the token. That person must be a collaborator on the Slack app.

## If the job fails on the token

`tooling.tokens.rotate: invalid_refresh_token` (or the "could not save the new refresh token" message) means the stored refresh token is spent or lost. That happens if a run died between rotating and saving, if `GH_TOKEN_SLACK_MANIFEST` expired, or if someone used that same refresh token elsewhere. Repeat step 3 above, fix `GH_TOKEN_SLACK_MANIFEST` if that was the cause, then re-run the job (`gh run rerun <run-id> --failed`).

It can also be a race rather than a spent token. A run seems to fix its secret values around when it's queued, so a run queued while an earlier run's job was rotating carries the old refresh token. Check `gh secret list` first: if `SLACK_CONFIG_REFRESH_TOKEN` was updated after the failed run was created, the stored token is probably fine. Re-run the failed job before generating a new token.

A failed push isn't retried by later pushes that don't touch the manifest, so re-run the failed job (or start a manual run) rather than waiting for the next merge.

The production deploy has already finished by the time this job runs, so a failure here never blocks a release.
