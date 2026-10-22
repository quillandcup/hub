// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { ChatTextContext } from "@/components/chat/ChatText";
import type { ChatMessageView } from "@/lib/chat/load";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/(member)/chat/actions", () => ({
  sendChatMessage: vi.fn(),
  loadOlderChat: vi.fn(),
  toggleChatReaction: vi.fn(),
  retryChatMessage: vi.fn(),
}));
import { sendChatMessage } from "@/app/(member)/chat/actions";
import Composer from "@/components/chat/Composer";
import MessageList from "@/components/chat/MessageList";
import { emitListEvent, isPendingId, optimisticView, subscribeListEvents, type ListEvent } from "@/lib/chat/list-events";

const VIEWER = { memberId: "member-fern", name: "Fern Quillsby", photoUrl: null };
const CTX: ChatTextContext = { userNames: {}, userMembers: {}, channelIds: {}, channelNames: {}, customEmoji: {} };
const serverView = (n: number, extra: Partial<ChatMessageView> = {}): ChatMessageView => ({
  ...optimisticView({ id: `m${n}`, body: `message ${n}`, viewer: { ...VIEWER, memberId: "member-gale", name: "Gale Prickleton" }, createdAt: new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString() }),
  syncStatus: null,
  mine: false,
  ...extra,
});

let events: ListEvent[];
let unsubscribe: () => void;
beforeEach(() => {
  cleanup();
  refresh.mockReset();
  vi.mocked(sendChatMessage).mockReset();
  events = [];
  unsubscribe = subscribeListEvents((e) => events.push(e));
});
afterEach(() => unsubscribe());

