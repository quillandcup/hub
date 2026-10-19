# Slack notification alerts in Sentry

`sentry-alerts.config.ts` declares two production Sentry workflows for the `hub` project:

- A Slack notification send that fails (`notification_channel=slack` on the captured exception).
- An ambiguous Slack-to-member match (`Ambiguous Slack member match` on the captured message).

Both notify [#hub-alerts](https://quillandcup.slack.com/archives/C0CA91G8LGH) through **Sentry's Slack integration**. The destination lives in the committed config. The workflows fire when an issue is first seen, regresses, or reappears. Further events in an already-open issue remain visible in Sentry and server logs but do not send a new Slack alert. This is issue alerting, not a per-attempt delivery receipt.

## Setup

1. Install Sentry's Slack integration into the Quill & Cup workspace and allow it to post in `#hub-alerts`. The Hub/Billie Bot Slack app is separate.
2. In Sentry, open **Settings → Custom Integrations → Create New Integration → Internal Integration**. Name it `hub-alerts-iac`. In **Permissions**, set **Alerts = Write** and **Organization = Read**. Leave the other permissions at **No Access** and **Continuous Integration (CI)** unchecked. Leave the webhook fields blank and **Alert Action** off; this integration is only an API credential. Save it, then copy its token from the **Tokens** section. Set it as `SENTRY_ALERTS_AUTH_TOKEN` in your shell or local ignored env file. The **Organization Tokens** page only offers the fixed `org:ci` scope for source-map uploads; it cannot configure alert permissions. Keep the existing `SENTRY_AUTH_TOKEN` for CI builds.
3. If Sentry has more than one active Slack integration, set `SENTRY_ALERTS_SLACK_INTEGRATION_ID` to the desired integration's numeric ID.
4. Run `npm run sentry:alerts:validate`, `npm run sentry:alerts:diff`, then `npm run sentry:alerts:push`. Run `diff` again; it should report zero pending changes.
5. Trigger a safe test event in production and verify the Sentry issue, workflow evaluation, and Slack delivery. Do this before relying on the alert for a global Slack notification rollout.

`diff` never writes. `push` creates or updates only workflows whose names are declared in the config; it does not delete other Sentry alerts. A later config change is applied by running `push` again. The sync discovers the project's Error Monitor and the installed Slack integration through Sentry's API, so their IDs are not committed.

The script uses Sentry's EU API (`de.sentry.io`) for the `quillandcup` organization. The workflow API is in beta; if Sentry changes its payload, validate against a read-only `diff` and a single `push` before adding automation to CI.
