import { describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryChatRepository } from "@/lib/data/chat";
import { loadMessages, MESSAGE_PAGE_SIZE, type ChatLoadRepos } from "@/lib/chat/load";

const CHANNEL = "chn_AAAAAAAAAAA1";
const at = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 3_600_000).toISOString();

function repos(count: number): ChatLoadRepos {
  const data = new InMemoryDataset();
  data.chatMessages = Array.from({ length: count }, (_, i) => ({
    id: `msg_${String(i).padStart(12, "A")}`,
    channel_id: CHANNEL,
    created_at: at(i),
    slack_ts: null,
    has_files: false,
    deleted_at: null,
    thread_root_id: null,
    origin: "slack" as const,
    slack_sync_status: null,
    author_member_id: null,
    posted_via: null,
    reply_count: 0,
  }));
  return { chat: new InMemoryChatRepository(data) } as unknown as ChatLoadRepos;
}

describe("loadMessages from a date", () => {
  it("starts at the first message on or after the date, oldest first, with older ones behind it", async () => {
    const page = await loadMessages(repos(100), CHANNEL, { from: at(30) });
    expect(page.messages).toHaveLength(MESSAGE_PAGE_SIZE);
    expect(page.messages[0].created_at).toBe(at(30));
    expect(page.messages[MESSAGE_PAGE_SIZE - 1].created_at).toBe(at(30 + MESSAGE_PAGE_SIZE - 1));
    expect(page.olderBefore).toBe(at(30));
    expect(page.newerAfter).toBe(at(30 + MESSAGE_PAGE_SIZE - 1));
  });

  it("lands on the next message when nothing was posted at the date", async () => {
    const page = await loadMessages(repos(5), CHANNEL, { from: new Date(Date.parse(at(1)) + 60_000).toISOString() });
    expect(page.messages[0].created_at).toBe(at(2));
  });

  it("has nothing older at the very beginning and nothing newer at the end", async () => {
    const page = await loadMessages(repos(5), CHANNEL, { from: "1970-01-01T00:00:00.000Z" });
    expect(page.messages).toHaveLength(5);
    expect(page.olderBefore).toBeNull();
    expect(page.newerAfter).toBeNull();
  });

  it("is empty past the last message, with the date as the cursor for what came before", async () => {
    const from = new Date(Date.parse(at(10))).toISOString();
    const page = await loadMessages(repos(5), CHANNEL, { from });
    expect(page.messages).toEqual([]);
    expect(page.olderBefore).toBe(from);
    expect(page.newerAfter).toBeNull();
  });

  it("continues after a message without repeating it", async () => {
    const page = await loadMessages(repos(10), CHANNEL, { from: at(3), fromExclusive: true });
    expect(page.messages[0].created_at).toBe(at(4));
  });

  it("shows an empty window rather than an error when the read fails", async () => {
    const broken = { chat: { channelMessagesFrom: async () => Promise.reject(new Error("down")), channelMessages: async () => [] } } as unknown as ChatLoadRepos;
    expect(await loadMessages(broken, CHANNEL, { from: at(0) })).toEqual({ messages: [], olderBefore: null, newerAfter: null });
  });
});
