"use server";

import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity, type EffectiveIdentity } from "@/lib/sudo";
import { effectiveMemberHasFeature, getUserFeaturePreviews } from "@/lib/features.server";
import { createRepos } from "@/lib/data/repos";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { sendChatMessageToSlack } from "@/lib/chat/slack-post";
import { syncReactionToSlack } from "@/lib/chat/slack-react";
import { pullReadFromSlack, pushReadToSlack } from "@/lib/chat/slack-read";
import { removeChatFileBytes } from "@/lib/chat/file-cleanup";
import { deleteChatFileInSlack, deleteChatMessageInSlack, updateChatMessageInSlack } from "@/lib/chat/slack-edit";
import { getSlackConnectionStatus } from "@/lib/slack-connect";
import { isId } from "@/lib/ids";
import { PENDING_FILE_PREFIX } from "@/lib/chat/files";
import { MAX_CHAT_FILES, MAX_CHAT_FILE_BYTES, isOwnStagingPath, newStagingPath, type StagedUpload } from "@/lib/chat/staging";
import { SLACK_FILES_BUCKET } from "@/lib/slack-capture";
import { clock } from "@/lib/clock";
import {
  buildMessageViews,
  chatTextContext,
  loadChannelForMember,
  loadChatChannels,
  loadMessage,
  loadMessages,
  loadMessagesByIds,
  loadUnreadCounts,
  type ChatMessageView,
} from "@/lib/chat/load";
import type { ChatTextContext } from "@/components/chat/ChatText";

import { withAction } from "@/lib/analytics/server";
import { chatCaller, postingCaller } from "@/lib/chat/caller";
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
  if (!isId(channelId, "chn")) return;
  if (Number.isNaN(Date.parse(through))) return;
  const caller = await chatCaller();
  if (!caller || caller.identity.isSudo) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("chat_mark_read", { p_channel_id: channelId, p_through: through });
  if (error) {
    console.error("chat_mark_read failed:", error.message);
    return;
  }
  // Slack stops showing it as unread too, once the response is out (members who connected Slack only).
  after(() => pushReadToSlack(createServiceRoleClient(), { memberId: caller.identity.memberId, channelId, through }).catch((e) => console.error("pushReadToSlack failed:", e)));
}

/**
 * The member came back to the Hub (or opened the search box): bring their read markers up to what
 * they have read in Slack, and answer with the unread counts as they now stand. `openChannelId` is
 * the conversation on screen, whose marker is left alone so its "New" line doesn't jump. Null when
 * nothing was pulled (not connected to Slack, asked again within the throttle, sudo, chat off), so
 * the caller keeps the numbers it has.
 */
