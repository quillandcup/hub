// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Tooltip, { placeTip } from "@/components/Tooltip";
import fs from "node:fs";
import path from "node:path";

/**
 * jsdom has no layout and no touch: what a real browser does with the media query, the pointer type of a tap and the
 * placement against the window was checked in Chromium (hover, focus, Escape, touch emulation, narrow card, dark and
 * light). Here: the wiring, the timing, the events, and the placement arithmetic.
 */

function hoverCapable(hover: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({ matches: hover && query === "(hover: hover)", media: query, addEventListener() {}, removeEventListener() {} })) as never;
}

function focusVisible(visible: boolean) {
  const real = Element.prototype.matches;
  return vi.spyOn(Element.prototype, "matches").mockImplementation(function (this: Element, selector: string) {
    return selector === ":focus-visible" ? visible : real.call(this, selector);
  });
}

// jsdom has no PointerEvent: a MouseEvent that carries the pointer type, so the touch paths can be driven.
class FakePointerEvent extends MouseEvent {
  pointerType: string;
  constructor(type: string, init: MouseEventInit & { pointerType?: string } = {}) {
    super(type, init);
    this.pointerType = init.pointerType ?? "mouse";
  }
}

beforeEach(() => {
  (window as unknown as { PointerEvent: unknown }).PointerEvent = FakePointerEvent;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  hoverCapable(true);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const button = () => screen.getByRole("button", { name: "Pin" });
const hover = (el: Element, pointerType = "mouse") => fireEvent.pointerEnter(el, { pointerType });
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe("Tooltip", () => {
  it("renders nothing until it is shown, and adds no element around the control", () => {
    const { container } = render(
      <Tooltip content="Pin to my dashboard">
        <button aria-label="Pin">p</button>
      </Tooltip>,
    );
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(container.firstElementChild).toBe(button());
    expect(button()).not.toHaveAttribute("aria-describedby");
  });

  it("shows after a short delay on hover, linked to the control with aria-describedby", () => {
    render(
      <Tooltip content="Pin to my dashboard">
        <button aria-label="Pin">p</button>
      </Tooltip>,
    );
    hover(button());
    expect(screen.queryByRole("tooltip")).toBeNull(); // no flash when the pointer only passes by
    wait(400);
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("Pin to my dashboard");
    expect(button().getAttribute("aria-describedby")).toBe(tip.id);
    expect(tip.parentElement).toBe(document.body); // drawn on <body>: no card or modal can clip it
  });

  it("does not show if the pointer leaves before the delay", () => {
    render(
      <Tooltip content="Hint">
        <button aria-label="Pin">p</button>
      </Tooltip>,
    );
    hover(button());
    wait(200);
    fireEvent.pointerLeave(button());
    wait(1000);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("never shows for a touch pointer, and not on a device without hover", () => {
    render(
      <Tooltip content="Hint">
        <button aria-label="Pin">p</button>
      </Tooltip>,
    );
    hover(button(), "touch");
    wait(1000);
    expect(screen.queryByRole("tooltip")).toBeNull();
    hoverCapable(false);
    hover(button(), "mouse");
    wait(1000);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows at once on keyboard focus (focus-visible), not on a click or tap focus", () => {
    render(
      <Tooltip content="Hint">
        <button aria-label="Pin">p</button>
      </Tooltip>,
    );
    const spy = focusVisible(false);
    fireEvent.focus(button());
    expect(screen.queryByRole("tooltip")).toBeNull();
    spy.mockRestore();
    focusVisible(true);
    fireEvent.focus(button());
    expect(screen.getByRole("tooltip")).toHaveTextContent("Hint");
    fireEvent.blur(button());
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("hides on Escape", () => {
    focusVisible(true);
    render(
      <Tooltip content="Hint">
        <button aria-label="Pin">p</button>
      </Tooltip>,
    );
    fireEvent.focus(button());
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(button()).not.toHaveAttribute("aria-describedby");
  });

  it("stays up while the pointer is over the tip itself, and goes when it leaves", () => {
    render(
      <Tooltip content="Hint">
        <button aria-label="Pin">p</button>
      </Tooltip>,
    );
    hover(button());
    wait(400);
    fireEvent.pointerLeave(button());
    fireEvent.pointerEnter(screen.getByRole("tooltip")); // the pointer crossed the gap onto the tip
    wait(1000);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.pointerLeave(screen.getByRole("tooltip"));
    wait(200);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("a press on the control dismisses it", () => {
    render(
      <Tooltip content="Hint">
        <button aria-label="Pin">p</button>
      </Tooltip>,
    );
    hover(button());
    wait(400);
    fireEvent.pointerDown(button());
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("keeps the control's own handlers and describedby", () => {
    const enter = vi.fn();
    const click = vi.fn();
    render(
      <Tooltip content="Hint">
        <button aria-label="Pin" aria-describedby="note" onPointerEnter={enter} onClick={click}>
          p
        </button>
      </Tooltip>,
    );
    hover(button());
    wait(400);
    fireEvent.click(button());
    expect(enter).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(button().getAttribute("aria-describedby")).toMatch(/^note /);
  });

  it("works on a disabled-looking control (the handlers are on the element, the tip is not)", () => {
    render(
      <Tooltip content="Not available yet">
        <button aria-label="Pin" aria-disabled="true">
          p
        </button>
      </Tooltip>,
    );
    hover(button());
    wait(400);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Not available yet");
  });

  it("is a no-op for empty content, so a conditional hint can be passed straight in", () => {
    render(
      <Tooltip content={undefined}>
        <button aria-label="Pin">p</button>
      </Tooltip>,
    );
    hover(button());
    wait(1000);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("is dark with readable text in light and dark mode, on the top layer, and has no hover-variant show rule", () => {
    render(
      <Tooltip content="Hint">
        <button aria-label="Pin">p</button>
      </Tooltip>,
    );
    hover(button());
    wait(400);
    const classes = screen.getByRole("tooltip").className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(["bg-slate-900", "dark:bg-slate-700", "text-white", "rounded-md", "fixed", "z-overlay-top"]));
    expect(classes.filter((c) => /^(group-)?hover:|group-focus|group-hover|^z-\[|^z-\d/.test(c))).toEqual([]);
  });

  it("does not use bare hover rules in its source: hover is decided in JS, from the (hover: hover) media query and the pointer type", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../../components/Tooltip.tsx"), "utf8");
    expect(source).not.toMatch(/group-hover|\bhover:block|\bhover:opacity/);
    expect(source).toContain('"(hover: hover)"');
    expect(source).toContain('"touch"');
    expect(source).toContain(":focus-visible");
  });

  it("goes when the control is hidden away while it is shown (a hover toolbar that closed)", () => {
    render(
      <Tooltip content="Hint">
        <button aria-label="Pin">p</button>
      </Tooltip>,
    );
    hover(button());
    wait(400);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    // jsdom has no layout: every rectangle is empty, as for a control inside a display:none toolbar
    act(() => void window.dispatchEvent(new Event("scroll")));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

describe("placeTip", () => {
  const viewport = { width: 400, height: 600 };
  const tip = { width: 200, height: 40 };

  it("centres the tip under the control", () => {
    expect(placeTip({ left: 100, right: 140, top: 100, bottom: 120 }, tip, viewport)).toEqual({ left: 20, top: 126 });
  });

  it("keeps it inside the window at the right edge (a narrow card)", () => {
    const { left } = placeTip({ left: 360, right: 392, top: 100, bottom: 120 }, tip, viewport);
    expect(left + tip.width).toBeLessThanOrEqual(viewport.width - 8);
  });

  it("keeps it inside the window at the left edge", () => {
    expect(placeTip({ left: 0, right: 20, top: 100, bottom: 120 }, tip, viewport).left).toBe(8);
  });

  it("flips above the control when there is no room below", () => {
    expect(placeTip({ left: 100, right: 140, top: 560, bottom: 580 }, tip, viewport).top).toBe(560 - 6 - 40);
  });

  it("stays below when there is no room above either", () => {
    expect(placeTip({ left: 100, right: 140, top: 10, bottom: 590 }, { width: 200, height: 40 }, { width: 400, height: 600 }).top).toBe(596);
  });
});

describe("Tooltip long press (touch)", () => {
  const touch = { pointerType: "touch" };
  const down = (el: Element, x = 10, y = 10) => fireEvent.pointerDown(el, { ...touch, clientX: x, clientY: y });

  function setup(onClick = vi.fn()) {
    render(
      <Tooltip content="Full hover text" touchContent="Short touch text">
        <button aria-label="Pin" onClick={onClick}>
          p
        </button>
      </Tooltip>,
    );
    return onClick;
  }

  it("shows after a long press, with the touch text, and a plain tap shows nothing", () => {
    setup();
    down(button());
    wait(300);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.pointerUp(button(), touch);
    wait(1000);
    expect(screen.queryByRole("tooltip")).toBeNull(); // lifted before the timer: a tap
    down(button());
    wait(500);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Short touch text");
  });

  it("is cancelled by movement beyond the slop, by a cancelled pointer and by scrolling; small jitter is fine", () => {
    setup();
    down(button());
    fireEvent.pointerMove(button(), { ...touch, clientX: 30, clientY: 10 });
    wait(600);
    expect(screen.queryByRole("tooltip")).toBeNull();
    down(button());
    fireEvent.pointerCancel(button(), touch);
    wait(600);
    expect(screen.queryByRole("tooltip")).toBeNull();
    down(button());
    act(() => void window.dispatchEvent(new Event("scroll")));
    wait(600);
    expect(screen.queryByRole("tooltip")).toBeNull();
    down(button());
    fireEvent.pointerMove(button(), { ...touch, clientX: 13, clientY: 12 });
    wait(500);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("swallows the click that follows a long press, but not the next tap", () => {
    const onClick = setup();
    down(button());
    wait(500);
    fireEvent.pointerUp(button(), touch);
    fireEvent.click(button());
    expect(onClick).not.toHaveBeenCalled();
    down(button());
    fireEvent.pointerUp(button(), touch);
    fireEvent.click(button());
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("a tap clicks through with no tooltip", () => {
    const onClick = setup();
    down(button());
    fireEvent.pointerUp(button(), touch);
    fireEvent.click(button());
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("prevents the context menu during a press, and stays after the lift for a couple of seconds, then goes", () => {
    setup();
    down(button());
    const notPrevented = fireEvent.contextMenu(button());
    expect(notPrevented).toBe(false); // preventDefault was called
    wait(500);
    fireEvent.pointerUp(button(), touch);
    wait(2000);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    wait(600);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("goes on a touch elsewhere, and when a drag starts after the tip is up", () => {
    setup();
    down(button());
    wait(500);
    fireEvent.pointerDown(document.body, touch);
    expect(screen.queryByRole("tooltip")).toBeNull();
    down(button());
    wait(500);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.pointerMove(button(), { ...touch, clientX: 60, clientY: 10 }); // the handle's drag begins
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("hover keeps its text, and the control gets no-callout classes only where there is no hover (class-gated)", () => {
    setup();
    expect(button().className).toContain("[@media(hover:none)]:select-none");
    expect(button().className).toContain("[@media(hover:none)]:[-webkit-touch-callout:none]");
    expect(button().className).not.toMatch(/(^|\s)select-none/);
    hover(button());
    wait(400);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Full hover text");
  });
});
