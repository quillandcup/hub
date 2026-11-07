import { describe, expect, it } from "vitest";
import { formatPlace } from "@/lib/session-place";

describe("formatPlace", () => {
  it.each([
    ["Heredia", "CR", "Heredia, Costa Rica"],
    [null, "CR", "Costa Rica"],
    ["Heredia", null, "Heredia"],
    ["  ", "US", "United States"],
    [null, null, null],
    [undefined, undefined, null],
    ["Nowhere", "??", "Nowhere, ??"],
  ])("%s / %s -> %s", (city, country, expected) => {
    expect(formatPlace(city, country)).toBe(expected);
  });
});
