import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";

vi.mock("@/lib/chat/names", () => ({
  customEmojiFor: async () => ({}),
  slackAuthorIdsByTs: async () => ({}),
  slackChannelNames: async () => ({}),
  slackUserMemberIds: async () => ({}),
  slackUserHubNames: async () => ({}),
  slackUserNames: async () => ({}),
  slackUserPhotos: async () => ({}),
}));

const state = vi.hoisted(() => ({ data: null as unknown, failing: false }));
vi.mock("@/lib/data/repos", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/data/repos")>();
  return {
    ...original,
    createRepos: () => {
      const repos = original.createInMemoryRepos(state.data as never);
      if (!state.failing) return repos;
      // Every chat read fails, as when the database is down.
      const failing = new Proxy(repos.chat, { get: () => async () => Promise.reject(new Error("db down")) });
      return { ...repos, chat: failing };
    },
  };
});

import { buildMessageViews, loadMessage, loadMessages, loadMessagesByIds, loadReactionRows } from "@/lib/chat/load";

const CH = "chn_AAAAAAAAAAA1";
const at = (minute: number) => `2026-10-01T10:${String(minute).padStart(2, "0")}:00.000Z`;

beforeEach(() => {
  state.failing = false;
  state.data = new InMemoryDataset({
    chatMessages: [
      { id: "msg_AAAAAAAAAAA1", channel_id: CH, created_at: at(1) },
      { id: "msg_AAAAAAAAAAA2", channel_id: CH, created_at: at(2), reply_count: 2 },
      { id: "msg_AAAAAAAAAAA3", channel_id: CH, created_at: at(3), thread_root_id: "msg_AAAAAAAAAAA2", slack_ts: "1.1" },
      { id: "msg_AAAAAAAAAAA4", channel_id: CH, created_at: at(4), thread_root_id: "msg_AAAAAAAAAAA2", author_member_id: "mbr_AAAAAAAAAAA1" },
    ],
    chatMessageContents: [{ message_id: "msg_AAAAAAAAAAA1", body: "hello" }],
  });
});

describe("loadMessages", () => {
  it("returns the newest top-level messages oldest first, with a cursor to older ones when the page is full", async () => {
    const page = await loadMessages({} as never, CH);
    expect(page.messages.map((m) => m.id)).toEqual(["msg_AAAAAAAAAAA1", "msg_AAAAAAAAAAA2"]);
    expect(page.olderBefore).toBeNull();
    expect((await loadMessages({} as never, CH, { before: at(2) })).messages.map((m) => m.id)).toEqual(["msg_AAAAAAAAAAA1"]);
  });

  it("returns one thread's replies in order", async () => {
    const page = await loadMessages({} as never, CH, { threadRootId: "msg_AAAAAAAAAAA2" });
    expect(page.messages.map((m) => m.id)).toEqual(["msg_AAAAAAAAAAA3", "msg_AAAAAAAAAAA4"]);
  });

  it("shows an empty list, not an error, when the database fails", async () => {
    state.failing = true;
    expect(await loadMessages({} as never, CH)).toEqual({ messages: [], olderBefore: null });
    expect(await loadMessages({} as never, CH, { threadRootId: "msg_AAAAAAAAAAA2" })).toEqual({ messages: [], olderBefore: null });
  });
});

describe("loadMessagesByIds and loadMessage", () => {
  it("read specific messages of a conversation", async () => {
    expect((await loadMessagesByIds({} as never, CH, ["msg_AAAAAAAAAAA1", "msg_AAAAAAAAAAA3"])).map((m) => m.id)).toEqual(["msg_AAAAAAAAAAA1"]);
    expect(await loadMessagesByIds({} as never, CH, [])).toEqual([]);
    expect(await loadMessage({} as never, CH, "msg_AAAAAAAAAAA3")).toMatchObject({ id: "msg_AAAAAAAAAAA3" });
    expect(await loadMessage({} as never, CH, "msg_missing")).toBeNull();
  });

  it("give nothing, not an error, when the database fails", async () => {
    state.failing = true;
    expect(await loadMessagesByIds({} as never, CH, ["msg_AAAAAAAAAAA1"])).toEqual([]);
    expect(await loadMessage({} as never, CH, "msg_AAAAAAAAAAA1")).toBeNull();
  });
});

describe("thread repliers and reactions in a page of views", () => {
  const root = { id: "msg_AAAAAAAAAAA2", author_member_id: null, slack_ts: "0.1", origin: "slack" as const, created_at: at(2), edited_at: null, deleted_at: null, reply_count: 2, last_reply_at: null, has_files: false, chat_message_contents: { body: "root" } };

  it("builds the views over the repository's replies and reactions", async () => {
    state.data = new InMemoryDataset({
      chatMessages: [
        { id: "msg_AAAAAAAAAAA2", channel_id: CH, created_at: at(2) },
        { id: "msg_AAAAAAAAAAA3", channel_id: CH, created_at: at(3), thread_root_id: "msg_AAAAAAAAAAA2", slack_ts: "1.1" },
      ],
      chatReactions: [{ id: "rct_AAAAAAAAAAA1", message_id: "msg_AAAAAAAAAAA2", emoji: "tada", slack_user_id: "U1" }],
    });
    const out = await buildMessageViews({} as never, { slackChannelId: null }, [root], "mbr_AAAAAAAAAAA1");
    expect(out.views[0].replyAuthors).toHaveLength(1);
    expect(out.views[0].reactions).toMatchObject([{ emoji: "tada", count: 1, mine: false }]);
    expect(await loadReactionRows({} as never, ["msg_AAAAAAAAAAA2"])).toHaveLength(1);
  });

  it("fails the build on a reactions error rather than showing no reactions", async () => {
    state.failing = true;
    await expect(buildMessageViews({} as never, { slackChannelId: null }, [root], "mbr_AAAAAAAAAAA1")).rejects.toThrow("db down");
  });
});