export async function syncChatReadFromSlack(openChannelId: string | null): Promise<Record<string, number> | null> {
  const caller = await chatCaller();
  if (!caller || caller.identity.isSudo) return null;
  const exceptChannelId = openChannelId && isId(openChannelId, "chn") ? openChannelId : null;
  const pulled = await pullReadFromSlack(createServiceRoleClient(), caller.identity.memberId, { exceptChannelId }).catch((e) => {
    console.error("pullReadFromSlack failed:", e);
    return false;
  });
  return pulled ? loadUnreadCounts(await createClient()) : null;
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
  if (!isId(channelId, "chn") || Number.isNaN(Date.parse(before))) return null;
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

/**
 * The newest page of top-level messages, for keeping an open conversation current without
 * re-rendering the page and layout: only the messages (the sidebar, members, read marker and the
 * rest are untouched), plus the messages in `alsoMessageIds` (ones whose reactions changed, wherever they
 * are in the list). Same access rules as the page and `loadOlderChat`; the text context carries
 * just the names found in these messages (the list merges it into what it already has), so the
 * channel list isn't read again. `withReadMarker` also returns where the member has read up to now (for a
 * page that came from the client cache, whose unread line is out of date). Null when it can't be loaded,
 * and the caller refreshes the page.
 */
export async function loadLatestChat(channelId: string, alsoMessageIds: string[] = [], withReadMarker = false): Promise<LatestChat | null> {
  if (!isId(channelId, "chn")) return null;
  const started = performance.now();
  const caller = await chatCaller();
  if (!caller) return null;
  const { identity } = caller;
  const afterAuth = performance.now();

  const supabase = await createClient();
  const channel = await loadChannelForMember(supabase, channelId, identity.memberId, identity.isSudo);
  if (!channel || (identity.isSudo && channel.restricted)) return null;
  const afterChannel = performance.now();

  const markerQuery = async (): Promise<string | null | undefined> => {
    if (!withReadMarker) return undefined;
    if (identity.isSudo) return null;
    // A failed read shows no marker, as it always has.
    return createRepos(supabase).chat.readMarker(channel.id, identity.memberId).catch(() => null);
  };
  const wanted = [...new Set(alsoMessageIds.filter((m) => isId(m, "msg")))].slice(0, 50);
  const [page, extra, readMarker] = await Promise.all([
    loadMessages(supabase, channel.id, {}),
    loadMessagesByIds(supabase, channel.id, wanted),
    markerQuery(),
  ]);
  const afterMessages = performance.now();
  // The newest page, plus any other messages asked for (ones whose reactions changed), once each.
  const inPage = new Set(page.messages.map((m) => m.id));
  const messages = [...page.messages, ...extra.filter((m) => !inPage.has(m.id))];
  const { views, ...rendered } = await buildMessageViews(supabase, channel, messages, identity.memberId);
  const done = performance.now();
  // Where the time goes, for tuning: this runs on every live change in an open conversation.
  console.info(
    "[chat] loadLatestChat %dms (auth %d, channel %d, messages %d, views %d)",
    Math.round(done - started),
    Math.round(afterAuth - started),
    Math.round(afterChannel - afterAuth),
    Math.round(afterMessages - afterChannel),
    Math.round(done - afterMessages)
  );
  return { views, ctx: chatTextContext(rendered, []), olderBefore: page.olderBefore, readMarker };
}

export interface LatestChat extends OlderChat {
  /** Where the member has read up to (null: nowhere, or sudo). Only when asked for. */
  readMarker?: string | null;
}

export interface ThreadChat {
  /** The thread's root message first, then its replies, oldest first. */
  views: ChatMessageView[];
  ctx: ChatTextContext;
}

/**
 * An open thread as it is now, for keeping the thread panel current without re-rendering the page
 * (see `loadLatestChat`). Same access rules as the page. Null when the thread can't be loaded (no
 * access, or the root is gone), and the caller refreshes the page.
 */
export async function loadThreadChat(channelId: string, threadRootId: string): Promise<ThreadChat | null> {
  if (!isId(channelId, "chn") || !isId(threadRootId, "msg")) return null;
  const caller = await chatCaller();
  if (!caller) return null;
  const { identity } = caller;

  const supabase = await createClient();
  const channel = await loadChannelForMember(supabase, channelId, identity.memberId, identity.isSudo);
  if (!channel || (identity.isSudo && channel.restricted)) return null;

  const [root, replies] = await Promise.all([
    loadMessage(supabase, channel.id, threadRootId),
    loadMessages(supabase, channel.id, { threadRootId }),
  ]);
  if (!root) return null;
  const { views, ...rendered } = await buildMessageViews(supabase, channel, [root, ...replies.messages], identity.memberId);
  return { views, ctx: chatTextContext(rendered, []) };
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
  bad_files: "Those files can't be sent.",
};

export type PrepareUploadsResult = { ok: true; uploads: { path: string; token: string }[] } | { ok: false; error: string };

/**
 * Places for the browser to put attachments: one signed upload per file, in the member's own folder
 * of the private bucket (the file goes straight to Storage; a server action can't take a big body).
 * Same gate as posting, and the same limits the send checks again.
 */
export async function prepareChatUploads(files: { name: string; size: number }[]): Promise<PrepareUploadsResult> {
  const caller = await postingCaller();
  if (!caller) return { ok: false, error: "Posting isn't available to you yet." };
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_CHAT_FILES) {
    return { ok: false, error: `Attach up to ${MAX_CHAT_FILES} files at a time.` };
  }
  if (files.some((f) => typeof f?.name !== "string" || !f.name || !(f.size >= 0) || f.size > MAX_CHAT_FILE_BYTES)) {
    return { ok: false, error: `Files can be up to ${MAX_CHAT_FILE_BYTES / (1024 * 1024)} MB each.` };
  }
  const bucket = createServiceRoleClient().storage.from(SLACK_FILES_BUCKET);
  const uploads: { path: string; token: string }[] = [];
  for (const f of files) {
    const path = newStagingPath(caller.identity.memberId, f.name, clock.now(), crypto.randomUUID());
    const { data, error } = await bucket.createSignedUploadUrl(path);
    if (error || !data) {
      console.error("createSignedUploadUrl failed:", error?.message);
      return { ok: false, error: "Couldn't start the upload. Try again." };
    }
    uploads.push({ path, token: data.token });
  }
  return { ok: true, uploads };
}

