import { describe, it, expect } from "vitest";
import { buildMembershipTimeline } from "@/lib/membership-timeline";

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

describe("buildMembershipTimeline", () => {
  it("keeps a member active through a concurrent program enrollment instead of showing it as an ending", () => {
    // Nicha's case: one open-ended Kajabi membership stint, plus a 180
    // Program cohort that ran for part of it. The program ending must not
    // make the member look cancelled — the membership stint keeps covering.
    const segments = buildMembershipTimeline(
      [{ created_at_kajabi: "2023-05-06", derived_end_at: null }],
      [],
      [{ starts_at: "2026-01-01", expires_at: "2026-07-01", reason: "180 Program" }],
      []
    );

    expect(segments).toHaveLength(3);
    expect(segments.every((s) => s.state === "active")).toBe(true);
    expect(segments[0]).toMatchObject({ endDate: null, reasonTags: ["Membership"] });
    expect(fmt(segments[1].startDate)).toBe("2026-01-01");
    expect(fmt(segments[1].endDate!)).toBe("2026-07-01");
    expect(segments[1].reasonTags).toEqual(["Membership", "180 Program"]);
    expect(fmt(segments[2].startDate)).toBe("2023-05-06");
    expect(fmt(segments[2].endDate!)).toBe("2026-01-01");
    expect(segments[2].reasonTags).toEqual(["Membership"]);
  });

  it("lets a hiatus win over a membership stint it interrupts, splitting the stint around it", () => {
    const segments = buildMembershipTimeline(
      [{ created_at_kajabi: "2023-06-15", derived_end_at: "2024-01-17" }],
      [{ id: "h4", start_date: "2023-09-14", end_date: "2023-12-14", reason: "travel", notes: null }],
      [],
      []
    );

    expect(segments.map((s) => s.state)).toEqual(["active", "hiatus", "active"]);
    const [after, hiatus, before] = segments;
    expect(fmt(before.startDate)).toBe("2023-06-15");
    expect(fmt(before.endDate!)).toBe("2023-09-14");
    expect(fmt(hiatus.startDate)).toBe("2023-09-14");
    expect(fmt(hiatus.endDate!)).toBe("2023-12-14");
    expect(hiatus.hiatus).toMatchObject({ id: "h4", reason: "travel" });
    expect(fmt(after.startDate)).toBe("2023-12-14");
    expect(fmt(after.endDate!)).toBe("2024-01-17");
  });

  it("merges a hiatus that outlasts and outranges the stint it started in, swallowing the gap between stints", () => {
    // h3 starts 2 days before m2 ends, runs through the gap, and ends after
    // m1 (the next stint) has already started — the whole span must render
    // as one continuous hiatus segment, not get split at m2's/m1's boundary.
    const segments = buildMembershipTimeline(
      [
        { created_at_kajabi: "2023-06-15", derived_end_at: "2024-01-17" },
        { created_at_kajabi: "2024-07-19", derived_end_at: "2026-05-19" },
      ],
      [{ id: "h3", start_date: "2024-01-15", end_date: "2025-01-18", reason: null, notes: null }],
      [],
      []
    );

    const hiatusSegments = segments.filter((s) => s.state === "hiatus");
    expect(hiatusSegments).toHaveLength(1);
    expect(fmt(hiatusSegments[0].startDate)).toBe("2024-01-15");
    expect(fmt(hiatusSegments[0].endDate!)).toBe("2025-01-18");
  });

  it("shows an uncovered stretch between two stints as its own gap segment", () => {
    const segments = buildMembershipTimeline(
      [
        { created_at_kajabi: "2022-09-29", derived_end_at: "2023-01-29" },
        { created_at_kajabi: "2023-06-15", derived_end_at: "2024-01-17" },
      ],
      [],
      [],
      []
    );

    expect(segments.map((s) => s.state)).toEqual(["active", "gap", "active"]);
    const gap = segments[1];
    expect(fmt(gap.startDate)).toBe("2023-01-29");
    expect(fmt(gap.endDate!)).toBe("2023-06-15");
    expect(gap.reasonTags).toEqual([]);
  });

  it("lets a gift override alone (no real subscription) explain an active period", () => {
    const segments = buildMembershipTimeline(
      [],
      [],
      [],
      [{ override_type: "gift", reason: "Lifetime gift", starts_at: "2024-01-01", expires_at: null }]
    );

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ state: "active", endDate: null, reasonTags: ["Gift"] });
  });

  it("never lets a 'special' override grant active status on its own, but still annotates whatever segment it overlaps", () => {
    const segments = buildMembershipTimeline(
      [],
      [],
      [],
      [{ override_type: "special", reason: "VIP discount", starts_at: "2024-01-01", expires_at: "2024-03-01" }]
    );

    expect(segments).toHaveLength(1);
    expect(segments[0].state).toBe("gap");
    expect(segments[0].reasonTags).toEqual(["Special"]);
  });

  it("returns nothing for a member with no history at all", () => {
    expect(buildMembershipTimeline([], [], [], [])).toEqual([]);
  });

  it("reconciles a full real-world history (3 stints, 4 overlapping hiatuses) into one clean sequence", () => {
    const segments = buildMembershipTimeline(
      [
        { created_at_kajabi: "2022-09-29", derived_end_at: "2023-01-29" },
        { created_at_kajabi: "2023-06-15", derived_end_at: "2024-01-17" },
        { created_at_kajabi: "2024-07-19", derived_end_at: "2026-05-19" },
      ],
      [
        { id: "h1", start_date: "2026-05-18", end_date: "2027-05-18", reason: null, notes: null },
        { id: "h2", start_date: "2025-09-17", end_date: "2025-11-17", reason: null, notes: null },
        { id: "h3", start_date: "2024-01-15", end_date: "2025-01-18", reason: null, notes: null },
        { id: "h4", start_date: "2023-09-14", end_date: "2023-12-14", reason: "travel", notes: null },
      ],
      [],
      []
    );

    // Ascending, for readability — the function itself returns newest-first.
    const asc = [...segments].reverse();
    const shape = asc.map((s) => [s.state, fmt(s.startDate), s.endDate ? fmt(s.endDate) : null]);

    expect(shape).toEqual([
      ["active", "2022-09-29", "2023-01-29"],
      ["gap", "2023-01-29", "2023-06-15"],
      ["active", "2023-06-15", "2023-09-14"],
      ["hiatus", "2023-09-14", "2023-12-14"],
      ["active", "2023-12-14", "2024-01-15"],
      ["hiatus", "2024-01-15", "2025-01-18"], // swallows m2's tail, the gap, and m1's head
      ["active", "2025-01-18", "2025-09-17"],
      ["hiatus", "2025-09-17", "2025-11-17"],
      ["active", "2025-11-17", "2026-05-18"],
      ["hiatus", "2026-05-18", "2027-05-18"], // swallows m1's tail
    ]);
  });
});
