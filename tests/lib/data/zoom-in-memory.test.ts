import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryZoomRepository } from "@/lib/data/zoom";
import { defineZoomContract } from "@/tests/helpers/zoom-contract";

defineZoomContract("InMemoryZoomRepository", () => {
  const data = new InMemoryDataset();
  let n = 0;
  return {
    repo: () => new InMemoryZoomRepository(data),
    unique: (label) => `zoom-${label}-${++n}`,
    clear: async () => {
      data.zoomAttendees = [];
      data.zoomMeetings = [];
      data.ignoredZoomNames = [];
    },
  };
});
