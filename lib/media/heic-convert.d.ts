// heic-convert ships no types. It decodes HEIC/HEIF (libheif compiled to JavaScript) and re-encodes it.
declare module "heic-convert" {
  function convert(options: { buffer: Buffer | Uint8Array; format: "JPEG" | "PNG"; quality?: number }): Promise<ArrayBuffer>;
  export default convert;
}
