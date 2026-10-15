import { describe, it, expect } from "vitest";
import { isValidTimeZone } from "@/lib/time-zone";

describe("isValidTimeZone", () => {
  it("accepts IANA zones", () => {
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("Europe/Dublin")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
  });

  it("rejects 'browser', blanks and things that aren't zones", () => {
    expect(isValidTimeZone("browser")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
  });
});
