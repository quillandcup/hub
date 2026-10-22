// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatTextContext } from "@/components/chat/ChatText";
import type { ChatMessageView } from "@/lib/chat/load";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/(member)/chat/actions", () => ({ loadOlderChat: vi.fn(), toggleChatReaction: vi.fn() }));
import { loadOlderChat } from "@/app/(member)/chat/actions";
import MessageList from "@/components/chat/MessageList";

const CTX: ChatTextContext = { userNames: {}, userMembers: {}, channelIds: {}, channelNames: {}, customEmoji: {} };
const view = (n: number, extra: Partial<ChatMessageView> = {}): ChatMessageView => ({
  id: `m${n}`,
  authorMemberId: "member-gale",
  authorName: "Gale Prickleton",
  authorPhotoUrl: null,
  replyAuthors: [],
  createdAt: new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString(),
  editedAt: null,
  body: `message ${n}`,
  contentState: "ok",
  hasFiles: false,
  files: [],
  replyCount: 0,
  lastReplyAt: null,
  reactions: [],
  syncStatus: null,
  mine: false,
  fromHub: false,
  system: false,
  ...extra,
});
const texts = () => screen.getAllByRole("article").map((a) => /message \d+|from the next page/.exec(a.textContent ?? "")![0]);

beforeEach(() => {
  vi.mocked(loadOlderChat).mockReset();
});