/**
 * The files JSON for chat_post_message from what the browser says it uploaded: only the member's own
 * staged paths, and only ones that are really in the bucket, with their real size. Null if anything is off.
 */
async function stagedFilesFor(memberId: string, uploads: StagedUpload[]): Promise<Record<string, unknown>[] | null> {
  if (!Array.isArray(uploads) || uploads.length > MAX_CHAT_FILES) return null;
  const bucket = createServiceRoleClient().storage.from(SLACK_FILES_BUCKET);
  const files: Record<string, unknown>[] = [];
  for (const u of uploads) {
    if (typeof u?.path !== "string" || typeof u.name !== "string" || !u.name || !isOwnStagingPath(memberId, u.path)) return null;
    const slash = u.path.lastIndexOf("/");
    const { data } = await bucket.list(u.path.slice(0, slash), { search: u.path.slice(slash + 1), limit: 5 });
    const size = (data?.find((o) => o.name === u.path.slice(slash + 1))?.metadata as { size?: number } | undefined)?.size;
    if (typeof size !== "number" || size > MAX_CHAT_FILE_BYTES) return null;
    files.push({ id: `${PENDING_FILE_PREFIX}${crypto.randomUUID()}`, name: u.name.slice(0, 200), mimetype: typeof u.mimetype === "string" ? u.mimetype.slice(0, 100) : "application/octet-stream", size, staged: u.path });
  }
  return files;
}

/**
 * The signed-in member posts `body` to a conversation (or as a reply in a thread). The message is
 * written first, as the member (chat_post_message checks they are in the conversation and that it
 * is bridged and open), then sent to Slack after the response (as them if they connected Slack,
 * else as the bot under their name and photo). If Slack is down the message stays in the Hub
 * marked failed, and the member can retry it; the nightly chat run retries too.
 */
