// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

// The picker lays out the whole emoji catalog; a loaded CI runner needs more than the 5s default.
vi.setConfig({ testTimeout: 30_000 });

vi.mock("@/lib/analytics/client", () => ({ track: vi.fn() }));
import EmojiPicker from "@/components/chat/EmojiPicker";
import { Emoji } from "@/components/chat/ChatText";

const CUSTOM = { partyparrot: { url: "https://example.com/p.png" } };

beforeEach(() => {
  cleanup();
  localStorage.clear();
});

async function open(custom: React.ComponentProps<typeof EmojiPicker>["custom"] = CUSTOM) {
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(<EmojiPicker custom={custom} onPick={onPick} onClose={onClose} />);
  await screen.findByRole("button", { name: "React with :grinning:" });
  return { onPick, onClose };
}

const cells = () => Array.from(document.querySelectorAll<HTMLElement>("button[data-cell]"));

describe("EmojiPicker skin tones", () => {
  it("applies the chosen tone to emoji with variants, not to others, and remembers it", async () => {
    const { onPick } = await open();
    await userEvent.click(screen.getByRole("radio", { name: "Medium skin tone" }));
    expect(screen.getByRole("radio", { name: "Medium skin tone" })).toHaveAttribute("aria-checked", "true");
    expect(localStorage.getItem("chat-skin-tone")).toBe("4");
    expect(screen.getByRole("button", { name: "React with :grinning:" })).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "React with :+1::skin-tone-4:" })[0]);
    expect(onPick).toHaveBeenCalledWith("+1::skin-tone-4");
    expect(screen.getAllByText("👍🏽").length).toBeGreaterThan(0);
  });

  it("starts from the remembered tone and goes back to the default", async () => {
    localStorage.setItem("chat-skin-tone", "2");
    await open();
    expect(screen.getByRole("radio", { name: "Light skin tone" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("radio", { name: "Default skin tone" }));
    expect(localStorage.getItem("chat-skin-tone")).toBeNull();
    expect(screen.getAllByRole("button", { name: "React with :+1:" }).length).toBeGreaterThan(0);
  });

  it("shows a toned reaction as the toned emoji", () => {
    render(<Emoji name="+1::skin-tone-6" custom={{}} />);
    expect(screen.getByText("👍🏿")).toBeInTheDocument();
  });
});

describe("EmojiPicker keyboard", () => {
  it("is one tab stop and moves with the arrow keys, Home and End", async () => {
    await open();
    const all = cells();
    expect(all.filter((c) => c.tabIndex === 0)).toHaveLength(1);
    await userEvent.type(screen.getByLabelText("Search emoji"), "{ArrowDown}");
    expect(all[0]).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    expect(all[1]).toHaveFocus();
    expect(all[1].tabIndex).toBe(0);
    expect(all[0].tabIndex).toBe(-1);
    await userEvent.keyboard("{ArrowLeft}");
    expect(all[0]).toHaveFocus();
    await userEvent.keyboard("{End}");
    expect(all[all.length - 1]).toHaveFocus();
    await userEvent.keyboard("{Home}");
    expect(all[0]).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(all[0]).toHaveFocus();
    await userEvent.keyboard("x");
    expect(all[0]).toHaveFocus();
  });

  it("picks with Enter and closes with Escape", async () => {
    const { onPick, onClose } = await open();
    await userEvent.type(screen.getByLabelText("Search emoji"), "{ArrowDown}");
    await userEvent.keyboard("{Enter}");
    expect(onPick).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("moves between rows by position and returns to search from the top", async () => {
    await open();
    const all = cells();
    all.forEach((el, i) => {
      Object.defineProperty(el, "offsetTop", { configurable: true, value: Math.floor(i / 4) * 32 });
      Object.defineProperty(el, "offsetLeft", { configurable: true, value: (i % 4) * 32 });
    });
    all[5].focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(all[9]).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}{ArrowUp}");
    expect(all[1]).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(screen.getByLabelText("Search emoji")).toHaveFocus();
    all[all.length - 1].focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(all[all.length - 1]).toHaveFocus();
  });

  it("ArrowDown in search with no results stays put", async () => {
    await open();
    await userEvent.type(screen.getByLabelText("Search emoji"), "qqqzzzxx{ArrowDown}");
    expect(screen.getByLabelText("Search emoji")).toHaveFocus();
  });
});

describe("EmojiPicker with thousands of custom emoji", () => {
  it("splits a long list into skippable chunks sized for their rows, with lazy images", async () => {
    const custom = Object.fromEntries(Array.from({ length: 3000 }, (_, i) => [`e${String(i).padStart(4, "0")}`, { url: `https://example.com/${i}.png` }]));
    await open(custom);
    const group = screen.getByRole("group", { name: "Custom" });
    expect(group.children).toHaveLength(Math.ceil(3000 / 144));
    expect((group.children[0] as HTMLElement).style.containIntrinsicSize).toBe("auto 32rem");
    expect(group.querySelector("img")).toHaveAttribute("loading", "lazy");
  });
});