describe("MessageList", () => {
  it("shows the server's messages oldest first, with the line above the first unread one", () => {
    render(<MessageList channelId="c1" views={[view(1), view(2), view(3)]} ctx={CTX} olderBefore={null} firstUnreadId="m2" />);
    expect(texts()).toEqual(["message 1", "message 2", "message 3"]);
    const line = screen.getByRole("separator", { name: "New messages" });
    expect(line.nextElementSibling).toHaveTextContent("message 2");
    expect(screen.queryByRole("button", { name: /older/ })).not.toBeInTheDocument();
  });

  it("shows a notice Slack posted itself as a quiet line without an author", () => {
    render(
      <MessageList
        channelId="c1"
        views={[view(1, { system: true, body: "<@U1> has renamed the channel from \"a\" to \"b &amp; c\"", authorName: "Someone on Slack" })]}
        ctx={{ ...CTX, userNames: { U1: "Fern Quillsby" } }}
        olderBefore={null}
      />
    );
    const notice = screen.getByRole("article");
    expect(notice).toHaveTextContent('Fern Quillsby renamed the channel from "a" to "b & c"');
    expect(notice).not.toHaveTextContent("Someone on Slack");
  });

  it("loads older messages above, from the cursor, and stops offering them at the start", async () => {
    vi.mocked(loadOlderChat).mockResolvedValueOnce({ views: [view(0, { body: "from the next page" })], ctx: CTX, olderBefore: null });
    render(<MessageList channelId="c1" views={[view(1), view(2)]} ctx={CTX} olderBefore="2026-10-01T00:01:00.000Z" />);

    await userEvent.click(screen.getByRole("button", { name: "Load older messages" }));
    expect(loadOlderChat).toHaveBeenCalledWith("c1", "2026-10-01T00:01:00.000Z");
    expect(texts()).toEqual(["from the next page", "message 1", "message 2"]);
    expect(screen.queryByRole("button", { name: /older/ })).not.toBeInTheDocument();
  });

  it("uses the cursor of the page it loaded, not the server's, for the next one", async () => {
    vi.mocked(loadOlderChat)
      .mockResolvedValueOnce({ views: [view(0)], ctx: CTX, olderBefore: "2026-10-01T00:00:00.000Z" })
      .mockResolvedValueOnce({ views: [view(-1)], ctx: CTX, olderBefore: null });
    render(<MessageList channelId="c1" views={[view(1)]} ctx={CTX} olderBefore="2026-10-01T00:01:00.000Z" />);
    await userEvent.click(screen.getByRole("button", { name: "Load older messages" }));
    await userEvent.click(screen.getByRole("button", { name: "Load older messages" }));
    expect(vi.mocked(loadOlderChat).mock.calls.map((c) => c[1])).toEqual(["2026-10-01T00:01:00.000Z", "2026-10-01T00:00:00.000Z"]);
  });

  it("keeps the reader where they were when older messages are added above", async () => {
    vi.mocked(loadOlderChat).mockResolvedValueOnce({ views: [view(0, { body: "from the next page" })], ctx: CTX, olderBefore: null });
    const { container } = render(
      <main style={{ overflowY: "auto" }}>
        <MessageList channelId="c1" views={[view(1)]} ctx={CTX} olderBefore="2026-10-01T00:01:00.000Z" />
      </main>,
    );
    const scroller = container.querySelector("main")!;
    // jsdom has no layout: the page is 400px taller once the older message is in it.
    Object.defineProperty(scroller, "scrollHeight", {
      get: () => (scroller.textContent?.includes("from the next page") ? 1400 : 1000),
      configurable: true,
    });
    Object.defineProperty(scroller, "scrollTop", { value: 20, writable: true, configurable: true });

    await userEvent.click(screen.getByRole("button", { name: "Load older messages" }));
    expect(scroller.scrollTop).toBe(420);
  });

  it("keeps messages that fall off the top of the server's window when it moves forward, and applies edits", () => {
    const { rerender } = render(<MessageList channelId="c1" views={[view(1), view(2), view(3)]} ctx={CTX} olderBefore="2026-10-01T00:01:00.000Z" />);
    rerender(
      <MessageList channelId="c1" views={[view(2, { body: "message 2 (edited)", editedAt: "2026-10-02T00:00:00.000Z" }), view(3), view(4)]} ctx={CTX} olderBefore="2026-10-01T00:02:00.000Z" />,
    );
    expect(texts()).toEqual(["message 1", "message 2", "message 3", "message 4"]);
    expect(screen.getByText(/message 2 \(edited\)/)).toBeInTheDocument();
  });

  it("says so when the page fails to load, and tries again from the same cursor", async () => {
    vi.mocked(loadOlderChat).mockResolvedValueOnce(null).mockResolvedValueOnce({ views: [view(0)], ctx: CTX, olderBefore: null });
    render(<MessageList channelId="c1" views={[view(1)]} ctx={CTX} olderBefore="2026-10-01T00:01:00.000Z" />);
    await userEvent.click(screen.getByRole("button", { name: "Load older messages" }));
    expect(screen.getByRole("button", { name: /Couldn't load older messages/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Couldn't load older messages/ }));
    expect(texts()).toEqual(["message 0", "message 1"]);
    expect(vi.mocked(loadOlderChat).mock.calls.map((c) => c[1])).toEqual(["2026-10-01T00:01:00.000Z", "2026-10-01T00:01:00.000Z"]);
  });

  it("loads the next page by itself when the top comes into view", async () => {
    let onVisible: (entries: { isIntersecting: boolean }[]) => void = () => {};
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: typeof onVisible) {
          onVisible = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.mocked(loadOlderChat).mockResolvedValue({ views: [view(0)], ctx: CTX, olderBefore: null });
    render(<MessageList channelId="c1" views={[view(1)]} ctx={CTX} olderBefore="2026-10-01T00:01:00.000Z" />);
    await act(async () => onVisible([{ isIntersecting: false }]));
    expect(loadOlderChat).not.toHaveBeenCalled();
    await act(async () => onVisible([{ isIntersecting: true }]));
    expect(loadOlderChat).toHaveBeenCalledTimes(1);
    expect(texts()).toEqual(["message 0", "message 1"]);
    vi.unstubAllGlobals();
  });
});

