// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelSummary } from "@/lib/chat/load";

let pathname = "/chat";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

// Shows what the sidebar asked the router to prefetch.
vi.mock("next/link", () => ({
  default: ({ prefetch, children, ...props }: { prefetch?: boolean; children: React.ReactNode } & Record<string, unknown>) => (
    <a {...props} data-prefetch={String(prefetch)}>
      {children}
    </a>
  ),
}));

type Row = Record<string, unknown>;
let onInsert: (payload: { new: Row }) => void = () => {};
let onUpdate: (payload: { new: Row }) => void = () => {};
const loadCounts = vi.hoisted(() => vi.fn());
vi.mock("@/lib/chat/load", () => ({ loadUnreadCounts: loadCounts }));
const subscribe = vi.fn();
const realtime: { on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> } = {
  on: vi.fn((_t: string, f: { event: string }, cb: (p: { new: Row }) => void) => {
    if (f.event === "UPDATE") onUpdate = cb;
    else onInsert = cb;
    return realtime;
  }),
  subscribe: vi.fn(() => {
    subscribe();
    return realtime;
  }),
};
vi.mock("@/lib/chat/live", () => ({ authenticateRealtime: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ channel: () => realtime, removeChannel: vi.fn() }) }));

const syncRead = vi.hoisted(() => vi.fn());
vi.mock("@/app/(member)/chat/actions", () => ({ syncChatReadFromSlack: syncRead }));

import ChatSidebar from "@/components/chat/ChatSidebar";

const channel = (id: string, label: string, extra: Partial<ChannelSummary> = {}): ChannelSummary => ({
  id,
  kind: "channel",
  label,
  visibility: "public",
  restricted: false,
  archived: false,
  joined: true,
  slackChannelId: null,
  ...extra,
});

const CHANNELS = [
  channel("1", "#general"),
  channel("2", "#writing-sprints"),
  channel("3", "#old-news", { archived: true }),
  channel("4", "Gale, Fern", { kind: "group_dm" }),
];

beforeEach(() => {
  pathname = "/chat";
  subscribe.mockClear();
  loadCounts.mockReset();
  syncRead.mockReset();
  syncRead.mockResolvedValue(null);
});

const ME = "member-me";
const insert = (extra: Row = {}) => ({ new: { channel_id: "1", thread_root_id: null, author_member_id: "member-gale", deleted_at: null, ...extra } });
const flush = () => act(async () => {});
const links = () => screen.getAllByRole("link").map((a) => a.textContent);

