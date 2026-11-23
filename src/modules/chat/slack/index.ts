import type { ChatTransport, OpenConversationResult } from "@/lib/chat/transport";
import { getSlackConnectionStatus } from "@/lib/slack-connect";
import { createSlackClient } from "@/lib/slack-client";
import { getSlackBotToken } from "@/lib/slack-bot-token";
import { chatSlackWritesEnabled, postChatMessageToSlack } from "./post";
import { syncReactionToSlack } from "./react";
import { pullReadFromSlack, pushReadToSlack, pushUnreadToSlack } from "./read";
import { openSlackDm, pullMemberDms } from "./dms";
import { catchUpChannel } from "./gap-fill";
import { removeSlackUnfurl } from "./unfurl-removal";
import { deleteChatFileInSlack, deleteChatMessageInSlack, updateChatMessageInSlack } from "./edit";
import { addToSlackConversation, removeFromSlackConversation, slackIdsForMembers } from "./conversation";
import { keepSlackFileCopies } from "./files";

/**
 * The Slack transport: implements the chat port (`src/lib/chat/transport.ts`). It owns Slack ids and tokens, mrkdwn escaping and
 * blocks, the user and bot token choice, and Slack's rate limits; core sees none of that. It never records delivery status: `send`
 * answers how it went and core writes it (`src/lib/chat/delivery.ts`). The outbound Slack code is in this folder; the inbound code
 * (`src/modules/chat/slack/dms.ts`, `gap-fill.ts`, the webhook) still sits outside and moves in the next step
 * (docs/architecture/CHAT_MODULE.md). Registered in `src/modules/chat-transport.ts`.
 */

/** Slack's own refusal is named for what it is in core's terms. */
const openResult = (result: Awaited<ReturnType<typeof openSlackDm>>): OpenConversationResult =>
  !result.ok && result.reason === "slack_refused" ? { ok: false, reason: "refused" } : (result as OpenConversationResult);

export const slackTransport: ChatTransport = {
  id: "slack",
  // Each method looks its Slack function up when called, not when this module loads, so a partial mock of one Slack module in a test
  // does not break importing the transport.
  writesEnabled: () => chatSlackWritesEnabled(),
  isConnected: async (db, memberId) => (await getSlackConnectionStatus(db, memberId)).connected,
  send: (db, messageId) => postChatMessageToSlack(db, messageId),
  syncReaction: (db, opts) => syncReactionToSlack(db, opts),
  editMessage: (db, opts) => updateChatMessageInSlack(db, opts),
  deleteMessage: (db, opts) => deleteChatMessageInSlack(db, opts),
  deleteFile: (db, opts) => deleteChatFileInSlack(db, opts),
  removePreview: (db, opts) => removeSlackUnfurl(db, opts),
  keepFileCopies: (db, opts) => keepSlackFileCopies(db, opts),
  pushRead: (db, opts) => pushReadToSlack(db, opts),
  pushUnread: (db, opts) => pushUnreadToSlack(db, opts),
  pullRead: (db, memberId, opts) => (opts ? pullReadFromSlack(db, memberId, opts) : pullReadFromSlack(db, memberId)),
  externalIdsFor: (db, memberIds) => slackIdsForMembers(db, memberIds),
  addToConversation: (db, opts) => addToSlackConversation(db, opts),
  removeFromConversation: (db, opts) => removeFromSlackConversation(db, opts),
  updateAppMessage: async ({ channelRef, ref, message }) => {
    const token = await getSlackBotToken();
    if (!token) throw new Error("no Slack bot token");
    await createSlackClient(token).chat.update({ channel: channelRef, ts: ref, ...message } as Parameters<ReturnType<typeof createSlackClient>["chat"]["update"]>[0]);
  },
  catchUp: (db, { channelRef }) => catchUpChannel(db, { channelId: channelRef, source: "open" }).then(() => undefined),
  pullDirectConversations: (db, memberId) => pullMemberDms(db, memberId),
  openDirectConversation: async (db, memberId, otherMemberId) => openResult(await openSlackDm(db, memberId, otherMemberId)),
};
