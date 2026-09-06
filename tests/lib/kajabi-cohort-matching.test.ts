import { describe, it, expect } from "vitest";
import { resolveMatchDate, isDateWithinCohortWindow } from "@/lib/kajabi-cohort-matching";

describe("resolveMatchDate", () => {
  it("prefers created_at_kajabi when present", () => {
    expect(
      resolveMatchDate({ created_at_kajabi: "2026-06-18T00:00:00Z", effective_start_at: "2025-01-01T00:00:00Z" })
    ).toBe("2026-06-18T00:00:00Z");
  });

  it("falls back to effective_start_at only when created_at_kajabi is null", () => {
    expect(resolveMatchDate({ created_at_kajabi: null, effective_start_at: "2025-01-01T00:00:00Z" })).toBe(
      "2025-01-01T00:00:00Z"
    );
  });

  it("returns null when neither date is present", () => {
    expect(resolveMatchDate({ created_at_kajabi: null, effective_start_at: null })).toBeNull();
    expect(resolveMatchDate({ created_at_kajabi: null })).toBeNull();
  });
});

describe("isDateWithinCohortWindow", () => {
  const cohort = { starts_at: "2026-06-14", expires_at: "2026-12-14" };

  it("is true for a date on starts_at", () => {
    expect(isDateWithinCohortWindow("2026-06-14T00:00:00Z", cohort)).toBe(true);
  });

  it("is true for a date on expires_at (inclusive)", () => {
    expect(isDateWithinCohortWindow("2026-12-14T23:59:59Z", cohort)).toBe(true);
  });

  it("is false for a date before starts_at", () => {
    expect(isDateWithinCohortWindow("2026-06-13T23:59:59Z", cohort)).toBe(false);
  });

  it("is false for a date the day after expires_at", () => {
    expect(isDateWithinCohortWindow("2026-12-15T00:00:00Z", cohort)).toBe(false);
  });
});

describe("resolveMatchDate + isDateWithinCohortWindow together (regression)", () => {
  // Reproduces the real bug: a repeat/alumna purchase whose real transaction
  // (created_at_kajabi) falls in the later cohort's window, but whose
  // effective_start_at is stale, reflecting original access from a much
  // earlier, unrelated cohort. Matching on either field independently (a
  // union of two ranges) incorrectly pulled this purchase into the earlier
  // cohort. Coalescing to created_at_kajabi first must NOT match the earlier
  // cohort here.
  const earlierCohort = { starts_at: "2025-09-08", expires_at: "2026-03-13" };
  const laterCohort = { starts_at: "2026-06-14", expires_at: "2026-12-14" };
  const purchase = {
    created_at_kajabi: "2026-06-18T14:00:00Z", // real transaction — in laterCohort's window
    effective_start_at: "2025-10-01T00:00:00Z", // stale, unrelated access date — in earlierCohort's window
  };

  it("does not match the earlier cohort whose window only contains the stale effective_start_at", () => {
    const matchDate = resolveMatchDate(purchase);
    expect(matchDate).toBe(purchase.created_at_kajabi);
    expect(isDateWithinCohortWindow(matchDate!, earlierCohort)).toBe(false);
  });

  it("matches the later cohort whose window contains the real transaction date", () => {
    const matchDate = resolveMatchDate(purchase);
    expect(isDateWithinCohortWindow(matchDate!, laterCohort)).toBe(true);
  });
});
