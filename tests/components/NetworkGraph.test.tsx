// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import NetworkGraph from "@/app/(admin)/admin/members/network/NetworkGraph";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

const nodes = [
  { id: "a", name: "Fern Quillsby", email: "fern@example.test", totalPrickles: 12 },
  { id: "b", name: "Quill Hollis", email: "quill@example.test", totalPrickles: 3 },
];
const edges = [{ source: "a", target: "b", weight: 4, normalizedWeight: 0.4 }];

/** The graph is 1200 units wide; the card shows it 600px wide, so a pixel is two units. */
const CARD_WIDTH = 600;

function renderGraph() {
  const { container } = render(<NetworkGraph nodes={nodes} edges={edges} />);
  const svg = container.querySelector("svg")!;
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: CARD_WIDTH, height: 400, right: CARD_WIDTH, bottom: 400, x: 0, y: 0, toJSON: () => ({}) });
  return { container, svg, content: () => svg.querySelector("g[transform]")!.getAttribute("transform") };
}

describe("NetworkGraph", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("scales to its card instead of staying 1200px wide", () => {
    const { svg } = renderGraph();

    expect(svg).toHaveAttribute("viewBox", "0 0 1200 800");
    expect(svg).toHaveClass("w-full", "h-auto");
  });

  it("pans by graph units, so the graph follows the pointer when it is scaled", () => {
    const { svg, content } = renderGraph();
    expect(content()).toBe("translate(0, 0) scale(1)");

    fireEvent.mouseDown(svg, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(svg, { clientX: 150, clientY: 130 });
    expect(content()).toBe("translate(100, 60) scale(1)"); // 50 and 30 pixels, two units each

    fireEvent.mouseUp(svg);
    fireEvent.mouseMove(svg, { clientX: 400, clientY: 400 });
    expect(content()).toBe("translate(100, 60) scale(1)"); // no longer panning
  });

  it("zooms toward the pointer in graph units", () => {
    const { svg, content } = renderGraph();

    fireEvent.wheel(svg, { deltaY: -1000, clientX: 300, clientY: 200 });

    expect(content()).toBe("translate(-600, -400) scale(2)"); // the point under the pointer (600, 400 units) stays put
  });

  describe("a member's connections", () => {
    const people = [
      { id: "a", name: "Fern Quillsby", email: "fern@example.test", totalPrickles: 12 },
      { id: "b", name: "Quill Hollis", email: "quill@example.test", totalPrickles: 3 },
      { id: "c", name: "Hazel Burrows", email: "hazel@example.test", totalPrickles: 0 },
      { id: "d", name: "Gale Prickleton", email: "gale@example.test", totalPrickles: 5 },
    ];
    const connected: ComponentProps<typeof NetworkGraph>["edges"] = [
      // prickles and chat, some of it private
      { source: "a", target: "b", weight: 8.5, normalizedWeight: 50, prickles: 4, chat: 4.5, chatByKind: { dm: 2, reaction: 5, thread_reply: 1 }, chatPrivate: 2 },
      // only chat: no attendance to compare
      { source: "a", target: "c", weight: 3, normalizedWeight: 0, prickles: 0, chat: 3, chatByKind: { mention: 3 }, chatPrivate: 0 },
      // only prickles
      { source: "a", target: "d", weight: 2, normalizedWeight: 40, prickles: 2, chat: 0, chatByKind: {}, chatPrivate: 0 },
    ];

    it("shows prickles together and what they talked about, with how much of it was private", () => {
      const { container } = render(<NetworkGraph nodes={people} edges={connected} />);
      // Click Fern (the first node drawn).
      fireEvent.click(container.querySelector("circle")!);

      expect(screen.getByText("Top Connections (3)")).toBeInTheDocument();
      expect(screen.getByText("Chat: 5 reactions, 2 DMs, 1 thread reply (2 private)")).toBeInTheDocument();
      expect(screen.getByText("Chat: 3 mentions")).toBeInTheDocument();
      expect(screen.getByText("4 Prickles")).toBeInTheDocument();
      expect(screen.getByText("50% of attendance overlap")).toBeInTheDocument();
    });

    it("doesn't claim an attendance overlap for people who only talk, nor a chat line for people who only attend together", () => {
      const { container } = render(<NetworkGraph nodes={people} edges={connected} />);
      fireEvent.click(container.querySelector("circle")!);

      expect(screen.queryByText("0% of attendance overlap")).not.toBeInTheDocument();
      expect(screen.getAllByText(/% of attendance overlap/)).toHaveLength(2);
      expect(screen.getAllByText(/^Chat:/)).toHaveLength(2);
    });

    it("still reads an edge from before chat was counted (weight only) as prickles", () => {
      const { container } = render(<NetworkGraph nodes={people.slice(0, 2)} edges={[{ source: "a", target: "b", weight: 4, normalizedWeight: 40 }]} />);
      fireEvent.click(container.querySelector("circle")!);

      expect(screen.getByText("4 Prickles")).toBeInTheDocument();
      expect(screen.getByText("40% of attendance overlap")).toBeInTheDocument();
      expect(screen.queryByText(/^Chat:/)).not.toBeInTheDocument();
    });
  });
});
