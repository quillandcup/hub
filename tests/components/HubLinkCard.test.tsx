// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const { refresh, track, hideChatUnfurl, pokeChat } = vi.hoisted(() => ({ refresh: vi.fn(), track: vi.fn(), hideChatUnfurl: vi.fn(), pokeChat: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/analytics/client", () => ({ track }));
vi.mock("@/app/(member)/chat/actions", () => ({ hideChatUnfurl }));
vi.mock("@/lib/chat/list-events", async (orig) => ({ ...(await orig<typeof import("@/lib/chat/list-events")>()), pokeChat }));

import HubLinkCard, { forgetHubCards } from "@/components/chat/HubLinkCard";
import MessageUnfurls from "@/components/chat/MessageUnfurls";
import type { HubCard } from "@/lib/chat/hub-link-card";
import type { ChatTextContext } from "@/components/chat/ChatText";
import type { HubLinkUnfurl } from "@/lib/chat/unfurls";

const CHANNEL = "chn_AAAAAAAAAAA1";
const MESSAGE = "msg_AAAAAAAAAAA9";
const TARGET = "msg_AAAAAAAAAAA1";
const ADDRESS = `https://hub.example.test/chat/${CHANNEL}?m=${TARGET}`;

const unfurl = (over: Partial<HubLinkUnfurl> = {}): HubLinkUnfurl => ({ kind: "hub", url: ADDRESS, link: { kind: "message", channelId: CHANNEL, messageId: TARGET }, removeKey: `url:${ADDRESS}`, ...over });
const ctx: ChatTextContext = { userNames: {}, userMembers: {}, channelIds: {}, channelNames: {}, customEmoji: {} };

