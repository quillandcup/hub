import { beforeEach, describe, expect, it, vi } from "vitest";

const getSearcher = vi.fn();
vi.mock("@/lib/search/context", () => ({ getSearcher: () => getSearcher() }));
const universalSearch = vi.fn();
vi.mock("@/lib/search/universal", () => ({ universalSearch: (...args: unknown[]) => universalSearch(...args) }));
const loadUnreadCounts = vi.fn();
vi.mock("@/lib/chat/load", () => ({ loadUnreadCounts: (...args: unknown[]) => loadUnreadCounts(...args) }));
const pullReadFromSlack = vi.fn();
vi.mock("@/lib/chat/slack-read", () => ({ pullReadFromSlack: (...args: unknown[]) => pullReadFromSlack(...args) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({ service: true }) }));
vi.mock("@/lib/search/metrics", () => ({ recordSearchTimings: vi.fn() }));

const getRankedUpcomingPrickles = vi.fn();
vi.mock("@/lib/upcoming-prickles", () => ({ getCheckinPrickles: (...a: unknown[]) => getRankedUpcomingPrickles(...a) }));
const getMyCheckins = vi.fn();
vi.mock("@/app/(member)/prickles/checkin-actions", () => ({ getMyCheckins: () => getMyCheckins() }));
const getUnloggedRecentPrickles = vi.fn();
vi.mock("@/app/(member)/projects/actions", () => ({ getUnloggedRecentPrickles: () => getUnloggedRecentPrickles() }));
vi.mock("@/lib/timezone", () => ({ getUserTimezonePreference: async () => "browser" }));

import { markSuggestionsRead, searchPalette, searchSuggestions, suggestOperatorValues } from "@/app/actions/search";

/** A chainable stand-in for a Supabase query: every call returns itself, awaiting it gives `result`. */
function fakeQuery(result: { data: unknown }) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "order", "limit", "or", "ilike"]) q[m] = () => q;
  q.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return q;
}

const channels = [
  { id: "c1", kind: "channel", label: "#general", visibility: "public" },
  { id: "c2", kind: "channel", label: "#book-club", visibility: "private" },
  { id: "c3", kind: "dm", label: "Fern Quillsby", visibility: "private" },
];

function searcher(over: Record<string, unknown> = {}, tables: Record<string, unknown> = {}) {
  return {
    isSudo: false,
    skip: [],
    ctx: {
      viewerMemberId: "me",
      chatChannels: async () => channels,
      supabase: { from: (table: string) => fakeQuery({ data: tables[table] ?? [] }) },
    },
    ...over,
  };
}

