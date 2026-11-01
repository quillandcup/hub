import { WebClient } from "@slack/web-api";
import * as Sentry from "@sentry/nextjs";
import appConfig from "../app.config";
import { isProduction, SLACK_ALERTS_CHANNEL_ID } from "@/lib/config";
import { sendEmail } from "@/lib/email";
import { getSlackBotToken } from "@/lib/slack-bot-token";

/** Alerts about the member-notification path, delivered outside that path. */
export type OperationsAlert =
  | { type: "slack_dm_failed"; notificationKind: string; memberId: string }
  | { type: "section_failed"; section: string; code?: string; ms: number }
  | { type: "client_crash"; route: string; message: string }
  | { type: "cron_partial_failure"; job: string; problems: string[] }
  | { type: "ambiguous_slack_member_match"; collisions: ReadonlyArray<{ reason: string; slackUserIds: string[]; memberIds: string[] }> };

const ALERT_WINDOW_SECONDS = 10 * 60;
type RateLimitClient = {
  rpc: (name: "rate_limit_hit", args: { p_bucket: string; p_window_seconds: number; p_max_hits: number }) =>
    PromiseLike<{ data: boolean | null; error: unknown }>;
};

/** Sentry issue search for events tagged with this section, last 24 hours, newest first. */
export function sentrySectionSearchUrl(section: string): string {
  const query = new URLSearchParams({ query: `section:"${section}"`, statsPeriod: "24h", sort: "date" });
  return `https://${appConfig.sentry.org}.sentry.io/issues/?${query}`;
}

function alertDetails(alert: OperationsAlert): { bucket: string; title: string; text: string } {
  if (alert.type === "slack_dm_failed") {
    return {
      bucket: `operations_alert:slack_dm_failed:${alert.notificationKind}`,
      title: "Slack notification DM failed",
      text: `Slack notification DM failed (kind: ${alert.notificationKind}, member ID: ${alert.memberId}). Check server logs and the Sentry event tagged notification_channel=slack. The failed DM was not retried by the notifier.`,
    };
  }

  if (alert.type === "section_failed") {
    const what = alert.code === "57014" ? "timed out in the database" : `failed${alert.code ? ` (${alert.code})` : ""}`;
    return {
      bucket: `operations_alert:section_failed:${alert.section}`,
      title: `Page section ${alert.section} ${what}`,
      text: `Page section "${alert.section}" ${what} after ${alert.ms} ms. Find the event in <${sentrySectionSearchUrl(alert.section)}|Sentry> (tagged section; it has the member id and the request) and the "[section failed]" line in the Vercel logs.`,
    };
  }

  if (alert.type === "client_crash") {
    // The message comes from a browser, so it is untrusted: one short line, escaped for Slack.
    const message = alert.message.replace(/\s+/g, " ").trim().slice(0, 200).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    return {
      bucket: `operations_alert:client_crash:${alert.route}`,
      title: `Page ${alert.route} crashed in the browser`,
      text: `Page ${alert.route} crashed in a member's or admin's browser: "${message}". Server logs have nothing for it; look for the browser event in Sentry for this route, and in the browser console.`,
    };
  }

  if (alert.type === "cron_partial_failure") {
    return {
      bucket: `operations_alert:cron_partial_failure:${alert.job}`,
      title: `Scheduled job ${alert.job} did not finish cleanly`,
      text: `Scheduled job ${alert.job} did not finish cleanly, so its Checkly heartbeat was skipped:\n${alert.problems.join("\n")}\nCheck the Vercel logs for that run.`,
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
    const token = await getSlackBotToken();
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
