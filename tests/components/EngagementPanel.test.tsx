// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EngagementPanel from "@/app/(admin)/admin/courses/[id]/stats/EngagementPanel";
import type { HeatBucket } from "@/lib/courses/watch-stats";

const bucket = (start: number, timesWatched: number, plays: number, people: number): HeatBucket => ({ start, end: start + 25, timesWatched, plays, people });

// A 100s video in 4 slices, 4 plays. Slice 3 (0:50 to 1:15): one person watched it twice in one visit (times watched 3 > plays 2 = people 2).
const buckets: HeatBucket[] = [bucket(0, 4, 4, 4), bucket(25, 3, 3, 3), bucket(50, 3, 2, 2), bucket(75, 1, 1, 1)];
const frames = ["tok0", "tok1", "tok2", "tok3"];

// jsdom doesn't load images: stand in for Image and finish loading at once.
const loaded: string[] = [];
beforeEach(() => {
  loaded.length = 0;
  vi.stubGlobal(
    "Image",
    class {
      onload: (() => void) | null = null;
      set src(value: string) {
        loaded.push(value);
        queueMicrotask(() => this.onload?.());
      }
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

const ui = (over: Partial<React.ComponentProps<typeof EngagementPanel>> = {}) => (
  <EngagementPanel buckets={buckets} durationSeconds={100} totalPlays={4} playbackId="pb-1" frames={frames} {...over} />
);

describe("EngagementPanel", () => {
  it("says so when nobody watched", () => {
    render(ui({ buckets: [] }));
    expect(screen.getByText("Nobody has watched this video yet.")).toBeInTheDocument();
  });

  it("names the three counts in a legend, and explains how they nest", () => {
    render(ui());
    expect(screen.getByText("Times watched, rewatches included")).toBeInTheDocument();
    expect(screen.getByText("Plays (visits)")).toBeInTheDocument();
    expect(screen.getByText("People, each counted once")).toBeInTheDocument();
    expect(screen.getByText(/each stricter than the last/)).toBeInTheDocument();
    expect(screen.getByText(/2, 1, 1; coming back another day is 2, 2, 1/)).toBeInTheDocument();
  });

  it("tabulates every moment: the three counts and the share of plays", () => {
    const { container } = render(ui());
    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(4);
    expect(within(rows[2] as HTMLElement).getAllByRole("cell").map((c) => c.textContent)).toEqual(["0:50 to 1:15", "3", "2", "2", "50%"]);
    expect(within(rows[0] as HTMLElement).getAllByRole("cell").map((c) => c.textContent)).toEqual(["0:00 to 0:25", "4", "4", "4", "100%"]);
  });

  it("reads a moment with the arrow keys: its time, the three counts, the share of plays, and the frame from there", async () => {
    const { container } = render(ui());
    const chart = screen.getByRole("img", { name: /Engagement over the 1:40 video/ });
    expect(chart).toHaveAttribute("tabindex", "0");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    // The first press from nothing selected lands on the first slice.
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    await act(async () => {});
    const tooltip = screen.getByRole("status");
    expect(tooltip).toHaveTextContent("0:50 to 1:15");
    expect(tooltip).toHaveTextContent("Times watched3");
    expect(tooltip).toHaveTextContent("Plays2");
    expect(tooltip).toHaveTextContent("People2");
    expect(tooltip).toHaveTextContent("50% of plays watched this");
    expect(container.querySelector("img")).toHaveAttribute("src", expect.stringContaining("token=tok2"));

    fireEvent.keyDown(chart, { key: "End" });
    expect(screen.getByRole("status")).toHaveTextContent("25% of plays watched this");
    fireEvent.keyDown(chart, { key: "Home" });
    expect(screen.getByRole("status")).toHaveTextContent("100% of plays watched this");
    fireEvent.keyDown(chart, { key: "Escape" });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("tells one person rewinding in a visit (2, 1, 1) from the same person coming back another day (2, 2, 1)", () => {
    const rewound = [bucket(0, 2, 1, 1), bucket(25, 0, 0, 0)];
    const { unmount } = render(ui({ buckets: rewound, totalPlays: 1 }));
    fireEvent.keyDown(screen.getByRole("img"), { key: "Home" });
    const first = screen.getByRole("status");
    expect(first).toHaveTextContent("Times watched2");
    expect(first).toHaveTextContent("Plays1");
    expect(first).toHaveTextContent("People1");
    unmount();

    const returned = [bucket(0, 2, 2, 1), bucket(25, 0, 0, 0)];
    render(ui({ buckets: returned, totalPlays: 2 }));
    fireEvent.keyDown(screen.getByRole("img"), { key: "Home" });
    const second = screen.getByRole("status");
    expect(second).toHaveTextContent("Times watched2");
    expect(second).toHaveTextContent("Plays2");
    expect(second).toHaveTextContent("People1");
  });

  it("shows the frame at the start, signed for its own moment", async () => {
    const { container } = render(ui());
    await act(async () => {});
    expect(loaded[0]).toBe("https://image.mux.com/pb-1/thumbnail.webp?token=tok0");
    expect(container.querySelector("img")).toHaveAttribute("src", "https://image.mux.com/pb-1/thumbnail.webp?token=tok0");
  });

  it("can turn the frames off with the toggle, and back on", async () => {
    const user = userEvent.setup();
    const { container } = render(ui());
    await act(async () => {});
    const toggle = screen.getByRole("checkbox", { name: "Show video frames" });
    expect(toggle).toBeChecked();
    expect(container.querySelector("img")).toBeInTheDocument();

    await user.click(toggle);
    expect(container.querySelector("img")).not.toBeInTheDocument();
    // The chart is still there, on a plain panel, with the same counts.
    expect(screen.getByRole("img", { name: /Engagement over the 1:40 video: times watched, plays and people by moment\. Arrow keys/ })).toBeInTheDocument();
    expect(container.querySelectorAll("tbody tr")).toHaveLength(4);

    await user.click(toggle);
    await act(async () => {});
    expect(container.querySelector("img")).toBeInTheDocument();
  });

  it("describes the frames in the chart's name only while they are shown", async () => {
    const user = userEvent.setup();
    render(ui());
    expect(screen.getByRole("img", { name: /drawn over its frames/ })).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Show video frames" }));
    expect(screen.queryByRole("img", { name: /drawn over its frames/ })).not.toBeInTheDocument();
  });

  it("has no frames, no toggle and no note when a view turns them off", () => {
    const { container } = render(ui({ showFrames: false }));
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/Frame previews aren't available/)).not.toBeInTheDocument();
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(loaded).toEqual([]);
    // Still a full chart.
    expect(screen.getByRole("img", { name: /Engagement over the 1:40 video/ })).toBeInTheDocument();
  });

  it("says previews aren't available, still draws the chart, and offers no toggle when stills can't be signed", () => {
    const { container } = render(ui({ frames: null }));
    expect(screen.getByText("Frame previews aren't available for this video.")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container.querySelector("svg path")).toBeInTheDocument();

    const { container: noId } = render(ui({ playbackId: null }));
    expect(noId.querySelector("img")).not.toBeInTheDocument();
  });

  it("shows a part-covered slice as a fraction on all three counts, so the lines coincide where nothing was replayed", () => {
    const edge = [bucket(0, 0.5, 0.5, 0.5), bucket(25, 1, 1, 1)];
    const { container } = render(ui({ buckets: edge, totalPlays: 1 }));
    fireEvent.keyDown(screen.getByRole("img"), { key: "Home" });
    const tooltip = screen.getByRole("status");
    expect(tooltip).toHaveTextContent("Times watched0.5");
    expect(tooltip).toHaveTextContent("Plays0.5");
    expect(tooltip).toHaveTextContent("People0.5");
    expect(within(container.querySelectorAll("tbody tr")[0] as HTMLElement).getAllByRole("cell").map((c) => c.textContent)).toEqual(["0:00 to 0:25", "0.5", "0.5", "0.5", "50%"]);
  });

  it("copes with a single slice, and with no plays at all", () => {
    render(ui({ buckets: [bucket(0, 1, 1, 1)], totalPlays: 1 }));
    fireEvent.keyDown(screen.getByRole("img"), { key: "End" });
    expect(screen.getByRole("status")).toHaveTextContent("100% of plays watched this");
  });

  it("keeps the frame inside the plot, so the axes and labels around it sit on a solid background", async () => {
    const { container } = render(ui());
    await act(async () => {});
    const img = container.querySelector("img")!;
    // The frame's box is the plot: an inset rectangle that clips it, not the whole panel.
    const plotBox = img.parentElement as HTMLElement;
    expect(plotBox).toHaveClass("overflow-hidden");
    expect(plotBox.style.left).not.toBe("0%");
    expect(plotBox.style.width).not.toBe("100%");
    // The panel itself has no image or scrim of its own.
    expect(img.closest("[role=img]")!.querySelectorAll("img")).toHaveLength(1);
    expect(plotBox.querySelector(".bg-slate-950\\/60")).toBeInTheDocument();
  });

  it("labels the three lines at their right-hand ends, kept apart where they finish together", () => {
    render(ui());
    const labels = [...screen.getByRole("img").querySelectorAll("svg text")].map((t) => t.textContent).filter((t) => ["Watched", "Plays", "People"].includes(t ?? ""));
    expect(labels).toEqual(["Watched", "Plays", "People"]);
    // Equal at the end (1, 1, 1): the labels are nudged apart rather than printed on top of each other.
    const ys = [...screen.getByRole("img").querySelectorAll("svg text")]
      .filter((t) => ["Watched", "Plays", "People"].includes(t.textContent ?? ""))
      .map((t) => Number(t.getAttribute("y")));
    expect(new Set(ys).size).toBe(3);
    expect(ys[1] - ys[0]).toBeGreaterThanOrEqual(14);
    expect(ys[2] - ys[1]).toBeGreaterThanOrEqual(14);
  });

  it("keeps the labels above the axis when all three lines end at zero", () => {
    // Everything stops before the end of the video, so all three lines finish on the baseline.
    const ended = [bucket(0, 2, 2, 1), bucket(25, 0, 0, 0)];
    render(ui({ buckets: ended, totalPlays: 2, showFrames: false }));
    const svg = screen.getByRole("img").querySelector("svg")!;
    const baselineY = Number([...svg.querySelectorAll("line")].map((l) => Number(l.getAttribute("y1"))).sort((a, b) => b - a)[0]);
    const ys = [...svg.querySelectorAll("text")].filter((t) => ["Watched", "Plays", "People"].includes(t.textContent ?? "")).map((t) => Number(t.getAttribute("y")));
    expect(ys).toHaveLength(3);
    // The lowest label is level with, not far below, the axis line.
    expect(Math.max(...ys)).toBeLessThanOrEqual(baselineY + 5);
  });
});
