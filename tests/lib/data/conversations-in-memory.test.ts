import { InMemoryConversationRepository } from "@/lib/data/conversations";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { defineConversationContract } from "@/tests/helpers/conversations-contract";

const members = [
  { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", displayName: "Ada E.", email: "ada@example.test" },
  { id: "mbr_AAAAAAAAAAA2", name: "Bo Example", email: "bo@example.test" },
  { id: "mbr_AAAAAAAAAAA3", name: "Cy Example", email: "cy@example.test" },
];

defineConversationContract("InMemoryConversationRepository", () => {
  const data = new InMemoryDataset({ members: members.map((m) => ({ ...m })) });
  return {
    repo: () => new InMemoryConversationRepository(data),
    members,
    openedBy: "11111111-1111-4111-8111-111111111111",
    missingId: "conv_ZZZZZZZZZZZZ",
    clear: async () => {
      data.conversations = [];
    },
  };
});
