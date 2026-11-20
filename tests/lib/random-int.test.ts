// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomInt } from "@/lib/random-int";

afterEach(() => vi.restoreAllMocks());

describe("randomInt", () => {
  it("stays in [0, max) and reaches every value", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const n = randomInt(58);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(58);
      seen.add(n);
    }
    expect(seen.size).toBe(58);
  });

  it("returns 0 for a range of one", () => {
    expect(randomInt(1)).toBe(0);
  });

  it("draws again when the sample falls in the biased tail, so values stay uniform", () => {
    // For max 58 the accepted range ends at floor(2^32 / 58) * 58; a draw at or above it must be rejected.
    const limit = Math.floor(0x100000000 / 58) * 58;
    const draws = [limit, 0xffffffff, 116];
    const spy = vi.spyOn(crypto, "getRandomValues").mockImplementation(((buffer: Uint32Array) => {
      buffer[0] = draws.shift()!;
      return buffer;
    }) as typeof crypto.getRandomValues);
    expect(randomInt(58)).toBe(116 % 58);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it.each([0, -1, 1.5, Number.NaN, 0x100000001])("refuses %s", (max) => {
    expect(() => randomInt(max)).toThrow(RangeError);
  });
});
