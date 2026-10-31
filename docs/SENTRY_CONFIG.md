# Sentry config as code

`sentry-config.yml` is the source of truth for the Sentry organization's data-scrubbing settings (Settings → Security & Privacy): server-side data scrubbing, the default scrubbers, and not storing IP addresses. They are organization-wide, so every project inherits them and shows its own switches as locked.

On a push to main that changes the file or `scripts/sentry-config.ts`, after the production deploy, CI's `push-sentry-config` job runs `scripts/sentry-config.ts push`. It prints the difference from the live organization, writes only the settings that differ, then reads them back to confirm. Change the file, not the Settings page: the next push puts the values back.

## Before merging a change

```bash
pnpm sentry:config:diff
```

Read-only. It needs `SENTRY_CONFIG_TOKEN` in `.env.prod` or `.env.shared`.

## The token

`SENTRY_CONFIG_TOKEN` is a token of the organization's `hub-iac` **internal integration** (Settings → Custom Integrations → `hub-iac`), whose Organization permission is Read & Write. It is not `SENTRY_AUTH_TOKEN`, the build token for source maps, which gets 403 on organization settings. A GitHub secret only: `pnpm env:sync:github --only=SENTRY_CONFIG_TOKEN`. Sync it before merging the change that first needs it, or the push job fails. The integration is organization-owned, so the token doesn't depend on any one person's account. Revoke or replace it from the integration's page.

## Not covered

- **Session Replay masking** is client-side: `instrumentation-client.ts` and `data-sentry-unmask` on the components it unmasks.
- **Retention** (replays, errors) is set by Sentry's plan, not by the API.
- **Project settings** (additional sensitive fields, safe fields, custom scrubbing rules) are not managed; add them to the file and script when one is needed.
