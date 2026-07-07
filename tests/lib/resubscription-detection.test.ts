import { describe, it, expect } from "vitest";
import { detectResubscriptions } from "@/lib/resubscription-detection";
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