describe("searchSuggestions", () => {
  beforeEach(() => {
    getSearcher.mockReset();
    loadUnreadCounts.mockReset().mockResolvedValue({});
    pullReadFromSlack.mockReset().mockResolvedValue(true);
    getRankedUpcomingPrickles.mockReset().mockResolvedValue([]);
    getMyCheckins.mockReset().mockResolvedValue({});
    getUnloggedRecentPrickles.mockReset().mockResolvedValue([]);
  });

  it("is empty when search is off, in sudo, or without a member", async () => {
    getSearcher.mockResolvedValue(null);
    expect(await searchSuggestions()).toEqual({ needsAttention: [] });
    getSearcher.mockResolvedValue(searcher({ isSudo: true }));
    expect(await searchSuggestions()).toEqual({ needsAttention: [] });
    getSearcher.mockResolvedValue(searcher({ ctx: { ...searcher().ctx, viewerMemberId: null } }));
    expect(await searchSuggestions()).toEqual({ needsAttention: [] });
  });

  it("puts open check-ins first, then unread chat (most unread first), then other notifications", async () => {
    loadUnreadCounts.mockResolvedValue({ c1: 2, c3: 7 });
    getSearcher.mockResolvedValue(
      searcher({}, {
        in_app_notifications: [
          { id: "n1", kind: "new_book", text: "A new book", url: null },
          { id: "n2", kind: "prickle_checkout", text: "How was Monday Writing?", url: "/prickles/p1" },
        ],
      })
    );
    const { needsAttention } = await searchSuggestions();
    expect(needsAttention.map((s) => [s.kind, s.title, s.count])).toEqual([
      ["checkin", "How was Monday Writing?", undefined],
      ["chat", "Fern Quillsby", 7],
      ["chat", "#general", 2],
      ["notification", "A new book", undefined],
    ]);
    expect(needsAttention[0].href).toBe("/prickles/p1");
    expect(needsAttention[3].href).toBe("/notifications");
  });

  it("finds open check-ins and check-outs from the prickles, without in-app notifications", async () => {
    const soon = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    getRankedUpcomingPrickles.mockResolvedValue([
      { priority: 1, prickle: { id: "p1", typeName: "Morning Writing", startTime: soon } },
      { priority: 1, prickle: { id: "p2", typeName: "Answered", startTime: soon } },
    ]);
    getMyCheckins.mockResolvedValue({ p2: { pleasantBefore: 3, energyBefore: 3, emotionBefore: null, need: "momentum", intentionMet: null, pleasantAfter: null, energyAfter: null, emotionAfter: null } });
    getUnloggedRecentPrickles.mockResolvedValue([{ id: "p9", label: "Sunday Sprint", startTime: "x", attended: true }]);
    getSearcher.mockResolvedValue(searcher());
    const { needsAttention } = await searchSuggestions();
    expect(needsAttention.map((s) => [s.title, s.subtitle, s.href])).toEqual([
      ["Morning Writing", "Check in", "/my-prickles/history?checkin=p1"],
      ["Sunday Sprint", "Check out", "/my-prickles/history?checkout=p9"],
    ]);
  });

  it("catches the member's read markers up with Slack before counting unread chat", async () => {
    const order: string[] = [];
    pullReadFromSlack.mockImplementation(async () => void order.push("pull"));
    loadUnreadCounts.mockImplementation(async () => (order.push("count"), {}));
    getSearcher.mockResolvedValue(searcher());
    await searchSuggestions();
    expect(order).toEqual(["pull", "count"]);
    expect(pullReadFromSlack).toHaveBeenCalledWith({ service: true }, "me");
  });

  it("still counts from the Hub's own markers when the Slack pull fails", async () => {
    pullReadFromSlack.mockRejectedValue(new Error("slack down"));
    loadUnreadCounts.mockResolvedValue({ c1: 2 });
    getSearcher.mockResolvedValue(searcher());
    const { needsAttention } = await searchSuggestions();
    expect(needsAttention.map((s) => s.title)).toEqual(["#general"]);
  });

  it("leaves chat out when the member doesn't have it", async () => {
    getSearcher.mockResolvedValue(searcher({ skip: ["chat", "channels"] }));
    await searchSuggestions();
    expect(loadUnreadCounts).not.toHaveBeenCalled();
  });
});

describe("suggestOperatorValues", () => {
  beforeEach(() => getSearcher.mockReset());

  it("lists channels by name for channel:", async () => {
    getSearcher.mockResolvedValue(searcher());
    expect(await suggestOperatorValues("channel", "#ge")).toEqual([{ value: "general", label: "#general", sublabel: undefined }]);
    expect((await suggestOperatorValues("channel", "")).map((c) => c.value)).toEqual(["general", "book-club"]);
  });

  it("leads from: with me, then the directory's members", async () => {
    getSearcher.mockResolvedValue(
      searcher({}, { member_directory: [{ id: "m1", name: "Ania Ray", display_name: "Ania", photo_url: null }] })
    );
    expect(await suggestOperatorValues("from", "")).toEqual([
      { value: "me", label: "Me", sublabel: "Your own" },
      { value: "Ania Ray", label: "Ania", sublabel: "Ania Ray", imageUrl: null },
    ]);
    // "me" only leads when it could be what was typed.
    expect((await suggestOperatorValues("from", "an")).map((o) => o.value)).toEqual(["Ania Ray"]);
  });

  it("is empty when search is off", async () => {
    getSearcher.mockResolvedValue(null);
    expect(await suggestOperatorValues("from", "a")).toEqual([]);
  });
});

