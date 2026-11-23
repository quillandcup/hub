import type { SupabaseClient } from "@supabase/supabase-js";
import { projectChatMessage } from "@/lib/chat-projection";
import { notifyChatMessageBySlackTs } from "@/lib/chat/notifications";
import { createRepos } from "@/lib/data/repos";
import type { Db } from "@/lib/data/db";
import type { ChatInboundSink } from "@/lib/chat/transport";

/**
 * What chat core does with what a transport reports (`ChatInboundSink`, src/lib/chat/transport.ts): bring the chat copy of one message in
 * line with what the transport stored, and tell the people a new message concerns. The transport has already kept its own raw copy
 * (Slack's Bronze rows) and answers for decoding and verifying its events; core never sees the event's shape.
 *
 * Constant cost per event: one message is projected (`project_slack_chat_message`), not a window. It is idempotent and order-free, since
 * the projection reads what the transport stored: the same event twice, a reaction before its message, or an edit before its message all
 * end in the same chat state, and one for a message the chat does not have yet answers `present: false` (the transport's gap-fill and the
 * nightly import bring it). Failures are logged by the projection, not thrown.
 */
export const chatInbound: ChatInboundSink = {
  async messageChanged(db: SupabaseClient, event) {
    const started = Date.now();
    const present = await projectChatMessage(db, event.channelRef, event.ref);
    console.info("[chat] projected one Slack message into chat in %dms%s", Date.now() - started, present ? "" : " (the chat has no such message)");
    return { present };
  },

  async messageArrived(db: SupabaseClient, event) {
    await notifyChatMessageBySlackTs(createRepos(db as unknown as Db), event.channelRef, event.ref);
  },
};
