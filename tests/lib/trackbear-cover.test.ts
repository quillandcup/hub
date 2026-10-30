import { describe, it, expect, vi } from "vitest";
import sharp from "sharp";
import { http, HttpResponse } from "msw";
import { server } from "../setup-msw";
import { makeTrackbearCoverCopier } from "@/lib/trackbear-cover";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryMediaRepository } from "@/lib/data/media";
import type { SupabaseClient } from "@supabase/supabase-js";

const COVER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp";
const ME = "mbr_AAAAAAAAAAA1";

function setup(uploadError: { message: string } | null = null) {
  const data = new InMemoryDataset();
  const media = new InMemoryMediaRepository(data);
  const upload = vi.fn().mockResolvedValue({ error: uploadError });
  const storage = { from: vi.fn(() => ({ upload })) } as unknown as SupabaseClient["storage"];
  return { data, media, upload, copy: makeTrackbearCoverCopier(media, storage) };
}

const cover = (width = 600, height = 900) => sharp({ create: { width, height, channels: 3, background: "#336699" } }).webp().toBuffer();
const serve = (body: Buffer | null, status = 200) => server.use(http.get(`https://trackbear.app/uploads/covers/${COVER}`, () => new HttpResponse(body, { status })));

describe("makeTrackbearCoverCopier", () => {
  it("keeps the TrackBear cover as it is, as the member's own library image named after the project", async () => {
    const original = await cover();
    serve(original);
    const { copy, media, upload, data } = setup();

    const result = await copy(COVER, ME, "My Novel");

    expect(result).toEqual({ url: expect.stringMatching(/^\/api\/media\/media_[1-9A-HJ-NP-Za-km-z]{12}\/book_cover_shelf$/), assetId: expect.stringMatching(/^media_/) });
    const asset = await media.byId((result as { assetId: string }).assetId);
    expect(asset).toMatchObject({ owner_member_id: ME, title: "My Novel", width: 600, height: 900, mime_type: "image/webp" });
    expect(data.mediaAssets).toHaveLength(1);
    const [path, bytes] = upload.mock.calls[0];
    expect(path).toMatch(new RegExp(`^originals/${ME}/[0-9a-f]{64}\\.webp$`));
    expect(Buffer.from(bytes).equals(original)).toBe(true); // not cropped, not re-encoded
  });

  it("makes importing the same file again the same library image", async () => {
    serve(await cover());
    const { copy, data } = setup();
    const first = await copy(COVER, ME, "My Novel");
    server.resetHandlers();
    serve(await cover());
    const again = await copy(COVER, ME, "My Novel");
    expect(again).toEqual(first);
    expect(data.mediaAssets).toHaveLength(1);
  });

  it("refuses filenames that aren't TrackBear's <uuid>.<ext> shape", async () => {
    const { copy, upload } = setup();
    const result = await copy("../../etc/passwd", ME);
    expect(result).toEqual({ error: expect.any(String) });
    expect(upload).not.toHaveBeenCalled();
  });

  it("reports a missing cover instead of throwing", async () => {
    serve(null, 404);
    const { copy } = setup();
    expect(await copy(COVER, ME)).toEqual({ error: expect.stringMatching(/HTTP 404/) });
  });

  it("reports a download that fails outright, and a file that is too large", async () => {
    server.use(http.get(`https://trackbear.app/uploads/covers/${COVER}`, () => HttpResponse.error()));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { copy, upload } = setup();
    expect(await copy(COVER, ME)).toEqual({ error: expect.stringMatching(/couldn't download it from TrackBear/) });
    log.mockRestore();

    server.resetHandlers();
    serve(Buffer.alloc(5 * 1024 * 1024 + 1));
    expect(await copy(COVER, ME)).toEqual({ error: expect.stringMatching(/too large/) });
    expect(upload).not.toHaveBeenCalled();
  });

  it("reports a cover the library can't use (not an image, or an SVG) without storing anything", async () => {
    const { copy, data, upload } = setup();
    serve(Buffer.from("not a picture"));
    expect(await copy(COVER, ME)).toEqual({ error: expect.stringMatching(/couldn't use the TrackBear cover.*upload it by hand/) });

    server.resetHandlers();
    serve(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>'));
    expect(await copy(COVER, ME)).toEqual({ error: expect.stringMatching(/upload it by hand/) });
    expect(data.mediaAssets).toHaveLength(0);
    expect(upload).not.toHaveBeenCalled();
  });

  it("reports an upload to storage that fails", async () => {
    serve(await cover());
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { copy, data } = setup({ message: "storage down" });
    expect(await copy(COVER, ME)).toEqual({ error: "upload to Hub failed; upload it by hand." });
    expect(data.mediaAssets).toHaveLength(0);
    log.mockRestore();
  });
});
