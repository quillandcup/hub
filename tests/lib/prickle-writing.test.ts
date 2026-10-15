import { describe, it, expect } from "vitest";
import {
  defaultPrickleId,
  formatPrickleLabel,
  localDateOf,
  sortPrickleOptions,
  type PrickleOption,
} from "@/lib/prickle-writing";

function option(id: string, startTime: string, attended: boolean): PrickleOption {
  return { id, label: id, startTime, attended };
}

describe("localDateOf", () => {
  it("uses the given timezone, not UTC", () => {
    // 8pm Pacific on Oct 1 is already Oct 2 in UTC.
    expect(localDateOf("2026-10-02T03:00:00Z", "America/Los_Angeles")).toBe("2026-10-01");
    expect(localDateOf("2026-10-02T03:00:00Z", "UTC")).toBe("2026-10-02");
  });
});

describe("formatPrickleLabel", () => {
  it("shows the local day, time, type and host first name", () => {
    expect(
      formatPrickleLabel(
        { startTime: "2026-10-02T03:00:00Z", typeName: "Night Owls", hostName: "Jo March" },
        "America/Los_Angeles"
      )
    ).toBe("Thu, Oct 1 · 8:00 PM · Night Owls with Jo");
  });

  it("falls back to 'Prickle' and omits a missing host", () => {
    expect(formatPrickleLabel({ startTime: "2026-10-01T15:00:00Z", typeName: null, hostName: null }, "UTC")).toBe(
      "Thu, Oct 1 · 3:00 PM · Prickle"
    );
  });
});

describe("sortPrickleOptions", () => {
  it("puts attended prickles first, then orders by start time", () => {
    const sorted = sortPrickleOptions([
      option("late", "2026-10-01T20:00:00Z", false),
      option("attended-late", "2026-10-01T18:00:00Z", true),
      option("early", "2026-10-01T09:00:00Z", false),
      option("attended-early", "2026-10-01T10:00:00Z", true),
    ]);
    expect(sorted.map((o) => o.id)).toEqual(["attended-early", "attended-late", "early", "late"]);
  });
});

describe("defaultPrickleId", () => {
  it("picks the only attended prickle", () => {
    expect(defaultPrickleId([option("a", "x", false), option("b", "y", true)])).toBe("b");
  });

  it("doesn't guess when none or several were attended", () => {
    expect(defaultPrickleId([option("a", "x", false)])).toBeNull();
    expect(defaultPrickleId([option("a", "x", true), option("b", "y", true)])).toBeNull();
    expect(defaultPrickleId([])).toBeNull();
  });
});
