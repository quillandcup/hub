// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import PanZoomCanvas from "@/components/PanZoomCanvas";

const transform = () => screen.getByTestId("pan-zoom-content").style.transform;
const parse = () => {
  const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\((-?[\d.]+)\)/.exec(transform())!;
  return { x: Number(m[1]), y: Number(m[2]), scale: Number(m[3]) };
};

function renderCanvas() {
  return render(
    <PanZoomCanvas width={1000} height={500}>
      <a href="/somewhere">Stage link</a>
    </PanZoomCanvas>
  );
}

describe("PanZoomCanvas", () => {
  it("opens fitted: jsdom has no layout, so the container counts as the canvas size and the scale is 1", () => {
    renderCanvas();
    expect(parse().scale).toBe(1);
  });

  it("zooms with the buttons and returns with fit", () => {
    renderCanvas();
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(parse().scale).toBeCloseTo(1.25);
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(parse().scale).toBeCloseTo(0.8);
    fireEvent.click(screen.getByRole("button", { name: "Fit to screen" }));
    expect(parse().scale).toBe(1);
  });

  it("pans when dragged, and a drag does not follow the link it ends on", () => {
    renderCanvas();
    const surface = screen.getByTestId("pan-zoom-surface");
    surface.setPointerCapture = () => {};
    const link = screen.getByRole("link", { name: "Stage link" });
    const before = parse();
    fireEvent.pointerDown(surface, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 160, clientY: 130 });
    fireEvent.pointerUp(surface, { pointerId: 1 });
    expect(parse().x).toBeCloseTo(before.x + 60);
    expect(parse().y).toBeCloseTo(before.y + 30);
    expect(fireEvent.click(link)).toBe(false); // the click after a drag is cancelled
    expect(fireEvent.click(link)).toBe(true); // the next one is a real click
  });

  it("lets a press that doesn't move click through to a link", () => {
    renderCanvas();
    const surface = screen.getByTestId("pan-zoom-surface");
    fireEvent.pointerDown(surface, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 101, clientY: 100 });
    fireEvent.pointerUp(surface, { pointerId: 1 });
    expect(fireEvent.click(screen.getByRole("link", { name: "Stage link" }))).toBe(true);
  });

  it("zooms with Ctrl-scroll but leaves plain scrolling to the page", () => {
    renderCanvas();
    const surface = screen.getByTestId("pan-zoom-surface");
    expect(fireEvent.wheel(surface, { deltaY: -100 })).toBe(true);
    expect(parse().scale).toBe(1);
    expect(fireEvent.wheel(surface, { deltaY: -100, ctrlKey: true })).toBe(false);
    expect(parse().scale).toBeGreaterThan(1);
  });

  it("zooms when two pointers pinch apart", () => {
    renderCanvas();
    const surface = screen.getByTestId("pan-zoom-surface");
    fireEvent.pointerDown(surface, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(surface, { pointerId: 2, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(surface, { pointerId: 2, clientX: 300, clientY: 100 });
    expect(parse().scale).toBeGreaterThan(1);
    fireEvent.pointerUp(surface, { pointerId: 1 });
    fireEvent.pointerUp(surface, { pointerId: 2 });
  });
});
