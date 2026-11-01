import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryCalendarSyncStateRepository } from "@/lib/data/calendar-sync-state";
import { defineCalendarSyncStateContract } from "@/tests/helpers/calendar-sync-state-contract";

let n = 0;
defineCalendarSyncStateContract("InMemoryCalendarSyncStateRepository", () => {
  const data = new InMemoryDataset();
  return {
    repo: () => new InMemoryCalendarSyncStateRepository(data),
    calendarId: () => `calendar-${++n}@example.test`,
    stored: async (calendarId) => data.calendarSyncStates.find((r) => r.calendar_id === calendarId) ?? null,
  };
});
