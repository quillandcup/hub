import { WebClient } from "@slack/web-api";
import { isProduction } from "@/lib/config";

/**
 * Whether outbound Slack DMs sent via this module should be redirected to SLACK_DEV_USER_ID
 * instead of their real recipient. Safe-by-default: unset SLACK_TEST_MODE means "redirect
 * everywhere except production" -- a deploy has to explicitly opt OUT of redirecting (set
 * SLACK_TEST_MODE=false) to send for real outside prod, and explicitly opt IN (set =true) to
 * dry-run inside prod.
 */
export function isSlackTestMode(): boolean {
  if (process.env.SLACK_TEST_MODE) return process.env.SLACK_TEST_MODE === "true";
  return !isProduction;
}

export interface SendSlackDMParams {
  slackUserId: string;
  text: string;
  blocks?: any[];
}

/**
 * Shared DM sender for new Writing Projects Phase 1 senders (pre-prickle nudge, post-prickle
 * quick-log prompt). Existing senders (wheel-of-wonder/actions.ts, feedback/route.ts) keep their
 * own direct WebClient calls for now -- migrating them onto this helper is a flagged fast-follow,
 * not part of this change, so their sends are unaffected by SLACK_TEST_MODE.
 */
export async function sendSlackDM(params: SendSlackDMParams): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.error("sendSlackDM: SLACK_BOT_TOKEN not configured, skipping send");
    return;
  }

  let { slackUserId, text } = params;
  const { blocks } = params;

  if (isSlackTestMode()) {
    const devUserId = process.env.SLACK_DEV_USER_ID;
    if (!devUserId) {
      console.error("sendSlackDM: SLACK_TEST_MODE is on but SLACK_DEV_USER_ID is unset -- skipping send rather than risk a real one");
      return;
    }
    text = `🧪 [test mode — would have gone to ${slackUserId}]\n${text}`;
    slackUserId = devUserId;
  }

  const slack = new WebClient(token);
  await slack.chat.postMessage({ channel: slackUserId, text, blocks });
}
