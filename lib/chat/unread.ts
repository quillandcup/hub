import type { ChatMessageView } from "@/lib/chat/load";

/**
 * The first message the reader had not seen: the oldest one after their read marker that someone
 * else wrote and that still exists. Views are oldest first. Shared by the page (the marker at render)
 * and by a conversation caught up after coming from the client cache (the marker now).
 */
export function firstUnreadMessageId(views: ChatMessageView[], readMarker: string | null): string | undefined {
  if (!readMarker) return undefined;
  const marker = Date.parse(readMarker);
  return views.find((m) => m.contentState !== "deleted" && !m.mine && Date.parse(m.createdAt) > marker)?.id;
}

/**
 * How many messages the "N new messages" banner counts: every live message from the "New" line on, whoever wrote it,
 * so the number matches what the reader sees below the line (a conversation of their own messages counts too).
 * Slack's own notices and deleted messages do not count. The sidebar's badge keeps its own rule (not the reader's);
 * the list holds only top-level messages, so replies never count.
 */
export function newMessagesSince(views: ChatMessageView[], firstUnreadId: string | undefined): number {
  if (!firstUnreadId) return 0;
  const from = views.findIndex((m) => m.id === firstUnreadId);
  if (from < 0) return 0;
  return views.slice(from).filter((m) => !m.system && m.contentState !== "deleted").length;
}
