import { InMemoryCareRepository } from "@/lib/data/care";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { defineCareContract } from "@/tests/helpers/care-contract";

const members = [
  { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", displayName: "Ada E.", email: "ada@example.test" },
  { id: "mbr_AAAAAAAAAAA2", name: "Bo Example", email: "bo@example.test" },
  { id: "mbr_AAAAAAAAAAA3", name: "Cy Example", email: "cy@example.test" },
];

const USERS = {
  manager: "11111111-1111-4111-8111-111111111111",
  colleague: "22222222-2222-4222-8222-222222222222",
  admin: "33333333-3333-4333-8333-333333333333",
  assistant: "44444444-4444-4444-8444-444444444444",
  plain: "55555555-5555-4555-8555-555555555555",
};

defineCareContract("InMemoryCareRepository", () => {
  const data = new InMemoryDataset({
    members: members.map((m) => ({ ...m })),
    userProfiles: [
      { id: USERS.manager, email: "manager@example.test", role: "community_manager" },
      { id: USERS.colleague, email: "colleague@example.test", role: "community_manager" },
      { id: USERS.admin, email: "admin@example.test", role: "admin" },
      { id: USERS.assistant, email: "assistant@example.test", role: "assistant" },
      { id: USERS.plain, email: "plain@example.test", role: "member" },
    ],
  });
  return {
    repo: () => new InMemoryCareRepository(data),
    repoAs: (userId) => new InMemoryCareRepository(data, userId),
    members,
    openedBy: USERS.manager,
    otherOwner: USERS.colleague,
    admin: USERS.admin,
    assistant: USERS.assistant,
    plain: USERS.plain,
    missingId: "care_ZZZZZZZZZZZZ",
    clear: async () => {
      data.careEngagements = [];
    },
  };
});
