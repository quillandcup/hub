import { describe, it, expect } from "vitest";
import { MODEL_WIDTHS, PHONE_MODELS, TABLET_MODELS, deviceClassForWidth } from "@/app/(admin)/admin/pages/[slug]/devices";

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

  it("starts each class with the width of its existing preview button", () => {
    expect(TABLET_MODELS[0].width).toBe(820);
    expect(PHONE_MODELS.find((m) => m.width === 390)?.name).toBe("iPhone 14");
  });

  it("infers the class from a width, and nothing for desktop or an odd width", () => {
    expect(deviceClassForWidth(820)).toBe("tablet");
    expect(deviceClassForWidth(402)).toBe("phone");
    expect(deviceClassForWidth(412)).toBe("phone");
    expect(deviceClassForWidth(1280)).toBeNull();
    expect(deviceClassForWidth(500)).toBeNull();
  });

  it("lists each width once for Puck", () => {
    expect(new Set(MODEL_WIDTHS).size).toBe(MODEL_WIDTHS.length);
  });
});
