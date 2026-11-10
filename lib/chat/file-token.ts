import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { getSlackBotToken } from "@/lib/slack-bot-token";
import { getSlackUserToken } from "@/lib/slack-connect";
import { isMemberTokenConversation } from "@/lib/chat/slack-dm-events";
import { ensureSlackFileCopied, type EnsuredSlackFile } from "@/lib/slack-capture";

/**
 * Makes sure a chat file is in our bucket, asking Slack for it if it isn't yet, and says where it is. The bot's token,
 * except for a file in a 1:1 DM or in a group DM the bot is not in: the bot can't read those, so the person looking at
 * it asks with their own token (they were let in by RLS, so they are a participant). Only ever the viewer's own: another
 * member's connection is never used for something they didn't ask for. Nothing is asked of Slack when the viewer has no
 * working connection, or is viewing as someone else (which never shows a DM). Once copied, it is served from our bucket
 * whoever asks; the pull copies a member's own DM files with their own token when it runs.
 */
export async function copyChatFile(
  service: SupabaseClient,
  user: AuthUser,
  ref: { fileId: string; channelId: string; messageTs: string }
): Promise<EnsuredSlackFile> {
  if (!(await isMemberTokenConversation(service, ref.channelId))) return ensureSlackFileCopied(service, (await getSlackBotToken()) ?? "", ref);

  const identity = await getEffectiveIdentity(user);
  if (!identity || identity.isSudo) return { ok: false, reason: "no Slack connection to ask with" };
  const connection = await getSlackUserToken(service, identity.memberId);
  if (!connection) return { ok: false, reason: "no Slack connection to ask with" };
  return ensureSlackFileCopied(service, connection.token, ref);
}
