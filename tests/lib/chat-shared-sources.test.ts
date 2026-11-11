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

import { buildMessageViews, type MessageRow } from "@/lib/chat/load";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";

const FERN = "mbr_AAAAAAAAAAF1";
const share = (channel: string, ts: string) => ({ is_share: true, author_name: "Ada Example", text: "the quoted words", ts, channel_id: channel, channel_name: "tea-room" });
const row = (attachments: unknown[]): MessageRow => ({
  id: "msg_AAAAAAAAAAA9",
  author_member_id: FERN,
  slack_ts: null,
  created_at: "2026-10-01T00:00:00Z",
  edited_at: null,
  deleted_at: null,
  reply_count: 0,
  last_reply_at: null,
  has_files: false,
  chat_message_contents: { body: "look", attachments },
});

const dataset = () =>
  new InMemoryDataset({
    chatChannels: [
      { id: "chn_AAAAAAAAAAA1", slack_channel_id: "CPUBLIC" },
      { id: "chn_AAAAAAAAAAA2", slack_channel_id: "CPRIVATE" },
    ],
    chatMessages: [
      { id: "msg_AAAAAAAAAAA1", channel_id: "chn_AAAAAAAAAAA1", slack_ts: "1700000000.000100" },
      { id: "msg_AAAAAAAAAAA2", channel_id: "chn_AAAAAAAAAAA2", slack_ts: "1700000001.000100" },
      { id: "msg_AAAAAAAAAAA3", channel_id: "chn_AAAAAAAAAAA1", slack_ts: "1700000002.000100", deleted_at: "2026-10-02T00:00:00Z" },
    ],
    // The private conversation's message has no readable content row: row-level security hid it from this viewer.
    chatMessageContents: [
      { message_id: "msg_AAAAAAAAAAA1", body: "Hub copy, edited" },
      { message_id: "msg_AAAAAAAAAAA3", body: "gone" },
    ],
  });

async function shareOf(repos: Pick<Repos, "attendance" | "chat" | "chatVideos" | "directory" | "memberProfile">, attachment: unknown) {
  const out = await buildMessageViews(repos, { slackChannelId: null }, [row([attachment])], FERN);
  const u = out.views[0].unfurls?.[0];
  if (!u || u.kind !== "share") throw new Error("no share");
  return u;
}

describe("buildMessageViews: shared Slack messages", () => {
  it("links the original when the viewer can read it in the Hub, and the card keeps the embedded copy", async () => {
    const u = await shareOf(createInMemoryRepos(dataset()), share("CPUBLIC", "1700000000.000100"));
    expect(u.source).toEqual({ hubUrl: "/chat/chn_AAAAAAAAAAA1?m=msg_AAAAAAAAAAA1", deleted: false });
    expect(u.shared?.text).toBe("the quoted words");
  });

  it("still carries the embedded copy, with no Hub link, for a source the viewer can't read", async () => {
    const u = await shareOf(createInMemoryRepos(dataset()), share("CPRIVATE", "1700000001.000100"));
    expect(u.source).toEqual({ hubUrl: null, deleted: false });
    expect(u.shared?.text).toBe("the quoted words");
  });

  it("marks a deleted original deleted, with no link", async () => {
    const u = await shareOf(createInMemoryRepos(dataset()), share("CPUBLIC", "1700000002.000100"));
    expect(u.source).toEqual({ hubUrl: null, deleted: true });
    expect(u.shared?.text).toBe("the quoted words");
  });

  it("shows the copy with no Hub link when the Hub doesn't have the original", async () => {
    const u = await shareOf(createInMemoryRepos(dataset()), share("CUNKNOWN", "1700000009.000100"));
    expect(u.source).toEqual({ hubUrl: null, deleted: false });
    expect(u.shared?.text).toBe("the quoted words");
  });

  it("still shows the copy, with no link, when the lookup throws", async () => {
    const repos = createInMemoryRepos(dataset());
    repos.chat.sharedSourcesBySlackRef = async () => {
      throw new Error("boom");
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const u = await shareOf(repos, share("CPUBLIC", "1700000000.000100"));
    expect(u.source).toEqual({ hubUrl: null, deleted: false });
    expect(u.shared?.text).toBe("the quoted words");
    spy.mockRestore();
  });

  it("asks nothing when a message has no share, and leaves an unparseable share undrawn", async () => {
    const repos = createInMemoryRepos(dataset());
    const spy = vi.spyOn(repos.chat, "sharedSourcesBySlackRef");
    const out = await buildMessageViews(repos, { slackChannelId: null }, [row([{ title: "A page", title_link: "https://example.com/a", text: "t" }])], FERN);
    expect(spy).not.toHaveBeenCalled();
    expect(out.views[0].unfurls?.map((u) => u.kind)).toEqual(["card"]);
    const empty = await buildMessageViews(repos, { slackChannelId: null }, [row([{ is_share: true }])], FERN);
    const u = empty.views[0].unfurls?.[0];
    expect(u && u.kind === "share" ? u.shared : "x").toBeUndefined();
  });
});
