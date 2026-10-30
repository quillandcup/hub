import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryMediaRepository } from "@/lib/data/media";
import { DELETED_KEEP_DAYS, STALE_UPLOAD_MS, sweepMedia } from "@/lib/media/sweep";
import { useFakeClock } from "@/tests/helpers/fake-clock";

const NOW = Date.parse("2026-11-15T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

/** A bucket held in a Map, listing like Supabase Storage: a prefix's files and sub-folders, paged. */
class FakeBucket {
  objects = new Map<string, string>(); // path -> created_at
  failRemoveOf: ((paths: string[]) => string | null) | null = null;
  failListOf: string | null = null;
  removeCalls: string[][] = [];
  onRemove: (() => void) | null = null;

  put(path: string, createdAt = new Date(NOW).toISOString()) {
    this.objects.set(path, createdAt);
  }
  async list(prefix: string, opts: { limit?: number; offset?: number } = {}) {
    if (this.failListOf === prefix) return { data: null, error: { message: "list failed" } };
    const seen = new Set<string>();
    const entries: { name: string; id: string | null; created_at: string | null }[] = [];
    for (const [path, created] of this.objects) {
      if (!path.startsWith(`${prefix}/`)) continue;
      const rest = path.slice(prefix.length + 1);
      const slash = rest.indexOf("/");
      if (slash >= 0) {
        const folder = rest.slice(0, slash);
        if (!seen.has(folder)) {
          seen.add(folder);
          entries.push({ name: folder, id: null, created_at: null });
        }
      } else entries.push({ name: rest, id: path, created_at: created });
    }
    const offset = opts.offset ?? 0;
    return { data: entries.slice(offset, offset + (opts.limit ?? 100)), error: null };
  }
  async remove(paths: string[]) {
    this.removeCalls.push(paths);
    const failure = this.failRemoveOf?.(paths);
    if (failure) return { data: null, error: { message: failure } };
    for (const p of paths) this.objects.delete(p);
    this.onRemove?.();
    return { data: [], error: null };
  }
}

let data: InMemoryDataset;
let media: InMemoryMediaRepository;
let bucket: FakeBucket;
const storage = () => ({ from: () => bucket }) as never;

const asset = async (sha: string, deletedDaysAgo: number | null) => {
  const row = await media.add({ storage_path: `originals/shared/${sha}.png`, mime_type: "image/png", width: 1, height: 1, bytes: 1, sha256: sha, title: sha });
  bucket.put(row.storage_path);
  bucket.put(`renditions/${row.id}/thumb-aaaa.webp`);
  bucket.put(`renditions/${row.id}/event_card-bbbb.webp`);
  if (deletedDaysAgo !== null) {
    await media.remove(row.id);
    const stored = data.mediaAssets.find((a) => a.id === row.id)!;
    stored.deleted_at = new Date(NOW - deletedDaysAgo * DAY).toISOString();
  }
  return row;
};

beforeEach(() => {
  data = new InMemoryDataset();
  media = new InMemoryMediaRepository(data);
  bucket = new FakeBucket();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("sweepMedia", () => {
  const fake = useFakeClock(() => NOW);

describe("sweepMedia: unconfirmed uploads", () => {
  it("removes uploads older than a day and leaves newer ones, other folders and sub-folders alone", async () => {
    bucket.put("uploads/old-1", new Date(NOW - STALE_UPLOAD_MS - 1000).toISOString());
    bucket.put("uploads/old-2", new Date(NOW - 5 * DAY).toISOString());
    bucket.put("uploads/fresh", new Date(NOW - 60_000).toISOString());
    bucket.put("uploads/nested/old-3", new Date(NOW - 5 * DAY).toISOString()); // a folder: not an upload slot
    bucket.put("originals/shared/keep.png", new Date(NOW - 90 * DAY).toISOString());

    expect(await sweepMedia(media, storage())).toEqual({ staleUploads: 2, assetsCleared: 0, assetsInUse: 0, failed: 0 });
    expect([...bucket.objects.keys()].sort()).toEqual(["originals/shared/keep.png", "uploads/fresh", "uploads/nested/old-3"]);
  });

  it("pages through a long list and removes in chunks", async () => {
    for (let i = 0; i < 1250; i++) bucket.put(`uploads/old-${i}`, new Date(NOW - 3 * DAY).toISOString());
    const result = await sweepMedia(media, storage());
    expect(result.staleUploads).toBe(1250);
    expect(bucket.objects.size).toBe(0);
    expect(Math.max(...bucket.removeCalls.map((c) => c.length))).toBeLessThanOrEqual(100);
  });

  it("counts a chunk it couldn't remove as failed and goes on", async () => {
    for (let i = 0; i < 150; i++) bucket.put(`uploads/old-${String(i).padStart(3, "0")}`, new Date(NOW - 3 * DAY).toISOString());
    let first = true;
    bucket.failRemoveOf = () => (first ? ((first = false), "storage down") : null);
    const result = await sweepMedia(media, storage());
    expect(result).toMatchObject({ staleUploads: 50, failed: 100 });
  });

  it("fails loudly when the uploads folder can't be listed", async () => {
    bucket.failListOf = "uploads";
    await expect(sweepMedia(media, storage())).rejects.toThrow("media uploads list failed: list failed");
  });
});

describe("sweepMedia: deleted images", () => {
  it(`removes the original and renditions of an image deleted over ${DELETED_KEEP_DAYS} days ago, keeping the row`, async () => {
    const old = await asset("old", DELETED_KEEP_DAYS + 1);
    const result = await sweepMedia(media, storage());

    expect(result).toEqual({ staleUploads: 0, assetsCleared: 1, assetsInUse: 0, failed: 0 });
    expect(bucket.objects.size).toBe(0);
    const row = await media.byId(old.id);
    expect(row).toMatchObject({ title: "old" });
    expect(row?.files_removed_at).not.toBeNull();
  });

  it("leaves a recently deleted image and a live one alone", async () => {
    await asset("recent", DELETED_KEEP_DAYS - 1);
    await asset("live", null);
    expect((await sweepMedia(media, storage())).assetsCleared).toBe(0);
    expect(bucket.objects.size).toBe(6);
  });

  it("doesn't look at an image again once its files are gone", async () => {
    await asset("old", 90);
    await sweepMedia(media, storage());
    bucket.removeCalls = [];
    expect(await sweepMedia(media, storage())).toEqual({ staleUploads: 0, assetsCleared: 0, assetsInUse: 0, failed: 0 });
    expect(bucket.removeCalls).toEqual([]);
  });

  it("skips an image something still shows, and says so", async () => {
    const used = await asset("used", 90);
    data.events.push({ id: "evt_AAAAAAAAAAA1", slug: "e", title: "Retreat", image_id: used.id });
    const result = await sweepMedia(media, storage());
    expect(result).toMatchObject({ assetsCleared: 0, assetsInUse: 1 });
    expect(bucket.objects.size).toBe(3);
    expect((await media.byId(used.id))?.files_removed_at).toBeNull();
  });

  it("leaves an image unmarked when its files couldn't be removed, so the next run tries again", async () => {
    const old = await asset("old", 90);
    bucket.failRemoveOf = () => "storage down";
    expect(await sweepMedia(media, storage())).toMatchObject({ assetsCleared: 0, failed: 1 });
    expect((await media.byId(old.id))?.files_removed_at).toBeNull();

    bucket.failRemoveOf = null;
    expect(await sweepMedia(media, storage())).toMatchObject({ assetsCleared: 1, failed: 0 });
    expect(bucket.objects.size).toBe(0);
  });

  it("reports an image whose renditions couldn't be listed as failed, without touching its original", async () => {
    const old = await asset("old", 90);
    bucket.failListOf = `renditions/${old.id}`;
    expect(await sweepMedia(media, storage())).toMatchObject({ assetsCleared: 0, failed: 1 });
    expect(bucket.objects.has(old.storage_path)).toBe(true);
  });

  it("stops starting new images once its time is up, leaving the rest for the next night", async () => {
    const first = await asset("a-first", 90);
    const second = await asset("b-second", 80);
    bucket.onRemove = () => fake.clock.advance(5 * 60 * 1000); // the first takes the whole budget
    expect(await sweepMedia(media, storage())).toMatchObject({ assetsCleared: 1 });
    expect((await media.byId(first.id))?.files_removed_at).not.toBeNull();
    expect((await media.byId(second.id))?.files_removed_at).toBeNull();

    bucket.onRemove = null;
    expect(await sweepMedia(media, storage())).toMatchObject({ assetsCleared: 1 });
  });
});
});
