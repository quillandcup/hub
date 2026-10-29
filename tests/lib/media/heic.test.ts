import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import sharp from "sharp";
import { heicToJpeg } from "@/lib/media/heic";
import { inspectImage } from "@/lib/media/inspect";

// A 64 x 48 solid red picture saved as HEIC (made with macOS `sips`): no photo, no metadata.
const HEIC = readFileSync(path.resolve(import.meta.dirname, "../../fixtures/media/solid-red-64x48.heic"));

describe("HEIC uploads", () => {
  it("are recognised so they can be converted, not rejected as unreadable", async () => {
    expect(await inspectImage(HEIC)).toMatchObject({ ok: false, heic: true });
  });

  it("convert to a JPEG of the same size and colour", async () => {
    const jpeg = await heicToJpeg(HEIC);
    expect(jpeg).not.toBeNull();
    const meta = await sharp(jpeg!).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 64, 48]);
    const { data } = await sharp(jpeg!).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(170); // red
    expect(data[1]).toBeLessThan(90);
    expect(await inspectImage(jpeg!)).toMatchObject({ ok: true, mime: "image/jpeg", width: 64, height: 48 });
  });

  it("answer null for bytes that aren't a HEIC picture", async () => {
    expect(await heicToJpeg(Buffer.from("not a picture"))).toBeNull();
  });
});
