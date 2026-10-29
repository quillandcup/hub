import convert from "heic-convert";

/**
 * iPhones save photos as HEIC, which browsers can't show and `sharp`'s build can't decode. An upload in
 * that format is converted to a high-quality JPEG when it is stored (the JPEG is then the "original": the
 * HEIC is not kept). libheif applies the photo's rotation, and the metadata is not carried over.
 */
export async function heicToJpeg(bytes: Buffer): Promise<Buffer | null> {
  try {
    return Buffer.from(await convert({ buffer: bytes, format: "JPEG", quality: 0.92 }));
  } catch {
    return null;
  }
}
