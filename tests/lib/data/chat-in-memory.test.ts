import { describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryChatRepository } from "@/lib/data/chat";
import { defineChatContract } from "@/tests/helpers/chat-contract";

defineChatContract("InMemoryChatRepository", () => {
  const data = new InMemoryDataset();
  let n = 0;
  let memberIds: string[] = [];
  let channelIds: Record<string, string> = {};
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
    // --- channels and membership slice ---
    seedMembers: async (count) => {
      memberIds = Array.from({ length: count }, (_, i) => `mbr_${String(++n).padStart(11, "A")}${i}`);
      return memberIds;
    },
    seedChannelRows: async (channels) => {
      const ids: Record<string, string> = {};
      data.chatChannels = channels.map((c) => {
        ids[c.key] = `chn_${String(++n).padStart(12, "A")}`;
        return {
          id: ids[c.key],
          name: c.name ?? null,
          kind: c.kind ?? "channel",
          visibility: c.visibility ?? "public",
          ...(c.restricted !== undefined ? { restricted: c.restricted } : {}),
          archived_at: c.archivedAt ?? null,
          slack_channel_id: c.slackChannelId ?? null,
          ...(c.bridgeDisabled !== undefined ? { bridge_disabled: c.bridgeDisabled } : {}),
        };
      });
      channelIds = ids;
      return ids;
    },
    seedMemberships: async (rows) => {
      data.chatChannelMembers = rows.map((r) => ({
        channel_id: channelIds[r.channel],
        member_id: memberIds[r.member],
        ...(r.joinedAt ? { joined_at: r.joinedAt } : {}),
        ...(r.leftAt ? { left_at: r.leftAt } : {}),
        ...(r.lastReadAt ? { last_read_at: r.lastReadAt } : {}),
        ...(r.source ? { source: r.source } : {}),
      }));
    },
    seedChannelMessages: async (rows) => {
      const ids: Record<string, string> = {};
      data.chatMessages = [];
      for (const r of rows) {
        ids[r.key] = `msg_${String(data.chatMessages.length + 1).padStart(12, "A")}`;
        data.chatMessages.push({
          id: ids[r.key],
          channel_id: channelIds[r.channel],
          created_at: r.createdAt,
          ...(r.author !== undefined ? { author_member_id: memberIds[r.author] } : {}),
          ...(r.slackTs ? { slack_ts: r.slackTs } : {}),
          ...(r.replyTo ? { thread_root_id: ids[r.replyTo] } : {}),
          ...(r.deleted ? { deleted_at: r.createdAt } : {}),
          ...(r.origin ? { origin: r.origin } : {}),
          ...(r.syncStatus ? { slack_sync_status: r.syncStatus } : {}),
        });
      }
      return ids;
    },
    noticesIn: async (channelId) =>
      data.chatMessages
        .filter((m) => m.channel_id === channelId && m.system_subtype)
        .map((m) => ({
          author_member_id: m.author_member_id ?? null,
          system_subtype: m.system_subtype ?? null,
          origin: m.origin ?? "slack",
          body: data.chatMessageContents.find((c) => c.message_id === m.id)?.body ?? "",
        })),
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
