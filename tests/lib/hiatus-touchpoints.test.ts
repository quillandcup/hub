import { describe, it, expect } from "vitest";
import { computeHiatusTouchpoint } from "@/lib/hiatus-touchpoints";

const START = "2024-01-01T00:00:00Z";
const startMs = new Date(START).getTime();
const DAY_MS = 24 * 60 * 60 * 1000;
// A 100-day hiatus makes the 25/50/75% marks land on day 25/50/75 exactly.
const END = new Date(startMs + 100 * DAY_MS).toISOString();

function daysAfterStart(days: number): Date {
  return new Date(startMs + days * DAY_MS);
}

describe("computeHiatusTouchpoint", () => {
  it("is all-null/false for an indefinite hiatus (no expires_at)", () => {
    const result = computeHiatusTouchpoint(START, null, daysAfterStart(10));
    expect(result).toEqual({ percentElapsed: null, nextTouchpoint: null, isPastAllTouchpoints: false });
  });

  it("before the 25% mark: next touchpoint is 25%", () => {
    const result = computeHiatusTouchpoint(START, END, daysAfterStart(10));
    expect(result.percentElapsed).toBeCloseTo(10, 5);
    expect(result.nextTouchpoint).toEqual({ pct: 25, date: daysAfterStart(25).toISOString() });
    expect(result.isPastAllTouchpoints).toBe(false);
  });

  it("just past the 25% mark: next touchpoint is 50%", () => {
    const result = computeHiatusTouchpoint(START, END, daysAfterStart(26));
    expect(result.nextTouchpoint).toEqual({ pct: 50, date: daysAfterStart(50).toISOString() });
    expect(result.isPastAllTouchpoints).toBe(false);
  });

  it("just past the 50% mark: next touchpoint is 75%", () => {
    const result = computeHiatusTouchpoint(START, END, daysAfterStart(51));
    expect(result.nextTouchpoint).toEqual({ pct: 75, date: daysAfterStart(75).toISOString() });
    expect(result.isPastAllTouchpoints).toBe(false);
  });

  it("at the 75% mark: past all touchpoints, no next touchpoint left", () => {
    const result = computeHiatusTouchpoint(START, END, daysAfterStart(75));
    expect(result.percentElapsed).toBeCloseTo(75, 5);
    expect(result.nextTouchpoint).toBeNull();
    expect(result.isPastAllTouchpoints).toBe(true);
  });

  it("past the 75% mark ('returning soon'): past all touchpoints", () => {
    const result = computeHiatusTouchpoint(START, END, daysAfterStart(90));
    expect(result.isPastAllTouchpoints).toBe(true);
    expect(result.nextTouchpoint).toBeNull();
  });

  it("already past expires_at: 100% elapsed, still past all touchpoints", () => {
    const result = computeHiatusTouchpoint(START, END, daysAfterStart(150));
    expect(result.percentElapsed).toBe(100);
    expect(result.isPastAllTouchpoints).toBe(true);
    expect(result.nextTouchpoint).toBeNull();
  });

  it("treats an invalid window (expires_at <= starts_at) the same as indefinite", () => {
    const result = computeHiatusTouchpoint(START, START, daysAfterStart(1));
    expect(result).toEqual({ percentElapsed: null, nextTouchpoint: null, isPastAllTouchpoints: false });
  });
});
