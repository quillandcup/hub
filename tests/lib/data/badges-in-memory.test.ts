import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryBadgeRepository } from "@/lib/data/badges";
import { defineBadgeContract } from "@/tests/helpers/badge-contract";

const memberIds = ["mbr_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA2"] as const;
const events = [
  { id: "evt-1", title: "Spring Retreat", slug: "spring-retreat" },
  { id: "evt-2", title: "Autumn Retreat", slug: "autumn-retreat" },
] as const;

defineBadgeContract("InMemoryBadgeRepository", () => {
  const data = new InMemoryDataset({
    events: events.map((e) => ({ id: e.id, slug: e.slug, prickle_id: `prkl_${e.id}` })),
    prickles: events.map((e) => ({ id: `prkl_${e.id}`, typeId: null, hostId: null, title: e.title, startTime: "2097-03-01T15:00:00Z", endTime: "2097-03-01T16:00:00Z", source: "calendar", calendarEventId: null })),
  });
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
