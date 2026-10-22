// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

// The picker lays out the whole emoji catalog; a loaded CI runner needs more than the 5s default.
vi.setConfig({ testTimeout: 30_000 });

const track = vi.fn();
vi.mock("@/lib/analytics/client", () => ({ track: (...a: unknown[]) => track(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/(member)/chat/actions", () => ({ toggleChatReaction: vi.fn() }));
import EmojiPicker from "@/components/chat/EmojiPicker";
import { ReactionPicker } from "@/components/chat/ReactionBar";

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
    expect(screen.getByRole("dialog")).toHaveClass("bottom-full");
    spy.mockRestore();
  });
});

describe("ReactionPicker", () => {
  it("keeps the quick row and opens the full picker from the plus button", async () => {
    const onPick = vi.fn();
    render(<ReactionPicker custom={{}} onPick={onPick} onClose={vi.fn()} className="" />);
    await userEvent.click(screen.getByRole("button", { name: "React with :tada:" }));
    expect(onPick).toHaveBeenCalledWith("tada");
    await userEvent.click(screen.getByRole("button", { name: "More emoji…" }));
    expect(screen.getByRole("dialog", { name: "Pick an emoji" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Pick a reaction" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "React with :grinning:" })).toBeInTheDocument());
  });
});
