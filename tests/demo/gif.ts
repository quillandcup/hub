/**
 * A tiny animated GIF writer for the demo seed (no image library needed): a 4-colour palette, one frame per
 * array of palette indexes, looping forever. Uncompressed "LZW": a clear code every 2 pixels keeps every code
 * 3 bits wide, which any decoder reads as ordinary GIF data.
 */
export type Rgb = [number, number, number];

export function animatedGif(size: number, palette: [Rgb, Rgb, Rgb, Rgb], frames: Uint8Array[], delayMs: number): Buffer {
  const out: number[] = [];
  const word = (n: number) => out.push(n & 0xff, (n >> 8) & 0xff);
  out.push(...Buffer.from("GIF89a"));
  word(size);
  word(size);
  out.push(0x81, 0, 0); // global colour table of 4 entries, background 0, no aspect ratio
  for (const c of palette) out.push(...c);
  out.push(0x21, 0xff, 0x0b, ...Buffer.from("NETSCAPE2.0"), 3, 1, 0, 0, 0); // loop forever
  for (const pixels of frames) {
    if (pixels.length !== size * size) throw new Error("a frame must be size x size palette indexes");
    out.push(0x21, 0xf9, 4, 0, ...[Math.round(delayMs / 10) & 0xff, (Math.round(delayMs / 10) >> 8) & 0xff], 0, 0);
    out.push(0x2c);
    word(0);
    word(0);
    word(size);
    word(size);
    out.push(0, 2); // no local table; minimum code size 2

    const bytes: number[] = [];
    let bits = 0;
    let nbits = 0;
    const emit = (code: number) => {
      bits |= code << nbits;
      nbits += 3;
      while (nbits >= 8) {
        bytes.push(bits & 0xff);
        bits >>= 8;
        nbits -= 8;
      }
    };
    for (let i = 0; i < pixels.length; i++) {
      if (i % 2 === 0) emit(4); // clear
      emit(pixels[i]);
    }
    emit(4);
    emit(5); // end
    if (nbits > 0) bytes.push(bits & 0xff);
    for (let i = 0; i < bytes.length; i += 255) {
      const block = bytes.slice(i, i + 255);
      out.push(block.length, ...block);
    }
    out.push(0);
  }
  out.push(0x3b);
  return Buffer.from(out);
}

/** Two frames of a disc that jumps from one side to the other, so a still and a moving image are easy to tell apart. */
export function bouncingDisc(size: number): Uint8Array[] {
  return [0.3, 0.7].map((cx, frame) => {
    const pixels = new Uint8Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - cx * size;
        const dy = y - size / 2;
        pixels[y * size + x] = dx * dx + dy * dy < (size / 4) ** 2 ? (frame === 0 ? 1 : 2) : 0;
      }
    }
    return pixels;
  });
}

export const DISC_PALETTE: [Rgb, Rgb, Rgb, Rgb] = [
  [250, 245, 235],
  [122, 59, 112],
  [42, 157, 143],
  [40, 40, 40],
];
