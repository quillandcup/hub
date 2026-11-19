import { describe, expect, it } from "vitest";
import {
  clampSpace,
  clampSpan,
  columnsLabel,
  normalizePadding,
  PADDING_DEFAULT_DESKTOP,
  PADDING_DEFAULT_MOBILE,
  presetOf,
  presetPadding,
  sectionPadding,
  SPACE_MAX,
  spanOf,
} from "@/lib/landing/layout";
import { hideClass, sectionVars, spanClasses } from "@/components/landing/theme";

describe("clampSpace", () => {
  it("keeps whole px between 0 and the maximum, rounding and clamping", () => {
    expect(clampSpace(24, 0)).toBe(24);
    expect(clampSpace(12.6, 0)).toBe(13);
    expect(clampSpace(-5, 7)).toBe(0);
    expect(clampSpace(100000, 7)).toBe(SPACE_MAX);
    expect(clampSpace("40", 7)).toBe(40);
  });

  it("takes the fallback for anything that is not a number", () => {
    for (const bad of [undefined, null, "", "  ", "abc", NaN, Infinity, {}, []]) expect(clampSpace(bad, 9), String(bad)).toBe(9);
  });
});

describe("normalizePadding and sectionPadding", () => {
  it("fills a missing or invalid side from the fallback and clamps the rest", () => {
    expect(normalizePadding({ top: 10, bottom: "x", left: -1, right: 999 }, PADDING_DEFAULT_DESKTOP)).toEqual({ top: 10, bottom: 48, left: 0, right: SPACE_MAX });
    expect(normalizePadding(undefined, PADDING_DEFAULT_MOBILE)).toEqual(PADDING_DEFAULT_MOBILE);
    expect(normalizePadding([1, 2, 3, 4], PADDING_DEFAULT_MOBILE)).toEqual(PADDING_DEFAULT_MOBILE);
  });

  it("gives each size its own defaults when a Section has none stored", () => {
    expect(sectionPadding({})).toEqual({ desktop: PADDING_DEFAULT_DESKTOP, mobile: PADDING_DEFAULT_MOBILE });
    expect(sectionPadding({ paddingMobile: { top: 4 } }).mobile).toEqual({ ...PADDING_DEFAULT_MOBILE, top: 4 });
  });
});

describe("presets", () => {
  it("builds both paddings from a preset, leaving left and right at the defaults", () => {
    const large = presetPadding("large");
    expect(large.paddingDesktop).toEqual({ ...PADDING_DEFAULT_DESKTOP, top: 80, bottom: 80 });
    expect(large.paddingMobile).toEqual({ ...PADDING_DEFAULT_MOBILE, top: 48, bottom: 48 });
    expect(presetPadding("medium")).toEqual({ paddingDesktop: PADDING_DEFAULT_DESKTOP, paddingMobile: PADDING_DEFAULT_MOBILE });
  });

  it("names the preset a padding matches for a size, and none when it is custom or top and bottom differ", () => {
    expect(presetOf(PADDING_DEFAULT_DESKTOP, "desktop")).toBe("medium");
    expect(presetOf(PADDING_DEFAULT_MOBILE, "mobile")).toBe("medium");
    expect(presetOf(PADDING_DEFAULT_MOBILE, "desktop")).toBeNull();
    expect(presetOf({ ...PADDING_DEFAULT_DESKTOP, top: 49 }, "desktop")).toBeNull();
    expect(presetOf({ ...PADDING_DEFAULT_DESKTOP, top: 0, bottom: 0 }, "desktop")).toBe("none");
  });
});

describe("clampSpan and spanOf", () => {
  it("accepts a whole number of columns from 1 to 12 and nothing else", () => {
    expect(clampSpan(8)).toBe(8);
    expect(clampSpan("5")).toBe(5);
    expect(clampSpan(7.6)).toBe(8);
    for (const bad of [0, 13, -3, NaN, "", "x", null, undefined, {}]) expect(clampSpan(bad), String(bad)).toBeUndefined();
  });

  it("is the full 12 for either size when unset or invalid", () => {
    expect(spanOf(undefined, undefined)).toEqual({ desktop: 12, mobile: 12 });
    expect(spanOf(6, undefined)).toEqual({ desktop: 6, mobile: 12 });
    expect(spanOf(6, 4)).toEqual({ desktop: 6, mobile: 4 });
    expect(spanOf(99, "no")).toEqual({ desktop: 12, mobile: 12 });
  });

  it("labels a width in columns", () => {
    expect(columnsLabel(8)).toBe("8 columns");
    expect(columnsLabel(1)).toBe("1 column");
  });
});

describe("what the page gets from them", () => {
  it("writes a custom property per side and size, in px", () => {
    const vars = sectionVars({ top: 1, bottom: 2, left: 3, right: 4 }, { top: 5, bottom: 6, left: 7, right: 8 }) as Record<string, string>;
    expect(vars).toEqual({
      "--sp-t-d": "1px", "--sp-b-d": "2px", "--sp-l-d": "3px", "--sp-r-d": "4px",
      "--sp-t-m": "5px", "--sp-b-m": "6px", "--sp-l-m": "7px", "--sp-r-m": "8px",
    });
  });

  it("puts the mobile column span in the base and the desktop one behind the named container size", () => {
    expect(spanClasses(8, 4)).toBe("col-span-4 @split:col-span-8");
    expect(spanClasses(undefined, undefined)).toBe("col-span-12 @split:col-span-12");
    expect(spanClasses(6, undefined)).toBe("col-span-12 @split:col-span-6");
  });

  it("hides on one size with the mobile style as the base, on both outright, and dims instead in the editor", () => {
    expect(hideClass(false, false, false)).toBe("");
    expect(hideClass(true, false, false)).toBe("@split:hidden");
    expect(hideClass(false, true, false)).toBe("hidden @split:block");
    expect(hideClass(true, true, false)).toBe("hidden");
    expect(hideClass(true, false, true)).toBe("opacity-40");
    expect(hideClass(false, false, true)).toBe("");
  });
});
