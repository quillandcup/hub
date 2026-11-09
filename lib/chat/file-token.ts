import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { getSlackBotToken } from "@/lib/slack-bot-token";
import { getSlackUserToken } from "@/lib/slack-connect";
import { isSlackDmChannelId } from "@/lib/slack-messages";

/**
 * The Slack token to fetch a chat file with. The bot's, except for a file in a 1:1 DM: the bot can't be in one, so
 * it can't read its files, and the person looking at it asks with their own token (a participant, since RLS let
 * them read the message). Null when that can't be had (no working connection, or viewing as someone else, which
 * never shows a DM). Once copied, the file is served from our bucket whoever asks.
 */
export async function slackFileToken(service: SupabaseClient, user: AuthUser, slackChannelId: string | null): Promise<string | null> {
  if (!isSlackDmChannelId(slackChannelId)) return (await getSlackBotToken()) ?? "";
  const identity = await getEffectiveIdentity(user);
  if (!identity || identity.isSudo) return null;
  return (await getSlackUserToken(service, identity.memberId))?.token ?? null;
}