describe("markSuggestionsRead", () => {
  const A = "prkl_AAAAAAAAAAAa"; // a prickle
  const B = "prkl_AAAAAAAAAAAb";
  const C = "chn_AAAAAAAAAAAc";
  const D = "00000000-0000-4000-a000-00000000000d";

  it("dismisses check-ins and check-outs, reads notifications, and ignores chats and junk", async () => {
    const writes: [string, string][] = [];
    const note: { kind: string; ref: string } | null = null;
    const q = (table: string, op: string) => {
      const chain: Record<string, unknown> = {};
      for (const m of ["eq", "is"]) chain[m] = () => chain;
      chain.then = (resolve: (v: unknown) => unknown) => (writes.push([table, op]), Promise.resolve({ error: null }).then(resolve));
      return chain;
    };
    getSearcher.mockResolvedValue(
      searcher({
        ctx: {
          ...searcher().ctx,
          supabase: {
            from: (table: string) => ({
              upsert: () => q(table, "upsert"),
              update: () => q(table, "update"),
              select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: note }) }) }) }),
            }),
          },
        },
      })
    );
    const n = await markSuggestionsRead([`checkin:${A}`, `checkout:${B}`, `chat:${C}`, `notification:${D}`, "checkin:not-a-uuid", `weird:${A}`]);
    expect(n).toBe(3); // chat rows are never marked read here
    expect(writes).toContainEqual(["prickle_checkin_dismissals", "upsert"]);
    expect(writes).toContainEqual(["prickle_checkout_dismissals", "upsert"]);
    expect(writes.filter(([t]) => t === "in_app_notifications").length).toBe(3);
  });

  it("closes the prickle's check-in or check-out when its notification is marked read", async () => {
    const writes: string[] = [];
    const q = (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const m of ["eq", "is"]) chain[m] = () => chain;
      chain.then = (resolve: (v: unknown) => unknown) => (writes.push(table), Promise.resolve({ error: null }).then(resolve));
      return chain;
    };
    const note = { kind: "prickle_checkin", ref: A };
    getSearcher.mockResolvedValue(
      searcher({
        ctx: {
          ...searcher().ctx,
          supabase: {
            from: (table: string) => ({
              upsert: () => q(table),
              update: () => q(table),
              select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: note }) }) }) }),
            }),
          },
        },
      })
    );
    expect(await markSuggestionsRead([`notification:${D}`])).toBe(1);
    expect(writes).toContain("prickle_checkin_dismissals");
  });

  it("does nothing in sudo", async () => {
    getSearcher.mockResolvedValue(searcher({ isSudo: true }));
    expect(await markSuggestionsRead([`checkin:${A}`])).toBe(0);
  });
});


describe("searchPalette chat opt-in", () => {
  beforeEach(() => {
    getSearcher.mockReset().mockResolvedValue(searcher());
    universalSearch.mockReset().mockImplementation(async (_ctx, _query, { skip, timings }) => {
      if (!skip.includes("chat")) timings.chat = 0;
      return [];
    });
  });

  it("skips chat by default and offers an explicit search", async () => {
    expect(await searchPalette("hello")).toEqual({ results: [], chatSkipped: true, chatSearched: false });
    expect(universalSearch.mock.calls[0][2].skip).toEqual(["chat"]);
  });

  it.each(["in:chat hello", "channel:general hello", "has:file"])("records chat participation even with no hits: %s", async (q) => {
    expect(await searchPalette(q)).toEqual({ results: [], chatSkipped: false, chatSearched: true });
    expect(universalSearch.mock.calls[0][2].skip).toEqual([]);
  });

  it("does not mark restricted chat as searched", async () => {
    getSearcher.mockResolvedValue(searcher({ skip: ["chat"] }));
    expect(await searchPalette("in:chat hello")).toEqual({ results: [], chatSkipped: false, chatSearched: false });
  });
});
