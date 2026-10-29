import { describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryChatRepository } from "@/lib/data/chat";
import { defineChatContract } from "@/tests/helpers/chat-contract";

defineChatContract("InMemoryChatRepository", () => {
  const data = new InMemoryDataset();
  let n = 0;
  return {
    repo: () => new InMemoryChatRepository(data),
    unique: (label) => `${label}${++n}`,
    seedChannels: async (channels) => {
      const ids: Record<string, string> = {};
      data.chatChannels = channels.map((c, i) => {
        ids[c.key] = `chn_${String(i).padStart(12, "A")}`;
        return {
          id: ids[c.key],
          slack_channel_id: c.slackChannelId ?? null,
          ...(c.bridgeMode ? { bridge_mode: c.bridgeMode } : {}),
          ...(c.bridgeDisabled !== undefined ? { bridge_disabled: c.bridgeDisabled } : {}),
          ...(c.bridgeStatus ? { bridge_status: c.bridgeStatus } : {}),
        };
      });
      return ids;
    },
  };
});

describe("InMemoryDataset chat tables", () => {
  it("keeps its own copy of every chat row it is given, so a test can change its fixtures afterwards", () => {
    const channel = { id: "chn_AAAAAAAAAAA1", name: "general" };
    const member = { channel_id: channel.id, member_id: "mbr_AAAAAAAAAAA1" };
    const message = { id: "msg_AAAAAAAAAAA1", channel_id: channel.id };
    const content = { message_id: message.id };
    const reaction = { message_id: message.id };
    const author = { slack_user_id: "U1", member_id: member.member_id };
    const gapFill = { id: "gf_AAAAAAAAAAA1" };

    const data = new InMemoryDataset({
      chatChannels: [channel],
      chatChannelMembers: [member],
      chatMessages: [message],
      chatMessageContents: [content],
      chatReactions: [reaction],
      chatSlackAuthors: [author],
      chatGapFills: [gapFill],
    });
    channel.name = "changed";

    expect(data.chatChannels).toEqual([{ id: channel.id, name: "general" }]);
    expect(data.chatChannelMembers).toEqual([member]);
    expect(data.chatMessages).toEqual([message]);
    expect(data.chatMessageContents).toEqual([content]);
    expect(data.chatReactions).toEqual([reaction]);
    expect(data.chatSlackAuthors).toEqual([author]);
    expect(data.chatGapFills).toEqual([gapFill]);
    expect(new InMemoryDataset().chatChannels).toEqual([]);
  });
});
