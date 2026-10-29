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
