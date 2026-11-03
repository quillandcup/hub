import { describe, expect, it } from "vitest";
import { MAX_SCALE, MIN_SCALE, clampScale, fitView, zoomAt } from "@/lib/pan-zoom";

describe("fitView", () => {
  it("shrinks a wide canvas to the container width and centres it vertically", () => {
    const v = fitView({ width: 400, height: 400 }, { width: 1800, height: 500 });
    expect(v.scale).toBeCloseTo(400 / 1800);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo((400 - 500 * v.scale) / 2);
  });

  it("never enlarges a canvas that already fits, and centres it", () => {
    expect(fitView({ width: 1000, height: 800 }, { width: 500, height: 400 })).toEqual({ scale: 1, x: 250, y: 200 });
  });
});

describe("zoomAt", () => {
  it("keeps the point under the cursor where it is", () => {
    const before = { scale: 1, x: 10, y: 20 };
    const after = zoomAt(before, 2, 110, 120);
    // content point under (110, 120) before: ((110 - 10) / 1, (120 - 20) / 1) = (100, 100)
    expect(after.scale).toBe(2);
    expect(after.x + 100 * after.scale).toBeCloseTo(110);
    expect(after.y + 100 * after.scale).toBeCloseTo(120);
  });

  it("stops at the zoom limits", () => {
    expect(zoomAt({ scale: 1, x: 0, y: 0 }, 100, 0, 0).scale).toBe(MAX_SCALE);
    expect(zoomAt({ scale: 1, x: 0, y: 0 }, 0.0001, 0, 0).scale).toBe(MIN_SCALE);
    expect(clampScale(1)).toBe(1);
  });
});
