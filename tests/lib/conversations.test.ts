import { describe, expect, it } from "vitest";
import { CONVERSATION_QUIET_DAYS } from "@/lib/config";
import {
  conversationStatus,
  daysAgoLabel,
  daysSince,
  isConversationChannel,
  isConversationId,
  isConversationOutcome,
  isConversationReason,
  isFollowUpDue,
  isMessageDirection,
  lastActivityAt,
  orgDay,
  sortConversations,
  type ConversationTimes,
} from "@/lib/conversations";

const DAY = 86_400_000;
const NOW = new Date("2026-03-20T12:00:00.000Z");
const ago = (days: number, extraMs = 0) => new Date(NOW.getTime() - days * DAY - extraMs).toISOString();

const convo = (over: Partial<ConversationTimes> = {}): ConversationTimes => ({
  opened_at: ago(30),
  closed_at: null,
  last_staff_message_at: null,
  last_member_message_at: null,
  ...over,
});

describe("conversationStatus", () => {
  it("is closed once she closed it, whatever was said last", () => {
    expect(conversationStatus(convo({ closed_at: ago(1), last_member_message_at: ago(0) }), NOW)).toBe("closed");
  });

  it("needs her reply when the member wrote last, however long ago", () => {
    expect(conversationStatus(convo({ last_staff_message_at: ago(3), last_member_message_at: ago(1) }), NOW)).toBe("needs_reply");
    expect(conversationStatus(convo({ last_member_message_at: ago(200) }), NOW)).toBe("needs_reply");
  });

  it("is waiting on them when she wrote last (or they wrote at the same moment), inside the window", () => {
    expect(conversationStatus(convo({ last_staff_message_at: ago(2), last_member_message_at: ago(5) }), NOW)).toBe("waiting");
    expect(conversationStatus(convo({ last_staff_message_at: ago(2), last_member_message_at: ago(2) }), NOW)).toBe("waiting");
  });

  it("has gone quiet only after the window: exactly the window is still waiting, a moment past it is quiet", () => {
    const edge = convo({ last_staff_message_at: ago(CONVERSATION_QUIET_DAYS) });
    expect(conversationStatus(edge, NOW)).toBe("waiting");
    expect(conversationStatus(convo({ last_staff_message_at: ago(CONVERSATION_QUIET_DAYS, 1) }), NOW)).toBe("gone_quiet");
  });

  it("takes the window as an argument", () => {
    const c = convo({ last_staff_message_at: ago(4) });
    expect(conversationStatus(c, NOW, 3)).toBe("gone_quiet");
    expect(conversationStatus(c, NOW, 7)).toBe("waiting");
  });

  it("counts from when it was opened when nobody has been logged", () => {
    expect(conversationStatus(convo({ opened_at: ago(2) }), NOW)).toBe("waiting");
    expect(conversationStatus(convo({ opened_at: ago(CONVERSATION_QUIET_DAYS + 1) }), NOW)).toBe("gone_quiet");
  });

  it("reads the quiet window from the config, not from a constant here", () => {
    expect(CONVERSATION_QUIET_DAYS).toBeGreaterThan(0);
  });
});

describe("lastActivityAt", () => {
  it("is the latest of opened, her message and theirs", () => {
    expect(lastActivityAt(convo({ opened_at: ago(10), last_staff_message_at: ago(4), last_member_message_at: ago(6) }))).toBe(ago(4));
    expect(lastActivityAt(convo({ opened_at: ago(1), last_staff_message_at: ago(4) }))).toBe(ago(1));
  });
});