describe("MessageList days and hover", () => {
  const at = (iso: string, n: number, extra: Partial<ChatMessageView> = {}) => view(n, { createdAt: iso, ...extra });

  it("puts a day marker before each day's messages, in the reader's time zone", () => {
    const views = [at("2026-10-08T03:30:00Z", 1), at("2026-10-08T05:00:00Z", 2)];
    const { unmount } = render(<MessageList channelId="c1" views={views} ctx={CTX} olderBefore={null} timeZone="America/New_York" />);
    expect(screen.getAllByRole("separator").map((s) => s.getAttribute("aria-label"))).toEqual(["Wednesday, October 7th", "Thursday, October 8th"]);
    unmount();
    render(<MessageList channelId="c1" views={views} ctx={CTX} olderBefore={null} timeZone="UTC" />);
    expect(screen.getAllByRole("separator").map((s) => s.getAttribute("aria-label"))).toEqual(["Thursday, October 8th"]);
  });

  it("shows times in the reader's zone and a follow-up without its own name", () => {
    render(<MessageList channelId="c1" views={[at("2026-10-07T14:00:00Z", 1), at("2026-10-07T14:01:00Z", 2)]} ctx={CTX} olderBefore={null} timeZone="Asia/Tokyo" />);
    expect(screen.getAllByText("Gale Prickleton")).toHaveLength(1);
    expect(screen.getByText("11:00 PM")).toBeInTheDocument();
    expect(screen.getByText("11:01")).toBeInTheDocument();
  });

  it("offers reply in thread and copy actions on a message", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<MessageList channelId="c1" views={[view(1)]} ctx={CTX} olderBefore={null} />);
    expect(screen.getByRole("link", { name: "Reply in thread" })).toHaveAttribute("href", "/chat/c1?thread=m1");
    expect(screen.queryByRole("button", { name: "Add reaction…" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Copy message" }));
    expect(writeText).toHaveBeenCalledWith("message 1");
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Copy link" }));
    expect(writeText).toHaveBeenLastCalledWith(`${window.location.origin}/chat/c1#m-m1`);
  });

  it("reacts from the hover bar when the viewer can react", async () => {
    const { toggleChatReaction } = await import("@/app/(member)/chat/actions");
    vi.mocked(toggleChatReaction).mockResolvedValue({ ok: true, active: true });
    render(<MessageList channelId="c1" views={[view(1)]} ctx={CTX} olderBefore={null} canReact />);
    await userEvent.click(screen.getByRole("button", { name: "Add reaction…" }));
    await userEvent.click(screen.getByRole("button", { name: "React with :tada:" }));
    expect(toggleChatReaction).toHaveBeenCalledWith("m1", "tada");
  });
});

describe("MessageList linked message", () => {
  it("loads older pages until the message named in the #hash is on the page, then scrolls to it", async () => {
    const scrollIntoViewTop = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
    window.location.hash = "#m-target";
    vi.mocked(loadOlderChat)
      .mockResolvedValueOnce({ views: [view(0, { id: "other" })], ctx: CTX, olderBefore: "2026-09-30T00:00:00.000Z" })
      .mockResolvedValueOnce({ views: [view(-1, { id: "target", body: "the one" })], ctx: CTX, olderBefore: "2026-09-29T00:00:00.000Z" });
    render(<MessageList channelId="c1" views={[view(1)]} ctx={CTX} olderBefore="2026-10-01T00:00:00.000Z" />);
    await screen.findByText("the one");
    expect(loadOlderChat).toHaveBeenCalledTimes(2);
    expect(scrollIntoViewTop).toHaveBeenCalled();
    scrollIntoViewTop.mockRestore();
    window.location.hash = "";
  });

  it("stops looking when the older pages run out", async () => {
    window.location.hash = "#m-missing";
    vi.mocked(loadOlderChat).mockResolvedValueOnce({ views: [view(0, { id: "other" })], ctx: CTX, olderBefore: null });
    render(<MessageList channelId="c1" views={[view(1)]} ctx={CTX} olderBefore="2026-10-01T00:00:00.000Z" />);
    await screen.findByText("message 0");
    expect(loadOlderChat).toHaveBeenCalledTimes(1);
    window.location.hash = "";
  });
});
