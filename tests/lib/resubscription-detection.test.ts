import { describe, it, expect } from "vitest";
import { detectResubscriptions, formatGapLabel, gapLabelsByStintStart } from "@/lib/resubscription-detection";
import type { PurchaseRecord } from "@/lib/resubscription-detection";

function purchase(
  id: string,
  startAt: string,
  deactivatedAt?: string
): PurchaseRecord {
  return {
    kajabi_purchase_id: id,
    effective_start_at: startAt,
    created_at_kajabi: null,
    deactivated_at: deactivatedAt ?? null,
  };
}

describe("detectResubscriptions", () => {
  it("returns empty for a single active purchase", () => {
    const result = detectResubscriptions([purchase("p1", "2024-01-01")]);
    expect(result).toHaveLength(0);
  });

  it("returns empty for a single cancelled purchase", () => {
    const result = detectResubscriptions([
      purchase("p1", "2024-01-01", "2024-06-01"),
    ]);
    expect(result).toHaveLength(0);
  });

  it("detects one resubscription", () => {
    const result = detectResubscriptions([
      purchase("p1", "2024-01-01", "2024-06-01"),
      purchase("p2", "2024-09-01"),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].cancelledAt).toBe("2024-06-01");
    expect(result[0].resubscribedAt).toBe("2024-09-01");
    expect(result[0].gapDays).toBe(92);
  });

  it("detects two resubscriptions", () => {
    const result = detectResubscriptions([
      purchase("p1", "2024-01-01", "2024-03-01"),
      purchase("p2", "2024-06-01", "2024-08-01"),
      purchase("p3", "2024-11-01"),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].resubscribedAt).toBe("2024-06-01");
    expect(result[1].resubscribedAt).toBe("2024-11-01");
  });

  it("handles purchases given in unsorted order", () => {
    const result = detectResubscriptions([
      purchase("p2", "2024-09-01"),
      purchase("p1", "2024-01-01", "2024-06-01"),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].resubscribedAt).toBe("2024-09-01");
  });

  it("falls back to created_at_kajabi when effective_start_at is null", () => {
    const p1: PurchaseRecord = {
      kajabi_purchase_id: "p1",
      effective_start_at: null,
      created_at_kajabi: "2024-01-01",
      deactivated_at: "2024-06-01",
    };
    const p2: PurchaseRecord = {
      kajabi_purchase_id: "p2",
      effective_start_at: null,
      created_at_kajabi: "2024-09-01",
      deactivated_at: null,
    };
    const result = detectResubscriptions([p1, p2]);
    expect(result).toHaveLength(1);
    expect(result[0].resubscribedAt).toBe("2024-09-01");
  });

  it("does not count a new purchase that starts before the cancellation", () => {
    // Edge case: overlapping or same-day purchases
    const result = detectResubscriptions([
      purchase("p1", "2024-01-01", "2024-06-01"),
      purchase("p2", "2024-05-01"), // starts before cancellation — not a resub
    ]);
    expect(result).toHaveLength(0);
  });

  it("uses the latest cancellation date when multiple purchases were cancelled", () => {
    // p1 cancelled June 1, p2 cancelled August 1 — the resub must be after August 1
    const result = detectResubscriptions([
      purchase("p1", "2024-01-01", "2024-06-01"),
      purchase("p2", "2024-05-01", "2024-08-01"),
      purchase("p3", "2024-10-01"),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].cancelledAt).toBe("2024-08-01");
    expect(result[0].resubscribedAt).toBe("2024-10-01");
  });

  it("skips purchases with no start date", () => {
    const noDate: PurchaseRecord = {
      kajabi_purchase_id: "p0",
      effective_start_at: null,
      created_at_kajabi: null,
      deactivated_at: null,
    };
    const result = detectResubscriptions([
      noDate,
      purchase("p1", "2024-01-01", "2024-06-01"),
      purchase("p2", "2024-09-01"),
    ]);
    expect(result).toHaveLength(1);
  });
});

describe("formatGapLabel", () => {
  it("formats sub-month gaps in days (rounds to 0 months below 15 days)", () => {
    expect(formatGapLabel(0)).toBe("0d gap");
    expect(formatGapLabel(10)).toBe("10d gap");
    expect(formatGapLabel(14)).toBe("14d gap");
  });

  it("uses singular '1 mo gap' once the gap rounds to one month", () => {
    expect(formatGapLabel(15)).toBe("1 mo gap"); // rounds up to 1
    expect(formatGapLabel(30)).toBe("1 mo gap");
    expect(formatGapLabel(44)).toBe("1 mo gap"); // rounds down to 1
  });

  it("formats multi-month gaps, rounded to the nearest month", () => {
    expect(formatGapLabel(45)).toBe("2 mo gap"); // rounds up to 2
    expect(formatGapLabel(150)).toBe("5 mo gap");
    expect(formatGapLabel(365)).toBe("12 mo gap");
  });
});

describe("gapLabelsByStintStart", () => {
  it("labels a resubscribed stint's start with the gap since the prior cancellation", () => {
    const labels = gapLabelsByStintStart([
      { created_at_kajabi: "2022-09-03T00:00:00Z", derived_end_at: "2023-03-04T00:00:00Z" },
      { created_at_kajabi: "2023-07-24T00:00:00Z", derived_end_at: "2023-12-24T00:00:00Z" },
      { created_at_kajabi: "2024-08-15T00:00:00Z", derived_end_at: "2024-12-30T00:00:00Z" },
    ]);

    expect(labels.get("2022-09-03T00:00:00Z")).toBeUndefined(); // first stint — nothing before it
    expect(labels.get("2023-07-24T00:00:00Z")).toBe("5 mo gap");
    expect(labels.get("2024-08-15T00:00:00Z")).toBe("8 mo gap");
  });

  it("does not label a stint when it immediately follows the prior one with no gap", () => {
    const labels = gapLabelsByStintStart([
      { created_at_kajabi: "2024-01-01T00:00:00Z", derived_end_at: "2024-06-01T00:00:00Z" },
      { created_at_kajabi: "2024-06-01T00:00:00Z", derived_end_at: null },
    ]);

    expect(labels.size).toBe(0);
  });

  it("returns an empty map for a single stint", () => {
    const labels = gapLabelsByStintStart([
      { created_at_kajabi: "2024-01-01T00:00:00Z", derived_end_at: null },
    ]);
    expect(labels.size).toBe(0);
  });

  it("accepts stints in any order, keyed by ISO start regardless of input order", () => {
    const labels = gapLabelsByStintStart([
      { created_at_kajabi: "2024-09-01T00:00:00Z", derived_end_at: null },
      { created_at_kajabi: "2024-01-01T00:00:00Z", derived_end_at: "2024-06-01T00:00:00Z" },
    ]);
    expect(labels.get("2024-09-01T00:00:00Z")).toBe("3 mo gap");
  });
});
