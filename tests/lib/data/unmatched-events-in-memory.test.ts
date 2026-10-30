import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryUnmatchedEventRepository } from "@/lib/data/unmatched-events";
import { defineUnmatchedEventContract } from "@/tests/helpers/unmatched-events-contract";

defineUnmatchedEventContract("InMemoryUnmatchedEventRepository", () => {
  const data = new InMemoryDataset();
  let n = 0;
  return {
    repo: () => new InMemoryUnmatchedEventRepository(data),
    unique: (label) => `${label}-${++n}`,
    calendarEvents: async (labels) => labels.map((label) => `cal-${label}-${++n}`),
    prickleType: async (label) => `type-${label}-${++n}`,
    clear: async () => {
      data.unmatchedEvents = [];
    },
  };
});
