// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import EngagementFrame from "@/app/(admin)/admin/courses/[id]/stats/EngagementFrame";
import type { HeatBucket } from "@/lib/courses/watch-stats";

// A 100s video in 4 slices, 4 plays: everyone watched the start, a quarter watched the end.
const buckets: HeatBucket[] = [
  { start: 0, end: 25, plays: 4, viewers: 4, sessions: 4 },
  { start: 25, end: 50, plays: 3, viewers: 3, sessions: 3 },
  { start: 50, end: 75, plays: 2, viewers: 2, sessions: 2 },
  { start: 75, end: 100, plays: 1, viewers: 1, sessions: 1 },
];
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

const ui = (over: Partial<React.ComponentProps<typeof EngagementFrame>> = {}) => (
  <EngagementFrame buckets={buckets} durationSeconds={100} plays={4} playbackId="pb-1" frames={frames} {...over} />
);

describe("EngagementFrame", () => {
  it("shows the frame at the start, signed for its own moment", async () => {
    const { container } = render(ui());
    await act(async () => {});

    expect(loaded[0]).toBe("https://image.mux.com/pb-1/thumbnail.webp?token=tok0");
    expect(container.querySelector("img")).toHaveAttribute("src", "https://image.mux.com/pb-1/thumbnail.webp?token=tok0");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("reads a moment with the arrow keys: its time, its share of plays, and the frame from there", async () => {
    const { container } = render(ui());
    const frame = screen.getByRole("img", { name: /Engagement over the 1:40 video/ });

    // The first press from nothing selected lands on the first slice.
    fireEvent.keyDown(frame, { key: "ArrowRight" });
    fireEvent.keyDown(frame, { key: "ArrowRight" });
    fireEvent.keyDown(frame, { key: "ArrowRight" });
    await act(async () => {});
    // The third slice (0:50 to 1:15): 2 of 4 plays watched it, and its middle moment is 1:03.
    expect(screen.getByRole("status")).toHaveTextContent("1:03");
    expect(screen.getByRole("status")).toHaveTextContent("50% engagement");
    expect(container.querySelector("img")).toHaveAttribute("src", expect.stringContaining("token=tok2"));

    fireEvent.keyDown(frame, { key: "End" });
    expect(screen.getByRole("status")).toHaveTextContent("25% engagement");
    fireEvent.keyDown(frame, { key: "Home" });
    expect(screen.getByRole("status")).toHaveTextContent("100% engagement");
    fireEvent.keyDown(frame, { key: "Escape" });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("is focusable, and says what the shading means", () => {
    render(ui());
    expect(screen.getByRole("img", { name: /Engagement over/ })).toHaveAttribute("tabindex", "0");
    expect(screen.getByText(/more of the 4 plays watched that moment/)).toBeInTheDocument();
  });

  it("still draws the overlay without frames, and says previews are unavailable", () => {
    const { container } = render(ui({ frames: null }));
    expect(screen.getByText("Frame previews aren't available for this video.")).toBeInTheDocument();
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container.querySelector("svg path")).toBeInTheDocument();
  });

  it("uses a singular for one play, and renders nothing with no slices", () => {
    const { container, rerender } = render(ui({ plays: 1 }));
    expect(screen.getByText(/more of the 1 play watched that moment/)).toBeInTheDocument();
    rerender(ui({ buckets: [] }));
    expect(container).toBeEmptyDOMElement();
  });
});
