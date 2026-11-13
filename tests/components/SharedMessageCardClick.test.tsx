// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/app/actions/member-hover-card", () => ({ getMemberHoverCard: vi.fn() }));
vi.mock("@/lib/analytics/client", () => ({ track: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/(member)/chat/actions", () => ({ hideChatUnfurl: vi.fn() }));
vi.mock("@/lib/chat/list-events", async (orig) => ({ ...(await orig<typeof import("@/lib/chat/list-events")>()), pokeChat: vi.fn() }));
import SharedMessageCard from "@/components/chat/SharedMessageCard";
import { parseSharedMessage, sharedMessageSource } from "@/lib/chat/shared-message";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ctx = { userNames: {}, userMembers: {}, channelIds: {}, channelNames: {}, customEmoji: {} };
const shared = parseSharedMessage({ is_share: true, author_name: "Ada Example", text: "Read <https://example.test/page|the page> please", ts: "1700000000.000100", channel_name: "tea-room", from_url: "https://example.slack.com/archives/C1/p1" })!;
const readable = sharedMessageSource({ state: "readable", channelId: "hub-tea", messageId: "msg_AAAAAAAAAAA1", deleted: false });
const removable = { channelId: "chn_AAAAAAAAAAA1", messageId: "msg_AAAAAAAAAAA2", removeKey: "url:x" };

/** Counts clicks that reach an anchor, and stops the browser following them. */
function watch(a: HTMLElement) {
  const spy = vi.fn((e: Event) => e.preventDefault());
  a.addEventListener("click", spy);
  return spy;
}

describe("the whole quoted-message card is one link", () => {
  it("has one stretched anchor with the visible text as its name, and a hover state", () => {
    render(<SharedMessageCard shared={shared} source={readable} ctx={ctx} />);
    const card = screen.getByTestId("shared-message-card");
    const anchor = screen.getByRole("link", { name: "View in Chat" });
    expect(anchor).toHaveAttribute("href", "/chat/hub-tea?m=msg_AAAAAAAAAAA1");
    expect(anchor.className).toContain("after:inset-0");
    expect(anchor.className).toContain("focus-visible:after:ring-2");
    expect(card.className).toContain("hover:border-mist-500");
    expect(card.className).toContain("border-mist-300");
    expect(card.querySelectorAll("a a")).toHaveLength(0);
  });

  it("follows the link on a click on the text; the anchor takes keyboard focus", () => {
    render(<SharedMessageCard shared={shared} source={readable} ctx={ctx} />);
    const anchor = screen.getByRole("link", { name: "View in Chat" });
    const spy = watch(anchor);
    fireEvent.click(screen.getByText("Ada Example"));
    expect(spy).toHaveBeenCalledTimes(1);
    anchor.focus();
    expect(anchor).toHaveFocus();
  });

  it("does not follow it when the click ends a text selection", () => {
    render(<SharedMessageCard shared={shared} source={readable} ctx={ctx} />);
    const spy = watch(screen.getByRole("link", { name: "View in Chat" }));
    vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "Read" } as Selection);
    fireEvent.click(screen.getByText("Ada Example"));
    expect(spy).not.toHaveBeenCalled();
  });

  it("keeps a link inside the quoted text working on its own: it opens its page, not the original", () => {
    render(<SharedMessageCard shared={shared} source={readable} ctx={ctx} />);
    const spy = watch(screen.getByRole("link", { name: "View in Chat" }));
    const inner = screen.getByRole("link", { name: "the page" });
    expect(inner.closest("[class*='z-10']")).not.toBeNull();
    const innerSpy = watch(inner);
    fireEvent.click(inner);
    expect(innerSpy).toHaveBeenCalledTimes(1);
    expect(spy).not.toHaveBeenCalled();
  });

  it("opens Slack's permalink in a new tab when the Hub has no copy for the viewer", () => {
    render(<SharedMessageCard shared={shared} source={sharedMessageSource(undefined)} ctx={ctx} />);
    const anchor = screen.getByRole("link", { name: "Open in Slack" });
    expect(anchor).toHaveAttribute("target", "_blank");
    expect(anchor).toHaveAttribute("rel", "noopener noreferrer");
    const spy = watch(anchor);
    fireEvent.click(screen.getByText("Ada Example"));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("the X removes without following the link", () => {
    render(<SharedMessageCard shared={shared} source={readable} ctx={ctx} removable={removable} />);
    const spy = watch(screen.getByRole("link", { name: "View in Chat" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove preview" }));
    expect(spy).not.toHaveBeenCalled();
  });

  it("is not clickable when the original was deleted, or there is nowhere to go", () => {
    const deleted = sharedMessageSource({ state: "readable", channelId: "c", messageId: "m", deleted: true });
    render(<SharedMessageCard shared={shared} source={deleted} ctx={ctx} />);
    const card = screen.getByTestId("shared-message-card");
    expect(card).not.toHaveAttribute("data-stretched-card");
    expect(card.className).not.toContain("hover:border-mist-500");
    const spy = watch(screen.getByRole("link", { name: "Open in Slack" }));
    fireEvent.click(screen.getByText("Ada Example"));
    expect(spy).not.toHaveBeenCalled();
    cleanup();
    const bare = parseSharedMessage({ is_share: true, text: "hi", ts: "1700000000.000100" })!;
    render(<SharedMessageCard shared={bare} source={{ hubUrl: null, deleted: false }} ctx={ctx} />);
    expect(screen.getByTestId("shared-message-card")).not.toHaveAttribute("data-stretched-card");
  });
});
