import { describe, it, expect } from "vitest";
import { ACCESS_OPTIONS, accessLabel, optionIndexFor } from "@/lib/courses/access-options";

describe("accessLabel", () => {
  it("reads ISO 8601 and Postgres interval text the same way", () => {
    for (const [stored, label] of [
      ["P1Y", "1 year"],
      ["1 year", "1 year"],
      ["P6M", "6 months"],
      ["6 mons", "6 months"],
      ["P3M", "3 months"],
      ["3 mons", "3 months"],
    ] as const) {
      expect(accessLabel(stored)).toBe(label);
    }
  });

  it("calls null lifetime, and shows an unfamiliar length as stored", () => {
    expect(accessLabel(null)).toBe("Lifetime");
    expect(accessLabel("P2Y")).toBe("P2Y");
  });
});

describe("optionIndexFor", () => {
  it("finds the option for a stored length in either format, or -1", () => {
    expect(ACCESS_OPTIONS[optionIndexFor("P6M")].value).toBe("6 months");
    expect(ACCESS_OPTIONS[optionIndexFor("6 mons")].value).toBe("6 months");
    expect(ACCESS_OPTIONS[optionIndexFor(null)].value).toBeNull();
    expect(optionIndexFor("P2Y")).toBe(-1);
  });
});
