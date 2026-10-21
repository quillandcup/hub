// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import EngagementChart from "@/app/(admin)/admin/courses/[id]/stats/EngagementChart";
import EngagementSparkline from "@/app/(admin)/admin/courses/[id]/stats/EngagementSparkline";
import type { HeatBucket } from "@/lib/courses/watch-stats";

// A 100s video in 4 buckets: everyone watches the start, two people rewatch the third quarter.
const buckets: HeatBucket[] = [
  { start: 0, end: 25, plays: 4, viewers: 4, sessions: 4 },
  { start: 25, end: 50, plays: 3, viewers: 3, sessions: 3 },
  { start: 50, end: 75, plays: 5, viewers: 3, sessions: 3 },
  { start: 75, end: 100, plays: 1, viewers: 1, sessions: 1 },
];

describe("EngagementChart", () => {
  it("says so when nobody watched", () => {
    render(<EngagementChart buckets={[]} durationSeconds={100} />);
    expect(screen.getByText("Nobody has watched this video yet.")).toBeInTheDocument();
  });

  it("has a legend, direct labels, a time axis and a table of every moment", () => {
    const { container } = render(<EngagementChart buckets={buckets} durationSeconds={100} />);
    expect(screen.getByText("Times watched, rewatches included")).toBeInTheDocument();
    expect(screen.getByText("People, each counted once")).toBeInTheDocument();
    const chart = screen.getByRole("img", { name: /Engagement over the 1:40 video/ });
    expect(within(chart as unknown as HTMLElement).getByText("1:40")).toBeInTheDocument();
    expect(container.querySelectorAll("tbody tr")).toHaveLength(4);
    // The table gives the rewatching directly: plays minus people.
    expect(within(container.querySelectorAll("tbody tr")[2] as HTMLElement).getAllByRole("cell").map((c) => c.textContent)).toEqual(["0:50 to 1:15", "5", "3", "2"]);
  });

  it("reads a moment with the arrow keys, including what was rewatched, and clears on Escape", () => {
    render(<EngagementChart buckets={buckets} durationSeconds={100} />);
    const chart = screen.getByRole("img");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    fireEvent.keyDown(chart, { key: "ArrowRight" });
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    const tooltip = screen.getByRole("status");
    expect(tooltip).toHaveTextContent("0:50 to 1:15");
    expect(tooltip).toHaveTextContent("Times watched5");
    expect(tooltip).toHaveTextContent("People3");
    expect(tooltip).toHaveTextContent("Rewatched: 2");

    fireEvent.keyDown(chart, { key: "Home" });
    expect(screen.getByRole("status")).toHaveTextContent("0:00 to 0:25");
    // Nothing was rewatched there, so no rewatch line.
    expect(screen.getByRole("status")).not.toHaveTextContent("Rewatched:");

    fireEvent.keyDown(chart, { key: "End" });
    expect(screen.getByRole("status")).toHaveTextContent("1:15 to 1:40");
    fireEvent.keyDown(chart, { key: "Escape" });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("labels the dashed line as people counted once, so one person watching a part twice reads as 2 times watched and 1 person", () => {
    // One member watched the first quarter twice: 2 plays, 1 person.
    const twice: HeatBucket[] = [{ start: 0, end: 50, plays: 2, viewers: 1, sessions: 2 }, { start: 50, end: 100, plays: 0, viewers: 0, sessions: 0 }];
    render(<EngagementChart buckets={twice} durationSeconds={100} />);
    fireEvent.keyDown(screen.getByRole("img"), { key: "Home" });
    const tooltip = screen.getByRole("status");
    expect(tooltip).toHaveTextContent("Times watched2");
    expect(tooltip).toHaveTextContent("People1");
    expect(tooltip).toHaveTextContent("Rewatched: 1");
    expect(screen.queryByText(/different viewers/i)).not.toBeInTheDocument();
    // The graph counts passes over a moment, never "plays": that word is the stats tiles' (one per visit).
    expect(screen.queryByText("Plays")).not.toBeInTheDocument();
    expect(screen.getByText("Times watched, rewatches included")).toBeInTheDocument();
  });

  it("shows a part-covered slice as a fraction of a person too, so the people line sits under the times-watched line at a stretch's edge", () => {
    const edge: HeatBucket[] = [{ start: 0, end: 4, plays: 0.5, viewers: 0.5, sessions: 0.5 }, { start: 4, end: 8, plays: 1, viewers: 1, sessions: 1 }];
    const { container } = render(<EngagementChart buckets={edge} durationSeconds={8} />);
    fireEvent.keyDown(screen.getByRole("img"), { key: "Home" });
    const tooltip = screen.getByRole("status");
    expect(tooltip).toHaveTextContent("Times watched0.5");
    expect(tooltip).toHaveTextContent("People0.5");
    // Nothing was rewatched, so no phantom rewatch line.
    expect(tooltip).not.toHaveTextContent("Rewatched:");
    expect(within(container.querySelectorAll("tbody tr")[0] as HTMLElement).getAllByRole("cell").map((c) => c.textContent)).toEqual(["0:00 to 0:04", "0.5", "0.5", "0"]);
  });

  it("is focusable so the keyboard works without a pointer", () => {
    render(<EngagementChart buckets={buckets} durationSeconds={100} />);
    expect(screen.getByRole("img")).toHaveAttribute("tabindex", "0");
  });
});

describe("EngagementSparkline", () => {
  it("draws the plays, or says there were no views", () => {
    const { rerender } = render(<EngagementSparkline buckets={buckets} label="Engagement over the 1:40 video" />);
    expect(screen.getByRole("img", { name: "Engagement over the 1:40 video" })).toBeInTheDocument();
    rerender(<EngagementSparkline buckets={[]} label="x" />);
    expect(screen.getByText("No views")).toBeInTheDocument();
  });
});
