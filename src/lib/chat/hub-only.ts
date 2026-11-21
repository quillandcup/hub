import type { ChatRepository } from "@/lib/data/chat";

/**
 * Whether a message lives only in the Hub: written in the Hub, in a conversation with no Slack channel
 * (a direct message), so it was never queued for Slack (no sync status). Its edits, deletes and reactions have no Slack copy to keep in step. A message that
 * can't be found is not Hub-only, so the usual paths report it as they always did.
 */
export async function isHubOnlyMessage(chat: Pick<ChatRepository, "slackTarget">, messageId: string): Promise<boolean> {
  const target = await chat.slackTarget(messageId).catch(() => null);
  return target !== null && target.origin === "app" && target.slackChannelId === null && target.slackSyncStatus === null;
}
