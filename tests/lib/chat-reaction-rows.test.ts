import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/chat/names", () => ({
  customEmojiFor: async () => ({}),
  slackAuthorIdsByTs: async () => ({}),
  slackChannelNames: async () => ({}),
  slackUserMemberIds: async () => ({}),
  slackUserHubNames: async () => ({}),
  slackUserNames: async () => ({}),
  slackUserPhotos: async () => ({}),
}));

import { buildMessageViews, loadReactionRows, type MessageRow } from "@/lib/chat/load";

type Reaction = { id: string; message_id: string; emoji: string; member_id: string | null; slack_user_id: string | null };

/** A client that answers like the API in production: at most 1000 rows per request, however many match. */
function apiWith(reactions: Reaction[], opts: { reportCount?: boolean; error?: string } = {}) {
  const calls: { from: number; to: number }[] = [];
  const client = {
    from: (table: string) => {
      if (table !== "chat_reactions") throw new Error(`unexpected table ${table}`);
      let ids: string[] = [];
      let wantCount = false;
      const chain: Record<string, unknown> = {};
      chain.select = (_cols: string, o?: { count?: string }) => ((wantCount = o?.count === "exact"), chain);
      chain.in = (_c: string, v: string[]) => ((ids = v), chain);
      chain.is = () => chain;
      chain.order = () => chain;
      chain.range = (from: number, to: number) => {
        calls.push({ from, to });
        const matching = reactions.filter((r) => ids.includes(r.message_id)).sort((a, b) => a.id.localeCompare(b.id));
        const slice = matching.slice(from, Math.min(to, from + 999) + 1);
        const result = opts.error
          ? { data: null, error: { message: opts.error } }
          : { data: slice, error: null, count: wantCount && opts.reportCount !== false ? matching.length : null };
        return { then: (resolve: (v: unknown) => unknown) => resolve(result) };
      };
      return chain;
    },
  };
  return { client: client as never, calls };
}

const make = (n: number, messageOf: (i: number) => string): Reaction[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `rct_${String(i).padStart(6, "0")}`,
    message_id: messageOf(i),
    emoji: i % 2 ? "tada" : "heart",
    member_id: null,
    slack_user_id: `U${i}`,
  }));

describe("loadReactionRows", () => {
  it("makes no request when there are no messages", async () => {
    const { client, calls } = apiWith([]);
    expect(await loadReactionRows(client, [])).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("reads a short list in one request", async () => {
    const { client, calls } = apiWith(make(40, () => "msg_1"));
    expect(await loadReactionRows(client, ["msg_1"])).toHaveLength(40);
    expect(calls).toHaveLength(1);
  });

  it("gets every reaction past the 1000-row cap, the rest in parallel once the total is known", async () => {
    const all = make(2587, (i) => `msg_${i % 40}`);
    const { client, calls } = apiWith(all);
    const got = await loadReactionRows(client, Array.from({ length: 40 }, (_, i) => `msg_${i}`));
    expect(got).toHaveLength(2587);
    expect(new Set(got.map((r) => `${r.message_id}|${r.slack_user_id}`)).size).toBe(2587);
    expect(calls.map((c) => c.from)).toEqual([0, 1000, 2000]);
  });

  it("keeps going until a short page when the total is not reported", async () => {
    const all = make(2300, () => "msg_1");
    const { client, calls } = apiWith(all, { reportCount: false });
    expect(await loadReactionRows(client, ["msg_1"])).toHaveLength(2300);
    expect(calls.map((c) => c.from)).toEqual([0, 1000, 2000]);
  });

  it("is an error, not an empty list, when the database fails", async () => {
    const { client } = apiWith(make(5, () => "msg_1"), { error: "canceling statement due to statement timeout" });
    await expect(loadReactionRows(client, ["msg_1"])).rejects.toThrow(/chat_reactions read failed: canceling statement/);
  });
});

describe("buildMessageViews with a busy page", () => {
  const row = (id: string): MessageRow => ({
    id,
    author_member_id: null,
    slack_ts: null,
    created_at: "2026-10-01T00:00:00Z",
    edited_at: null,
    deleted_at: null,
    reply_count: 0,
    last_reply_at: null,
    has_files: false,
    chat_message_contents: { body: "hi" },
  });

  it("shows the reactions of a message whose rows sit past the first 1000", async () => {
    // 1200 reactions on the first message, then 3 on the second: the old single request returned only
    // the first 1000 and the second message showed none.
    const all = [...make(1200, () => "msg_1"), ...make(3, () => "msg_2").map((r, i) => ({ ...r, id: `rct_z${i}` }))];
    const { client } = apiWith(all);
    const out = await buildMessageViews(client, { slackChannelId: null }, [row("msg_1"), row("msg_2")], "mbr_AAAAAAAAAAA1");
    const counts = (id: string) => out.views.find((v) => v.id === id)!.reactions.reduce((n, r) => n + r.count, 0);
    expect(counts("msg_1")).toBe(1200);
    expect(counts("msg_2")).toBe(3);
  });

  it("fails the build rather than showing a message with no reactions", async () => {
    const { client } = apiWith(make(3, () => "msg_1"), { error: "boom" });
    await expect(buildMessageViews(client, { slackChannelId: null }, [row("msg_1")], "mbr_AAAAAAAAAAA1")).rejects.toThrow(/chat_reactions/);
  });
});
