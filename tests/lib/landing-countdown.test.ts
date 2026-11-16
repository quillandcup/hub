import { describe, it, expect } from "vitest";
import { describeTarget, timeLeft, utcToZonedLocal, zonedLocalToUtc } from "@/lib/landing/countdown";

const NY = "America/New_York";

describe("a wall-clock time in the organization's zone", () => {
  it("becomes the right instant in winter and summer", () => {
    expect(zonedLocalToUtc("2027-01-15T09:00", NY)).toBe("2027-01-15T14:00:00.000Z");
    expect(zonedLocalToUtc("2027-07-15T09:00", NY)).toBe("2027-07-15T13:00:00.000Z");
  });

  it("is right on both sides of the daylight saving changes", () => {
    // Second Sunday of March 2027 is the 14th: 02:00 jumps to 03:00.
    expect(zonedLocalToUtc("2027-03-14T01:30", NY)).toBe("2027-03-14T06:30:00.000Z");
    expect(zonedLocalToUtc("2027-03-14T03:30", NY)).toBe("2027-03-14T07:30:00.000Z");
    // First Sunday of November 2027 is the 7th: 02:00 falls back to 01:00.
    expect(zonedLocalToUtc("2027-11-07T00:30", NY)).toBe("2027-11-07T04:30:00.000Z");
    expect(zonedLocalToUtc("2027-11-07T03:30", NY)).toBe("2027-11-07T08:30:00.000Z");
  });

  it("round-trips through the editor's field, and refuses junk", () => {
    const iso = zonedLocalToUtc("2027-05-20T18:45", NY)!;
    expect(utcToZonedLocal(iso, NY)).toBe("2027-05-20T18:45");
    expect(zonedLocalToUtc("tomorrow", NY)).toBeNull();
    expect(utcToZonedLocal("nope", NY)).toBe("");
  });

  it("is the same wherever the server runs", () => {
    expect(zonedLocalToUtc("2027-01-15T09:00", "UTC")).toBe("2027-01-15T09:00:00.000Z");
    expect(zonedLocalToUtc("2027-01-15T09:00", "Asia/Tokyo")).toBe("2027-01-15T00:00:00.000Z");
  });
});

describe("time left", () => {
  const target = "2027-01-02T00:00:00.000Z";

  it("splits into days, hours, minutes and seconds", () => {
    const now = Date.parse("2026-12-30T22:58:55.000Z");
    expect(timeLeft(target, now)).toEqual({ days: 2, hours: 1, minutes: 1, seconds: 5, expired: false });
  });

  it("stops at zero and says it has expired", () => {
    expect(timeLeft(target, Date.parse(target))).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0, expired: true });
    expect(timeLeft(target, Date.parse(target) + 60_000)?.expired).toBe(true);
    expect(timeLeft("junk", 0)).toBeNull();
  });

  it("describes the target in the organization's zone", () => {
    expect(describeTarget("2027-01-15T14:00:00.000Z", NY)).toContain("9:00");
    expect(describeTarget("2027-01-15T14:00:00.000Z", NY)).toContain("EST");
    expect(describeTarget("junk")).toBe("");
  });
});
