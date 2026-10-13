// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
const loadLatestChat = vi.fn(async (): Promise<unknown> => null);
const loadThreadChat = vi.fn(async (): Promise<unknown> => null);
vi.mock("@/app/(member)/chat/actions", () => ({
  markChatRead: vi.fn(),
  loadLatestChat: (...a: unknown[]) => loadLatestChat(...(a as [])),
  loadThreadChat: (...a: unknown[]) => loadThreadChat(...(a as [])),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

type Payload = { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> };
const handlers: Record<string, (p: Payload) => void> = {};
let onStatus: (status: string) => void = () => {};
const removeChannel = vi.fn();
/** What the "newest message" lookup after a reconnect returns. */
let newestId = "m2";
const query: Record<string, unknown> = {
  select: () => query,
  eq: () => query,
  is: () => query,
  order: () => query,
  limit: () => query,
  then: (resolve: (r: { data: { id: string }[] }) => void) => resolve({ data: [{ id: newestId }] }),
};
const calls: string[] = [];
const setAuth = vi.fn(async () => {
  calls.push("setAuth");
});
const channel = {
  on: vi.fn((_type: string, filter: { table: string }, cb: (p: Payload) => void) => {
    handlers[filter.table] = cb;
    return channel;
  }),
  subscribe: vi.fn((cb: (status: string) => void) => {
    calls.push("subscribe");
    onStatus = cb;
    return channel;
  }),
};
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: () => channel,
    from: () => query,
    removeChannel,
    auth: { getSession: async () => ({ data: { session: { access_token: "member-token" } } }) },
    realtime: { setAuth },
  }),
}));

import ChatLive, { type ChatLiveView } from "@/components/chat/ChatLive";
import { pokeChat, subscribeListEvents, type ListEvent } from "@/lib/chat/list-events";
import type { ChatMessageView } from "@/lib/chat/load";
import { markChatRead } from "@/app/(member)/chat/actions";

/** Like the member layout: the page scrolls inside <main>, not the window. */
async function mount(view: ChatLiveView = "latest", extra: { threadRootId?: string; markRead?: boolean; latestAt?: string | null } = {}) {
  const result = render(
    <main style={{ overflowY: "auto" }}>
      <ChatLive channelId="c1" view={view} messageIds={["m1", "m2"]} latestId="m2" {...extra} />
    </main>,
  );
  await act(async () => {}); // let the session load and the channel subscribe
  return result;
}
const insert = (thread_root_id: string | null = null): Payload => ({ eventType: "INSERT", new: { id: "m3", thread_root_id }, old: {} });
const update: Payload = { eventType: "UPDATE", new: { id: "m1", thread_root_id: null }, old: {} };

/** jsdom has no layout: say how far down the scroller the reader is (5000px tall, 800px window). */
function scrolledTo(position: "bottom" | "top") {
  const top = position === "bottom" ? 4200 : 0;
  for (const [prop, value] of [["scrollHeight", 5000], ["clientHeight", 800], ["scrollTop", top]] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { value, configurable: true, writable: true });
  }
}

