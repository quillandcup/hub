import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryEventRepository } from "@/lib/data/events";
import { defineEventContract } from "@/tests/helpers/event-contract";

defineEventContract("InMemoryEventRepository", () => {
  const data = new InMemoryDataset();
  return {
    repo: () => new InMemoryEventRepository(data),
    seed: async (events) => {
      const ids: Record<string, string> = {};
      data.events = events.map((e, i) => {
        ids[e.key] = `evnt_${i}`;
        return { id: ids[e.key], title: e.title, slug: `slug-${i}`, starts_at: e.startsAt };
      });
      return ids;
    },
  };
});
