// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { refresh, track, hideChatUnfurl, pokeChat } = vi.hoisted(() => ({ refresh: vi.fn(), track: vi.fn(), hideChatUnfurl: vi.fn(), pokeChat: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/analytics/client", () => ({ track }));
vi.mock("@/app/(member)/chat/actions", () => ({ hideChatUnfurl }));
vi.mock("@/lib/chat/list-events", async (orig) => ({ ...(await orig<typeof import("@/lib/chat/list-events")>()), pokeChat }));

import RemoveUnfurlButton from "@/components/chat/RemoveUnfurlButton";

const MESSAGE = "msg_AAAAAAAAAAA9";
const CHANNEL = "chn_AAAAAAAAAAA1";
const IMG = "https://thumb.wikimedia.org/wikipedia/commons/a/ab/x.jpg";

const open = (removeKey = `url:${IMG}`, blockable = true) => {
  render(<RemoveUnfurlButton channelId={CHANNEL} messageId={MESSAGE} removeKey={removeKey} source="hub" blockable={blockable} />);
  fireEvent.click(screen.getByRole("button", { name: "Remove preview" }));
};
const dialog = () => screen.getByRole("dialog", { name: "Remove preview?" });
const select = () => within(dialog()).getByRole("combobox");

beforeEach(() => {
  refresh.mockReset();
  track.mockReset();
  pokeChat.mockReset().mockReturnValue(false);
  hideChatUnfurl.mockReset().mockResolvedValue({ ok: true, slack: "not_needed", blocked: true });
});

describe("the Remove preview dialog", () => {
  it("opens on the X without removing anything, with the block box ticked and the choice still to make", () => {
    open();
    expect(hideChatUnfurl).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox", { name: "Also block previews from this website" })).toBeChecked();
    expect(select()).toHaveValue("");
    expect(within(select()).getByRole("option", { name: "--Select an option--" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove and Block" })).toBeDisabled();
  });

  it("offers the site, the first path segment and this link for an address with a path", () => {
    open();
    expect(within(select()).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "--Select an option--",
      "Block all previews from thumb.wikimedia.org",
      "Block previews from links under thumb.wikimedia.org/wikipedia/…",
      "Block previews from this specific link",
    ]);
  });

  it("offers no path choice for an address without a path segment", () => {
    open("url:https://example.test/");
    expect(within(select()).getAllByRole("option").map((o) => o.getAttribute("value"))).toEqual(["", "site", "link"]);
  });

  it("enables Remove and Block once a choice is made and sends that scope with the key", async () => {
    open();
    fireEvent.change(select(), { target: { value: "path" } });
    const button = screen.getByRole("button", { name: "Remove and Block" });
    expect(button).toBeEnabled();
    fireEvent.click(button);

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(hideChatUnfurl).toHaveBeenCalledWith(MESSAGE, `url:${IMG}`, "path");
    expect(track).toHaveBeenCalledWith("chat_unfurl_removed", { source: "hub", slack: "not_needed" });
    expect(track).toHaveBeenCalledWith("chat_preview_block_chosen", { scope: "path", saved: true });
    // Never the address in what is recorded.
    expect(JSON.stringify(track.mock.calls)).not.toContain("wikimedia");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("unticking hides the choice and turns the button into a plain Remove that blocks nothing", async () => {
    open();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove and Block" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(hideChatUnfurl).toHaveBeenCalledWith(MESSAGE, `url:${IMG}`);
    expect(track).toHaveBeenCalledWith("chat_preview_block_chosen", { scope: "none", saved: false });
  });

  it("Cancel closes it and does nothing, and Escape does too", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove preview" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(hideChatUnfurl).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });

  it("starts fresh when it is opened again", () => {
    open();
    fireEvent.change(select(), { target: { value: "site" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove preview" }));
    expect(select()).toHaveValue("");
  });

  it("offers just Remove for a card without an address, or one that cannot be blocked", () => {
    open("idx:2");
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Remove" })).toBeEnabled();
  });

  it("offers just Remove for an address that is not https, and when the card is not blockable at all", () => {
    open("url:http://example.test/a");
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("offers just Remove where blocking is not offered (a quoted message, a link to the Hub)", () => {
    open(`url:${IMG}`, false);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("shows a refusal in the dialog and keeps it open, recording nothing", async () => {
    hideChatUnfurl.mockResolvedValue({ ok: false, error: "That preview can't be removed, so nothing was blocked." });
    open();
    fireEvent.change(select(), { target: { value: "site" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove and Block" }));

    expect(await within(dialog()).findByRole("alert")).toHaveTextContent("nothing was blocked");
    expect(track).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    // And it can be tried again.
    hideChatUnfurl.mockResolvedValue({ ok: true, slack: "not_needed", blocked: true });
    fireEvent.click(screen.getByRole("button", { name: "Remove and Block" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("survives the action throwing", async () => {
    hideChatUnfurl.mockRejectedValue(new Error("network"));
    open();
    fireEvent.change(select(), { target: { value: "link" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove and Block" }));
    expect(await within(dialog()).findByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("says the card is removed but the block was not saved, then lets the card go", async () => {
    const real = globalThis.setTimeout;
    const later: (() => void)[] = [];
    const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number, ...rest: unknown[]) => (ms === 3500 ? (later.push(fn), 0 as never) : real(fn, ms, ...rest))) as never);
    try {
      hideChatUnfurl.mockResolvedValue({ ok: true, slack: "not_needed", blocked: false, blockError: "Removed, but we couldn't block this site. Try again from the next preview." });
      open();
      fireEvent.change(select(), { target: { value: "site" } });
      fireEvent.click(screen.getByRole("button", { name: "Remove and Block" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Removed, but we couldn't block this site");
      expect(track).toHaveBeenCalledWith("chat_preview_block_chosen", { scope: "site", saved: false });
      expect(refresh).not.toHaveBeenCalled();
      later.forEach((fn) => fn());
      expect(refresh).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
