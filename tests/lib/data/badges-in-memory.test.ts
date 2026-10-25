import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryBadgeRepository } from "@/lib/data/badges";
import { defineBadgeContract } from "@/tests/helpers/badge-contract";

const memberIds = ["mbr_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA2"] as const;
const events = [
  { id: "evt-1", title: "Spring Retreat", slug: "spring-retreat" },
  { id: "evt-2", title: "Autumn Retreat", slug: "autumn-retreat" },
] as const;

defineBadgeContract("InMemoryBadgeRepository", () => {
  const data = new InMemoryDataset({ events: [...events] });
  let n = 0;
  return {
    repo: () => new InMemoryBadgeRepository(data),
    memberIds,
    events,
    unique: (label) => `${label} ${++n}`,
    adopt: () => {},
    reset: async () => {
      data.memberBadges = [];
    },
  };
});
