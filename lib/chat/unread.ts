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
 * How many messages the "N new messages" banner counts: those at or after the "New" line that the reader
 * did not write, that still exist and that are not Slack's own notices. Same definition as the sidebar's
 * badge (top-level, live, not the reader's); the list holds only top-level messages, so replies never count.
 * The message the line sits on counts even when it is the reader's own: they picked it with "Mark unread".
 */
export function newMessagesSince(views: ChatMessageView[], firstUnreadId: string | undefined): number {
  if (!firstUnreadId) return 0;
  const from = views.findIndex((m) => m.id === firstUnreadId);
  if (from < 0) return 0;
  return views.slice(from).filter((m, i) => (i === 0 || !m.mine) && !m.system && m.contentState !== "deleted").length;
}
