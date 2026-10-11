import { WebClient } from "@slack/web-api";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chatSlackWritesEnabled } from "@/lib/chat/slack-post";
import { getSlackUserToken, isDeadTokenError } from "@/lib/slack-connect";

/**
 * Sends a member's Hub reaction to Slack as them, when they have connected Slack. The bot can't
 * react under someone else's name, so without a connection the reaction stays in the Hub
 * (synced_to_slack = false, which chat_toggle_reaction sets). Service role.
 *
 * `active` is the state chat_toggle_reaction just left the reaction in: true = add it in Slack,
 * false = take it back. Returns whether Slack now agrees. Slack saying it already does
 * (already_reacted / no_reaction) counts as agreeing; a dead token revokes the connection; anything
 * else leaves the reaction Hub-only and is logged.
 */
export async function syncReactionToSlack(
  service: SupabaseClient,
  opts: { messageId: string; memberId: string; emoji: string; active: boolean }
): Promise<boolean> {
  if (!chatSlackWritesEnabled()) return false;

  const { data: message } = await service
    .from("chat_messages")
    .select("slack_ts, chat_channels(slack_channel_id)")
    .eq("id", opts.messageId)
    .maybeSingle();
  const channels = message?.chat_channels as { slack_channel_id: string | null } | { slack_channel_id: string | null }[] | null | undefined;
  const slackChannelId = (Array.isArray(channels) ? channels[0] : channels)?.slack_channel_id;
  if (!message?.slack_ts || !slackChannelId) return false;

  const connection = await getSlackUserToken(service, opts.memberId);
  if (!connection) return false;

  const slack = new WebClient(connection.token);
  const args = { channel: slackChannelId, timestamp: message.slack_ts, name: opts.emoji };
  try {
    if (opts.active) await slack.reactions.add(args);
    else await slack.reactions.remove(args);
  } catch (error) {
    const code = (error as { data?: { error?: string } } | null)?.data?.error;
    const agrees = opts.active ? code === "already_reacted" : code === "no_reaction";
    if (!agrees) {
      if (isDeadTokenError(error)) await service.rpc("slack_connection_revoke", { p_member: opts.memberId });
      else console.error("syncReactionToSlack failed for message %s:", opts.messageId, error);
      return false;
    }
  }

  await service
    .from("chat_reactions")
    .update({ synced_to_slack: true })
    .eq("message_id", opts.messageId)
    .eq("emoji", opts.emoji)
    .eq("member_id", opts.memberId)
    .is("slack_user_id", null);
  return true;
}
