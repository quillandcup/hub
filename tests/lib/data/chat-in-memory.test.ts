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
      // Messages go with their channels, as the database cascades.
      data.chatMessages = [];
      data.chatMessageContents = [];
      data.chatReactions = [];
      data.chatChannels =channels.map((c, i) => {
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
    // --- message reads ---
    seedMessages: async (channelId, messages) => {
      const ids: Record<string, string> = {};
      for (const m of messages) {
        ids[m.key] = `msg_${String(++n).padStart(12, "A")}`;
        data.chatMessages.push({
          id: ids[m.key],
          channel_id: channelId,
          created_at: m.createdAt,
          slack_ts: m.slackTs ?? null,
          has_files: m.hasFiles ?? false,
          deleted_at: m.deleted ? m.createdAt : null,
          thread_root_id: m.threadRootKey ? ids[m.threadRootKey] : null,
        });
        if (m.body !== undefined) data.chatMessageContents.push({ message_id: ids[m.key], body: m.body });
      }
      return ids;
    },
    seedReactions: async (channelId, reactions) => {
      for (const r of reactions) {
        data.chatReactions.push({
          id: `rct_${String(++n).padStart(12, "A")}`,
          channel_id: channelId,
          message_id: r.messageId,
          emoji: r.emoji,
          slack_user_id: r.slackUserId,
          member_id: null,
          deleted_at: r.deleted ? "2026-10-01T11:00:00.000Z" : null,
        });
      }
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
