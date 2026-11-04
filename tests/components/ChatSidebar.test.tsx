// @vitest-environment jsdom
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelSummary } from "@/lib/chat/load";

let pathname = "/chat";
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ usePathname: () => pathname, useRouter: () => ({ refresh }) }));

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
  refresh.mockReset();
  syncRead.mockReset();
  syncRead.mockResolvedValue(null);
});

const ME = "member-me";
const insert = (extra: Row = {}) => ({ new: { channel_id: "1", thread_root_id: null, author_member_id: "member-gale", deleted_at: null, ...extra } });
const flush = () => act(async () => {});
// The conversation links; the privacy link under them is not one.
const links = () => screen.getAllByRole("link").map((a) => a.textContent).filter((text) => text !== "Who can see this?");

describe("ChatSidebar", () => {
  it("has a channel finder that is not the message search", () => {
    render(<ChatSidebar channels={CHANNELS} />);
    expect(screen.getByRole("searchbox", { name: "Search messages" }).closest("form")).toHaveAttribute("action", "/chat/search");
    expect(screen.getByRole("searchbox", { name: "Find a channel" }).closest("form")).toBeNull();
  });

  it("narrows every section as you type, ignoring case and a leading #", async () => {
    render(<ChatSidebar channels={CHANNELS} />);
    expect(links()).toHaveLength(3);

    await userEvent.type(screen.getByRole("searchbox", { name: "Find a channel" }), "#WRIT");
    expect(links()).toEqual(["#writing-sprints"]);

    await userEvent.clear(screen.getByRole("searchbox", { name: "Find a channel" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Find a channel" }), "gale");
    expect(links()).toEqual(["Gale, Fern"]);
  });

  it("takes the whole height on the list screen, so the empty pane beside it can't halve it", () => {
    render(<ChatSidebar channels={CHANNELS} />);
    const nav = screen.getByRole("navigation", { name: "Conversations" });
    expect(nav).toHaveClass("basis-full", "grow");
    expect(nav).not.toHaveClass("flex-1");
  });

  it("is hidden on a narrow screen while a conversation is open", () => {
    pathname = "/chat/1";
    render(<ChatSidebar channels={CHANNELS} />);
    expect(screen.getByRole("navigation", { name: "Conversations" })).toHaveClass("hidden");
  });

  it("lists only the conversations you are in, with no archived section", () => {
    render(<ChatSidebar channels={[...CHANNELS, channel("5", "#lurking", { joined: false })]} />);
    expect(links()).toEqual(["#general", "#writing-sprints", "Gale, Fern"]);
    expect(screen.queryByText("Archived")).not.toBeInTheDocument();
  });

  it("opens the channels you could join in a panel under the icon, not further down the list", async () => {
    const all = [
      ...CHANNELS,
      channel("5", "#lurking", { joined: false }),
      channel("6", "#secret", { joined: false, visibility: "private" }),
      channel("7", "#gone", { joined: false, archived: true }),
    ];
    render(<ChatSidebar channels={all} />);
    const browse = screen.getByRole("button", { name: "Browse channels" });
    expect(screen.getByRole("heading", { name: "Channels" }).parentElement).toContainElement(browse);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await userEvent.click(browse);
    const panel = screen.getByRole("dialog", { name: "Channels you can join" });
    expect(browse).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("heading", { name: "Channels" }).parentElement).toContainElement(panel);
    const names = within(panel).getAllByRole("link").map((a) => a.textContent);
    expect(names).toEqual(["#lurking"]);
    expect(within(panel).getByRole("link", { name: "#lurking" })).toHaveAttribute("href", "/chat/5");

    await userEvent.type(within(panel).getByRole("searchbox", { name: "Find a channel to join" }), "zzz");
    expect(within(panel).getByText("No channels match.")).toBeInTheDocument();
  });

  it("closes the panel on Escape, a click outside, choosing a channel or the icon again", async () => {
    render(<ChatSidebar channels={[...CHANNELS, channel("5", "#lurking", { joined: false })]} />);
    const open = async () => {
      await userEvent.click(screen.getByRole("button", { name: "Browse channels" }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    };
    await open();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await open();
    await userEvent.click(screen.getByRole("searchbox", { name: "Search messages" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await open();
    await userEvent.click(screen.getByRole("link", { name: "#lurking" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Browse channels" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("still shows the Channels heading with Browse when the member has joined no channel", async () => {
    render(<ChatSidebar channels={[channel("5", "#lurking", { joined: false })]} />);
    expect(screen.getByRole("heading", { name: "Channels" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Browse channels" }));
    expect(within(screen.getByRole("dialog")).getByRole("link", { name: "#lurking" })).toBeInTheDocument();
  });

  it("offers no Browse button when there is nothing to join", () => {
    render(<ChatSidebar channels={CHANNELS} />);
    expect(screen.queryByRole("button", { name: "Browse channels" })).not.toBeInTheDocument();
  });

  it("shows a lock instead of the # on a private channel", () => {
    render(<ChatSidebar channels={[channel("7", "#founding", { visibility: "private" })]} />);
    const link = screen.getByRole("link", { name: /founding/ });
    expect(link).toHaveTextContent("founding");
    expect(link).not.toHaveTextContent("#");
    expect(screen.getByRole("img", { name: "Private channel" })).toBeInTheDocument();
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
      expect(screen.getByRole("link", { name: /^#general\s*3\s*unread$/ })).toHaveTextContent("3");
      expect(screen.getByRole("link", { name: /^#writing-sprints\s*99\+\s*unread$/ })).toHaveTextContent("99+");
      expect(screen.getByRole("link", { name: /^#general\s*3\s*unread$/ })).toHaveClass("font-semibold");
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
      expect(screen.getByRole("link", { name: /^#writing-sprints\s*4\s*unread$/ })).toBeInTheDocument();

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
      expect(screen.getByRole("link", { name: /^#general\s*2\s*unread$/ })).toBeInTheDocument();

      act(() => onInsert(insert({ author_member_id: ME })));
      act(() => onInsert(insert({ thread_root_id: "m1" })));
      act(() => onInsert(insert({ deleted_at: "2026-10-10T00:00:00Z" })));
      act(() => onInsert(insert({ channel_id: "2" })));
      act(() => onInsert(insert({ channel_id: "5" })));
      act(() => onInsert(insert({ channel_id: "3" })));
      expect(screen.getByRole("link", { name: /^#general\s*2\s*unread$/ })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "#writing-sprints" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "#lurking" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "#old-news" })).not.toBeInTheDocument();
    });

    it("starts over from the server's numbers when they change, as after a refresh", async () => {
      const { rerender } = render(<ChatSidebar channels={CHANNELS} unread={{}} selfMemberId={ME} />);
      await flush();
      act(() => onInsert(insert()));
      expect(screen.getByRole("link", { name: /^#general\s*1\s*unread$/ })).toBeInTheDocument();

      rerender(<ChatSidebar channels={CHANNELS} unread={{ "1": 5 }} selfMemberId={ME} />);
      expect(screen.getByRole("link", { name: /^#general\s*5\s*unread$/ })).toBeInTheDocument();
    });

    describe("a message in a conversation the list doesn't have", () => {
      // A Slack DM that has just come in: the layout doesn't re-run on client navigation, so the list is fetched again.
      const settle = () =>
        act(async () => {
          await vi.advanceTimersByTimeAsync(600);
        });
      beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
      afterEach(() => vi.useRealTimers());

      it("asks the server for the list once, however many messages arrive", async () => {
        render(<ChatSidebar channels={CHANNELS} selfMemberId={ME} />);
        await flush();
        onInsert(insert({ channel_id: "new-dm" }));
        onInsert(insert({ channel_id: "new-dm" }));
        onInsert(insert({ channel_id: "new-dm", author_member_id: ME }));
        expect(refresh).not.toHaveBeenCalled(); // a burst waits a moment
        await settle();
        expect(refresh).toHaveBeenCalledTimes(1);
        onInsert(insert({ channel_id: "new-dm" }));
        await settle();
        expect(refresh).toHaveBeenCalledTimes(1);
      });

      it("does not for a conversation on the list (joined or not), a reply, or a deleted message", async () => {
        render(<ChatSidebar channels={[...CHANNELS, channel("5", "#not-joined", { joined: false })]} selfMemberId={ME} />);
        await flush();
        onInsert(insert({ channel_id: "1" }));
        onInsert(insert({ channel_id: "5" }));
        onInsert(insert({ channel_id: "3" }));
        onInsert(insert({ channel_id: "new-dm", deleted_at: "2026-10-10T00:00:00Z" }));
        await settle();
        expect(refresh).not.toHaveBeenCalled();
      });

      it("asks again for another new conversation", async () => {
        render(<ChatSidebar channels={CHANNELS} selfMemberId={ME} />);
        await flush();
        onInsert(insert({ channel_id: "new-dm" }));
        await settle();
        onInsert(insert({ channel_id: "another-dm" }));
        await settle();
        expect(refresh).toHaveBeenCalledTimes(2);
      });
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
        expect(screen.getByRole("link", { name: /^#general\s*1\s*unread$/ })).toBeInTheDocument();
        act(() => onUpdate(del()));
        await settle();
        expect(screen.getByRole("link", { name: /^#general\s*1\s*unread$/ })).toBeInTheDocument();
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
        expect(screen.getByRole("link", { name: /^#general\s*2\s*unread$/ })).toBeInTheDocument();
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
        expect(screen.getByRole("link", { name: /^#general\s*2\s*unread$/ })).toBeInTheDocument();
      });

      it("keeps its numbers if the recount fails, and skips a conversation opened meanwhile", async () => {
        loadCounts.mockRejectedValueOnce(new Error("offline"));
        const { rerender } = render(<ChatSidebar channels={CHANNELS} unread={{ "1": 2 }} selfMemberId={ME} />);
        await flush();
        act(() => onUpdate(del()));
        await settle();
        expect(screen.getByRole("link", { name: /^#general\s*2\s*unread$/ })).toBeInTheDocument();

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
      expect(screen.getByRole("link", { name: /^#general\s*1\s*unread$/ })).toBeInTheDocument();
    });

    it("keeps its numbers when the server had nothing to pull, and asks again when the window regains focus", async () => {
      render(<ChatSidebar channels={CHANNELS} unread={{ "1": 4 }} selfMemberId={ME} />);
      await flush();
      expect(syncRead).toHaveBeenCalledWith(null);
      expect(screen.getByRole("link", { name: /^#general\s*4\s*unread$/ })).toBeInTheDocument();

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
  it("links to the privacy page under the conversations", () => {
    render(<ChatSidebar channels={CHANNELS} />);
    expect(screen.getByRole("link", { name: "Who can see this?" })).toHaveAttribute("href", "/privacy");
  });
});

describe("ChatSidebar drafts", () => {
  it("lists unsent messages, each opening where it was written, with mentions shown by name", () => {
    render(
      <ChatSidebar
        channels={CHANNELS}
        drafts={[
          { channelId: "2", threadRootId: null, body: "hello <@U1|Ania Ray>" },
          { channelId: "1", threadRootId: "msg_AAAAAAAAAAA1", body: "a reply" },
        ]}
      />,
    );
    const heading = screen.getByRole("heading", { name: "Drafts" });
    const section = within(heading.parentElement!);
    const [first, second] = section.getAllByRole("link");
    expect(first).toHaveAttribute("href", "/chat/2");
    expect(first).toHaveTextContent("writing-sprintshello @Ania Ray");
    expect(second).toHaveAttribute("href", "/chat/1?thread=msg_AAAAAAAAAAA1");
    expect(second).toHaveTextContent("general · threada reply");
  });

  it("says how many files a draft keeps, with or without text", () => {
    render(
      <ChatSidebar
        channels={CHANNELS}
        drafts={[
          { channelId: "2", threadRootId: null, body: "hello", fileCount: 2 },
          { channelId: "1", threadRootId: null, body: "", fileCount: 1 },
        ]}
      />,
    );
    const [first, second] = within(screen.getByRole("heading", { name: "Drafts" }).parentElement!).getAllByRole("link");
    expect(first).toHaveTextContent("writing-sprintshello · 2 files");
    expect(second).toHaveTextContent("general1 file");
  });

  it("shows no Drafts heading without drafts, or when their conversation is not in the list", () => {
    const { rerender } = render(<ChatSidebar channels={CHANNELS} />);
    expect(screen.queryByRole("heading", { name: "Drafts" })).toBeNull();
    rerender(<ChatSidebar channels={CHANNELS} drafts={[{ channelId: "gone", threadRootId: null, body: "x" }]} />);
    expect(screen.queryByRole("heading", { name: "Drafts" })).toBeNull();
  });
});

describe("ChatSidebar drafts follow the message boxes", () => {
  const draftLinks = () => within(screen.getByRole("heading", { name: "Drafts" }).parentElement!).getAllByRole("link");

  it("adds a draft as it is typed, moves an edited one to the top, and drops one that is emptied", async () => {
    const { emitDraftChange } = await import("@/lib/chat/draft-events");
    render(<ChatSidebar channels={CHANNELS} drafts={[{ channelId: "2", threadRootId: null, body: "old" }]} />);
    act(() => emitDraftChange({ channelId: "1", threadRootId: "msg_AAAAAAAAAAA1", body: "reply", fileCount: 0 }));
    expect(draftLinks().map((a) => a.getAttribute("href"))).toEqual(["/chat/1?thread=msg_AAAAAAAAAAA1", "/chat/2"]);
    act(() => emitDraftChange({ channelId: "2", threadRootId: null, body: "old, edited", fileCount: 1 }));
    expect(draftLinks().map((a) => a.textContent)).toEqual(["writing-sprintsold, edited · 1 file", "general · threadreply"]);
    act(() => emitDraftChange({ channelId: "2", threadRootId: null, body: " ", fileCount: 0 }));
    act(() => emitDraftChange({ channelId: "1", threadRootId: "msg_AAAAAAAAAAA1", body: "", fileCount: 0 }));
    expect(screen.queryByRole("heading", { name: "Drafts" })).toBeNull();
  });

  it("starts over from the server's list when that changes", async () => {
    const { emitDraftChange } = await import("@/lib/chat/draft-events");
    const { rerender } = render(<ChatSidebar channels={CHANNELS} drafts={[]} />);
    act(() => emitDraftChange({ channelId: "1", threadRootId: null, body: "typed", fileCount: 0 }));
    expect(draftLinks()).toHaveLength(1);
    rerender(<ChatSidebar channels={CHANNELS} drafts={[{ channelId: "2", threadRootId: null, body: "from the server" }]} />);
    expect(draftLinks().map((a) => a.getAttribute("href"))).toEqual(["/chat/2"]);
  });
});
