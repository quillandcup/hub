import { describe, expect, it } from "vitest";
import { mergeArrivals, wasMemberAt, type Arrival } from "@/lib/arrivals";
import { buildMembershipTimeline } from "@/lib/membership-timeline";

const at = (dateOnly: string) => Date.parse(`${dateOnly}T00:00:00Z`);

describe("wasMemberAt", () => {
  it("is true inside a membership stint, so a renewal or plan change is not an arrival", () => {
    const timeline = buildMembershipTimeline([{ created_at_kajabi: "2026-01-01T00:00:00Z", derived_end_at: null }], []);
    expect(wasMemberAt(timeline, at("2026-06-01"))).toBe(true);
  });

  it("is false after a stint ended: someone rejoining after time away is new again", () => {
    const timeline = buildMembershipTimeline(
      [{ created_at_kajabi: "2025-01-01T00:00:00Z", derived_end_at: "2025-09-01T00:00:00Z" }],
      []
    );
    expect(wasMemberAt(timeline, at("2026-06-01"))).toBe(false);
  });

  it("counts a hiatus as still being a member", () => {
    const timeline = buildMembershipTimeline(
      [{ created_at_kajabi: "2025-01-01T00:00:00Z", derived_end_at: null }],
      [{ id: "h", start_date: "2026-03-01", end_date: "2026-07-01", reason: null, notes: null }]
    );
    expect(wasMemberAt(timeline, at("2026-06-01"))).toBe(true);
  });

  it("counts a program that includes membership, and nothing when there is no history", () => {
    const withProgram = buildMembershipTimeline([], [], [{ starts_at: "2026-05-01", expires_at: "2026-08-01", reason: "180 Program" }]);
    expect(wasMemberAt(withProgram, at("2026-06-01"))).toBe(true);
    expect(wasMemberAt([], at("2026-06-01"))).toBe(false);
  });
});

const arrival = (overrides: Partial<Arrival>): Arrival => ({
  memberId: "m1",
  memberName: "Ada",
  arrivedOn: "2026-06-01",
  kind: "direct",
  trialEndsOn: null,
  programName: null,
  ...overrides,
});

describe("mergeArrivals", () => {
  it("keeps one arrival per member, the earliest", () => {
    const merged = mergeArrivals([arrival({ arrivedOn: "2026-06-05" }), arrival({ arrivedOn: "2026-06-01" })]);
    expect(merged).toHaveLength(1);
    expect(merged[0].arrivedOn).toBe("2026-06-01");
  });

  it("prefers the membership subscription over a program starting the same day", () => {
    const merged = mergeArrivals([
      arrival({ kind: "program", programName: "Ready Writers" }),
      arrival({ kind: "trial", trialEndsOn: "2026-06-08" }),
    ]);
    expect(merged[0]).toMatchObject({ kind: "trial", trialEndsOn: "2026-06-08" });
  });

  it("lists the longest-waiting first", () => {
    const merged = mergeArrivals([
      arrival({ memberId: "b", memberName: "Bea", arrivedOn: "2026-06-03" }),
      arrival({ memberId: "a", memberName: "Ada", arrivedOn: "2026-06-01" }),
    ]);
    expect(merged.map((a) => a.memberName)).toEqual(["Ada", "Bea"]);
  });
});
