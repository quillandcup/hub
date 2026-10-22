import { chatDayKey, formatChatDay } from "@/lib/chat/format";
import type { ChatMessageView } from "@/lib/chat/load";

/** A message right after one from the same person within this long reads as a follow-up. */
export const FOLLOW_UP_WITHIN_MS = 5 * 60_000;

export type DayGroup = {
  /** The calendar day in the reader's zone, YYYY-MM-DD. */
  key: string;
  /** "Wednesday, October 7th". */
  label: string;
  items: { message: ChatMessageView; /** Shown without avatar, name and time. */ compact: boolean }[];
};

/**
 * Messages (oldest first) split into the reader's calendar days, each flagged as a follow-up when it
 * continues the previous message's author within a few minutes on the same day. A message that
 * starts something the reader has to notice (`breakBeforeId`, the first unread) is never a follow-up.
 */
export function groupByDay(messages: ChatMessageView[], timeZone: string, breakBeforeId?: string): DayGroup[] {
  const days: DayGroup[] = [];
  let prev: ChatMessageView | null = null;
  for (const message of messages) {
    const key = chatDayKey(message.createdAt, timeZone);
    let day = days[days.length - 1];
    if (!day || day.key !== key) {
      day = { key, label: formatChatDay(message.createdAt, timeZone), items: [] };
      days.push(day);
    }
    const compact =
      day.items.length > 0 &&
      prev !== null &&
      message.id !== breakBeforeId &&
      sameAuthor(prev, message) &&
      !message.system &&
      !prev.system &&
      message.contentState === "ok" &&
      prev.contentState === "ok" &&
      message.syncStatus !== "failed" &&
      Date.parse(message.createdAt) - Date.parse(prev.createdAt) <= FOLLOW_UP_WITHIN_MS;
    day.items.push({ message, compact });
    prev = message;
  }
  return days;
}

const sameAuthor = (a: ChatMessageView, b: ChatMessageView) =>
  a.authorMemberId !== null || b.authorMemberId !== null ? a.authorMemberId === b.authorMemberId : a.authorName === b.authorName;
