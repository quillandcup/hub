import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFakeClock } from "../../helpers/fake-clock";
import { FakeStorage } from "../../helpers/fake-storage";
import { FAILURE_TTL_MS, UNFURL_IMAGE_TTL_DAYS, cachedUnfurlImage, resetUnfurlImageMemory, sweepUnfurlImages, unfurlImageKey } from "@/lib/chat/unfurl-image-cache";
import type { FetchImageResult } from "@/lib/net/safe-fetch";

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const URL1 = "https://img.example.test/a.png?token=SECRET";
const DAY = 24 * 60 * 60 * 1000;

let storage: FakeStorage;
const okFetch = () => vi.fn(async (): Promise<FetchImageResult> => ({ ok: true, bytes: png, contentType: "image/png" }));
const as = (s: FakeStorage) => s as unknown as Parameters<typeof cachedUnfurlImage>[0];

describe("unfurl image cache", () => {
const fake = useFakeClock();

beforeEach(() => {
  storage = new FakeStorage();
  resetUnfurlImageMemory();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("cachedUnfurlImage", () => {
  it("fetches once, stores under a hash of the address with the sniffed type, and serves the next viewer from the copy", async () => {
    const fetcher = okFetch();
    const first = await cachedUnfurlImage(as(storage), URL1, fetcher);
    const second = await cachedUnfurlImage(as(storage), URL1, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ ok: true, bytes: png, contentType: "image/png" });
    expect(second).toEqual(first);
    expect([...storage.objects.keys()]).toEqual([unfurlImageKey(URL1)]);
    expect(unfurlImageKey(URL1)).toMatch(/^[0-9a-f]{64}$/);
    expect(storage.objects.get(unfurlImageKey(URL1))?.type).toBe("image/png");
  });

  it("shares one fetch between concurrent requests for the same address", async () => {
    const fetcher = okFetch();
    const results = await Promise.all([1, 2, 3].map(() => cachedUnfurlImage(as(storage), URL1, fetcher)));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("does not store what failed (not an image, too large, refused) and says the same thing", async () => {
    for (const reason of ["not_image", "too_large", "blocked"] as const) {
      resetUnfurlImageMemory();
      const fetcher = vi.fn(async (): Promise<FetchImageResult> => ({ ok: false, reason, detail: "x" }));
      const result = await cachedUnfurlImage(as(storage), URL1, fetcher);
      expect(result).toMatchObject({ ok: false, reason });
    }
    expect(storage.objects.size).toBe(0);
  });

  it("remembers a failure for minutes, then asks the host again (fake clock)", async () => {
    const fetcher = vi.fn(async (): Promise<FetchImageResult> => ({ ok: false, reason: "bad_status", detail: "403" }));
    await cachedUnfurlImage(as(storage), URL1, fetcher);
    await cachedUnfurlImage(as(storage), URL1, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    fake.clock.advance(FAILURE_TTL_MS - 1);
    await cachedUnfurlImage(as(storage), URL1, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    fake.clock.advance(2);
    await cachedUnfurlImage(as(storage), URL1, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("serves a recovered host after the failure window and stores it", async () => {
    const fetcher = vi.fn<() => Promise<FetchImageResult>>().mockResolvedValueOnce({ ok: false, reason: "network", detail: "x" }).mockResolvedValue({ ok: true, bytes: png, contentType: "image/png" });
    expect((await cachedUnfurlImage(as(storage), URL1, fetcher)).ok).toBe(false);
    fake.clock.advance(FAILURE_TTL_MS + 1);
    expect((await cachedUnfurlImage(as(storage), URL1, fetcher)).ok).toBe(true);
    expect(storage.objects.size).toBe(1);
  });

  it("ignores a stored copy whose bytes or type don't check out, and fetches again", async () => {
    storage.objects.set(unfurlImageKey(URL1), { bytes: Buffer.from("<html></html>"), type: "image/png", createdAt: 0 });
    const fetcher = okFetch();
    expect(await cachedUnfurlImage(as(storage), URL1, fetcher)).toMatchObject({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    resetUnfurlImageMemory();
    storage.objects.set(unfurlImageKey(URL1), { bytes: png, type: "image/jpeg", createdAt: 0 });
    await cachedUnfurlImage(as(storage), URL1, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("still serves the picture when storing it fails", async () => {
    storage.failUpload = true;
    expect(await cachedUnfurlImage(as(storage), URL1, okFetch())).toMatchObject({ ok: true });
    expect(storage.objects.size).toBe(0);
  });

  it("falls back to the host when reading storage throws", async () => {
    const broken = { from: () => ({ download: async () => { throw new Error("down"); }, upload: async () => ({ error: null }) }) };
    expect(await cachedUnfurlImage(broken as never, URL1, okFetch())).toMatchObject({ ok: true });
  });

  it("keeps different addresses apart", async () => {
    const fetcher = okFetch();
    await cachedUnfurlImage(as(storage), URL1, fetcher);
    await cachedUnfurlImage(as(storage), "https://img.example.test/b.png", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(storage.objects.size).toBe(2);
  });

  it("forgets the oldest failures past its bound", async () => {
    const fetcher = vi.fn(async (): Promise<FetchImageResult> => ({ ok: false, reason: "network", detail: "x" }));
    for (let i = 0; i < 502; i++) await cachedUnfurlImage(as(storage), `https://img.example.test/${i}.png`, fetcher);
    fetcher.mockClear();
    await cachedUnfurlImage(as(storage), "https://img.example.test/0.png", fetcher); // evicted: asked again
    expect(fetcher).toHaveBeenCalledTimes(1);
    fake.clock.advance(FAILURE_TTL_MS + 1);
    for (let i = 502; i < 1010; i++) await cachedUnfurlImage(as(storage), `https://img.example.test/${i}.png`, fetcher); // expired ones are dropped first
  });
});

describe("sweepUnfurlImages", () => {
  it("removes copies older than the TTL and keeps fresh ones", async () => {
    const old = (name: string) => storage.objects.set(name, { bytes: png, type: "image/png", createdAt: fake.clock.now() });
    old("old1");
    old("old2");
    fake.clock.advance((UNFURL_IMAGE_TTL_DAYS + 1) * DAY);
    old("fresh");
    expect(await sweepUnfurlImages(as(storage))).toEqual({ removed: 2, failed: 0 });
    expect([...storage.objects.keys()]).toEqual(["fresh"]);
    expect(await sweepUnfurlImages(as(storage))).toEqual({ removed: 0, failed: 0 });
  });

  it("counts a failed removal and throws on a failed listing", async () => {
    storage.objects.set("old", { bytes: png, type: "image/png", createdAt: fake.clock.now() - 30 * DAY });
    const failing = { from: () => ({ ...storage.from(""), remove: async () => ({ error: { message: "nope" } }) }) };
    expect(await sweepUnfurlImages(failing as never)).toEqual({ removed: 0, failed: 1 });
    const broken = { from: () => ({ list: async () => ({ data: null, error: { message: "nope" } }) }) };
    await expect(sweepUnfurlImages(broken as never)).rejects.toThrow("list failed");
  });
});
});
