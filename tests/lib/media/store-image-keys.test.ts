import { describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryMediaRepository } from "@/lib/data/media";
import { storeImage, versionedKey } from "@/lib/media/library";
import { solidImage } from "@/tests/helpers/media-fixtures";

const storage = { from: () => ({ upload: async () => ({ error: null }) }) } as never;
const KEY = "import:layout:photo.png";
const store = (media: InMemoryMediaRepository, bytes: Buffer, sourceKey = KEY) => storeImage(media, storage, { bytes, source: "kajabi", sourceKey });
const fresh = () => new InMemoryMediaRepository(new InMemoryDataset());

describe("storeImage keeps an import's picture under its key", () => {
  it("stores a first import under the key itself, and the same bytes again reuse it", async () => {
    const media = fresh();
    const bytes = await solidImage(40, 30, "png");
    const first = await store(media, bytes);
    expect(first).toMatchObject({ ok: true, duplicate: false, asset: { source: "kajabi", source_key: KEY } });
    const again = await store(media, bytes);
    expect(again).toMatchObject({ ok: true, duplicate: true });
    expect(again.ok && first.ok && again.asset.id === first.asset.id).toBe(true);
  });

  it("stores other bytes under a held key with a hash added to it, found again on the next re-import", async () => {
    const media = fresh();
    const before = await solidImage(40, 30, "png");
    const after = await solidImage(41, 30, "png");
    const first = await store(media, before);
    const changed = await store(media, after);
    if (!first.ok || !changed.ok) throw new Error("not stored");
    expect(changed.duplicate).toBe(false);
    expect(changed.asset.id).not.toBe(first.asset.id);
    expect(changed.asset.source_key).toBe(versionedKey(KEY, changed.asset.sha256));
    expect(changed.asset.source_key).toMatch(/^import:layout:photo\.png#[0-9a-f]{12}$/);
    const third = await store(media, after);
    expect(third).toMatchObject({ ok: true, duplicate: true });
    expect(third.ok && third.asset.id).toBe(changed.asset.id);
    // and going back to the first bytes finds the first asset
    const back = await store(media, before);
    expect(back.ok && back.asset.id).toBe(first.asset.id);
  });

  it("takes the hashed key when another request takes the plain one with other bytes during the insert", async () => {
    const media = fresh();
    const mine = await solidImage(40, 30, "png");
    const theirs = await solidImage(41, 30, "png");
    const add = media.add.bind(media);
    let once = true;
    media.add = async (asset) => {
      if (once) {
        once = false;
        await storeImage(media, storage, { bytes: theirs, source: "kajabi", sourceKey: KEY });
        return add(asset); // the plain key is taken now: the database says so
      }
      return add(asset);
    };
    const result = await store(media, mine);
    expect(result).toMatchObject({ ok: true, duplicate: false });
    expect(result.ok && result.asset.source_key).toMatch(/#[0-9a-f]{12}$/);
  });

  it("uses the asset another request stored with the same bytes during the insert", async () => {
    const media = fresh();
    const bytes = await solidImage(40, 30, "png");
    const add = media.add.bind(media);
    let once = true;
    media.add = async (asset) => {
      if (once) {
        once = false;
        await add({ ...asset });
      }
      return add(asset);
    };
    expect(await store(media, bytes)).toMatchObject({ ok: true, duplicate: true });
  });
});

describe("versionedKey", () => {
  it("shortens the key, never the hash, to stay within 300 characters", () => {
    const sha = "ab".repeat(32);
    const key = versionedKey("k".repeat(500), sha);
    expect(key).toHaveLength(300);
    expect(key.endsWith(`#${sha.slice(0, 12)}`)).toBe(true);
    expect(versionedKey("short", sha)).toBe("short#abababababab");
  });
});
