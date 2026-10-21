// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import TimeSeriesChart from "@/app/(admin)/admin/courses/[id]/stats/TimeSeriesChart";
import type { SeriesPoint } from "@/lib/courses/watch-timeseries";

const point = (start: string, label: string, over: Partial<SeriesPoint> = {}): SeriesPoint => ({
  start,
  label,
  value: 0,
  plays: 0,
  views: 0,
  uniquePlays: 0,
  uniqueViewers: 0,
  hoursWatched: 0,
  ...over,
});

const points = [
  point("2026-10-05", "Oct 5", { value: 1, plays: 1, views: 2, uniqueViewers: 2, hoursWatched: 0.08 }),
  point("2026-10-06", "Oct 6", { value: 3, plays: 3, views: 4, uniqueViewers: 2, hoursWatched: 0.5 }),
  point("2026-10-07", "Oct 7"),
];

describe("TimeSeriesChart", () => {
  it("says so when there is nothing in the range", () => {
    render(<TimeSeriesChart points={[]} unit="count" metricLabel="Total plays" granularityLabel="day" />);
    expect(screen.getByText("Nothing in this range.")).toBeInTheDocument();
  });

  it("describes itself, labels the first and last point, and tabulates every value", () => {
    const { container } = render(<TimeSeriesChart points={points} unit="count" metricLabel="Total plays" granularityLabel="day" />);
    const chart = screen.getByRole("img", { name: /Total plays by day, Oct 5 to Oct 7/ });
    expect(within(chart as unknown as HTMLElement).getByText("Oct 5")).toBeInTheDocument();
    expect(within(chart as unknown as HTMLElement).getByText("Oct 7")).toBeInTheDocument();
    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(3);
    expect(within(rows[1] as HTMLElement).getAllByRole("cell").map((c) => c.textContent)).toEqual(["Oct 6", "3", "3", "4", "2"]);
  });

  it("reads a point with the arrow keys: its value and the counts behind it, and clears on Escape", () => {
    render(<TimeSeriesChart points={points} unit="count" metricLabel="Total plays" granularityLabel="day" />);
    const chart = screen.getByRole("img");
    expect(chart).toHaveAttribute("tabindex", "0");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    fireEvent.keyDown(chart, { key: "ArrowRight" });
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    const tooltip = screen.getByRole("status");
    expect(tooltip).toHaveTextContent("Oct 6");
    expect(tooltip).toHaveTextContent("Total plays3");
    expect(tooltip).toHaveTextContent("3 plays in 4 visits");
    expect(tooltip).toHaveTextContent("2 viewers, 0.5 h watched");

    fireEvent.keyDown(chart, { key: "End" });
    expect(screen.getByRole("status")).toHaveTextContent("Oct 7");
    fireEvent.keyDown(chart, { key: "Home" });
    expect(screen.getByRole("status")).toHaveTextContent("Oct 5");
    fireEvent.keyDown(chart, { key: "Escape" });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("formats percent and hour values on the axis, in the tooltip and in the table", () => {
    const percent = [point("2026-10-05", "Oct 5", { value: 0.5, plays: 1, views: 2 }), point("2026-10-06", "Oct 6", { value: 0.25 })];
    const { container, rerender } = render(<TimeSeriesChart points={percent} unit="percent" metricLabel="Play rate" granularityLabel="day" />);
    fireEvent.keyDown(screen.getByRole("img"), { key: "Home" });
    expect(screen.getByRole("status")).toHaveTextContent("Play rate50%");
    expect(container.querySelector("tbody tr td:nth-child(2)")).toHaveTextContent("50%");

    rerender(<TimeSeriesChart points={[point("2026-10-05", "Oct 5", { value: 1.5 })]} unit="hours" metricLabel="Hours watched" granularityLabel="day" />);
    fireEvent.keyDown(screen.getByRole("img"), { key: "Home" });
    expect(screen.getByRole("status")).toHaveTextContent("Hours watched1.5 h");
  });

  it("keeps a count chart's gridlines on whole numbers", () => {
    const quiet = [point("2026-10-05", "Oct 5", { value: 5 }), point("2026-10-06", "Oct 6", { value: 2 })];
    render(<TimeSeriesChart points={quiet} unit="count" metricLabel="Total plays" granularityLabel="day" />);
    const ticks = [...screen.getByRole("img").querySelectorAll("text")].map((t) => t.textContent).filter((t) => /^\d+$/.test(t ?? ""));
    // 0 and 5: the middle (2.5) is left out rather than shown as 3.
    expect(ticks).toEqual(["0", "5"]);
  });

  it("names weeks and months in the readout and the table", () => {
    const { container, rerender } = render(<TimeSeriesChart points={points} unit="count" metricLabel="Total plays" granularityLabel="week" />);
    fireEvent.keyDown(screen.getByRole("img"), { key: "Home" });
    expect(screen.getByRole("status")).toHaveTextContent("Week of Oct 5");
    expect(container.querySelector("thead th")).toHaveTextContent("Week of");

    rerender(<TimeSeriesChart points={points} unit="count" metricLabel="Total plays" granularityLabel="month" />);
    expect(container.querySelector("thead th")).toHaveTextContent("Month");
  });

  it("copes with a single point", () => {
    render(<TimeSeriesChart points={[points[1]]} unit="count" metricLabel="Total plays" granularityLabel="day" />);
    fireEvent.keyDown(screen.getByRole("img"), { key: "End" });
    expect(screen.getByRole("status")).toHaveTextContent("Oct 6");
  });

  it("labels about six points of a long range and always ends on the last", () => {
    const many = Array.from({ length: 30 }, (_, i) => point(`2026-09-${String(i + 1).padStart(2, "0")}`, `Sep ${i + 1}`, { value: i }));
    render(<TimeSeriesChart points={many} unit="count" metricLabel="Total plays" granularityLabel="day" />);
    const labels = [...screen.getByRole("img").querySelectorAll("text")].map((t) => t.textContent).filter((t) => t?.startsWith("Sep"));
    expect(labels.length).toBeGreaterThanOrEqual(5);
    expect(labels.length).toBeLessThanOrEqual(8);
    expect(labels[0]).toBe("Sep 1");
    expect(labels[labels.length - 1]).toBe("Sep 30");
  });
});