/** An action result the test settles by hand, to look at the screen while the send is in flight. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("Composer: the message shows up before the server has finished", () => {
  it("announces the message and clears the box the moment Send is pressed, then swaps in the saved message", async () => {
    const result = deferred<{ ok: true; id: string }>();
    vi.mocked(sendChatMessage).mockReturnValue(result.promise);
    render(<Composer channelId="c1" placeholder="Message #hosts" viewer={VIEWER} />);

    await userEvent.type(screen.getByRole("textbox"), "Hello there{Enter}");

    // The action hasn't returned, and the message is already out there, with the box empty.
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "add", channelId: "c1", view: { body: "Hello there", authorName: "Fern Quillsby", mine: true, syncStatus: "pending" } });
    expect(isPendingId((events[0] as { view: ChatMessageView }).view.id)).toBe(true);
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(refresh).not.toHaveBeenCalled();

    result.resolve({ ok: true, id: "real-id" });
    await waitFor(() => expect(events).toHaveLength(2));
    const tempId = (events[0] as { view: ChatMessageView }).view.id;
    expect(events[1]).toMatchObject({ kind: "swap", channelId: "c1", tempId, view: { id: "real-id", body: "Hello there" } });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("takes the message away and gives the text back when the send is refused", async () => {
    vi.mocked(sendChatMessage).mockResolvedValue({ ok: false, error: "This conversation is archived." });
    render(<Composer channelId="c1" placeholder="Message #hosts" viewer={VIEWER} />);
    await userEvent.type(screen.getByRole("textbox"), "still here{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("archived");
    expect(events.map((e) => e.kind)).toEqual(["add", "drop"]);
    expect(screen.getByRole("textbox")).toHaveValue("still here");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does the same when the action itself throws", async () => {
    vi.mocked(sendChatMessage).mockRejectedValue(new Error("network"));
    render(<Composer channelId="c1" placeholder="Message #hosts" viewer={VIEWER} />);
    await userEvent.type(screen.getByRole("textbox"), "oops{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
    expect(events.map((e) => e.kind)).toEqual(["add", "drop"]);
    expect(screen.getByRole("textbox")).toHaveValue("oops");
  });

  it("announces a reply with its thread, so the thread's list shows it and the conversation's doesn't", async () => {
    vi.mocked(sendChatMessage).mockResolvedValue({ ok: true, id: "reply-1" });
    render(<Composer channelId="c1" threadRootId="root" placeholder="Reply…" viewer={VIEWER} />);
    await userEvent.type(screen.getByRole("textbox"), "thanks{Enter}");

    await waitFor(() => expect(events.map((e) => e.kind)).toEqual(["add", "swap"]));
    expect(events.every((e) => "threadRootId" in e && e.threadRootId === "root")).toBe(true);
  });

  it("shows nothing early on an older page or without knowing who is writing, but still sends", async () => {
    vi.mocked(sendChatMessage).mockResolvedValue({ ok: true, id: "r1" });
    for (const props of [{ showSent: false, viewer: VIEWER }, {}]) {
      cleanup();
      render(<Composer channelId="c1" placeholder="Message #hosts" {...props} />);
      await userEvent.type(screen.getByRole("textbox"), "hi{Enter}");
      await waitFor(() => expect(sendChatMessage).toHaveBeenCalled());
      vi.mocked(sendChatMessage).mockClear();
    }
    expect(events).toHaveLength(0);
  });

  it("won't send a second message while the first is still being sent", async () => {
    const result = deferred<{ ok: true; id: string }>();
    vi.mocked(sendChatMessage).mockReturnValue(result.promise);
    render(<Composer channelId="c1" placeholder="Message #hosts" viewer={VIEWER} />);
    await userEvent.type(screen.getByRole("textbox"), "one{Enter}two{Enter}");

    expect(sendChatMessage).toHaveBeenCalledTimes(1);
    result.resolve({ ok: true, id: "m-1" });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});

describe("MessageList: shows what is being sent", () => {
  const list = (views: ChatMessageView[], extra: Partial<React.ComponentProps<typeof MessageList>> = {}) => (
    <MessageList channelId="c1" views={views} ctx={CTX} olderBefore={null} {...extra} />
  );
  const texts = () => screen.getAllByRole("article").map((a) => /message \d+|Hello there/.exec(a.textContent ?? "")![0]);

  it("adds the message at once, as sending, and the saved one replaces it without a duplicate", () => {
    const { rerender } = render(list([serverView(1)]));
    const temp = optimisticView({ id: "pending-1", body: "Hello there", viewer: VIEWER });

    act(() => emitListEvent({ kind: "add", channelId: "c1", view: temp }));
    expect(texts()).toEqual(["message 1", "Hello there"]);
    expect(screen.getByText("Sending to Slack…")).toBeInTheDocument();

    act(() => emitListEvent({ kind: "swap", channelId: "c1", tempId: "pending-1", view: { ...temp, id: "real-id" } }));
    expect(texts()).toEqual(["message 1", "Hello there"]);

    // The page refresh brings the server's copy of the same message: it replaces the placeholder's.
    rerender(list([serverView(1), { ...temp, id: "real-id", syncStatus: null }]));
    expect(texts()).toEqual(["message 1", "Hello there"]);
    expect(screen.queryByText("Sending to Slack…")).not.toBeInTheDocument();
  });

  it("keeps the server's version if it arrived before the action returned", () => {
    const temp = optimisticView({ id: "pending-1", body: "Hello there", viewer: VIEWER });
    const { rerender } = render(list([serverView(1)]));
    act(() => emitListEvent({ kind: "add", channelId: "c1", view: temp }));
    rerender(list([serverView(1), { ...temp, id: "real-id", syncStatus: null }]));

    act(() => emitListEvent({ kind: "swap", channelId: "c1", tempId: "pending-1", view: { ...temp, id: "real-id" } }));
    expect(texts()).toEqual(["message 1", "Hello there"]);
    expect(screen.queryByText("Sending to Slack…")).not.toBeInTheDocument();
  });

  it("takes a message away when its send failed", () => {
    render(list([serverView(1)]));
    const temp = optimisticView({ id: "pending-1", body: "Hello there", viewer: VIEWER });
    act(() => emitListEvent({ kind: "add", channelId: "c1", view: temp }));
    act(() => emitListEvent({ kind: "drop", channelId: "c1", tempId: "pending-1" }));
    expect(texts()).toEqual(["message 1"]);
  });

  it("ignores another conversation's messages, and everything on an older page", () => {
    const temp = optimisticView({ id: "pending-1", body: "Hello there", viewer: VIEWER });
    render(list([serverView(1)]));
    act(() => emitListEvent({ kind: "add", channelId: "c2", view: temp }));
    expect(texts()).toEqual(["message 1"]);

    cleanup();
    render(list([serverView(1)], { showSent: false }));
    act(() => emitListEvent({ kind: "add", channelId: "c1", view: temp }));
    expect(texts()).toEqual(["message 1"]);
  });

  it("can't react to a message that isn't saved yet", () => {
    render(list([], { canReact: true }));
    act(() => emitListEvent({ kind: "add", channelId: "c1", view: optimisticView({ id: "pending-1", body: "Hello there", viewer: VIEWER }) }));
    expect(screen.queryByRole("button", { name: "Add reaction…" })).not.toBeInTheDocument();
  });

  it("merges the newest messages the server fetched: its version of each wins and new ones are added", () => {
    render(list([serverView(1), serverView(2)]));
    act(() =>
      emitListEvent({
        kind: "merge",
        channelId: "c1",
        views: [serverView(2, { body: "message 2 (edited)" }), serverView(3)],
        ctx: CTX,
      }),
    );
    expect(screen.getAllByRole("article").map((a) => a.textContent)).toEqual([
      expect.stringContaining("message 1"),
      expect.stringContaining("message 2 (edited)"),
      expect.stringContaining("message 3"),
    ]);
  });

  it("ignores a merge for another conversation or while showing an older page", () => {
    render(list([serverView(1)]));
    act(() => emitListEvent({ kind: "merge", channelId: "c2", views: [serverView(3)], ctx: CTX }));
    expect(texts()).toEqual(["message 1"]);

    cleanup();
    render(list([serverView(1)], { showSent: false }));
    act(() => emitListEvent({ kind: "merge", channelId: "c1", views: [serverView(3)], ctx: CTX }));
    expect(texts()).toEqual(["message 1"]);
  });
});
