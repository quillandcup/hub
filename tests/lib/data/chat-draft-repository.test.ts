import { InMemoryChatDraftRepository } from "@/lib/data/chat-drafts";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { defineChatDraftContract } from "@/tests/helpers/chat-draft-contract";

const members: [string, string] = ["mbr_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA2"];

defineChatDraftContract("InMemoryChatDraftRepository", () => {
  const data = new InMemoryDataset();
  return {
    repo: () => new InMemoryChatDraftRepository(data),
    members,
    places: {
      conversation: { channelId: "chn_AAAAAAAAAAA1", threadRootId: null },
      thread: { channelId: "chn_AAAAAAAAAAA1", threadRootId: "msg_AAAAAAAAAAA1" },
      other: { channelId: "chn_AAAAAAAAAAA2", threadRootId: null },
    },
    clear: async () => {
      data.chatDrafts = [];
    },
  };
});