async function sendChatMessageImpl(channelId: string, body: string, threadRootId?: string, uploads: StagedUpload[] = []): Promise<SendChatResult> {
  if (!isId(channelId, "chn") || (threadRootId !== undefined && !isId(threadRootId, "msg"))) return { ok: false, error: "Something went wrong." };
  const caller = await postingCaller();
  if (!caller) return { ok: false, error: "Posting isn't available to you yet." };
  // Messages are posted as the member, with their own Slack token, and there is no bot fallback: without a
  // connection nothing would reach Slack, so say so now instead of saving a message that can only fail.
  if (!(await getSlackConnectionStatus(createServiceRoleClient(), caller.identity.memberId)).connected) {
    return { ok: false, error: "Connect Slack in Settings to post: your messages are posted as you." };
  }

  let files: Record<string, unknown>[] | null = null;
  if (uploads.length > 0) {
    files = await stagedFilesFor(caller.identity.memberId, uploads);
    if (!files) return { ok: false, error: POST_ERRORS.bad_files };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("chat_post_message", {
    p_channel_id: channelId,
    p_body: body,
    p_thread_root_id: (threadRootId ?? null) as string, // null when absent (the generated type has no null)
    ...(files ? { p_files: files } : {}),
  });
  if (error || !data) {
    const reason = /chat_post: (\w+)/.exec(error?.message ?? "")?.[1];
    if (!reason) console.error("chat_post_message failed:", error?.message);
    return { ok: false, error: (reason && POST_ERRORS[reason]) || "Something went wrong. Try again." };
  }

  // Slack takes a second or more; the member shouldn't wait for it. The message is already saved
  // (pending), so return now and send after the response: the page shows it at once, and flips it to
  // sent through Realtime when Slack has it. A failure marks it failed (Retry) and the nightly run retries.
  const messageId = data as string;
  after(async () => {
    try {
      await sendChatMessageToSlack(createServiceRoleClient(), messageId);
    } catch (error) {
      console.error("sendChatMessageToSlack threw for %s:", messageId, error);
    }
  });
  return { ok: true, id: messageId };
}

export type ToggleReactionResult = { ok: true; active: boolean } | { ok: false; error: string };

const REACT_ERRORS: Record<string, string> = {
  no_member: "You need a member profile to react.",
  no_message: "That message isn't available.",
  archived: "This conversation is archived.",
  bad_emoji: "That emoji can't be used.",
};

/**
 * The signed-in member adds their reaction to a message, or takes it back if they already have
 * it. It is sent to Slack as them, so it needs their Slack connection. Same gate as posting.
 */
async function toggleChatReactionImpl(messageId: string, emoji: string): Promise<ToggleReactionResult> {
  if (!isId(messageId, "msg")) return { ok: false, error: "Something went wrong." };
  const caller = await postingCaller();
  if (!caller) return { ok: false, error: "Reacting isn't available to you yet." };

  const supabase = await createClient();

  // Reactions go to Slack as the member (their own token; the bot can't react under a name), and there is no
  // Hub-only fallback: without a connection one would be hidden here and never reach Slack, and a reaction
  // the member made in Slack could not be taken back from here. So say what to do instead.
  if (!(await getSlackConnectionStatus(createServiceRoleClient(), caller.identity.memberId)).connected) {
    return { ok: false, error: "Connect Slack in Settings to react: your reactions are sent as you." };
  }

  const { data, error } = await supabase.rpc("chat_toggle_reaction", { p_message_id: messageId, p_emoji: emoji });
  if (error || typeof data !== "boolean") {
    const reason = /chat_react: (\w+)/.exec(error?.message ?? "")?.[1];
    if (!reason) console.error("chat_toggle_reaction failed:", error?.message);
    return { ok: false, error: (reason && REACT_ERRORS[reason]) || "Something went wrong. Try again." };
  }
  // A member who connected Slack has it in Slack too, as them: after the response, so the chip
  // updates at once, and never able to fail the reaction itself.
  const memberId = caller.identity.memberId;
  after(async () => {
    try {
      await syncReactionToSlack(createServiceRoleClient(), { messageId, memberId, emoji, active: data });
    } catch (error) {
      console.error("syncReactionToSlack threw:", error);
    }
  });
  return { ok: true, active: data };
}

/** The author sends one of their own failed messages to Slack again. */
export async function retryChatMessage(messageId: string): Promise<SendChatResult> {
  if (!isId(messageId, "msg")) return { ok: false, error: "Something went wrong." };
  const caller = await postingCaller();
  if (!caller) return { ok: false, error: "Posting isn't available to you yet." };

  // Under the caller's RLS, so only a message they can see; the author check is on top.
  const supabase = await createClient();
  const row = await createRepos(supabase).chat.retryState(messageId).catch(() => null);
  if (!row || row.origin !== "app" || row.author_member_id !== caller.identity.memberId || row.slack_sync_status === "sent") {
    return { ok: false, error: "That message can't be retried." };
  }
  const service = createServiceRoleClient();
  if (!(await getSlackConnectionStatus(service, caller.identity.memberId)).connected) {
    return { ok: false, error: "Connect Slack in Settings, then retry: your messages are posted as you." };
  }
  const result = await sendChatMessageToSlack(service, messageId);
  return result === "failed" ? { ok: false, error: "Slack didn't take it. Try again in a moment." } : { ok: true, id: messageId };
}

export type ChangeChatResult = { ok: true } | { ok: false; error: string };

const CHANGE_ERRORS: Record<string, string> = {
  no_member: "You need a member profile to do that.",
  not_yours: "That message can't be changed.",
  archived: "This conversation is archived.",
  empty: "Write something first.",
  too_long: "That message is too long (4,000 characters at most).",
};

const changeError = (error: { message?: string } | null, verb: "edit" | "delete"): string => {
  const reason = new RegExp(`chat_${verb}: (\\w+)`).exec(error?.message ?? "")?.[1];
  if (!reason) console.error("chat_%s_message failed:", verb, error?.message);
  return (reason && CHANGE_ERRORS[reason]) || "Something went wrong. Try again.";
};

/**
 * The author edits one of their own messages written in the Hub. Slack first, as whoever posted it
 * (their own token or the bot), then the Hub's copy, so the Hub never shows text Slack doesn't have.
 * Same gate as posting.
 */
async function editChatMessageImpl(messageId: string, body: string): Promise<ChangeChatResult> {
  if (!isId(messageId, "msg")) return { ok: false, error: "Something went wrong." };
  const caller = await postingCaller();
  if (!caller) return { ok: false, error: "Editing isn't available to you yet." };

  // Refuse what the database would refuse before touching Slack.
  const text = body.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
  if (text === "") return { ok: false, error: CHANGE_ERRORS.empty };
  if (text.length > 4000) return { ok: false, error: CHANGE_ERRORS.too_long };

  const inSlack = await updateChatMessageInSlack(createServiceRoleClient(), { messageId, memberId: caller.identity.memberId, body: text });
  if (!inSlack.ok) return inSlack;

  const supabase = await createClient();
  const { error } = await supabase.rpc("chat_edit_message", { p_message_id: messageId, p_body: text });
  if (error) return { ok: false, error: changeError(error, "edit") };
  return { ok: true };
}

/** The author deletes one of their own messages written in the Hub: in Slack first, then the Hub (a tombstone, the text kept). */
async function deleteChatMessageImpl(messageId: string): Promise<ChangeChatResult> {
  if (!isId(messageId, "msg")) return { ok: false, error: "Something went wrong." };
  const caller = await postingCaller();
  if (!caller) return { ok: false, error: "Deleting isn't available to you yet." };

  const inSlack = await deleteChatMessageInSlack(createServiceRoleClient(), { messageId, memberId: caller.identity.memberId });
  if (!inSlack.ok) return inSlack;

  const supabase = await createClient();
  const { error } = await supabase.rpc("chat_delete_message", { p_message_id: messageId });
  if (error) return { ok: false, error: changeError(error, "delete") };
  return { ok: true };
}

/** The author removes one attachment from their own Hub message: in Slack first, then the Hub's file list. */
async function deleteChatFileImpl(messageId: string, fileId: string): Promise<ChangeChatResult> {
  if (!isId(messageId, "msg") || !fileId || fileId.startsWith(PENDING_FILE_PREFIX)) return { ok: false, error: "Something went wrong." };
  const caller = await postingCaller();
  if (!caller) return { ok: false, error: "Deleting isn't available to you yet." };

  const service = createServiceRoleClient();
  const inSlack = await deleteChatFileInSlack(service, { messageId, memberId: caller.identity.memberId, fileId });
  if (!inSlack.ok) return inSlack;

  const supabase = await createClient();
  const { error } = await supabase.rpc("chat_delete_file", { p_message_id: messageId, p_file_id: fileId });
  if (error) return { ok: false, error: changeError(error, "delete") };

  // Last, once nothing lists the file any more: a failure here only leaves bytes for the sweep.
  await removeChatFileBytes(service, fileId);
  return { ok: true };
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
export async function sendChatMessage(...args: Parameters<typeof sendChatMessageImpl>): ReturnType<typeof sendChatMessageImpl> {
  return withAction("chat_message_sent", () => sendChatMessageImpl(...args));
}

export async function toggleChatReaction(...args: Parameters<typeof toggleChatReactionImpl>): ReturnType<typeof toggleChatReactionImpl> {
  return withAction("chat_reaction_toggled", () => toggleChatReactionImpl(...args));
}

export async function editChatMessage(...args: Parameters<typeof editChatMessageImpl>): ReturnType<typeof editChatMessageImpl> {
  return withAction("chat_message_edited", () => editChatMessageImpl(...args));
}

export async function deleteChatMessage(...args: Parameters<typeof deleteChatMessageImpl>): ReturnType<typeof deleteChatMessageImpl> {
  return withAction("chat_message_deleted", () => deleteChatMessageImpl(...args));
}

export async function deleteChatFile(...args: Parameters<typeof deleteChatFileImpl>): ReturnType<typeof deleteChatFileImpl> {
  return withAction("chat_file_deleted", () => deleteChatFileImpl(...args));
}
