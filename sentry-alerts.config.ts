/** Sentry workflows managed by scripts/sentry-alerts.ts. Names are stable identifiers. */
export const SENTRY_SLACK_ALERT_DESTINATION = {
  channel: "#hub-alerts",
  channelId: "C0CA91G8LGH", // https://quillandcup.slack.com/archives/C0CA91G8LGH
} as const;

export const SENTRY_SLACK_ALERTS = [
  {
    name: "Hub production: Slack notification delivery failed",
    environment: "production",
    condition: {
      type: "tagged_event",
      comparison: { key: "notification_channel", match: "eq", value: "slack" },
      conditionResult: true,
    },
  },
  {
    name: "Hub production: ambiguous Slack member match",
    environment: "production",
    condition: {
      type: "event_attribute",
      comparison: { attribute: "message", match: "co", value: "Ambiguous Slack member match" },
      conditionResult: true,
    },
  },
] as const;
