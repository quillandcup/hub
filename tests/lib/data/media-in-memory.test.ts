import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryMediaRepository } from "@/lib/data/media";
import { defineMediaContract } from "@/tests/helpers/media-contract";

defineMediaContract("InMemoryMediaRepository", () => {
  const data = new InMemoryDataset();
  let n = 0;
  return {
    repo: () => new InMemoryMediaRepository(data),
    unique: (label) => `${label}-${++n}`,
    owners: async () => ["mbr_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA2"],
    eventShowing: async (assetId, title, startsAt) => {
      const id = `evt_${String(++n).padStart(12, "A")}`;
      data.events.push({ id, slug: id, title, starts_at: startsAt, image_id: assetId });
      return id;
    },
  };
});
