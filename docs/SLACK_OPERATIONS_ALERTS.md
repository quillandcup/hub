# Slack notification operations alerts

The Sentry Slack integration requires a Team plan, so the Hub app posts its own production
alerts to [#hub-alerts](https://quillandcup.slack.com/archives/C0CA91G8LGH) through Billie Bot.
The channel ID is in `app.config.ts`; the alert cases are in `lib/operations-alerts.ts`:

- A Slack member notification DM failed and was skipped by the notifier.
- A Slack user matched ambiguously to Hub members and was rejected.
- A scheduled job finished with problems, so its Checkly heartbeat was skipped (`cron_partial_failure`; today the nightly Slack reconciliation: a Silver step failed, threads were left behind, capture errors, or it failed outright). The message names the job and lists each problem.
- A traced page section failed (`section_failed`, from `traced()` in `lib/query-trace.ts`: today the admin member page's queries). A Postgres statement timeout (code 57014) is called out as such. Limited to one per section every ten minutes; the message names the section, and the Sentry event tagged `section` has the member id.

The original failures still appear in server logs and Sentry. The channel messages contain
only notification kinds, reasons and IDs, not member names, email addresses or message bodies.
Repeated alerts of the same type are limited to one every ten minutes using the existing
database-backed `rate_limit_hit` function. Ambiguous matches found in one resolution pass are
batched into one message.

If Billie Bot cannot post, the app emails `ALERTS_EMAIL` through Resend and captures the
posting failure in Sentry. Both destinations failing is logged and captured in Sentry; the
member notification flow still finishes without throwing an alert-delivery error.

## Setup and verification

1. Add Billie Bot to `#hub-alerts` (or confirm it is already a member). The app's bot token
   needs channel access; member DM test mode does not redirect these staff alerts.
2. Confirm production has `SLACK_BOT_TOKEN`, `ALERTS_EMAIL` and `RESEND_API_KEY`.
3. In a production-safe test, cause one failed notification DM and one ambiguous member
   match. Verify the corresponding server log, Sentry event and `#hub-alerts` post.
4. Separately test the email fallback with a controlled Slack posting failure.

`SENTRY_ALERTS_AUTH_TOKEN` and the [hub-iac internal integration](https://quillandcup.sentry.io/settings/developer-settings/hub-iac-45ec4c/)
were created for the initial Sentry workflow approach. They are no longer used by this alert
path and do not need to be synced to Vercel.
