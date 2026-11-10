// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/app/actions/member-hover-card", () => ({ getMemberHoverCard: vi.fn() }));
vi.mock("@/lib/analytics/client", () => ({ track: vi.fn() }));
import SharedMessageCard from "@/components/chat/SharedMessageCard";
import { parseSharedMessage, sharedMessageSource } from "@/lib/chat/shared-message";

afterEach(cleanup);

const ctx = { userNames: { U1: "Pat" }, userMembers: {}, channelIds: {}, channelNames: {}, customEmoji: {} };
const shared = parseSharedMessage({
  is_share: true,
  author_name: "Tea & <Cake> Ada",
  text: "Fish &amp; chips &lt;b&gt; for <@U1>",
  ts: "1700000000.000100",
  channel_name: "tea-room",
  from_url: "https://example.slack.com/archives/C1/p1",
  files: [{ name: "menu.pdf" }],
})!;
const readable = sharedMessageSource(shared, { state: "readable", channelId: "hub-tea", messageId: "msg_AAAAAAAAAAA1", deleted: false });

describe("SharedMessageCard", () => {
  it("shows author, decoded text, mention names, time, channel and a Hub link", () => {
    render(<SharedMessageCard shared={shared} source={readable} ctx={ctx} />);
    expect(screen.getByText("Tea & <Cake> Ada")).toBeTruthy();
    const text = screen.getByTestId("shared-message-card").textContent;
    expect(text).toContain("Fish & chips <b> for");
    expect(text).toContain("Pat");
    expect(text).not.toContain("&amp;");
    expect(text).toContain("Posted in #tea-room");
    expect(screen.getByText("Attached: menu.pdf")).toBeTruthy();
    expect(document.querySelector("time")?.getAttribute("datetime")).toBe("2023-11-14T22:13:20.000Z");
    expect(screen.getByRole("link", { name: "View in Chat" }).getAttribute("href")).toBe("/chat/hub-tea?m=msg_AAAAAAAAAAA1");
  });

  it("says a deleted source was deleted and shows no text", () => {
    const src = sharedMessageSource(shared, { state: "readable", channelId: "c", messageId: "m", deleted: true });
    render(<SharedMessageCard shared={shared} source={src} ctx={ctx} />);
    expect(screen.getByText("This message was deleted.")).toBeTruthy();
    expect(screen.queryByText(/Fish/)).toBeNull();
  });

  it("shows only a stub for a private source: no text, author or channel", () => {
    const { container } = render(<SharedMessageCard shared={shared} source={sharedMessageSource(shared, { state: "hidden" })} ctx={ctx} />);
    expect(screen.getByText("A message from a private conversation.")).toBeTruthy();
    expect(container.textContent).not.toMatch(/Fish|Ada|tea-room|menu\.pdf/);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("offers Open in Slack, and no content, when the Hub has no copy", () => {
    const { container } = render(<SharedMessageCard shared={shared} source={sharedMessageSource(shared, { state: "not_mirrored" })} ctx={ctx} />);
    expect(container.textContent).not.toMatch(/Fish|Ada|tea-room/);
    const a = screen.getByRole("link", { name: "Open in Slack" });
    expect(a.getAttribute("href")).toBe("https://example.slack.com/archives/C1/p1");
    expect(a.getAttribute("rel")).toContain("noopener");
  });
});
