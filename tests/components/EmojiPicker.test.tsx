// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

// The picker lays out the whole emoji catalog; a loaded CI runner needs more than the 5s default.
vi.setConfig({ testTimeout: 30_000 });

const track = vi.fn();
vi.mock("@/lib/analytics/client", () => ({ track: (...a: unknown[]) => track(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/(member)/chat/actions", () => ({ toggleChatReaction: vi.fn() }));
import EmojiPicker from "@/components/chat/EmojiPicker";

const CUSTOM = { partyparrot: { url: "https://example.com/p.png" }, hedgie: { text: "🦔" } };

beforeEach(() => {
  cleanup();
  localStorage.clear();
  track.mockReset();
});

async function open(props: Partial<React.ComponentProps<typeof EmojiPicker>> = {}) {
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(<EmojiPicker custom={CUSTOM} onPick={onPick} onClose={onClose} {...props} />);
  await screen.findByRole("button", { name: "React with :grinning:" });
  return { onPick, onClose };
}

describe("EmojiPicker", () => {
  it("focuses search, lists standard and custom emoji, and picks by shortcode", async () => {
    const { onPick } = await open();
    expect(screen.getByLabelText("Search emoji")).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "React with :partyparrot:" }));
    expect(onPick).toHaveBeenCalledWith("partyparrot");
    expect(track).toHaveBeenCalledWith("chat_reaction_picked", { via: "browse", custom: true });
    expect(JSON.parse(localStorage.getItem("chat-recent-reactions")!)).toEqual(["partyparrot"]);
  });

  it("searches names, aliases and keywords, custom first", async () => {
    const { onPick } = await open();
    await userEvent.type(screen.getByLabelText("Search emoji"), "hedg");
    expect(screen.getByRole("button", { name: "React with :hedgehog:" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "React with :hedgie:" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "React with :hedgie:" }));
    expect(onPick).toHaveBeenCalledWith("hedgie");
    expect(track).toHaveBeenCalledWith("chat_reaction_picked", { via: "search", custom: true });
  });

  it("says so when nothing matches", async () => {
    await open();
    await userEvent.type(screen.getByLabelText("Search emoji"), "qqqzzzxx");
    expect(screen.getByText(/No emoji match/)).toBeInTheDocument();
  });

  it("does not scroll when the picker is gone before the next frame", async () => {
    const frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => frames.push(cb));
    await open();
    await userEvent.click(screen.getByRole("tab", { name: "Food" }));
    cleanup();
    expect(() => frames.forEach((cb) => cb(0))).not.toThrow();
    raf.mockRestore();
  });

  it("jumps to a category from its tab and clears the search", async () => {
    await open();
    await userEvent.type(screen.getByLabelText("Search emoji"), "a");
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Search emoji"));
    await userEvent.click(screen.getByRole("tab", { name: "Food" }));
    expect(screen.getByRole("tab", { name: "Food" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("region", { name: "Food" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Custom" }));
    expect(screen.getByRole("region", { name: "Custom" })).toBeInTheDocument();
  });

  it("shows recent picks first and tags them", async () => {
    localStorage.setItem("chat-recent-reactions", JSON.stringify(["tada"]));
    const { onPick } = await open();
    expect(screen.getByRole("tab", { name: "Frequently used" })).toHaveAttribute("aria-selected", "true");
    const grid = screen.getByRole("group", { name: "Frequently used" });
    await userEvent.click(grid.querySelector("button")!);
    expect(onPick).toHaveBeenCalledWith("tada");
    expect(track).toHaveBeenCalledWith("chat_reaction_picked", { via: "recent", custom: false });
  });

  it("closes on Escape and on an outside click, not an inside one", async () => {
    const { onClose } = await open();
    fireEvent.mouseDown(screen.getByLabelText("Search emoji"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(document, { key: "a" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("opens above when it would run off the bottom of the window", async () => {
    const spy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ top: 900, bottom: 1300, height: 400 } as DOMRect);
    await open();
    expect(screen.getByRole("dialog")).toHaveClass("sm:bottom-full");
    spy.mockRestore();
  });
});

describe("EmojiPicker on narrow screens", () => {
  it("seeds Frequently used with the old quick reactions when there are no recents", async () => {
    const { onPick } = await open();
    expect(screen.getByRole("tab", { name: "Frequently used" })).toHaveAttribute("aria-selected", "true");
    const grid = screen.getByRole("group", { name: "Frequently used" });
    expect(grid.querySelectorAll("button")).toHaveLength(8);
    await userEvent.click(within(grid).getByRole("button", { name: "React with :heart:" }));
    expect(onPick).toHaveBeenCalledWith("heart");
  });

  it("is a bottom sheet on phones with a backdrop and a close button, 16px search, 40px targets", async () => {
    const { onClose } = await open();
    expect(screen.getByRole("dialog")).toHaveClass("fixed", "inset-x-0", "bottom-0", "sm:absolute", "sm:w-80");
    expect(screen.getByTestId("emoji-backdrop")).toHaveClass("fixed", "inset-0", "sm:hidden");
    expect(screen.getByLabelText("Search emoji")).toHaveClass("text-base");
    expect(within(screen.getByRole("group", { name: "Frequently used" })).getByRole("button", { name: "React with :heart:" })).toHaveClass("h-10", "w-10");
    expect(screen.getByRole("tab", { name: "Food" })).toHaveClass("h-10", "w-10");
    expect(screen.getByRole("tablist")).toHaveClass("overflow-x-auto");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("nudges itself back when its left edge is off the window", async () => {
    const spy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ top: 10, bottom: 300, height: 290, left: -50, right: 270 } as DOMRect);
    await open();
    expect(screen.getByRole("dialog").style.transform).toBe("translateX(58px)");
    spy.mockRestore();
  });

  it("nudges itself back when its right edge is off the window", async () => {
    const spy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ top: 10, bottom: 300, height: 290, left: 900, right: 1100 } as DOMRect);
    await open();
    expect(screen.getByRole("dialog").style.transform).toMatch(/^translateX\(-/);
    spy.mockRestore();
  });
});

describe("EmojiPicker position inside a scrolling pane", () => {
  const rectOf = (left: number, right: number) => ({ left, right, top: 100, bottom: 400, width: right - left, height: 300, x: left, y: 100, toJSON: () => ({}) }) as DOMRect;

  function openIn(pane: { left: number; right: number }, dialog: { left: number; right: number }) {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute("role") === "dialog") return rectOf(dialog.left, dialog.right);
      if (this.dataset.testid === "pane") return rectOf(pane.left, pane.right);
      return rectOf(0, 0);
    });
    render(
      <div data-testid="pane" style={{ overflowY: "auto" }}>
        <div>
          <EmojiPicker custom={CUSTOM} onPick={vi.fn()} onClose={vi.fn()} />
        </div>
      </div>
    );
    return screen.getByRole("dialog", { name: "Pick an emoji" });
  }

  afterEach(() => vi.restoreAllMocks());

  it("moves in when the pane's left edge would cut it off (a thread open beside the conversation)", () => {
    // The pane starts at 225px (after the sidebar); the picker would start at 192px, inside the sidebar.
    expect(openIn({ left: 225, right: 608 }, { left: 192, right: 512 })).toHaveStyle({ transform: "translateX(41px)" });
  });

  it("moves in when the pane's right edge would cut it off, without crossing the left edge", () => {
    expect(openIn({ left: 225, right: 608 }, { left: 300, right: 620 })).toHaveStyle({ transform: "translateX(-20px)" });
  });

  it("stays put when it fits", () => {
    expect(openIn({ left: 225, right: 900 }, { left: 400, right: 720 })).not.toHaveAttribute("style");
  });
});
