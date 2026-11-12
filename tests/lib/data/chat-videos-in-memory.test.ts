import { InMemoryChatVideoRepository } from "@/lib/data/chat-videos";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { defineChatVideoContract } from "@/tests/helpers/chat-video-contract";

const data = new InMemoryDataset();

defineChatVideoContract("InMemoryChatVideoRepository", () => ({
  repo: () => new InMemoryChatVideoRepository(data),
  messages: ["msg_AAAAAAAAAAA1", "msg_AAAAAAAAAAA2", "msg_AAAAAAAAAAA3"],
  lessons: ["les_AAAAAAAAAAA1", "les_AAAAAAAAAAA2"],
  softDelete: async (messageId) => {
    const existing = data.chatMessages.find((m) => m.id === messageId);
    if (existing) existing.deleted_at = new Date().toISOString();
    else data.chatMessages.push({ id: messageId, channel_id: "chn_AAAAAAAAAAA1", deleted_at: new Date().toISOString() } as never);
  },
  clear: async () => {
    data.chatMessageVideos.length = 0;
    data.chatMessages.length = 0;
  },
}));
