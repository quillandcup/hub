// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatTextContext } from "@/components/chat/ChatText";
import type { ChatMessageView } from "@/lib/chat/load";

vi.mock("@/app/(member)/chat/actions", () => ({ loadOlderChat: vi.fn() }));
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
  replyCount: 0,
  lastReplyAt: null,
  reactions: [],
  syncStatus: null,
  mine: false,
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