describe("sortConversations", () => {
  const row = (id: string, over: Partial<ConversationTimes>) => ({ id, ...convo(over) });

  it("puts what needs her first, then gone quiet, then waiting, then closed, longest-waiting first, with the id as the tie-break", () => {
    const rows = [
      row("conv_closed_old", { closed_at: ago(20) }),
      row("conv_waiting", { last_staff_message_at: ago(2) }),
      row("conv_quiet", { last_staff_message_at: ago(40) }),
      row("conv_reply_new", { last_member_message_at: ago(1) }),
      row("conv_reply_old", { last_member_message_at: ago(6) }),
      row("conv_closed_new", { closed_at: ago(2) }),
      row("conv_waiting_b", { last_staff_message_at: ago(2) }),
      row("conv_waiting_older", { last_staff_message_at: ago(9) }),
    ];

    expect(sortConversations(rows, NOW).map((r) => r.id)).toEqual([
      "conv_reply_old",
      "conv_reply_new",
      "conv_quiet",
      "conv_waiting_older",
      "conv_waiting",
      "conv_waiting_b",
      "conv_closed_new",
      "conv_closed_old",
    ]);
  });

  it("orders closed ones with the same close time by id, and does not change its input", () => {
    const rows = [row("conv_b", { closed_at: ago(2) }), row("conv_a", { closed_at: ago(2) })];
    expect(sortConversations(rows, NOW).map((r) => r.id)).toEqual(["conv_a", "conv_b"]);
    expect(rows.map((r) => r.id)).toEqual(["conv_b", "conv_a"]);
  });
});

describe("days", () => {
  it("counts whole days, never below zero", () => {
    expect(daysSince(ago(3, 1000), NOW)).toBe(3);
    expect(daysSince(ago(-2), NOW)).toBe(0);
  });

  it("words how long ago", () => {
    expect(daysAgoLabel(ago(0, 60_000), NOW)).toBe("today");
    expect(daysAgoLabel(ago(1, 60_000), NOW)).toBe("yesterday");
    expect(daysAgoLabel(ago(5, 60_000), NOW)).toBe("5 days ago");
  });
});

describe("the follow-up day is the organization's day", () => {
  // 03:30 UTC on 2026-03-09 is 23:30 on 2026-03-08 in Eastern (daylight time began the day before); 05:30 UTC is 01:30 on the 9th.
  const lateEvening = new Date("2026-03-09T03:30:00.000Z");
  const justAfterMidnight = new Date("2026-03-09T05:30:00.000Z");

  it("names the Eastern day on both sides of midnight", () => {
    expect(orgDay(lateEvening)).toBe("2026-03-08");
    expect(orgDay(justAfterMidnight)).toBe("2026-03-09");
  });

  it("is due on the day itself, not before", () => {
    expect(isFollowUpDue("2026-03-09", lateEvening)).toBe(false);
    expect(isFollowUpDue("2026-03-09", justAfterMidnight)).toBe(true);
    expect(isFollowUpDue("2026-03-08", lateEvening)).toBe(true);
  });

  it("is never due without a day", () => {
    expect(isFollowUpDue(null, justAfterMidnight)).toBe(false);
  });

  it("holds across the autumn change too (a 25-hour day)", () => {
    // 2026-11-01: clocks go back at 06:00 UTC. 04:30 UTC is 00:30 EDT on the 1st; 05:30 UTC is still the 1st (01:30 EDT); 05:30 UTC on the 2nd is 00:30 EST.
    expect(orgDay(new Date("2026-11-01T04:30:00.000Z"))).toBe("2026-11-01");
    expect(orgDay(new Date("2026-11-02T04:30:00.000Z"))).toBe("2026-11-01");
    expect(orgDay(new Date("2026-11-02T05:30:00.000Z"))).toBe("2026-11-02");
  });
});

describe("guards", () => {
  it("accepts only the declared sets", () => {
    expect(isConversationReason("writing_check_in")).toBe(true);
    expect(isConversationReason("gossip")).toBe(false);
    expect(isConversationChannel("slack_dm")).toBe(true);
    expect(isConversationChannel("fax")).toBe(false);
    expect(isConversationOutcome("re_engaged")).toBe(true);
    expect(isConversationOutcome(undefined)).toBe(false);
    expect(isMessageDirection("staff")).toBe(true);
    expect(isMessageDirection("robot")).toBe(false);
  });

  it("recognises a conversation id and nothing else", () => {
    expect(isConversationId("conv_AAAAAAAAAAA1")).toBe(true);
    expect(isConversationId("mbr_AAAAAAAAAAA1")).toBe(false);
    expect(isConversationId("conv_AAAAAAAAAAA0")).toBe(false); // 0 is not base58
    expect(isConversationId("conv_short")).toBe(false);
    expect(isConversationId(42)).toBe(false);
  });
});
