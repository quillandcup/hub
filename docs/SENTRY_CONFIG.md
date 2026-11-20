# Sentry config as code

`config/sentry.yml` is the source of truth for two things in Sentry:

- **Organization data-scrubbing settings** (Settings → Security & Privacy): server-side data scrubbing, the default scrubbers, and not storing IP addresses. They are organization-wide, so every project inherits them and shows its own switches as locked.
- **Issue alert rules** for the `hub` project (`alerts:`), today the three CSP alerts described in `docs/CSP_ALERTS.md`. The organization is on Sentry's workflow engine, so a rule is a workflow connected to the project's issue stream detector, with a trigger (new issue, regression, every event), filters (the `logger=csp` tag, a frequency threshold) and an email action. Sentry's own default alerts are not touched: only workflows named `Hub: ...` are managed, matched by name, so a push is idempotent, and a rule removed from the file is deleted from Sentry.

On a push to main that changes the file or `scripts/sentry-config.ts`, after the production deploy, CI's `push-sentry-config` job runs `scripts/sentry-config.ts push`. It prints the difference from the live organization, writes only what differs (the settings that differ; the rules to create, update or delete), then reads everything back to confirm. Change the file, not the Settings or Alerts pages: the next push puts the values back.

## Before merging a change

```bash
pnpm sentry:config:diff
```

Read-only. It needs `SENTRY_CONFIG_TOKEN` in `.env.prod` or `.env.shared`. It lists the alert rules a push would create (`+`), change (`~`) or delete (`-`).

## The token

`SENTRY_CONFIG_TOKEN` is a token of the organization's `hub-iac` **internal integration** (Settings → Custom Integrations → `hub-iac`), whose Organization permission is Read & Write. For the alert rules the integration also needs **Alerts: Read & Write** and **Project & Team: Read**, and the token must be one created after the permissions were changed (Sentry shows a token's scopes on the integration page). It is not `SENTRY_AUTH_TOKEN`, the build token for source maps, which gets 403 on organization settings. A GitHub secret only: `pnpm env:sync:github --only=SENTRY_CONFIG_TOKEN`. Sync it before merging the change that first needs it, or the push job fails. The integration is organization-owned, so the token doesn't depend on any one person's account. Revoke or replace it from the integration's page.

## Adding a rule

Add an entry under `alerts:` with a name starting `Hub: `, a `when` (`new_issue`, `regression` or `every_event`), the `logger` tag it is limited to, and `frequencyMinutes` (the pause between two emails for the same issue). `when: every_event` needs `moreThan: { count, interval }` (more than `count` events within `interval`, such as `1h`). The shapes are checked by `parseAlertRules` (`lib/sentry-config.ts`). To notify somewhere other than email (Slack), the action in `workflowBody` changes; see `docs/TODO.md`, "Route the CSP alerts to Slack".

## Not covered

- **Session Replay masking** is client-side: `instrumentation-client.ts` and `data-sentry-unmask` on the components it unmasks.
- **Retention** (replays, errors) is set by Sentry's plan, not by the API.
- **Other project settings** (additional sensitive fields, safe fields, custom scrubbing rules) are not managed; add them to the file and script when one is needed.
- **Alert rules other than `Hub: ...`**, including Sentry's defaults, stay as they are in the dashboard.
