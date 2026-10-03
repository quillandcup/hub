# Slack app manifest as code

`slack-app-manifest.yml` is the source of truth for the Slack app (Billie Bot): its name and description, bot scopes, the `/hub` slash command, event subscriptions and request URLs.

On every push to main, after the production deploy, CI's `push-slack-manifest` job runs `scripts/slack-manifest.ts push`, which prints the difference between the manifest and the live app and then replaces the live configuration (it skips the update when there is no difference).

**The push replaces everything.** Anything set in the Slack dashboard but absent from the manifest is removed on the next push to main. Change the manifest, not the dashboard.

## Before merging a manifest change

```bash
SLACK_CONFIG_TOKEN=xoxe.xoxp-... npm run slack:manifest:diff
```

Read-only. Make sure it shows only the change you intend. A `-` line is something the live app has that the manifest doesn't: the push would remove it, so add it to the manifest if it should stay.

`SLACK_CONFIG_TOKEN` is an app configuration **access** token from [api.slack.com/apps](https://api.slack.com/apps) → "Your App Configuration Tokens" (valid 12 hours). `SLACK_APP_ID` comes from `.env.shared`/`.env.prod`. `npm run slack:manifest:push` does a manual push the same way.

Two things a push can't do for you:

- **Scope changes need a reinstall.** The job prints a warning when scopes changed; reinstall the app to the workspace (Install App → Reinstall) for them to take effect.
- **Request URLs are verified by Slack.** That's why the job runs after the deploy.

## One-time setup

The job fails until all three exist.

1. **`SLACK_APP_ID`** (GitHub variable): the app's `A...` id, in `.env.shared` (the app uses it too); `npm run env:sync:github` sets it.
2. **`GH_TOKEN_SLACK_MANIFEST`** (GitHub secret): a fine-grained personal access token limited to this repository with **Secrets: Read and write**. Put it in `.env.prod` and run `npm run env:sync:github`. It expires on the date you pick; rotate it then.
3. **`SLACK_CONFIG_REFRESH_TOKEN`** (GitHub secret): at api.slack.com/apps → "Your App Configuration Tokens", generate a token for the workspace and copy the **refresh** token (`xoxe-...`):

   ```bash
   gh secret set SLACK_CONFIG_REFRESH_TOKEN --repo quillandcup/hub
   ```

   Paste it at the prompt. Don't put it in `.env.prod`, and it isn't in `env-vars.config.ts`: see below.

## How the token rotates

Slack's configuration access tokens last 12 hours, so CI stores the refresh token instead. Each run trades it for a fresh access token (`tooling.tokens.rotate`), and Slack hands back a **new** refresh token at the same time. The script writes that new one to the `SLACK_CONFIG_REFRESH_TOKEN` secret straight away, before touching the manifest. The secret therefore changes on every run, which is why it can't be synced from a file.

Configuration tokens belong to a user and workspace, not to the app, so the job acts as whoever generated the token. That person must be a collaborator on the Slack app.

## If the job fails on the token

`tooling.tokens.rotate: invalid_refresh_token` (or the "could not save the new refresh token" message) means the stored refresh token is spent or lost. That happens if a run died between rotating and saving, if `GH_TOKEN_SLACK_MANIFEST` expired, or if someone used that same refresh token elsewhere. Repeat step 3 above, fix `GH_TOKEN_SLACK_MANIFEST` if that was the cause, then re-run the job (`gh run rerun <run-id> --failed`).

The production deploy has already finished by the time this job runs, so a failure here never blocks a release.
