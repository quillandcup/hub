import { sendSlackDM } from "@/lib/slack";
import { resolveSlackUserIds } from "@/lib/slack-member-ids";
import type { ChannelAdapter, OutboundMessage } from "./types";

/**
 * Slack DM from the bot. A member is reachable when we can match them to a Slack user
 * (lib/slack-member-ids.ts). sendSlackDM honors SLACK_TEST_MODE.
 */
export const slackChannel: ChannelAdapter = {
  id: "slack",
  resolveAddresses: (supabase, memberIds) => resolveSlackUserIds(supabase, memberIds),
  async send(slackUserId, message) {
    await sendSlackDM({ slackUserId, text: message.text, blocks: slackBlocks(message) });
  },
};

export function slackBlocks(message: OutboundMessage): any[] {
  const body = message.slackBlocks ?? [
    {
      type: "section",
      text: { type: "mrkdwn", text: message.url ? `${message.text}\n<${message.url}|Open in the Hub>` : message.text },
    },
  ];
  const links = (message.footerLinks ?? []).map((l) => ({ type: "mrkdwn", text: `<${l.url}|${l.label}>` }));
  if (links.length === 0) return body;

  // Join a trailing context footer (Slack shows its elements side by side, max 10) rather than stack a second one.
  const last = body[body.length - 1];
  if (last?.type === "context" && Array.isArray(last.elements) && last.elements.length + links.length <= 10) {
    return [...body.slice(0, -1), { ...last, elements: [...last.elements, ...links] }];
  }
  return [...body, { type: "context", elements: links }];
}
