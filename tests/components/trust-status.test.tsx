// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { COMPLIANCE_STATUSES } from "@/content/compliance";
import { STATUS_MEANING, StatusLegend, StatusPill } from "@/components/trust/Trust";

// jsdom has no PointerEvent: a MouseEvent that carries the pointer type, as in Tooltip.test.tsx.
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
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({ matches: query === "(hover: hover)", media: query, addEventListener() {}, removeEventListener() {} })) as never;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const hoverFor = (el: Element) => {
  fireEvent.pointerEnter(el, { pointerType: "mouse" });
  act(() => void vi.advanceTimersByTime(400));
};

describe("StatusPill", () => {
  it("shows what the status means when hovered", () => {
    render(<StatusPill status="inPlace" />);
    expect(screen.queryByRole("tooltip")).toBeNull();
    hoverFor(screen.getByText(COMPLIANCE_STATUSES.inPlace));
    expect(screen.getByRole("tooltip")).toHaveTextContent("We do this ourselves, and you can check it in the Hub.");
  });

  it("has a different hint for every status", () => {
    const meanings = Object.keys(COMPLIANCE_STATUSES).map((s) => STATUS_MEANING[s as keyof typeof COMPLIANCE_STATUSES]);
    expect(new Set(meanings).size).toBe(meanings.length);
  });

  it("shows no tooltip where the meaning is already printed beside it (hint off)", () => {
    render(<StatusPill status="working" hint={false} />);
    hoverFor(screen.getByText(COMPLIANCE_STATUSES.working));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

describe("StatusLegend", () => {
  it("is a plain list when not collapsed (the staff pages)", () => {
    const { container } = render(<StatusLegend statuses={["inPlace", "review"]} />);
    expect(container.querySelector("details")).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("collapsed: a closed 'What the labels mean' disclosure whose text is still on the page, only for the statuses given", () => {
    const { container } = render(<StatusLegend statuses={["inPlace", "guide"]} collapsed />);
    const details = container.querySelector("details");
    if (!details) throw new Error("no disclosure");
    expect(details.open).toBe(false);
    expect(within(details).getByText("What the labels mean").tagName).toBe("SUMMARY");
    // The meanings are in the document even while it is closed, so a phone or a screen reader still has them.
    expect(details).toHaveTextContent(STATUS_MEANING.inPlace);
    expect(details).toHaveTextContent(STATUS_MEANING.guide);
    expect(details).not.toHaveTextContent(STATUS_MEANING.provider);
    expect(within(details).getAllByRole("listitem")).toHaveLength(2);
  });

  it("opens when the summary is clicked", () => {
    const { container } = render(<StatusLegend statuses={["inPlace"]} collapsed />);
    const details = container.querySelector("details") as HTMLDetailsElement;
    fireEvent.click(screen.getByText("What the labels mean"));
    // jsdom toggles `open` on a summary click.
    expect(details.open).toBe(true);
  });
});
