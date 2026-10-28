import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryActivityRepository } from "@/lib/data/activities";
import { defineActivityContract } from "@/tests/helpers/activity-contract";

const memberIds = ["mbr_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA2"] as const;

defineActivityContract("InMemoryActivityRepository", () => {
  const data = new InMemoryDataset();
  let n = 0;
  return {
    memberIds,
    repo: () => new InMemoryActivityRepository(data),
    unique: (label) => `${label}-${++n}`,
    clear: async () => {
      data.activities = [];
    },
  };
});
