// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const { refresh, track, hideChatUnfurl, pokeChat } = vi.hoisted(() => ({ refresh: vi.fn(), track: vi.fn(), hideChatUnfurl: vi.fn(), pokeChat: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/analytics/client", () => ({ track }));
vi.mock("@/app/(member)/chat/actions", () => ({ hideChatUnfurl }));
vi.mock("@/lib/chat/list-events", async (orig) => ({ ...(await orig<typeof import("@/lib/chat/list-events")>()), pokeChat }));

import MessageUnfurls from "@/components/chat/MessageUnfurls";
import type { ChatTextContext } from "@/components/chat/ChatText";
import { previewToCard } from "@/lib/chat/link-preview-cards";
import { withLinkPreviews } from "@/lib/chat/link-preview-cards";
import { parseUnfurls } from "@/lib/chat/unfurls";

const ctx: ChatTextContext = { userNames: {}, userMembers: {}, channelIds: {}, channelNames: {}, customEmoji: {} };
const MESSAGE = "msg_AAAAAAAAAAA9";
const CHANNEL = "chn_AAAAAAAAAAA1";

const hubCard = () =>
  withLinkPreviews([], [{ messageId: MESSAGE, position: 0, url: "https://example.test/post", finalUrl: "https://example.test/post", kind: "link", status: "ok", title: "Tom & <Jerry>", description: "*not bold* & <b>plain</b>", siteName: "Example & Sons", imageUrl: "https://example.test/c.png", fetchedAt: "2026-10-01T00:00:00Z" }]);

beforeEach(() => {
  refresh.mockReset();
  track.mockReset();
  pokeChat.mockReset().mockReturnValue(false);
  hideChatUnfurl.mockReset().mockResolvedValue({ ok: true });
});

describe("a link preview the Hub made", () => {
  it("draws names with & and < as text, the description as plain text and a linked picture", () => {
    const { container } = render(<MessageUnfurls unfurls={hubCard()} ctx={ctx} permalink={null} />);

    expect(screen.getByRole("link", { name: "Tom & <Jerry>" })).toHaveAttribute("href", "https://example.test/post");
    expect(screen.getByText("Example & Sons")).toBeInTheDocument();
    // Plain text: no bold, and the markup in it stays visible as text.
    expect(screen.getByText("*not bold* & <b>plain</b>")).toBeInTheDocument();
    expect(container.querySelector("b, strong")).toBeNull();
    expect(container.querySelector("a img")).toHaveAttribute("src", "https://example.test/c.png");
    expect(container.querySelector('a[data-track="chat-link-preview"]')).not.toBeNull();
  });

  it("draws a picture card for a link straight to a picture", () => {
    const card = previewToCard({ messageId: MESSAGE, position: 0, url: "https://example.test/a.jpg", finalUrl: "https://example.test/a.jpg", kind: "image", status: "ok", title: null, description: null, siteName: null, imageUrl: "https://example.test/a.jpg", fetchedAt: "2026-10-01T00:00:00Z" })!;
    const { container } = render(<MessageUnfurls unfurls={[card]} ctx={ctx} permalink={null} />);
    expect(container.querySelector('a[href="https://example.test/a.jpg"] img')).not.toBeNull();
  });
});

describe("the X on a card", () => {
  it("is not there unless the viewer is the author", () => {
    render(<MessageUnfurls unfurls={hubCard()} ctx={ctx} permalink={null} />);
    expect(screen.queryByRole("button", { name: "Remove preview" })).toBeNull();
  });

  it("is a labelled button on the card of the author's message, shown on hover, focus and touch", () => {
    render(<MessageUnfurls unfurls={hubCard()} ctx={ctx} permalink={null} removable={{ channelId: CHANNEL, messageId: MESSAGE }} />);
    const button = screen.getByRole("button", { name: "Remove preview" });
    expect(button.className).toContain("group-hover:opacity-100");
    expect(button.className).toContain("focus-visible:opacity-100");
    expect(button.className).toContain("[@media(hover:none)]:opacity-100");
    expect(screen.getByTestId("unfurl-card").className).toContain("group");
    button.focus();
    expect(button).toHaveFocus();
  });

  it("removes with one click, records that it happened without the address, and refreshes the chat", async () => {
    render(<MessageUnfurls unfurls={hubCard()} ctx={ctx} permalink={null} removable={{ channelId: CHANNEL, messageId: MESSAGE }} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove preview" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(hideChatUnfurl).toHaveBeenCalledWith(MESSAGE, "url:https://example.test/post");
    expect(track).toHaveBeenCalledWith("chat_unfurl_removed", { source: "hub" });
    expect(JSON.stringify(track.mock.calls)).not.toContain("example.test");
  });

  it("is on one of Slack's unfurls too, reported as such", async () => {
    const slack = withLinkPreviews(parseUnfurls({ attachments: [{ title: "From Slack", title_link: "https://slack-card.example.test/" }] }, { bot: false, body: "x" }).unfurls, undefined);
    render(<MessageUnfurls unfurls={slack} ctx={ctx} permalink={null} removable={{ channelId: CHANNEL, messageId: MESSAGE }} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove preview" }));

    await waitFor(() => expect(hideChatUnfurl).toHaveBeenCalledWith(MESSAGE, "url:https://slack-card.example.test/"));
    expect(track).toHaveBeenCalledWith("chat_unfurl_removed", { source: "slack" });
  });

  it("shows why it failed and records nothing", async () => {
    hideChatUnfurl.mockResolvedValue({ ok: false, error: "That preview can't be removed." });
    render(<MessageUnfurls unfurls={hubCard()} ctx={ctx} permalink={null} removable={{ channelId: CHANNEL, messageId: MESSAGE }} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove preview" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That preview can't be removed.");
    expect(track).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("uses the chat's own refresh when it can, and survives the action throwing", async () => {
    pokeChat.mockReturnValue(true);
    render(<MessageUnfurls unfurls={hubCard()} ctx={ctx} permalink={null} removable={{ channelId: CHANNEL, messageId: MESSAGE }} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove preview" }));
    await waitFor(() => expect(pokeChat).toHaveBeenCalledWith(CHANNEL));
    expect(refresh).not.toHaveBeenCalled();

    hideChatUnfurl.mockRejectedValue(new Error("network"));
    fireEvent.click(screen.getByRole("button", { name: "Remove preview" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("is not offered on an app's blocks, which are the message itself", () => {
    const blocks = withLinkPreviews(parseUnfurls({ blocks: [{ type: "header", text: { type: "plain_text", text: "Deploy" } }] }, { bot: true, body: "" }).unfurls, undefined);
    render(<MessageUnfurls unfurls={blocks} ctx={ctx} permalink={null} removable={{ channelId: CHANNEL, messageId: MESSAGE }} />);
    expect(screen.queryByRole("button", { name: "Remove preview" })).toBeNull();
  });
});
