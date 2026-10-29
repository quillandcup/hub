import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { renderPreset, renditionPath, settingsFor } from "@/lib/media/render";
import { pixel, solidImage, splitImage } from "@/tests/helpers/media-fixtures";

const asset = (over: Partial<Parameters<typeof settingsFor>[0]> = {}) => ({ id: "img_AAAAAAAAAAAA", width: 400, height: 200, focal_x: null, focal_y: null, fits: {}, ...over });
const size = async (body: Buffer) => {
  const m = await sharp(body).metadata();
  return [m.width, m.height, m.format];
};

describe("renderPreset", () => {
  it("makes a preset's exact size and format whatever shape the original is", async () => {
    const wide = await solidImage(400, 200);
    for (const fit of ["crop", "extend", "white"] as const) {
      const { body, contentType } = await renderPreset(wide, "book_cover_shelf", { fit, focal: null });
      expect(await size(body)).toEqual([290, 430, "webp"]);
      expect(contentType).toBe("image/webp");
    }
    const kdp = await renderPreset(wide, "book_cover_kdp_ebook", { fit: "extend", focal: null });
    expect(await size(kdp.body)).toEqual([1600, 2560, "jpeg"]);
    expect(kdp.contentType).toBe("image/jpeg");
  });

  it("white keeps the whole picture on white; extend continues its edges; crop cuts to the frame", async () => {
    const wide = await solidImage(400, 200, "png", { r: 255, g: 0, b: 0 });
    const white = (await renderPreset(wide, "book_cover_kdp_ebook", { fit: "white", focal: null })).body;
    expect((await pixel(white, 800, 10)).every((c) => c > 250)).toBe(true); // padding at the top
    const middle = await pixel(white, 800, 1280);
    expect(middle[0]).toBeGreaterThan(200);
    expect(middle[1]).toBeLessThan(60);
    const extended = (await renderPreset(wide, "book_cover_kdp_ebook", { fit: "extend", focal: null })).body;
    const top = await pixel(extended, 800, 10);
    expect(top[0]).toBeGreaterThan(200); // red continues up, not white
    expect(top[1]).toBeLessThan(60);
  });

  it("crops around the focal point", async () => {
    const split = await splitImage(400, 200); // left red, right blue
    const left = (await renderPreset(split, "thumb", { fit: "crop", focal: { x: 0, y: 0.5 } })).body;
    const right = (await renderPreset(split, "thumb", { fit: "crop", focal: { x: 1, y: 0.5 } })).body;
    expect(await size(left)).toEqual([320, 320, "webp"]);
    expect((await pixel(left, 160, 160))[0]).toBeGreaterThan(200); // red
    expect((await pixel(right, 160, 160))[2]).toBeGreaterThan(200); // blue
  });

  it("applies EXIF orientation and drops metadata such as GPS", async () => {
    const tagged = await sharp(await solidImage(300, 100, "jpeg")).withExif({ IFD0: { Copyright: "x" }, IFD3: { GPSLatitudeRef: "N" } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const { body } = await renderPreset(tagged, "thumb", { fit: "white", focal: null });
    const meta = await sharp(body).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
  });
});

describe("renditionPath", () => {
  it("changes with the focal point, the fit and the preset, and is stable otherwise", () => {
    const base = renditionPath(asset(), "event_card");
    expect(base).toMatch(/^renditions\/img_AAAAAAAAAAAA\/event_card-[0-9a-f]{12}\.webp$/);
    expect(renditionPath(asset(), "event_card")).toBe(base);
    expect(renditionPath(asset({ focal_x: 0.2, focal_y: 0.2 }), "event_card")).not.toBe(base);
    expect(renditionPath(asset({ width: 400, height: 400, fits: { book_cover_shelf: "white" } }), "book_cover_shelf")).not.toBe(renditionPath(asset({ width: 400, height: 400 }), "book_cover_shelf"));
    expect(renditionPath(asset(), "book_cover_kdp_ebook")).toMatch(/\.jpg$/);
  });

  it("reads the asset's focal point and per-preset fit", () => {
    expect(settingsFor(asset({ focal_x: 0.3, focal_y: 0.6 }), "thumb")).toEqual({ fit: "crop", focal: { x: 0.3, y: 0.6 } });
    expect(settingsFor(asset({ fits: { book_cover_shelf: "white" } }), "book_cover_shelf").fit).toBe("white");
  });
});
