import { describe, it, expect } from "vitest";
import { MODEL_SIZES, PHONE_MODELS, TABLET_MODELS, deviceClassForSize, isLandscape, modelForSize, modelSize } from "@/app/(admin)/admin/pages/[slug]/devices";

describe("editor device models", () => {
  const all = [...TABLET_MODELS, ...PHONE_MODELS];

  it("gives every model a unique name", () => {
    expect(new Set(all.map((m) => m.name)).size).toBe(all.length);
  });

  it("keeps widths sane for each class", () => {
    for (const m of TABLET_MODELS) expect(m.width).toBeGreaterThanOrEqual(600);
    for (const m of TABLET_MODELS) expect(m.width).toBeLessThanOrEqual(1100);
    for (const m of PHONE_MODELS) expect(m.width).toBeGreaterThanOrEqual(320);
    for (const m of PHONE_MODELS) expect(m.width).toBeLessThan(600);
    for (const m of all) expect(Number.isInteger(m.width)).toBe(true);
  });

  it("gives every model an integer portrait height taller than its width, in a sane range", () => {
    for (const m of all) {
      expect(Number.isInteger(m.height)).toBe(true);
      expect(m.height).toBeGreaterThan(m.width);
      expect(m.height / m.width).toBeGreaterThan(1.3);
      expect(m.height / m.width).toBeLessThan(2.3);
    }
    for (const m of PHONE_MODELS) expect(m.height).toBeGreaterThanOrEqual(640);
    for (const m of PHONE_MODELS) expect(m.height).toBeLessThanOrEqual(1000);
    for (const m of TABLET_MODELS) expect(m.height).toBeGreaterThanOrEqual(1100);
    for (const m of TABLET_MODELS) expect(m.height).toBeLessThanOrEqual(1400);
  });

  it("starts each class with the model its preview button shows", () => {
    expect(TABLET_MODELS[0]).toMatchObject({ name: "iPad", width: 820, height: 1180 });
    expect(PHONE_MODELS[0]).toMatchObject({ name: "iPhone 17", width: 402, height: 874 });
  });

  it("swaps width and height for landscape", () => {
    expect(modelSize(TABLET_MODELS[0])).toEqual({ width: 820, height: 1180 });
    expect(modelSize(TABLET_MODELS[0], true)).toEqual({ width: 1180, height: 820 });
    expect(isLandscape(1180, 820)).toBe(true);
    expect(isLandscape(820, 1180)).toBe(false);
    expect(isLandscape(1280, "auto")).toBe(false);
  });

  it("infers the class from a size in either orientation, and nothing for desktop or an odd size", () => {
    expect(deviceClassForSize(820, 1180)).toBe("tablet");
    expect(deviceClassForSize(1180, 820)).toBe("tablet");
    expect(deviceClassForSize(402, 874)).toBe("phone");
    expect(deviceClassForSize(874, 402)).toBe("phone");
    expect(deviceClassForSize(412, 923)).toBe("phone");
    expect(deviceClassForSize(820, "auto")).toBe("tablet");
    expect(deviceClassForSize(1280, "auto")).toBeNull();
    expect(deviceClassForSize(500, 900)).toBeNull();
    expect(deviceClassForSize(820, 900)).toBeNull();
  });

  it("finds the first model with a size, so two models of one size share it", () => {
    expect(modelForSize("tablet", 820, 1180)?.name).toBe("iPad");
    expect(modelForSize("tablet", 1376, 1032)?.name).toBe("iPad Pro 13-inch");
    expect(modelForSize("phone", 390, 844)?.name).toBe("iPhone 14");
    expect(modelForSize("phone", 820, 1180)).toBeUndefined();
  });

  it("lists each size once for Puck", () => {
    expect(new Set(MODEL_SIZES.map((s) => `${s.width}x${s.height}`)).size).toBe(MODEL_SIZES.length);
  });
});
