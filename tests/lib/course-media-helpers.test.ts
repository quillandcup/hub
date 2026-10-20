import { afterEach, describe, expect, it, vi } from "vitest";
import { fingerprintSource } from "@/lib/courses/media";
import { getAssetStatus } from "@/lib/mux";

afterEach(() => vi.unstubAllGlobals());

describe("fingerprintSource", () => {
  it("combines total size, ETag and Last-Modified from a one-byte ranged GET", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 206, headers: { "content-range": "bytes 0-0/163577856", etag: '"abc"', "last-modified": "Tue, 14 Oct 2026 12:00:00 GMT" } }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await fingerprintSource("https://kajabi.test/v?sig=1")).toBe('163577856|"abc"|Tue, 14 Oct 2026 12:00:00 GMT');
    expect(fetchMock).toHaveBeenCalledWith("https://kajabi.test/v?sig=1", { headers: { Range: "bytes=0-0" } });
  });

  it("falls back to Content-Length when the server ignores the range, and tolerates missing headers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200, headers: { "content-length": "999" } })));
    expect(await fingerprintSource("https://kajabi.test/v")).toBe("999||");
  });

  it("throws when the link is refused (expired or signed for something else)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 403 })));
    await expect(fingerprintSource("https://kajabi.test/v")).rejects.toThrow("source answered 403");
  });
});

describe("getAssetStatus", () => {
  const muxWith = (asset: Record<string, unknown>) => ({ video: { assets: { retrieve: async () => asset } } }) as never;

  it("reads a ready asset's signed playback id and length", async () => {
    const status = await getAssetStatus(
      muxWith({ status: "ready", duration: 61.5, playback_ids: [{ id: "public-pb", policy: "public" }, { id: "signed-pb", policy: "signed" }] }),
      "a1"
    );
    expect(status).toEqual({ status: "ready", durationSeconds: 61.5, playbackId: "signed-pb" });
  });

  it("reports errored, and treats anything else as still preparing", async () => {
    expect((await getAssetStatus(muxWith({ status: "errored" }), "a")).status).toBe("errored");
    expect((await getAssetStatus(muxWith({ status: "preparing" }), "a")).status).toBe("preparing");
    expect((await getAssetStatus(muxWith({ status: "something-new" }), "a")).status).toBe("preparing");
  });
});
