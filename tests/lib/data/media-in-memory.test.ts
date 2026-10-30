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
    bookShowing: async (assetId, ownerMemberId, title, publishedOn) => {
      const id = `book_${String(++n).padStart(12, "A")}`;
      data.memberBooks.push({ id, member_id: ownerMemberId, title, published_date: publishedOn, cover_asset_id: assetId });
      return id;
    },
    courseImageShowing: async (assetId, kind, title) => {
      const id = `${kind === "course" ? "crs" : kind === "module" ? "mod" : "les"}_${String(++n).padStart(12, "A")}`;
      data.courseImages.push({ id, kind, title, asset_ids: [assetId] });
      return id;
    },
    projectShowing: async (assetId, ownerMemberId) => {
      const id = `wprj_${String(++n).padStart(12, "A")}`;
      data.writingProjects.push({ id, member_id: ownerMemberId, cover_asset_id: assetId } as never);
      return id;
    },
    eventShowing: async (assetId, title, startsAt) => {
      const id = `evt_${String(++n).padStart(12, "A")}`;
      data.events.push({ id, slug: id, title, starts_at: startsAt, image_id: assetId });
      return id;
    },
  };
});
