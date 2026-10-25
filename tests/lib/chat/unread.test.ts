import { describe, expect, it } from "vitest";
import { firstUnreadMessageId } from "@/lib/chat/unread";
import type { ChatMessageView } from "@/lib/chat/load";

const v = (n: number, extra: Partial<ChatMessageView> = {}) =>
  ({ id: `m${n}`, createdAt: new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString(), contentState: "ok", mine: false, ...extra }) as ChatMessageView;
const at = (n: number) => new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString();

describe("firstUnreadMessageId", () => {
  it("is the oldest message after the marker", () => {
    expect(firstUnreadMessageId([v(1), v(2), v(3)], at(1))).toBe("m2");
  });
  it("skips the reader's own and deleted messages", () => {
    expect(firstUnreadMessageId([v(1), v(2, { mine: true }), v(3, { contentState: "deleted" }), v(4)], at(1))).toBe("m4");
  });
  it("is undefined with no marker or nothing newer", () => {
    expect(firstUnreadMessageId([v(1), v(2)], null)).toBeUndefined();
    expect(firstUnreadMessageId([v(1), v(2)], at(2))).toBeUndefined();
  });
});
