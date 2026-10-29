import sharp from "sharp";

/** A solid-colour image in the given format, for tests that need real bytes. */
export function solidImage(width: number, height: number, format: "png" | "jpeg" | "webp" | "gif" = "png", rgb = { r: 200, g: 40, b: 40 }): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: rgb } }).toFormat(format).toBuffer();
}

/** Left half red, right half blue: lets a test see which part a crop kept. */
export async function splitImage(width: number, height: number): Promise<Buffer> {
  const right = await solidImage(width - Math.floor(width / 2), height, "png", { r: 0, g: 0, b: 255 });
  return sharp({ create: { width, height, channels: 3, background: { r: 255, g: 0, b: 0 } } })
    .composite([{ input: right, left: Math.floor(width / 2), top: 0 }])
    .png()
    .toBuffer();
}

/** The colour of one pixel of an image. */
export async function pixel(image: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
}