describe("ChatLive", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    for (const k of Object.keys(handlers)) delete handlers[k];
    refresh.mockClear();
    calls.length = 0;
    vi.mocked(markChatRead).mockClear();
    newestId = "m2";
    HTMLElement.prototype.scrollTo = vi.fn() as never;
    scrolledTo("bottom");
  });
  afterEach(() => vi.useRealTimers());

  it("listens to this channel's messages and to reactions, but not message content", async () => {
    await mount();
    expect(channel.on).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({ table: "chat_messages", filter: "channel_id=eq.c1" }),
      expect.any(Function),
    );
    expect(Object.keys(handlers).sort()).toEqual(["chat_messages", "chat_reactions"]);
  });

  it("hands Realtime the member's token before joining, since it joins as anon otherwise", async () => {
    await mount();
    expect(setAuth).toHaveBeenCalledWith("member-token");
    expect(calls).toEqual(["setAuth", "subscribe"]);
  });

  it("fetches the first change at once, and folds a burst right behind it into one more fetch", async () => {
    await mount();
    act(() => handlers.chat_messages(update));
    await act(async () => {});
    // No waiting to see whether more follow.
    expect(refresh).toHaveBeenCalledTimes(1);

    act(() => {
      handlers.chat_messages(update);
      handlers.chat_messages(update);
      handlers.chat_reactions({ eventType: "INSERT", new: { message_id: "m1" }, old: {} });
    });
    await act(async () => vi.advanceTimersByTime(1000));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("goes back to fetching at once after things have been quiet", async () => {
    await mount();
    act(() => handlers.chat_messages(update));
    await act(async () => vi.advanceTimersByTime(1000));
    expect(refresh).toHaveBeenCalledTimes(1);

    act(() => handlers.chat_messages(update));
    await act(async () => {});
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("ignores reactions on messages that are not on the page", async () => {
    await mount();
    act(() => handlers.chat_reactions({ eventType: "INSERT", new: { message_id: "elsewhere" }, old: {} }));
    await act(async () => vi.advanceTimersByTime(1000));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("lands on the newest message when a conversation opens, but not on older pages or threads", async () => {
    await mount("latest");
    expect(HTMLElement.prototype.scrollTo).toHaveBeenCalledTimes(1);
    vi.mocked(HTMLElement.prototype.scrollTo).mockClear();
    await mount("older");
    await mount("thread", { threadRootId: "m1" });
    expect(HTMLElement.prototype.scrollTo).not.toHaveBeenCalled();
  });

  it("opens on the line between read and new when there is one, else on the newest message", async () => {
    render(
      <main style={{ overflowY: "auto" }}>
        <div id="unread-divider" />
        <ChatLive channelId="c1" view="latest" messageIds={["m1"]} latestId="m1" />
      </main>,
    );
    await act(async () => {});
    expect(HTMLElement.prototype.scrollTo).not.toHaveBeenCalled();
    cleanup();

    await mount("latest");
    expect(HTMLElement.prototype.scrollTo).toHaveBeenCalledTimes(1);
  });

  describe("read state", () => {
    const settle = () => act(() => vi.advanceTimersByTime(1));

    it("does not mark the conversation read when it opens, so the line stays put", async () => {
      await mount("latest", { markRead: true, latestAt: "2026-10-03T12:00:00Z" });
      await settle();
      handlers.chat_messages(update);
      await act(async () => vi.advanceTimersByTime(1000));
      expect(markChatRead).not.toHaveBeenCalled();
    });

    it("marks it read, through the newest message on the page, when the reader leaves", async () => {
      const { unmount } = await mount("latest", { markRead: true, latestAt: "2026-10-03T12:00:00Z" });
      await settle();
      unmount();
      expect(markChatRead).toHaveBeenCalledWith("c1", "2026-10-03T12:00:00Z");
    });

    it("marks it read when the tab is hidden", async () => {
      await mount("latest", { markRead: true, latestAt: "2026-10-03T12:00:00Z" });
      await settle();
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      expect(markChatRead).toHaveBeenCalledWith("c1", "2026-10-03T12:00:00Z");
    });

    it("ignores the development double-mount, which unmounts at once", async () => {
      const { unmount } = await mount("latest", { markRead: true, latestAt: "2026-10-03T12:00:00Z" });
      unmount();
      expect(markChatRead).not.toHaveBeenCalled();
    });

    it("does nothing in sudo, in a thread, on an older page or with nothing to read", async () => {
      for (const [view, extra] of [
        ["latest", { markRead: false, latestAt: "2026-10-03T12:00:00Z" }],
        ["thread", { markRead: true, latestAt: "2026-10-03T12:00:00Z", threadRootId: "m1" }],
        ["older", { markRead: true, latestAt: "2026-10-03T12:00:00Z" }],
        ["latest", { markRead: true, latestAt: null }],
      ] as const) {
        const { unmount } = await mount(view, extra);
        await settle();
        unmount();
      }
      expect(markChatRead).not.toHaveBeenCalled();
    });
  });

  it("follows a new message when the reader is at the bottom", async () => {
    const { rerender } = await mount();
    act(() => handlers.chat_messages(insert()));
    await act(async () => vi.advanceTimersByTime(1000));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/New messages/)).toBeNull();
    rerender(
      <main style={{ overflowY: "auto" }}>
        <ChatLive channelId="c1" view="latest" messageIds={["m1", "m2", "m3"]} latestId="m3" />
      </main>,
    );
    expect(HTMLElement.prototype.scrollTo).toHaveBeenCalled();
  });

  it("holds a new message behind a pill when the reader has scrolled up, until clicked", async () => {
    scrolledTo("top");
    await mount();
    act(() => handlers.chat_messages(insert()));
    await act(async () => vi.advanceTimersByTime(1000));
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /New messages/ })));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/New messages/)).toBeNull();
  });

  it("refreshes quietly for edits and thread replies even when scrolled up", async () => {
    scrolledTo("top");
    await mount();
    act(() => handlers.chat_messages(update));
    act(() => handlers.chat_messages(insert("m1")));
    await act(async () => vi.advanceTimersByTime(1000));
    // The first at once, the one right behind it folded into a second.
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/New messages/)).toBeNull();
  });

  it("treats only replies to the open thread as new in a thread view", async () => {
    scrolledTo("top");
    await mount("thread", { threadRootId: "m1" });
    act(() => handlers.chat_messages(insert("m1")));
    expect(screen.getByRole("button", { name: /New messages/ })).toBeTruthy();
  });

  it("refreshes on re-subscribe but not the first subscribe, and unsubscribes on unmount", async () => {
    const { unmount } = await mount();
    await act(async () => onStatus("SUBSCRIBED"));
    await act(async () => vi.advanceTimersByTime(1000));
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => onStatus("SUBSCRIBED"));
    await act(async () => vi.advanceTimersByTime(1000));
    expect(refresh).toHaveBeenCalledTimes(1);
    unmount();
    expect(removeChannel).toHaveBeenCalled();
  });

  it("does not raise the pill after a reconnect when nothing new arrived", async () => {
    scrolledTo("top");
    await mount();
    await act(async () => onStatus("SUBSCRIBED"));
    await act(async () => onStatus("SUBSCRIBED"));
    await act(async () => vi.advanceTimersByTime(1000));
    expect(screen.queryByText(/New messages/)).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("raises the pill after a reconnect only when a newer message exists and the reader is scrolled up", async () => {
    scrolledTo("top");
    newestId = "m3";
    await mount();
    await act(async () => onStatus("SUBSCRIBED"));
    await act(async () => onStatus("SUBSCRIBED"));
    expect(screen.getByRole("button", { name: /New messages/ })).toBeTruthy();
  });

  describe("keeping the newest messages current without a page refresh", () => {
    const fetched = (...ids: string[]) => ({
      views: ids.map((id, i) => ({ id, createdAt: `2026-10-0${i + 1}T00:00:00.000001Z` }) as ChatMessageView),
      ctx: { userNames: {}, userMembers: {}, channelIds: {}, channelNames: {}, customEmoji: {} },
      olderBefore: null,
    });
    let events: ListEvent[];
    let unsubscribe: () => void;
    beforeEach(() => {
      loadLatestChat.mockReset();
      loadLatestChat.mockResolvedValue(fetched("m1", "m2", "m3"));
      events = [];
      unsubscribe = subscribeListEvents((e) => events.push(e));
    });
    afterEach(() => unsubscribe());

    it("fetches just the newest messages and hands them to the list, instead of refreshing the page", async () => {
      await mount();
      act(() => handlers.chat_messages(insert()));
      await act(async () => vi.advanceTimersByTime(1000));

      expect(loadLatestChat).toHaveBeenCalledWith("c1");
      expect(events).toEqual([expect.objectContaining({ kind: "merge", channelId: "c1", views: expect.any(Array) })]);
      expect(refresh).not.toHaveBeenCalled();
      // The reader was at the bottom, so it follows the new message.
      expect(HTMLElement.prototype.scrollTo).toHaveBeenCalledTimes(2);
      expect(screen.queryByText(/New messages/)).toBeNull();
    });

    it("still holds a new message behind the pill when scrolled up, and fetches when it is clicked", async () => {
      scrolledTo("top");
      await mount();
      act(() => handlers.chat_messages(insert()));
      await act(async () => vi.advanceTimersByTime(1000));
      expect(loadLatestChat).not.toHaveBeenCalled();

      await act(async () => void fireEvent.click(screen.getByRole("button", { name: /New messages/ })));
      expect(loadLatestChat).toHaveBeenCalledTimes(1);
      expect(events).toHaveLength(1);
      expect(refresh).not.toHaveBeenCalled();
      expect(screen.queryByText(/New messages/)).toBeNull();
    });

    it("pays attention to reactions on messages it fetched, which the page doesn't know yet", async () => {
      await mount();
      act(() => handlers.chat_messages(insert()));
      await act(async () => vi.advanceTimersByTime(1000));
      loadLatestChat.mockClear();

      act(() => handlers.chat_reactions({ eventType: "INSERT", new: { message_id: "m3" }, old: {} }));
      await act(async () => vi.advanceTimersByTime(1000));
      expect(loadLatestChat).toHaveBeenCalledTimes(1);
    });

    it("falls back to refreshing the page when the small fetch can't be done", async () => {
      loadLatestChat.mockResolvedValueOnce(null);
      await mount();
      act(() => handlers.chat_messages(update));
      await act(async () => vi.advanceTimersByTime(1000));
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(events).toHaveLength(0);

      loadLatestChat.mockRejectedValueOnce(new Error("offline"));
      act(() => handlers.chat_messages(update));
      await act(async () => vi.advanceTimersByTime(1000));
      expect(refresh).toHaveBeenCalledTimes(2);
    });

    it("still refreshes the page for an older page", async () => {
      await mount("older");
      act(() => handlers.chat_messages(update));
      await act(async () => vi.advanceTimersByTime(1000));

      expect(refresh).toHaveBeenCalledTimes(1);
      expect(loadLatestChat).not.toHaveBeenCalled();
      expect(loadThreadChat).not.toHaveBeenCalled();
    });

    describe("in a thread", () => {
      const thread = (...ids: string[]) => ({ ...fetched(...ids), olderBefore: undefined });
      beforeEach(() => {
        loadThreadChat.mockReset();
        loadThreadChat.mockResolvedValue(thread("m1", "r1"));
      });

      it("fetches just the thread and hands it to the thread list, instead of refreshing the page", async () => {
        await mount("thread", { threadRootId: "m1" });
        act(() => handlers.chat_messages(insert("m1")));
        await act(async () => vi.advanceTimersByTime(1000));

        expect(loadThreadChat).toHaveBeenCalledWith("c1", "m1");
        expect(loadLatestChat).not.toHaveBeenCalled();
        expect(events).toEqual([expect.objectContaining({ kind: "merge-thread", channelId: "c1", threadRootId: "m1" })]);
        expect(refresh).not.toHaveBeenCalled();
      });

      it("falls back to refreshing the page when the thread can't be fetched", async () => {
        loadThreadChat.mockResolvedValueOnce(null);
        await mount("thread", { threadRootId: "m1" });
        act(() => handlers.chat_messages(update));
        await act(async () => vi.advanceTimersByTime(1000));
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(events).toHaveLength(0);
      });

      it("holds a new reply behind the pill when scrolled up, and fetches the thread when it is clicked", async () => {
        scrolledTo("top");
        await mount("thread", { threadRootId: "m1" });
        act(() => handlers.chat_messages(insert("m1")));
        await act(async () => vi.advanceTimersByTime(1000));
        expect(loadThreadChat).not.toHaveBeenCalled();

        await act(async () => void fireEvent.click(screen.getByRole("button", { name: /New messages/ })));
        expect(loadThreadChat).toHaveBeenCalledTimes(1);
        expect(events).toHaveLength(1);
        expect(refresh).not.toHaveBeenCalled();
        expect(screen.queryByText(/New messages/)).toBeNull();
      });
    });

    it("answers a poke at once, without the debounce, for as long as it is open", async () => {
      const { unmount } = await mount();
      expect(pokeChat("c1")).toBe(true);
      await act(async () => {});
      expect(loadLatestChat).toHaveBeenCalledTimes(1);
      expect(events).toHaveLength(1);

      expect(pokeChat("another-channel")).toBe(false);
      unmount();
      expect(pokeChat("c1")).toBe(false);
    });
  });
});
