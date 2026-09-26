import { describe, it, expect } from "vitest";
import { computeHostPunctuality, computeHostingStats, type HostedPrickleRecord } from "@/lib/hosting-stats";

const NOW = new Date("2026-06-15T12:00:00.000Z");

function rec(
  prickleId: string,
  startTime: string,
  earliestJoinTime: string | null,
  endTime?: string
): HostedPrickleRecord {
  return { prickleId, typeName: "Progress Prickle", startTime, endTime, earliestJoinTime };
}

describe("computeHostPunctuality", () => {
  const start = "2026-06-01T10:00:00.000Z";

  it("is on_time when the host joins early or within 5 minutes", () => {
    expect(computeHostPunctuality(start, "2026-06-01T09:55:00.000Z")).toBe("on_time");
    expect(computeHostPunctuality(start, "2026-06-01T10:05:00.000Z")).toBe("on_time");
  });

  it("is late when the host joins more than 5 minutes after start", () => {
    expect(computeHostPunctuality(start, "2026-06-01T10:05:01.000Z")).toBe("late");
  });

  it("is missing when the host never joined", () => {
    expect(computeHostPunctuality(start, null)).toBe("missing");
  });
});

describe("computeHostingStats", () => {
  it("classifies on-time, late, and no-show and computes show-up and on-time rates", () => {
    const stats = computeHostingStats(
      [
        rec("a", "2026-06-01T10:00:00.000Z", "2026-06-01T09:58:00.000Z", "2026-06-01T11:00:00.000Z"),
        rec("b", "2026-06-02T10:00:00.000Z", "2026-06-02T10:02:00.000Z", "2026-06-02T11:00:00.000Z"),
        rec("c", "2026-06-03T10:00:00.000Z", "2026-06-03T10:20:00.000Z", "2026-06-03T11:00:00.000Z"),
        rec("d", "2026-06-04T10:00:00.000Z", null, "2026-06-04T11:00:00.000Z"),
      ],
      NOW
    );

    expect(stats.totalHosted).toBe(4);
    expect(stats.onTimeCount).toBe(2);
    expect(stats.lateCount).toBe(1);
    expect(stats.missingCount).toBe(1);
    // Showed up (late or not) to 3 of 4.
    expect(stats.showUpRate).toBeCloseTo(3 / 4);
    // On-time among the ones they showed up to.
    expect(stats.onTimeRate).toBeCloseTo(2 / 3);
  });

  it("classifies by the earliest of multiple join records (leave/rejoin), counting the prickle once", () => {
    // getMyHostingStats collapses a host's multiple attendance rows to the earliest join_time;
    // a host who joined on time, left, and rejoined late is on time -- and never a no-show.
    const stats = computeHostingStats(
      [rec("a", "2026-06-01T10:00:00.000Z", "2026-06-01T10:01:00.000Z", "2026-06-01T11:00:00.000Z")],
      NOW
    );
    expect(stats.totalHosted).toBe(1);
    expect(stats.onTimeCount).toBe(1);
    expect(stats.missingCount).toBe(0);
    expect(stats.showUpRate).toBe(1);
  });

  it("never counts future occurrences as hosted or as no-shows", () => {
    const stats = computeHostingStats(
      [
        rec("past", "2026-06-01T10:00:00.000Z", "2026-06-01T10:00:00.000Z", "2026-06-01T11:00:00.000Z"),
        rec("future-1", "2026-06-20T10:00:00.000Z", null, "2026-06-20T11:00:00.000Z"),
        rec("future-2", "2026-07-01T10:00:00.000Z", null),
      ],
      NOW
    );
    expect(stats.totalHosted).toBe(1);
    expect(stats.missingCount).toBe(0);
    expect(stats.showUpRate).toBe(1);
    expect(stats.mostRecentHostedAt).toBe("2026-06-01T10:00:00.000Z");
  });

  it("does not count an in-progress prickle with no host join yet as a no-show", () => {
    // Started 30 min ago, ends in 30 min; Zoom attendance for it hasn't been imported yet.
    const stats = computeHostingStats(
      [rec("live", "2026-06-15T11:30:00.000Z", null, "2026-06-15T12:30:00.000Z")],
      NOW
    );
    expect(stats.totalHosted).toBe(1);
    expect(stats.missingCount).toBe(0);
    expect(stats.showUpRate).toBeNull();
  });

  it("does classify an in-progress prickle the host has already joined", () => {
    const stats = computeHostingStats(
      [rec("live", "2026-06-15T11:30:00.000Z", "2026-06-15T11:45:00.000Z", "2026-06-15T12:30:00.000Z")],
      NOW
    );
    expect(stats.lateCount).toBe(1);
    expect(stats.showUpRate).toBe(1);
  });

  it("counts a prickle with no end time and no join as a no-show once it has started", () => {
    const stats = computeHostingStats([rec("x", "2026-06-01T10:00:00.000Z", null)], NOW);
    expect(stats.missingCount).toBe(1);
    expect(stats.showUpRate).toBe(0);
    expect(stats.onTimeRate).toBeNull();
  });

  it("returns null rates when there is no hosting history", () => {
    const stats = computeHostingStats([], NOW);
    expect(stats.totalHosted).toBe(0);
    expect(stats.showUpRate).toBeNull();
    expect(stats.onTimeRate).toBeNull();
  });
});
