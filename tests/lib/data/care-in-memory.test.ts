import { InMemoryCareRepository } from "@/lib/data/care";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { defineCareContract } from "@/tests/helpers/care-contract";

const members = [
  { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", displayName: "Ada E.", email: "ada@example.test" },
  { id: "mbr_AAAAAAAAAAA2", name: "Bo Example", email: "bo@example.test" },
  { id: "mbr_AAAAAAAAAAA3", name: "Cy Example", email: "cy@example.test" },
];

defineCareContract("InMemoryCareRepository", () => {
  const data = new InMemoryDataset({ members: members.map((m) => ({ ...m })) });
  return {
    repo: () => new InMemoryCareRepository(data),
    members,
    openedBy: "11111111-1111-4111-8111-111111111111",
    otherOwner: "22222222-2222-4222-8222-222222222222",
    missingId: "care_ZZZZZZZZZZZZ",
    clear: async () => {
      data.careEngagements = [];
    },
  };
});
