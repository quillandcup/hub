import { describe, it, expect } from "vitest";
import { chooseFit, isPresetName, PRESETS, tooSmallFor } from "@/lib/media/presets";

describe("media presets", () => {
  it("knows its presets by name and nothing else", () => {
    expect(isPresetName("event_card")).toBe(true);
    expect(isPresetName("toString")).toBe(false);
    expect(isPresetName("nope")).toBe(false);
  });

  it("crops a picture of the same shape and otherwise uses the asset's choice or the preset's default", () => {
    const cover = PRESETS.book_cover_shelf;
    expect(chooseFit({ width: 1450, height: 2150 }, cover)).toBe("crop"); // same shape
    expect(chooseFit({ width: 1000, height: 1000 }, cover)).toBe("extend"); // the preset's default for covers
    expect(chooseFit({ width: 1000, height: 1000 }, cover, "white")).toBe("white");
    expect(chooseFit({ width: 1000, height: 1000 }, cover, "bogus")).toBe("extend");
    expect(chooseFit({ width: 1000, height: 1000 }, PRESETS.event_card)).toBe("crop");
  });

  it("refuses a source below a preset's minimum, and says so", () => {
    const kdp = PRESETS.book_cover_kdp_ebook;
    expect(tooSmallFor({ width: 1600, height: 2560 }, kdp)).toBeNull();
    expect(tooSmallFor({ width: 500, height: 800 }, kdp)).toMatch(/500 x 800 px; at least 625 x 1000/);
    expect(tooSmallFor({ width: 10, height: 10 }, PRESETS.thumb)).toBeNull();
  });
});