describe("ChatSidebar", () => {
  it("has a channel finder that is not the message search", () => {
    render(<ChatSidebar channels={CHANNELS} />);
    expect(screen.getByRole("searchbox", { name: "Search messages" }).closest("form")).toHaveAttribute("action", "/chat/search");
    expect(screen.getByRole("searchbox", { name: "Find a channel" }).closest("form")).toBeNull();
  });

  it("narrows every section as you type, ignoring case and a leading #", async () => {
    render(<ChatSidebar channels={CHANNELS} />);
    expect(links()).toHaveLength(4);

    await userEvent.type(screen.getByRole("searchbox", { name: "Find a channel" }), "#WRIT");
    expect(links()).toEqual(["#writing-sprints"]);
    expect(screen.queryByText("Archived")).not.toBeInTheDocument();

    await userEvent.clear(screen.getByRole("searchbox", { name: "Find a channel" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Find a channel" }), "news");
    expect(links()).toEqual(["#old-news"]);
  });

  it("says so when nothing matches, and leaves the message search alone", async () => {
    render(<ChatSidebar channels={CHANNELS} />);
    await userEvent.type(screen.getByRole("searchbox", { name: "Find a channel" }), "zzz");
    expect(screen.getByText("No channels match.")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search messages" })).toHaveValue("");
  });

  describe("unread", () => {
    it("bolds and badges conversations with unread messages, capping the number at 99+", () => {
      render(<ChatSidebar channels={CHANNELS} unread={{ "1": 3, "2": 100 }} selfMemberId={ME} />);
      expect(screen.getByRole("link", { name: "#general, 3 unread" })).toHaveTextContent("3");
      expect(screen.getByRole("link", { name: "#writing-sprints, 99+ unread" })).toHaveTextContent("99+");
      expect(screen.getByRole("link", { name: "#general, 3 unread" })).toHaveClass("font-semibold");
      expect(screen.getByRole("link", { name: "Gale, Fern" })).not.toHaveClass("font-semibold");
    });

    it("remembers the open conversation in a cookie, and not the list", async () => {
      document.cookie = "chat_last_channel=; max-age=0; path=/";
      pathname = "/chat";
      const { rerender } = render(<ChatSidebar channels={CHANNELS} selfMemberId={ME} />);
      expect(document.cookie).not.toContain("chat_last_channel=1");
      pathname = "/chat/2";
      rerender(<ChatSidebar channels={CHANNELS} selfMemberId={ME} />);
      expect(document.cookie).toContain("chat_last_channel=2");
    });

    it("shows no count on the conversation that is open, and clears one when it is opened", async () => {
      pathname = "/chat/1";
      const { rerender } = render(<ChatSidebar channels={CHANNELS} unread={{ "1": 3, "2": 4 }} selfMemberId={ME} />);
      expect(screen.getByRole("link", { name: "#general" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "#writing-sprints, 4 unread" })).toBeInTheDocument();

      pathname = "/chat/2";
      rerender(<ChatSidebar channels={CHANNELS} unread={{ "1": 3, "2": 4 }} selfMemberId={ME} />);
      expect(screen.getByRole("link", { name: "#writing-sprints" })).toBeInTheDocument();
      // Leaving a conversation marks it read too, so its stale count from the page load stays gone.
      expect(screen.getByRole("link", { name: "#general" })).toBeInTheDocument();
    });

    it("counts a message as it arrives in another conversation, but not your own, replies, deleted ones, the open one or ones you are not in", async () => {
      pathname = "/chat/2";
      render(<ChatSidebar channels={[...CHANNELS, channel("5", "#lurking", { joined: false })]} unread={{}} selfMemberId={ME} />);
      await flush();

      act(() => onInsert(insert()));
      act(() => onInsert(insert()));
      expect(screen.getByRole("link", { name: "#general, 2 unread" })).toBeInTheDocument();

      act(() => onInsert(insert({ author_member_id: ME })));
      act(() => onInsert(insert({ thread_root_id: "m1" })));
      act(() => onInsert(insert({ deleted_at: "2026-10-10T00:00:00Z" })));
      act(() => onInsert(insert({ channel_id: "2" })));
      act(() => onInsert(insert({ channel_id: "5" })));
      act(() => onInsert(insert({ channel_id: "3" })));
      expect(screen.getByRole("link", { name: "#general, 2 unread" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "#writing-sprints" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "#lurking" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "#old-news" })).toBeInTheDocument();
    });

    it("starts over from the server's numbers when they change, as after a refresh", async () => {
      const { rerender } = render(<ChatSidebar channels={CHANNELS} unread={{}} selfMemberId={ME} />);
      await flush();
      act(() => onInsert(insert()));
      expect(screen.getByRole("link", { name: "#general, 1 unread" })).toBeInTheDocument();

      rerender(<ChatSidebar channels={CHANNELS} unread={{ "1": 5 }} selfMemberId={ME} />);
      expect(screen.getByRole("link", { name: "#general, 5 unread" })).toBeInTheDocument();
    });

    describe("a message deleted after it was counted", () => {
      const del = (extra: Row = {}) => ({ new: { channel_id: "1", thread_root_id: null, author_member_id: "member-gale", deleted_at: "2026-10-10T00:00:00Z", ...extra } });
      const settle = () =>
        act(async () => {
          await vi.advanceTimersByTimeAsync(400);
        });
      beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
      afterEach(() => vi.useRealTimers());

      it("takes the server's count once, however many events arrive", async () => {
        pathname = "/chat/2";
        loadCounts.mockResolvedValue({ "1": 1 });
        render(<ChatSidebar channels={CHANNELS} unread={{ "1": 2 }} selfMemberId={ME} />);
        await flush();
        act(() => onUpdate(del()));
        act(() => onUpdate(del()));
        await settle();
        expect(loadCounts).toHaveBeenCalledTimes(1);
        expect(screen.getByRole("link", { name: "#general, 1 unread" })).toBeInTheDocument();
        act(() => onUpdate(del()));
        await settle();
        expect(screen.getByRole("link", { name: "#general, 1 unread" })).toBeInTheDocument();
      });

      it("drops the badge when the last unread message goes", async () => {
        loadCounts.mockResolvedValue({});
        render(<ChatSidebar channels={CHANNELS} unread={{ "1": 1 }} selfMemberId={ME} />);
        await flush();
        act(() => onUpdate(del()));
        await settle();
        expect(screen.getByRole("link", { name: "#general" })).toBeInTheDocument();
      });

      it("leaves the count alone when the deleted message was already read", async () => {
        loadCounts.mockResolvedValue({ "1": 2 });
        render(<ChatSidebar channels={CHANNELS} unread={{ "1": 2 }} selfMemberId={ME} />);
        await flush();
        act(() => onUpdate(del()));
        await settle();
        expect(screen.getByRole("link", { name: "#general, 2 unread" })).toBeInTheDocument();
      });

      it("ignores edits, your own, replies, the open conversation and ones you are not in", async () => {
        pathname = "/chat/2";
        render(<ChatSidebar channels={[...CHANNELS, channel("5", "#lurking", { joined: false })]} unread={{ "1": 2 }} selfMemberId={ME} />);
        await flush();
        act(() => onUpdate(del({ deleted_at: null })));
        act(() => onUpdate(del({ author_member_id: ME })));
        act(() => onUpdate(del({ thread_root_id: "m1" })));
        act(() => onUpdate(del({ channel_id: "2" })));
        act(() => onUpdate(del({ channel_id: "5" })));
        await settle();
        expect(loadCounts).not.toHaveBeenCalled();
        expect(screen.getByRole("link", { name: "#general, 2 unread" })).toBeInTheDocument();
      });

      it("keeps its numbers if the recount fails, and skips a conversation opened meanwhile", async () => {
        loadCounts.mockRejectedValueOnce(new Error("offline"));
        const { rerender } = render(<ChatSidebar channels={CHANNELS} unread={{ "1": 2 }} selfMemberId={ME} />);
        await flush();
        act(() => onUpdate(del()));
        await settle();
        expect(screen.getByRole("link", { name: "#general, 2 unread" })).toBeInTheDocument();

        loadCounts.mockResolvedValue({ "1": 1 });
        act(() => onUpdate(del()));
        pathname = "/chat/1";
        rerender(<ChatSidebar channels={CHANNELS} unread={{ "1": 2 }} selfMemberId={ME} />);
        await settle();
        expect(screen.getByRole("link", { name: "#general" })).toBeInTheDocument();
      });
    });

    it("does not listen at all in sudo", async () => {
      render(<ChatSidebar channels={CHANNELS} unread={{}} selfMemberId={null} />);
      await flush();
      expect(subscribe).not.toHaveBeenCalled();
    });
  });

  describe("read state shared with Slack", () => {
    it("catches up with Slack on open and takes the fresh counts it answers with", async () => {
      pathname = "/chat/2";
      syncRead.mockResolvedValue({ "1": 1 });
      render(<ChatSidebar channels={CHANNELS} unread={{ "1": 4 }} selfMemberId={ME} />);
      await flush();
      expect(syncRead).toHaveBeenCalledWith("2");
      expect(screen.getByRole("link", { name: "#general, 1 unread" })).toBeInTheDocument();
    });

    it("keeps its numbers when the server had nothing to pull, and asks again when the window regains focus", async () => {
      render(<ChatSidebar channels={CHANNELS} unread={{ "1": 4 }} selfMemberId={ME} />);
      await flush();
      expect(syncRead).toHaveBeenCalledWith(null);
      expect(screen.getByRole("link", { name: "#general, 4 unread" })).toBeInTheDocument();

      syncRead.mockResolvedValue({});
      act(() => void window.dispatchEvent(new Event("focus")));
      await flush();
      expect(syncRead).toHaveBeenCalledTimes(2);
      expect(screen.getByRole("link", { name: "#general" })).toBeInTheDocument();
    });

    it("does not ask in sudo", async () => {
      render(<ChatSidebar channels={CHANNELS} unread={{}} selfMemberId={null} />);
      await flush();
      expect(syncRead).not.toHaveBeenCalled();
    });
  });
});

describe("ChatSidebar prefetching", () => {
  const prefetchOf = (name: string) => screen.getByRole("link", { name }).getAttribute("data-prefetch");

  it("prefetches a conversation in full only once it is hovered, focused or touched", async () => {
    render(<ChatSidebar channels={CHANNELS} />);
    expect(prefetchOf("#general")).toBe("undefined");
    await userEvent.hover(screen.getByRole("link", { name: "#general" }));
    expect(prefetchOf("#general")).toBe("true");
    expect(prefetchOf("#writing-sprints")).toBe("undefined");
    await act(async () => screen.getByRole("link", { name: "#writing-sprints" }).focus());
    expect(prefetchOf("#writing-sprints")).toBe("true");
  });

  it("prefetches conversations with unread messages up front, but not the open one and not more than five", () => {
    pathname = "/chat/1";
    const many = Array.from({ length: 8 }, (_, i) => channel(String(i + 1), `#c${i + 1}`));
    render(<ChatSidebar channels={many} unread={Object.fromEntries(many.map((c) => [c.id, 3]))} />);
    const flags = many.map((c) => document.querySelector(`a[href="/chat/${c.id}"]`)?.getAttribute("data-prefetch"));
    expect(flags[0]).toBe("undefined");
    expect(flags.filter((f) => f === "true")).toHaveLength(5);
  });
});

describe("ChatSidebar privacy link", () => {
  it("links to the privacy page only when it is on for the member", () => {
    render(<ChatSidebar channels={CHANNELS} />);
    expect(screen.queryByRole("link", { name: "Who can see this?" })).not.toBeInTheDocument();
  });

  it("shows it under the conversations when it is", () => {
    render(<ChatSidebar channels={CHANNELS} showPrivacy />);
    expect(screen.getByRole("link", { name: "Who can see this?" })).toHaveAttribute("href", "/privacy");
  });
});
