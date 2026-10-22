import { describe, it, expect } from "vitest";
import {
  CHAT_KIND_WEIGHTS,
  DEFAULT_CHAT_MODE,
  DEFAULT_WINDOW_DAYS,
  buildNetworkEdges,
  describeChat,
  parseChatMode,
  parseWindowDays,
  type ChatPairRow,
} from "@/lib/member-network";

const pair = (x: string, y: string, kind: string, visibility: "public" | "private", n: number): ChatPairRow => ({ member_x: x, member_y: y, kind, visibility, n });
const ACTIVE = new Set(["a", "b", "c"]);

describe("parseChatMode / parseWindowDays", () => {
  it("takes the known values and falls back to the defaults for anything else", () => {
    expect(parseChatMode("off")).toBe("off");
    expect(parseChatMode("all")).toBe("all");
    expect(parseChatMode(["public", "all"])).toBe("public"); // the first of a repeated param
    expect(parseChatMode("everything")).toBe(DEFAULT_CHAT_MODE);
    expect(parseChatMode(undefined)).toBe(DEFAULT_CHAT_MODE);

    expect(parseWindowDays("30")).toBe(30);
    expect(parseWindowDays("365")).toBe(365);
    expect(parseWindowDays("7")).toBe(DEFAULT_WINDOW_DAYS);
    expect(parseWindowDays("abc")).toBe(DEFAULT_WINDOW_DAYS);
    expect(parseWindowDays(undefined)).toBe(DEFAULT_WINDOW_DAYS);
  });
});

describe("buildNetworkEdges", () => {
  const base = { prickleConnections: new Map<string, number>(), prickleTotals: new Map<string, number>(), activeIds: ACTIVE };

  it("keeps prickle co-attendance as it was: shared prickles and the share of the smaller member's attendance", () => {
    const edges = buildNetworkEdges({
      ...base,
      prickleConnections: new Map([["a||b", 4]]),
      prickleTotals: new Map([["a", 12], ["b", 8]]),
      chatPairs: [],
    });
    expect(edges).toEqual([{ source: "a", target: "b", weight: 4, normalizedWeight: 50, prickles: 4, chat: 0, chatByKind: {}, chatPrivate: 0 }]);
  });

  it("adds chat on top, weighting a reaction lighter than writing to someone", () => {
    const edges = buildNetworkEdges({
      ...base,
      prickleConnections: new Map([["a||b", 2]]),
      prickleTotals: new Map([["a", 10], ["b", 10]]),
      chatPairs: [pair("a", "b", "thread_reply", "public", 3), pair("a", "b", "reaction", "public", 4), pair("a", "b", "dm", "private", 2)],
    });

    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      prickles: 2,
      chat: 3 * CHAT_KIND_WEIGHTS.thread_reply + 4 * CHAT_KIND_WEIGHTS.reaction + 2 * CHAT_KIND_WEIGHTS.dm,
      weight: 2 + 3 + 2 + 2,
      normalizedWeight: 20, // 2 of the smaller member's 10 prickles; chat has no such base
      chatByKind: { thread_reply: 3, reaction: 4, dm: 2 },
      chatPrivate: 2,
    });
  });

  it("makes an edge for people who only talk, with no shared prickles", () => {
    const edges = buildNetworkEdges({ ...base, chatPairs: [pair("b", "c", "mention", "public", 5)] });
    expect(edges).toEqual([{ source: "b", target: "c", weight: 5, normalizedWeight: 0, prickles: 0, chat: 5, chatByKind: { mention: 5 }, chatPrivate: 0 }]);
  });

  it("treats a pair the same whichever way round it comes, and sums public and private", () => {
    const edges = buildNetworkEdges({
      ...base,
      prickleConnections: new Map([["a||b", 1]]),
      prickleTotals: new Map([["a", 1], ["b", 1]]),
      chatPairs: [pair("b", "a", "mention", "public", 1), pair("a", "b", "mention", "private", 2)],
    });
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: "a", target: "b", prickles: 1, chatByKind: { mention: 3 }, chatPrivate: 2, weight: 4 });
  });

  it("leaves out members who aren't active and kinds with no weight", () => {
    const edges = buildNetworkEdges({
      ...base,
      chatPairs: [pair("a", "gone", "dm", "private", 9), pair("a", "b", "channel_comember", "public", 9), pair("a", "c", "reaction", "public", 1)],
    });
    expect(edges.map((e) => `${e.source}-${e.target}`)).toEqual(["a-c"]);
    expect(edges[0].weight).toBe(0.5);
  });

  it("lists the strongest connection first", () => {
    const edges = buildNetworkEdges({
      ...base,
      prickleConnections: new Map([["a||b", 1], ["b||c", 6]]),
      prickleTotals: new Map([["a", 3], ["b", 7], ["c", 6]]),
      chatPairs: [pair("a", "b", "dm", "private", 2)],
    });
    expect(edges.map((e) => e.weight)).toEqual([6, 3]);
  });
});

describe("describeChat", () => {
  it("names each kind with its count, the biggest first, singular for one", () => {
    expect(describeChat({ reaction: 5, thread_reply: 3, dm: 1, mention: 1 })).toBe("5 reactions, 3 thread replies, 1 DM, 1 mention");
  });

  it("keeps a kind it has no label for as it is", () => {
    expect(describeChat({ something_new: 2 })).toBe("2 something_new");
  });
});
