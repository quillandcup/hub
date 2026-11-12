import { InMemoryCareTrackedDmRepository } from "@/lib/data/care-dms";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { defineCareDmsContract } from "@/tests/helpers/care-dms-contract";

const members = [
  { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", email: "ada@example.test" },
  { id: "mbr_AAAAAAAAAAA2", name: "Bo Example", email: "bo@example.test" },
];

defineCareDmsContract("InMemoryCareTrackedDmRepository", () => {
  const data = new InMemoryDataset({ members: members.map((m) => ({ ...m })) });
  let n = 0;
  return {
    repo: () => new InMemoryCareTrackedDmRepository(data),
    members,
    users: ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"],
    channel: (label) => `D${label.toUpperCase()}${++n}`,
    clear: async () => {
      data.careTrackedDms = [];
    },
  };
});
