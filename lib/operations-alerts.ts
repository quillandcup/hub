import { WebClient } from "@slack/web-api";
import * as Sentry from "@sentry/nextjs";
import { isProduction, SLACK_ALERTS_CHANNEL_ID } from "@/lib/config";
import { sendEmail } from "@/lib/email";

/** Alerts about the member-notification path, delivered outside that path. */
export type OperationsAlert =
  | { type: "slack_dm_failed"; notificationKind: string; memberId: string }
  | { type: "ambiguous_slack_member_match"; collisions: ReadonlyArray<{ reason: string; slackUserIds: string[]; memberIds: string[] }> };

const ALERT_WINDOW_SECONDS = 10 * 60;
type RateLimitClient = {
  rpc: (name: string, args: { p_bucket: string; p_window_seconds: number; p_max_hits: number }) =>
    PromiseLike<{ data: boolean | null; error: unknown }>;
};

function alertDetails(alert: OperationsAlert): { bucket: string; title: string; text: string } {
  if (alert.type === "slack_dm_failed") {
    return {
      bucket: `operations_alert:slack_dm_failed:${alert.notificationKind}`,
      title: "Slack notification DM failed",
      text: `Slack notification DM failed (kind: ${alert.notificationKind}, member ID: ${alert.memberId}). Check server logs and the Sentry event tagged notification_channel=slack. The failed DM was not retried by the notifier.`,
    };
  }

  const examples = alert.collisions.slice(0, 3).map(({ reason, slackUserIds, memberIds }) =>
    `${reason}: Slack IDs ${slackUserIds.join(", ") || "none"}; member IDs ${memberIds.join(", ") || "none"}`
  );
  return {
    bucket: "operations_alert:ambiguous_slack_member_match",
    title: "Ambiguous Slack member match",
    text: `${alert.collisions.length} ambiguous Slack member match(es) rejected. Check server logs and Sentry for the full details.\n${examples.join("\n")}`,
  };
}

/**
 * Rate-limit repeated failures across serverless invocations, then post to the staff channel.
 * If the bot itself is broken, email ALERTS_EMAIL through Resend so that failure is still visible.
 * Never throws into the member notification or identity-resolution path.
 */
export async function sendOperationsAlert(service: RateLimitClient, alert: OperationsAlert): Promise<void> {
  if (!isProduction) return;
  const { bucket, title, text } = alertDetails(alert);
  try {
    const { data, error } = await service.rpc("rate_limit_hit", {
      p_bucket: bucket,
      p_window_seconds: ALERT_WINDOW_SECONDS,
      p_max_hits: 1,
    });
    if (error) {
      console.error("[operations-alerts] rate limit lookup failed", error);
    } else if (data !== true) {
      return;
    }
  } catch (error) {
    console.error("[operations-alerts] rate limit lookup threw", error);
  }

  try {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) throw new Error("SLACK_BOT_TOKEN is not configured");
    await new WebClient(token).chat.postMessage({
      channel: SLACK_ALERTS_CHANNEL_ID,
      text: `🚨 ${text}`,
      unfurl_links: false,
      unfurl_media: false,
    });
  } catch (error) {
    console.error("[operations-alerts] Slack channel post failed", error);
    Sentry.captureException(error, { tags: { operations_alert: alert.type, alert_channel: "slack" } });
    const address = process.env.ALERTS_EMAIL;
    if (!address) {
      console.error("[operations-alerts] ALERTS_EMAIL is not configured; email fallback unavailable");
      return;
    }
    try {
      await sendEmail({
        to: address,
        subject: `[Hub alert] ${title}`,
        text,
        html: `<pre>${text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</pre>`,
      });
    } catch (emailError) {
      console.error("[operations-alerts] email fallback failed", emailError);
      Sentry.captureException(emailError, { tags: { operations_alert: alert.type, alert_channel: "email" } });
    }
  }
}
