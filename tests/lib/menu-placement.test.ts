import { describe, expect, it } from "vitest";
import { placeMenu } from "@/lib/menu-placement";

const phone = { width: 390, height: 800 };
const panel = { width: 224, height: 200 };
const box = (left: number, width = 40, top = 100) => ({ left, right: left + width, top, bottom: top + 40 });

describe("placeMenu", () => {
  it("right-aligns to the trigger when there is room on its left", () => {
    const p = placeMenu(box(300), panel, phone);
    expect(p.left + 224).toBe(340); // panel's right edge = trigger's right edge
    expect(p.top).toBe(144);
    expect(p.above).toBe(false);
  });

  it("left-aligns when a trigger near the left edge has no room to its left", () => {
    const p = placeMenu(box(16), panel, phone);
    expect(p.left).toBe(16);
    expect(p.left + 224).toBeLessThanOrEqual(390 - 8);
  });

  it("clamps inside the viewport when neither alignment fits", () => {
    const p = placeMenu(box(150), { width: 300, height: 100 }, { width: 330, height: 800 });
    expect(p.left).toBeGreaterThanOrEqual(8);
    expect(p.left + 300).toBeLessThanOrEqual(330 - 8);
  });

  it("never lets the panel exceed the viewport width", () => {
    expect(placeMenu(box(0), { width: 500, height: 50 }, { width: 320, height: 800 }).maxWidth).toBe(304);
  });

  it("opens upward only when below clips and above has room", () => {
    const up = placeMenu(box(100, 40, 700), panel, phone);
    expect(up.above).toBe(true);
    expect(up.top + 200).toBeLessThanOrEqual(700);
    expect(placeMenu(box(100, 40, 100), panel, phone).above).toBe(false);
    expect(placeMenu(box(100, 40, 50), { width: 224, height: 900 }, phone).above).toBe(false);
  });
});
