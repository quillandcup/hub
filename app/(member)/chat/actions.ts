"use server";

import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity, type EffectiveIdentity } from "@/lib/sudo";
import { effectiveMemberHasFeature, getUserFeaturePreviews } from "@/lib/features.server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { sendChatMessageToSlack } from "@/lib/chat/slack-post";
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

export type SendChatResult = { ok: true; id: string } | { ok: false; error: string };

/** What chat_post_message's 'chat_post: <reason>' errors mean to the person who wrote the message. */
const POST_ERRORS: Record<string, string> = {
  no_member: "You need a member profile to post.",
  not_in_channel: "You can only post in conversations you are in.",
  not_bridged: "This conversation isn't connected to Slack, so it can't take posts yet.",
  archived: "This conversation is archived.",
  empty: "Write something first.",
  too_long: "That message is too long (4,000 characters at most).",
  bad_thread: "That thread can't be replied to.",
};

/** Posting is its own preview on top of chat, and never happens in sudo (read-only). */
async function postingCaller() {
  const caller = await chatCaller();
  if (!caller || caller.identity.isSudo) return null;
  if (!(await effectiveMemberHasFeature("chat_posting", caller.identity, await getUserFeaturePreviews(caller.userId)))) return null;
  return caller;
}

/**
 * The signed-in member posts `body` to a conversation (or as a reply in a thread). The message is
 * written first, as the member (chat_post_message checks they are in the conversation and that it
 * is bridged and open), then sent to Slack as the bot under their name and photo. If Slack is
 * down the message stays in the Hub marked failed, and the member can retry it; the nightly chat
 * run retries too.
 */
export async function sendChatMessage(channelId: string, body: string, threadRootId?: string): Promise<SendChatResult> {
  if (!isUuid(channelId) || (threadRootId !== undefined && !isUuid(threadRootId))) return { ok: false, error: "Something went wrong." };
  if (!(await postingCaller())) return { ok: false, error: "Posting isn't available to you yet." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("chat_post_message", {
    p_channel_id: channelId,
    p_body: body,
    p_thread_root_id: threadRootId ?? null,
  });
  if (error || !data) {
    const reason = /chat_post: (\w+)/.exec(error?.message ?? "")?.[1];
    if (!reason) console.error("chat_post_message failed:", error?.message);
    return { ok: false, error: (reason && POST_ERRORS[reason]) || "Something went wrong. Try again." };
  }

  await sendChatMessageToSlack(createServiceRoleClient(), data as string);
  return { ok: true, id: data as string };
}

/** The author sends one of their own failed messages to Slack again. */
export async function retryChatMessage(messageId: string): Promise<SendChatResult> {
  if (!isUuid(messageId)) return { ok: false, error: "Something went wrong." };
  const caller = await postingCaller();
  if (!caller) return { ok: false, error: "Posting isn't available to you yet." };

  // Under the caller's RLS, so only a message they can see; the author check is on top.
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("chat_messages")
    .select("author_member_id, origin, slack_sync_status")
    .eq("id", messageId)
    .maybeSingle();
  if (!row || row.origin !== "app" || row.author_member_id !== caller.identity.memberId || row.slack_sync_status === "sent") {
    return { ok: false, error: "That message can't be retried." };
  }
  const result = await sendChatMessageToSlack(createServiceRoleClient(), messageId);
  return result === "failed" ? { ok: false, error: "Slack didn't take it. Try again in a moment." } : { ok: true, id: messageId };
}
