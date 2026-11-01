import { describe, it, expect } from "vitest";
import { MAX_CUSTOM_SIDE, parseCustomSize } from "@/lib/media/custom";

const parse = (query: string) => parseCustomSize(new URLSearchParams(query));

describe("parseCustomSize", () => {
  it("reads a size, defaulting to a JPEG that crops", () => {
    expect(parse("width=1600&height=2560")).toEqual({ ok: true, spec: { width: 1600, height: 2560, format: "jpeg", quality: 92 }, fit: "crop" });
    expect(parse("width=300&height=200&format=png&fit=white")).toMatchObject({ ok: true, spec: { format: "png" }, fit: "white" });
  });

  it("refuses a missing, fractional, zero or oversized size and unknown options", () => {
    for (const query of ["", "width=100", "height=100", "width=1.5&height=10", "width=0&height=10", "width=-1&height=10", "width=abc&height=10", "width=123456&height=10"]) {
      expect(parse(query).ok, query).toBe(false);
    }
    expect(parse(`width=${MAX_CUSTOM_SIDE + 1}&height=10`).ok).toBe(false);
    expect(parse("width=7000&height=7000").ok).toBe(false); // too many pixels
    expect(parse("width=10&height=10&format=bmp")).toEqual({ ok: false, error: "format must be jpeg, webp or png" });
    expect(parse("width=10&height=10&fit=stretch")).toEqual({ ok: false, error: "fit must be crop, extend or white" });
  });
});
