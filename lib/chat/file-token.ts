import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { getSlackBotToken } from "@/lib/slack-bot-token";
import { getSlackUserToken } from "@/lib/slack-connect";
import { isMemberTokenConversation } from "@/lib/chat/slack-dm-events";
import { ensureSlackFileCopied, type EnsuredSlackFile } from "@/lib/slack-capture";
import { createRepos } from "@/lib/data/repos";

/**
 * Makes sure a chat file is in our bucket, asking Slack for it if it isn't yet, and says where it is. The bot's token,
 * except for a file in a 1:1 DM or in a group DM the bot is not in: the bot can't read those, so the people in the
 * conversation ask with their own token. The viewer's first (they were let in by RLS, so they are a participant),
 * then the other members who have pulled the conversation, since a file Slack won't give one participant may be
 * served to another (a member who connected before the file scope, say). Nothing is asked of Slack when nobody has a
 * working connection, or when viewing as someone else (which never shows a DM). Once copied, it is served from our
 * bucket whoever asks.
 */
export async function copyChatFile(
  service: SupabaseClient,
  user: AuthUser,
  ref: { fileId: string; channelId: string; messageTs: string }
): Promise<EnsuredSlackFile> {
  if (!(await isMemberTokenConversation(service, ref.channelId))) return ensureSlackFileCopied(service, (await getSlackBotToken()) ?? "", ref);

  const identity = await getEffectiveIdentity(user);
  if (!identity || identity.isSudo) return { ok: false, reason: "no Slack connection to ask with" };
  const repos = createRepos(service);
  const chatChannelId = await repos.chat.idBySlackChannel(ref.channelId).catch(() => null);
  const others = chatChannelId ? (await repos.chat.activeMembersOf([chatChannelId]).catch(() => [])).map((r) => r.member_id).filter((id) => id !== identity.memberId) : [];

  let last: EnsuredSlackFile = { ok: false, reason: "no Slack connection to ask with" };
  for (const memberId of [identity.memberId, ...others]) {
    const connection = await getSlackUserToken(service, memberId);
    if (!connection) continue;
    last = await ensureSlackFileCopied(service, connection.token, ref);
    if (last.ok) return last;
  }
  return last;
}
