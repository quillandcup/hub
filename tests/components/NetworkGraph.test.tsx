// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
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
});
