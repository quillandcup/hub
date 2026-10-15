import { describe, it, expect } from "vitest";
import { daysSinceJoined, isNewcomer, NEWCOMER_WINDOW_DAYS } from "@/lib/newcomer";

const NOW = new Date("2026-10-13T15:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

describe("isNewcomer", () => {
  it("is true within the 90-day window and false outside it", () => {
    expect(isNewcomer(daysAgo(0).toISOString(), NOW)).toBe(true);
    expect(isNewcomer(daysAgo(NEWCOMER_WINDOW_DAYS).toISOString(), NOW)).toBe(true);
    expect(isNewcomer(daysAgo(NEWCOMER_WINDOW_DAYS + 1).toISOString(), NOW)).toBe(false);
  });

  it("takes a date-only first_joined_at", () => {
    expect(isNewcomer("2026-10-01", NOW)).toBe(true);
    expect(isNewcomer("2022-03-01", NOW)).toBe(false);
  });

  it("is false without a usable join date", () => {
    expect(isNewcomer(null, NOW)).toBe(false);
    expect(isNewcomer(undefined, NOW)).toBe(false);
    expect(isNewcomer("not a date", NOW)).toBe(false);
  });

  it("uses the current time by default", () => {
    expect(isNewcomer(new Date().toISOString())).toBe(true);
  });
});

describe("daysSinceJoined", () => {
  it("counts whole days since joining", () => {
    expect(daysSinceJoined(daysAgo(3).toISOString(), NOW)).toBe(3);
    expect(daysSinceJoined(daysAgo(0).toISOString(), NOW)).toBe(0);
  });

  it("never goes negative for a join date in the future", () => {
    expect(daysSinceJoined(new Date(NOW.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString(), NOW)).toBe(0);
  });

  it("is null without a usable join date", () => {
    expect(daysSinceJoined(null, NOW)).toBeNull();
    expect(daysSinceJoined("nope", NOW)).toBeNull();
  });
});
