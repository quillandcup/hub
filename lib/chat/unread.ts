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
