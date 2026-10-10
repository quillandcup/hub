// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

type Payload = { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> };
const handlers: Record<string, (p: Payload) => void> = {};
let onStatus: (status: string) => void = () => {};
const removeChannel = vi.fn();
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
    removeChannel,
    auth: { getSession: async () => ({ data: { session: { access_token: "member-token" } } }) },
    realtime: { setAuth },
  }),
}));

import ChatLive, { type ChatLiveView } from "@/components/chat/ChatLive";

/** Like the member layout: the page scrolls inside <main>, not the window. */
async function mount(view: ChatLiveView = "latest", extra: { threadRootId?: string } = {}) {
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
    Object.defineProperty(HTMLElement.prototype, prop, { value, configurable: true });
  }
}

describe("ChatLive", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    for (const k of Object.keys(handlers)) delete handlers[k];
    refresh.mockClear();
    calls.length = 0;
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

  it("turns a burst of changes into one refresh", async () => {
    await mount();
    act(() => {
      handlers.chat_messages(update);
      handlers.chat_messages(update);
      handlers.chat_reactions({ eventType: "INSERT", new: { message_id: "m1" }, old: {} });
    });
    act(() => vi.advanceTimersByTime(1000));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("ignores reactions on messages that are not on the page", async () => {
    await mount();
    act(() => handlers.chat_reactions({ eventType: "INSERT", new: { message_id: "elsewhere" }, old: {} }));
    act(() => vi.advanceTimersByTime(1000));
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

  it("follows a new message when the reader is at the bottom", async () => {
    const { rerender } = await mount();
    act(() => handlers.chat_messages(insert()));
    act(() => vi.advanceTimersByTime(1000));
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
    act(() => vi.advanceTimersByTime(1000));
    expect(refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /New messages/ }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/New messages/)).toBeNull();
  });

  it("refreshes quietly for edits and thread replies even when scrolled up", async () => {
    scrolledTo("top");
    await mount();
    act(() => handlers.chat_messages(update));
    act(() => handlers.chat_messages(insert("m1")));
    act(() => vi.advanceTimersByTime(1000));
    expect(refresh).toHaveBeenCalledTimes(1);
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
    act(() => onStatus("SUBSCRIBED"));
    act(() => vi.advanceTimersByTime(1000));
    expect(refresh).not.toHaveBeenCalled();
    act(() => onStatus("SUBSCRIBED"));
    act(() => vi.advanceTimersByTime(1000));
    expect(refresh).toHaveBeenCalledTimes(1);
    unmount();
    expect(removeChannel).toHaveBeenCalled();
  });
});
