// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import HostingStats from "@/app/(member)/hosting/HostingStats";
import { computeHostingStats } from "@/lib/hosting-stats";

describe("HostingStats", () => {
  it("shows a top-level show-up rate next to the on-time rate", () => {
    const stats = computeHostingStats(
      [
        { prickleId: "a", typeName: "P", startTime: "2026-06-01T10:00:00Z", earliestJoinTime: "2026-06-01T10:00:00Z" },
        { prickleId: "b", typeName: "P", startTime: "2026-06-02T10:00:00Z", earliestJoinTime: "2026-06-02T10:30:00Z" },
        { prickleId: "c", typeName: "P", startTime: "2026-06-03T10:00:00Z", earliestJoinTime: null },
        { prickleId: "d", typeName: "P", startTime: "2026-06-04T10:00:00Z", earliestJoinTime: "2026-06-04T10:00:00Z" },
      ],
      new Date("2026-06-15T00:00:00Z")
    );
    render(<HostingStats stats={stats} />);

    expect(screen.getByText("show-up rate").previousElementSibling).toHaveTextContent("75%");
    expect(screen.getByText("on-time rate").previousElementSibling).toHaveTextContent("67%");
  });

  it("shows a dash when nothing can be judged yet", () => {
    const stats = computeHostingStats(
      [
        {
          prickleId: "live",
          typeName: "P",
          startTime: "2026-06-15T11:30:00Z",
          endTime: "2026-06-15T12:30:00Z",
          earliestJoinTime: null,
        },
      ],
      new Date("2026-06-15T12:00:00Z")
    );
    render(<HostingStats stats={stats} />);

    expect(screen.getByText("show-up rate").previousElementSibling).toHaveTextContent("—");
  });
});
