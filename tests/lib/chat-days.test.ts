import { describe, expect, it } from "vitest";
import { groupByDay } from "@/lib/chat/days";
import { chatDayKey, formatChatClock, formatChatDay } from "@/lib/chat/format";
import type { ChatMessageView } from "@/lib/chat/load";

const msg = (id: string, at: string, extra: Partial<ChatMessageView> = {}): ChatMessageView => ({
  id,
  authorMemberId: "member-gale",
  authorName: "Gale Prickleton",
  authorPhotoUrl: null,
  replyAuthors: [],
  createdAt: at,
  editedAt: null,
  body: id,
  contentState: "ok",
  hasFiles: false,
  files: [],
  replyCount: 0,
  lastReplyAt: null,
  reactions: [],
  syncStatus: null,
  mine: false,
  fromHub: false,
  ...extra,
});

describe("chat day formatting", () => {
  it("labels days with an ordinal, in the given zone", () => {
    expect(formatChatDay("2026-10-07T18:00:00Z", "America/New_York")).toBe("Wednesday, October 7th");
    expect(formatChatDay("2026-10-12T18:00:00Z", "America/New_York")).toBe("Monday, October 12th");
    expect(formatChatDay("2026-10-01T18:00:00Z", "UTC")).toBe("Thursday, October 1st");
    expect(formatChatDay("2026-10-22T18:00:00Z", "UTC")).toBe("Thursday, October 22nd");
    expect(formatChatDay("2026-10-23T18:00:00Z", "UTC")).toBe("Friday, October 23rd");
    expect(formatChatDay("2026-10-11T18:00:00Z", "UTC")).toBe("Sunday, October 11th");
  });

  it("puts the same instant on different days in different zones", () => {
    const iso = "2026-10-08T02:30:00Z";
    expect(chatDayKey(iso, "America/New_York")).toBe("2026-10-07");
    expect(chatDayKey(iso, "Asia/Tokyo")).toBe("2026-10-08");
    expect(formatChatClock(iso, "America/New_York")).toBe("10:30 PM");
    expect(formatChatClock(iso, "Asia/Tokyo")).toBe("11:30 AM");
  });
});

describe("groupByDay", () => {
  it("starts a new day at midnight in the reader's zone, not UTC", () => {
    const messages = [msg("a", "2026-10-08T03:30:00Z"), msg("b", "2026-10-08T05:00:00Z")];
    expect(groupByDay(messages, "America/New_York").map((d) => d.key)).toEqual(["2026-10-07", "2026-10-08"]);
    expect(groupByDay(messages, "UTC").map((d) => d.key)).toEqual(["2026-10-08"]);
  });

  it("marks quick follow-ups from the same person as compact, but not across authors, gaps, days or the unread line", () => {
    const messages = [
      msg("a", "2026-10-07T14:00:00Z"),
      msg("b", "2026-10-07T14:02:00Z"),
      msg("c", "2026-10-07T14:03:00Z", { authorMemberId: "member-other", authorName: "Other" }),
      msg("d", "2026-10-07T14:04:00Z", { authorMemberId: "member-other", authorName: "Other" }),
      msg("e", "2026-10-07T14:30:00Z", { authorMemberId: "member-other", authorName: "Other" }),
      msg("f", "2026-10-07T14:31:00Z", { authorMemberId: "member-other", authorName: "Other" }),
      msg("g", "2026-10-08T14:32:00Z", { authorMemberId: "member-other", authorName: "Other" }),
    ];
    const flags = (breakId?: string) => groupByDay(messages, "UTC", breakId).flatMap((d) => d.items.map((i) => i.compact));
    expect(flags()).toEqual([false, true, false, true, false, true, false]);
    expect(flags("f")).toEqual([false, true, false, true, false, false, false]);
  });

  it("does not fold deleted, failed or unattributed messages into a neighbour", () => {
    const messages = [
      msg("a", "2026-10-07T14:00:00Z", { authorMemberId: null, authorName: "Bot" }),
      msg("b", "2026-10-07T14:01:00Z", { authorMemberId: null, authorName: "Bot" }),
      msg("c", "2026-10-07T14:02:00Z", { authorMemberId: null, authorName: "Bot", contentState: "deleted" }),
      msg("d", "2026-10-07T14:03:00Z", { authorMemberId: null, authorName: "Bot", syncStatus: "failed" }),
    ];
    expect(groupByDay(messages, "UTC").flatMap((d) => d.items.map((i) => i.compact))).toEqual([false, true, false, false]);
  });
});