const answer = (body: HubCard | null, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

const MESSAGE_CARD: HubCard = { state: "message", authorName: "Fern <&> Quillsby", authorPhotoUrl: null, postedAt: "2026-10-01T15:30:00Z", text: "Hello & welcome", channelName: "general" };

beforeEach(() => {
  forgetHubCards();
  track.mockReset();
  hideChatUnfurl.mockReset().mockResolvedValue({ ok: true, slack: "not_needed" });
  pokeChat.mockReset().mockReturnValue(false);
});
afterEach(() => vi.unstubAllGlobals());

describe("HubLinkCard", () => {
  it("holds its place while it asks, then shows the quoted message with the time in the viewer's zone", async () => {
    const fetcher = answer(MESSAGE_CARD);
    vi.stubGlobal("fetch", fetcher);
    render(<HubLinkCard unfurl={unfurl()} timeZone="America/Los_Angeles" />);

    expect(screen.getByTestId("hub-link-card-loading")).toHaveClass("h-24", "animate-pulse", "dark:bg-slate-800");
    expect(await screen.findByTestId("hub-link-card")).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledWith(`/api/chat/hub-links?url=${encodeURIComponent(ADDRESS)}`, expect.anything());

    // Names with & and < are text, not markup or entities.
    expect(screen.getByText("Fern <&> Quillsby")).toBeInTheDocument();
    expect(screen.getByText("Hello & welcome")).toBeInTheDocument();
    expect(screen.getByText("Posted in #general")).toBeInTheDocument();
    // 15:30 UTC on 1 October is 8:30 AM in Los Angeles.
    expect(screen.getByText(/8:30\s?AM/)).toBeInTheDocument();
    // The whole card opens the message, by a path rebuilt from the ids.
    const open = screen.getByRole("link", { name: "Open in Hub Chat" });
    expect(open).toHaveAttribute("href", `/chat/${CHANNEL}?m=${TARGET}`);
    expect(open).toHaveAttribute("data-stretched-link");
    expect(open).toHaveClass("after:absolute", "after:inset-0");
    expect(open).toHaveAttribute("data-track", "chat-hub-link-card");
    expect(track).toHaveBeenCalledWith("chat_hub_link_card_shown", { kind: "message", state: "card" });
  });

  it("is drawn with the same light and dark tokens as the link preview card", async () => {
    vi.stubGlobal("fetch", answer(MESSAGE_CARD));
    render(<HubLinkCard unfurl={unfurl()} />);
    const card = (await screen.findByTestId("hub-link-card")).firstElementChild!;
    expect(card).toHaveClass("border-l-4", "border-slate-300", "dark:border-slate-600", "bg-slate-50", "dark:bg-slate-800/40", "dark:hover:bg-slate-800/70");
    expect(card).toHaveAttribute("data-stretched-card");
    expect(screen.getByText("Hello & welcome")).toHaveClass("dark:text-slate-100");
  });

  it("says only that it is a link to the Hub when the reader may not see the target", async () => {
    vi.stubGlobal("fetch", answer({ state: "stub" }));
    render(<HubLinkCard unfurl={unfurl()} />);
    expect(await screen.findByText("Link to the Hub")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the link" })).toHaveAttribute("href", `/chat/${CHANNEL}?m=${TARGET}`);
    expect(track).toHaveBeenCalledWith("chat_hub_link_card_shown", { kind: "message", state: "stub" });
  });

  it("draws a prickle by title and date, and a member by name", async () => {
    vi.stubGlobal("fetch", answer({ state: "prickle", title: "Monday Sprint", startTime: "2026-11-02T15:00:00Z" }));
    const prickle = render(<HubLinkCard unfurl={unfurl({ url: "https://hub.example.test/prickles/prkl_AAAAAAAAAAA1", link: { kind: "prickle", prickleId: "prkl_AAAAAAAAAAA1" } })} timeZone="UTC" />);
    expect(await screen.findByText("Monday Sprint")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the prickle" })).toHaveAttribute("href", "/prickles/prkl_AAAAAAAAAAA1");
    prickle.unmount();

    forgetHubCards();
    vi.stubGlobal("fetch", answer({ state: "member", name: "Fern Quillsby", photoUrl: null }));
    render(<HubLinkCard unfurl={unfurl({ url: "https://hub.example.test/members/mbr_AAAAAAAAAAA1", link: { kind: "member", memberId: "mbr_AAAAAAAAAAA1" } })} />);
    expect(await screen.findByText("Fern Quillsby")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View profile" })).toHaveAttribute("href", "/members/mbr_AAAAAAAAAAA1");
  });

  it("draws nothing when it can't be had, so the link in the text is all there is", async () => {
    for (const fetcher of [answer(null, 404), answer(null, 401), vi.fn(async () => Promise.reject(new Error("offline")))]) {
      forgetHubCards();
      vi.stubGlobal("fetch", fetcher);
      const { container, unmount } = render(<HubLinkCard unfurl={unfurl()} />);
      await waitFor(() => expect(screen.queryByTestId("hub-link-card-loading")).toBeNull());
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it("does not ask again for a card it was just told about, so a redraw does not blink it", async () => {
    const fetcher = answer(MESSAGE_CARD);
    vi.stubGlobal("fetch", fetcher);
    const first = render(<HubLinkCard unfurl={unfurl()} />);
    await screen.findByTestId("hub-link-card");
    first.unmount();
    render(<HubLinkCard unfurl={unfurl()} />);
    expect(screen.getByTestId("hub-link-card")).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  describe("the X", () => {
    it("is there for the author of the message, and removes the card under the key it was written with", async () => {
      vi.stubGlobal("fetch", answer(MESSAGE_CARD));
      render(<HubLinkCard unfurl={unfurl()} removable={{ channelId: CHANNEL, messageId: MESSAGE }} />);
      await screen.findByTestId("hub-link-card");
      screen.getByRole("button", { name: "Remove preview" }).click();
      await waitFor(() => expect(hideChatUnfurl).toHaveBeenCalledWith(MESSAGE, `url:${ADDRESS}`));
      await waitFor(() => expect(track).toHaveBeenCalledWith("chat_unfurl_removed", { source: "hub", slack: "not_needed" }));
    });

    it("is not there for anyone else, and not in sudo (where no one is handed the right to remove)", async () => {
      vi.stubGlobal("fetch", answer(MESSAGE_CARD));
      render(<HubLinkCard unfurl={unfurl()} />);
      await screen.findByTestId("hub-link-card");
      expect(screen.queryByRole("button", { name: "Remove preview" })).toBeNull();
    });
  });
});

describe("MessageUnfurls with a Hub card", () => {
  it("draws it, and hands the author's right to remove it on", async () => {
    vi.stubGlobal("fetch", answer({ state: "stub" }));
    render(<MessageUnfurls unfurls={[unfurl()]} ctx={ctx} permalink={null} removable={{ channelId: CHANNEL, messageId: MESSAGE }} />);
    expect(await screen.findByText("Link to the Hub")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove preview" })).toBeInTheDocument();
  });
});
