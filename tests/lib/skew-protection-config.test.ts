import { describe, expect, it } from "vitest";
import { readSkewMaxAgeSeconds, skewMaxAgeSeconds } from "@/scripts/skew-protection-config";
import { isNearSkewDeadline, WARN_BEFORE_MS } from "@/lib/skew-deadline";

const DAY = 24 * 60 * 60;

describe("skewMaxAgeSeconds", () => {
  it("reads the number of seconds", () => {
    expect(skewMaxAgeSeconds({ skewProtection: { maxAgeSeconds: 7 * DAY } })).toBe(7 * DAY);
  });

  it.each([
    ["missing", {}],
    ["null file", null],
    ["a string", { skewProtection: { maxAgeSeconds: "604800" } }],
    ["a fraction", { skewProtection: { maxAgeSeconds: 3600.5 } }],
    ["under an hour", { skewProtection: { maxAgeSeconds: 3599 } }],
    ["over 30 days (Vercel's production retention)", { skewProtection: { maxAgeSeconds: 30 * DAY + 1 } }],
  ])("refuses %s", (_name, raw) => {
    expect(() => skewMaxAgeSeconds(raw)).toThrow(/skewProtection\.maxAgeSeconds/);
  });

  it("accepts both ends of the range", () => {
    expect(skewMaxAgeSeconds({ skewProtection: { maxAgeSeconds: 3600 } })).toBe(3600);
    expect(skewMaxAgeSeconds({ skewProtection: { maxAgeSeconds: 30 * DAY } })).toBe(30 * DAY);
  });

  it("is valid in the committed vercel-project-config.yml, which next.config.ts and the Vercel push both read", () => {
    const seconds = readSkewMaxAgeSeconds();
    expect(seconds).toBeGreaterThan(WARN_BEFORE_MS / 1000);
  });
});

describe("isNearSkewDeadline", () => {
  const built = "2026-11-01T12:00:00.000Z";
  const deadline = Date.parse(built) + 7 * DAY * 1000;

  it("is true from the warning window before the deadline on, and false before", () => {
    expect(isNearSkewDeadline(deadline - WARN_BEFORE_MS - 1, built, String(7 * DAY))).toBe(false);
    expect(isNearSkewDeadline(deadline - WARN_BEFORE_MS, built, String(7 * DAY))).toBe(true);
    expect(isNearSkewDeadline(deadline + 1, built, String(7 * DAY))).toBe(true);
  });

  it("never warns without a usable build time or maximum age", () => {
    for (const [time, age] of [[undefined, String(7 * DAY)], ["", String(7 * DAY)], ["not a date", String(7 * DAY)], [built, undefined], [built, "x"], [built, "0"]] as const) {
      expect(isNearSkewDeadline(deadline + 365 * DAY * 1000, time, age)).toBe(false);
    }
  });
});
