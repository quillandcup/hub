import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryCalendarEventRepository } from "@/lib/data/calendar-events";
import { defineCalendarEventContract } from "@/tests/helpers/calendar-event-contract";

defineCalendarEventContract("InMemoryCalendarEventRepository", () => {
  const data = new InMemoryDataset();
  let n = 0;
  return {
    repo: () => new InMemoryCalendarEventRepository(data),
    unique: (label) => `gcal-${label}-${++n}`,
    clear: async () => {
      data.calendarEvents = [];
    },
  };
});
