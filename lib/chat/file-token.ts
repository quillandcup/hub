import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { getSlackBotToken } from "@/lib/slack-bot-token";
import { getSlackUserToken } from "@/lib/slack-connect";
import { isMemberTokenConversation } from "@/lib/chat/slack-dm-events";

/**
 * The Slack token to fetch a chat file with. The bot's, except for a file in a 1:1 DM or in a group DM the bot is not in: the bot can't read those, so
 * it can't read its files, and the person looking at it asks with their own token (a participant, since RLS let
 * them read the message). Null when that can't be had (no working connection, or viewing as someone else, which
 * never shows a DM). Once copied, the file is served from our bucket whoever asks.
 */
export async function slackFileToken(service: SupabaseClient, user: AuthUser, slackChannelId: string | null): Promise<string | null> {
  if (!(await isMemberTokenConversation(service, slackChannelId))) return (await getSlackBotToken()) ?? "";
  const identity = await getEffectiveIdentity(user);
  if (!identity || identity.isSudo) return null;
  return (await getSlackUserToken(service, identity.memberId))?.token ?? null;
}
