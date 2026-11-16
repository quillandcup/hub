import { InMemoryChatLinkPreviewRepository } from "@/lib/data/chat-link-previews";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { defineChatLinkPreviewContract } from "@/tests/helpers/chat-link-preview-contract";

const messages: [string, string, string] = ["msg_AAAAAAAAAAA1", "msg_AAAAAAAAAAA2", "msg_AAAAAAAAAAA3"];
const members: [string, string] = ["mbr_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA2"];
const data = new InMemoryDataset({ chatMessages: messages.map((id) => ({ id, channel_id: "chn_AAAAAAAAAAA1", deleted_at: null })) });

defineChatLinkPreviewContract("InMemoryChatLinkPreviewRepository", () => ({
  repo: () => new InMemoryChatLinkPreviewRepository(data),
  messages,
  members,
  clear: async () => {
    data.chatLinkPreviews.length = 0;
    data.chatHiddenUnfurls.length = 0;
    data.chatPreviewBlocks.length = 0;
  },
}));
