import { describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryMediaRepository } from "@/lib/data/media";
import { storeImage } from "@/lib/media/library";
import { solidImage } from "@/tests/helpers/media-fixtures";

const storage = { from: () => ({ upload: async () => ({ error: null }) }) } as never;

/** A library where another request stores the same picture between this one's lookup and its insert. */
function racing() {
  const data = new InMemoryDataset();
  const media = new InMemoryMediaRepository(data);
  const add = media.add.bind(media);
  let once = true;
  media.add = async (asset) => {
    if (once) {
      once = false;
      await add({ ...asset });
    }
    return add(asset);
  };
  return media;
}

describe("storeImage when two requests store the same picture at once", () => {
  it("takes the picture the other request stored instead of failing the request", async () => {
    const media = racing();
    const bytes = await solidImage(40, 30, "png");
    const result = await storeImage(media, storage, { bytes, source: "kajabi", sourceKey: "import:layout:logo" });
    expect(result).toMatchObject({ ok: true, duplicate: true });
    const again = await storeImage(media, storage, { bytes, source: "kajabi", sourceKey: "import:layout:logo" });
    expect(again.ok && result.ok && again.asset.id === result.asset.id).toBe(true);
  });

  it("still throws an error that is not a duplicate", async () => {
    const media = new InMemoryMediaRepository(new InMemoryDataset());
    media.add = vi.fn().mockRejectedValue(new Error("connection reset"));
    await expect(storeImage(media, storage, { bytes: await solidImage(8, 8, "png") })).rejects.toThrow("connection reset");
  });

  it("throws the duplicate error when no row is there to take", async () => {
    const media = new InMemoryMediaRepository(new InMemoryDataset());
    media.add = vi.fn().mockRejectedValue(new Error('duplicate key value violates unique constraint "media_assets_source_key"'));
    await expect(storeImage(media, storage, { bytes: await solidImage(8, 8, "png") })).rejects.toThrow("duplicate key");
  });
});
