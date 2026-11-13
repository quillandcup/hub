import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryChatRepository } from "@/lib/data/chat";

// The same rules as supabase/tests/database/chat_mark_unread.test.sql, which runs the real function
// (it is bound to the signed-in caller, so the shared contract suite, which runs as the service role,
// can't call it). The twin keeps millisecond precision.
const CHANNEL = "chn_AAAAAAAAAAA1";
const FERN = "mbr_AAAAAAAAAAA1";
const GALE = "mbr_AAAAAAAAAAA2";

let data: InMemoryDataset;
let repo: InMemoryChatRepository;

beforeEach(() => {
  data = new InMemoryDataset({
    chatChannelMembers: [
      { channel_id: CHANNEL, member_id: FERN, joined_at: "2019-01-01T00:00:00Z", last_read_at: "2020-03-01T00:00:00Z", left_at: null },
      { channel_id: CHANNEL, member_id: GALE, joined_at: "2019-01-01T00:00:00Z", last_read_at: "2020-03-01T00:00:00Z", left_at: null },
    ],
    chatMessages: [
      { id: "msg_AAAAAAAAAAA1", channel_id: CHANNEL, created_at: "2020-02-01T10:00:00.123Z" },
      { id: "msg_AAAAAAAAAAA2", channel_id: CHANNEL, created_at: "2020-02-02T00:00:00Z" },
      { id: "msg_AAAAAAAAAAA3", channel_id: CHANNEL, created_at: "2020-02-03T00:00:00Z", thread_root_id: "msg_AAAAAAAAAAA1" },
      { id: "msg_AAAAAAAAAAA4", channel_id: CHANNEL, created_at: "2020-02-04T00:00:00Z", deleted_at: "2020-02-05T00:00:00Z" },
      { id: "msg_AAAAAAAAAAA5", channel_id: CHANNEL, created_at: "2020-04-01T00:00:00Z" },
    ] as never,
  });
  repo = new InMemoryChatRepository(data);
});

describe("InMemoryChatRepository.markUnread", () => {
  it("moves the caller's marker to just before the message, and only theirs", async () => {
    const marker = await repo.markUnread(CHANNEL, "msg_AAAAAAAAAAA1", FERN);
    expect(Date.parse(marker as string)).toBe(Date.parse("2020-02-01T10:00:00.123Z") - 1);
    expect(await repo.readMarker(CHANNEL, FERN)).toBe(marker);
    expect(await repo.readMarker(CHANNEL, GALE)).toBe("2020-03-01T00:00:00Z");
  });

  it("never moves the marker forward", async () => {
    const marker = await repo.markUnread(CHANNEL, "msg_AAAAAAAAAAA5", FERN);
    expect(marker).toBe("2020-03-01T00:00:00Z");
  });

  it("refuses replies, deleted messages, other conversations and people who are not in it", async () => {
    expect(await repo.markUnread(CHANNEL, "msg_AAAAAAAAAAA3", FERN)).toBeNull();
    expect(await repo.markUnread(CHANNEL, "msg_AAAAAAAAAAA4", FERN)).toBeNull();
    expect(await repo.markUnread("chn_AAAAAAAAAAA9", "msg_AAAAAAAAAAA1", FERN)).toBeNull();
    expect(await repo.markUnread(CHANNEL, "msg_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA9")).toBeNull();
    expect(await repo.readMarker(CHANNEL, FERN)).toBe("2020-03-01T00:00:00Z");
  });

  it("works from the join time for a membership that never read", async () => {
    data.chatChannelMembers[0].last_read_at = null;
    data.chatChannelMembers[0].joined_at = "2020-06-01T00:00:00Z";
    const marker = await repo.markUnread(CHANNEL, "msg_AAAAAAAAAAA2", FERN);
    expect(Date.parse(marker as string)).toBe(Date.parse("2020-02-02T00:00:00Z") - 1);
  });
});
