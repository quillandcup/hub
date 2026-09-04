import { describe, it, expect } from "vitest";
import { computeAllHiatusTouchpoints } from "@/lib/hiatus-touchpoints";

const START = "2024-01-01T00:00:00Z";
const startMs = new Date(START).getTime();
const DAY_MS = 24 * 60 * 60 * 1000;
// A 100-day hiatus makes the 25/50/75% marks land on day 25/50/75 exactly.
const END = new Date(startMs + 100 * DAY_MS).toISOString();

function daysAfterStart(days: number): Date {
  return new Date(startMs + days * DAY_MS);
}

describe("computeAllHiatusTouchpoints", () => {
  it("returns all three marks regardless of asOf", () => {
    const result = computeAllHiatusTouchpoints(START, END);
    expect(result).toEqual([
      { pct: 25, date: daysAfterStart(25).toISOString() },
      { pct: 50, date: daysAfterStart(50).toISOString() },
      { pct: 75, date: daysAfterStart(75).toISOString() },
    ]);
  });

  it("returns an empty list for an indefinite hiatus", () => {
    expect(computeAllHiatusTouchpoints(START, null)).toEqual([]);
  });

  it("returns an empty list for an invalid window", () => {
    expect(computeAllHiatusTouchpoints(START, START)).toEqual([]);
  });
});
