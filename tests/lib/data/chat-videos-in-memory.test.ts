import { InMemoryChatVideoRepository } from "@/lib/data/chat-videos";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { defineChatVideoContract } from "@/tests/helpers/chat-video-contract";

const data = new InMemoryDataset();

defineChatVideoContract("InMemoryChatVideoRepository", () => ({
  repo: () => new InMemoryChatVideoRepository(data),
  messages: ["msg_AAAAAAAAAAA1", "msg_AAAAAAAAAAA2", "msg_AAAAAAAAAAA3"],
  lessons: ["les_AAAAAAAAAAA1", "les_AAAAAAAAAAA2"],
  clear: async () => {
    data.chatMessageVideos.length = 0;
  },
}));
