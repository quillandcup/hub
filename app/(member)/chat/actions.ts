"use server";

import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity, type EffectiveIdentity } from "@/lib/sudo";
import { effectiveMemberHasFeature, getUserFeaturePreviews } from "@/lib/features.server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/chat/format";
import {
  buildMessageViews,
  chatTextContext,
  loadChannelForMember,
  loadChatChannels,
  loadMessages,
  type ChatMessageView,
} from "@/lib/chat/load";
import type { ChatTextContext } from "@/components/chat/ChatText";

/**
 * Who is calling a chat action: the signed-in member with chat on, or null (signed out, no member
 * record, chat off). Actions are directly callable endpoints, so each one checks for itself rather
 * than trusting the page that offers it; unlike the pages they answer "nothing" instead of redirecting.
 */
async function chatCaller(): Promise<{ userId: string; identity: EffectiveIdentity } | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const identity = await getEffectiveIdentity(user);
  if (!identity) return null;
  if (!(await effectiveMemberHasFeature("chat", identity, await getUserFeaturePreviews(user.id)))) return null;
  return { userId: user.id, identity };
}

/**
 * The signed-in member has seen a conversation through `through` (the time of the newest message
 * they had on screen): moves their own read marker forward (the `chat_mark_read` function can only
 * touch the caller's row, in a conversation they are in, and never backward or past now). `through`
 * is the message's own created_at string, passed on untouched: a JavaScript Date would round it to
 * the millisecond, leaving the newest message a few microseconds "unread" for good.
 * Quietly does nothing when chat is off for them or in sudo, which is read-only, so a viewing
 * admin never marks things read for the member they are looking at.
 */
export async function markChatRead(channelId: string, through: string): Promise<void> {
  if (!isUuid(channelId)) return;
  if (Number.isNaN(Date.parse(through))) return;
  const caller = await chatCaller();
  if (!caller || caller.identity.isSudo) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("chat_mark_read", { p_channel_id: channelId, p_through: through });
  if (error) console.error("chat_mark_read failed:", error.message);
}

export interface OlderChat {
  /** Oldest first, the page of messages before the cursor. */
  views: ChatMessageView[];
  ctx: ChatTextContext;
  /** Cursor for the page before this one, or null at the start of the conversation. */
  olderBefore: string | null;
}

/**
 * The page of top-level messages before `before` (a created_at cursor, passed through untouched so
 * its microseconds survive), for "load older" in the conversation. Same rules as the page: only
 * what the member may read, and nothing for a restricted conversation while viewing as a member.
 * Null when it can't be loaded (no access, bad cursor).
 */
export async function loadOlderChat(channelId: string, before: string): Promise<OlderChat | null> {
  if (!isUuid(channelId) || Number.isNaN(Date.parse(before))) return null;
  const caller = await chatCaller();
  if (!caller) return null;
  const { identity } = caller;

  const supabase = await createClient();
  const channel = await loadChannelForMember(supabase, channelId, identity.memberId, identity.isSudo);
  if (!channel || (identity.isSudo && channel.restricted)) return null;

  const page = await loadMessages(supabase, channel.id, { before });
  const [{ views, ...rendered }, channels] = await Promise.all([
    buildMessageViews(supabase, channel, page.messages, identity.memberId),
    loadChatChannels(supabase, identity.memberId, identity.isSudo),
  ]);
  return { views, ctx: chatTextContext(rendered, channels), olderBefore: page.olderBefore };
}
