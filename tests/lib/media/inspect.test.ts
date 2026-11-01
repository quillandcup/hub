import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { inspectImage, MAX_ORIGINAL_BYTES } from "@/lib/media/inspect";
import { solidImage } from "@/tests/helpers/media-fixtures";

describe("inspectImage", () => {
  it("reads the type from the bytes and hashes them", async () => {
    const png = await solidImage(40, 30, "png");
    expect(await inspectImage(png)).toMatchObject({ ok: true, mime: "image/png", extension: "png", width: 40, height: 30 });
    const same = await inspectImage(Buffer.from(png));
    const other = await inspectImage(await solidImage(40, 30, "png", { r: 1, g: 2, b: 3 }));
    expect(same.ok && other.ok && same.sha256 === other.sha256).toBe(false);
    for (const [format, mime] of [["jpeg", "image/jpeg"], ["webp", "image/webp"], ["gif", "image/gif"]] as const) {
      expect(await inspectImage(await solidImage(8, 8, format))).toMatchObject({ ok: true, mime });
    }
  });

  it("swaps width and height for a picture the EXIF orientation turns", async () => {
    const turned = await sharp(await solidImage(300, 100, "jpeg")).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    expect(await inspectImage(turned)).toMatchObject({ ok: true, width: 100, height: 300 });
  });

  it("refuses what isn't a usable image, with a reason", async () => {
    expect(await inspectImage(Buffer.alloc(0))).toEqual({ ok: false, error: "That file is empty" });
    expect(await inspectImage(Buffer.from("not an image"))).toMatchObject({ ok: false, error: expect.stringContaining("doesn't look like an image") });
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
    expect(await inspectImage(svg)).toMatchObject({ ok: false, error: expect.stringContaining("Use a JPEG") });
    expect(await inspectImage(Buffer.alloc(MAX_ORIGINAL_BYTES + 1))).toMatchObject({ ok: false, error: expect.stringContaining("larger than 25 MB") });
  });
});
