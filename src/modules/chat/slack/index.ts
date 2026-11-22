import type { ChatTransport, OpenConversationResult } from "@/lib/chat/transport";
import { getSlackConnectionStatus } from "@/lib/slack-connect";
import { chatSlackWritesEnabled, retryUnsentChatMessages, sendChatMessageToSlack } from "@/lib/chat/slack-post";
import { syncReactionToSlack } from "@/lib/chat/slack-react";
import { pullReadFromSlack, pushReadToSlack, pushUnreadToSlack } from "@/lib/chat/slack-read";
import { openSlackDm, pullMemberDms } from "@/lib/chat/slack-dms";
import { removeSlackUnfurl } from "@/lib/chat/slack-unfurl-removal";
import { deleteChatFileInSlack, deleteChatMessageInSlack, updateChatMessageInSlack } from "@/lib/chat/slack-edit";
import { keepSlackFileCopies } from "./files";

/**
 * The Slack transport: implements the chat port (`src/lib/chat/transport.ts`) over the existing Slack code. It owns Slack ids and
 * tokens, mrkdwn escaping and blocks, the user and bot token choice, and Slack's rate limits; core sees none of that.
 * The Slack modules still live in `src/lib/chat/slack-*.ts` and move under this folder in the next steps
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
  deliver: (db, messageId) => sendChatMessageToSlack(db, messageId),
  retryUnsent: (db) => retryUnsentChatMessages(db),
  syncReaction: (db, opts) => syncReactionToSlack(db, opts),
  editMessage: (db, opts) => updateChatMessageInSlack(db, opts),
  deleteMessage: (db, opts) => deleteChatMessageInSlack(db, opts),
  deleteFile: (db, opts) => deleteChatFileInSlack(db, opts),
  removePreview: (db, opts) => removeSlackUnfurl(db, opts),
  keepFileCopies: (db, opts) => keepSlackFileCopies(db, opts),
  pushRead: (db, opts) => pushReadToSlack(db, opts),
  pushUnread: (db, opts) => pushUnreadToSlack(db, opts),
  pullRead: (db, memberId, opts) => (opts ? pullReadFromSlack(db, memberId, opts) : pullReadFromSlack(db, memberId)),
  pullDirectConversations: (db, memberId) => pullMemberDms(db, memberId),
  openDirectConversation: async (db, memberId, otherMemberId) => openResult(await openSlackDm(db, memberId, otherMemberId)),
};
