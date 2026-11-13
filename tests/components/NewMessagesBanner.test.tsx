// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NewMessagesBanner from "@/components/chat/NewMessagesBanner";
import { newMessagesSince } from "@/lib/chat/unread";
import type { ChatMessageView } from "@/lib/chat/load";

const track = vi.hoisted(() => vi.fn());
vi.mock("@/lib/analytics/client", () => ({ track }));

let callback: IntersectionObserverCallback;

function report(isIntersecting: boolean, top: number) {
  act(() => {
    callback(
      [{ isIntersecting, boundingClientRect: { top } as DOMRectReadOnly, rootBounds: { top: 0 } as DOMRectReadOnly } as IntersectionObserverEntry],
      {} as IntersectionObserver
    );
  });
}

beforeEach(() => {
  track.mockClear();
  document.body.innerHTML = '<div id="unread-divider"></div>';
  class FakeObserver {
    constructor(cb: IntersectionObserverCallback) {
      callback = cb;
    }
    observe() {}
    disconnect() {}
    unobserve() {}
    takeRecords() {
      return [];
    }
  }
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("NewMessagesBanner", () => {
  it("is hidden while the New line is in view", () => {
    render(<NewMessagesBanner count={13} />);
    expect(screen.queryByText(/new messages/)).toBeNull();
    report(true, 100);
    expect(screen.queryByText(/new messages/)).toBeNull();
  });

  it("shows the count when the line is above the visible area, and goes away when it comes into view", () => {
    render(<NewMessagesBanner count={13} />);
    report(false, -300);
    expect(screen.getByText(/13 new messages/)).toBeTruthy();
    report(true, 10);
    expect(screen.queryByText(/new messages/)).toBeNull();
  });

  it("is hidden when the line is below the visible area", () => {
    render(<NewMessagesBanner count={13} />);
    report(false, 900);
    expect(screen.queryByText(/new messages/)).toBeNull();
  });

  it("says 'new message' for one", () => {
    render(<NewMessagesBanner count={1} />);
    report(false, -300);
    expect(screen.getByText(/1 new message$/)).toBeTruthy();
  });

  it("shows nothing for a count of zero", () => {
    render(<NewMessagesBanner count={0} />);
    report(false, -300);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("scrolls up to the line when clicked", async () => {
    const scrollTo = vi.fn();
    document.body.innerHTML = '<div id="scroller" style="overflow-y:auto"><div id="unread-divider"></div></div>';
    const scroller = document.getElementById("scroller") as HTMLElement;
    scroller.scrollTo = scrollTo as unknown as typeof scroller.scrollTo;
    render(<NewMessagesBanner count={5} />);
    report(false, -300);
    await userEvent.click(screen.getByRole("button", { name: /5 new messages/ }));
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: "smooth" }));
    expect(track).toHaveBeenCalledWith("chat_new_messages_banner", { action: "jumped", count: 5 });
  });

  it("is dismissed by the X and stays dismissed", async () => {
    render(<NewMessagesBanner count={5} />);
    report(false, -300);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/new messages/)).toBeNull();
    report(false, -400);
    expect(screen.queryByText(/new messages/)).toBeNull();
    expect(track).toHaveBeenCalledWith("chat_new_messages_banner", { action: "dismissed", count: 5 });
  });

  it("keeps the count it first rendered with", () => {
    const { rerender } = render(<NewMessagesBanner count={4} />);
    rerender(<NewMessagesBanner count={9} />);
    report(false, -300);
    expect(screen.getByText(/4 new messages/)).toBeTruthy();
  });
});

const view = (id: string, extra: Partial<ChatMessageView> = {}) =>
  ({ id, mine: false, system: false, contentState: "visible", ...extra }) as unknown as ChatMessageView;

describe("newMessagesSince", () => {
  it("counts others' live messages from the line on, skipping the reader's own, notices and deleted ones", () => {
    const views = [
      view("a"),
      view("b"),
      view("c", { mine: true }),
      view("d", { system: true }),
      view("e", { contentState: "deleted" }),
      view("f"),
    ];
    expect(newMessagesSince(views, "b")).toBe(2);
    expect(newMessagesSince(views, "f")).toBe(1);
  });

  it("is zero without a line or when the line's message is not in the list", () => {
    expect(newMessagesSince([view("a")], undefined)).toBe(0);
    expect(newMessagesSince([view("a")], "zzz")).toBe(0);
  });
});
