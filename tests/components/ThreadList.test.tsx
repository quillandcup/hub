// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ChatTextContext } from "@/components/chat/ChatText";
import type { ChatMessageView } from "@/lib/chat/load";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/(member)/chat/actions", () => ({ toggleChatReaction: vi.fn(), retryChatMessage: vi.fn() }));
import ThreadList from "@/components/chat/ThreadList";
import { emitListEvent, optimisticView } from "@/lib/chat/list-events";

const VIEWER = { memberId: "member-fern", name: "Fern Quillsby", photoUrl: null };
const CTX: ChatTextContext = { userNames: {}, userMembers: {}, channelIds: {}, channelNames: {}, customEmoji: {} };
const view = (id: string, body: string, minute: number, extra: Partial<ChatMessageView> = {}): ChatMessageView => ({
  ...optimisticView({ id, body, viewer: { ...VIEWER, memberId: "member-gale", name: "Gale Prickleton" }, createdAt: new Date(Date.UTC(2026, 9, 1, 0, minute)).toISOString() }),
  syncStatus: null,
  mine: false,
  ...extra,
});

const ROOT = view("root", "the root", 0);
const mount = (replies: ChatMessageView[] = [view("r1", "first reply", 1)]) =>
  render(<ThreadList channelId="c1" threadRootId="root" root={ROOT} replies={replies} ctx={CTX} canReact={false} />);
const texts = () => screen.getAllByRole("article").map((a) => /the root|[a-z ]*reply[a-z ]*|thanks/.exec(a.textContent ?? "")?.[0]?.trim());

beforeEach(() => cleanup());

describe("ThreadList", () => {
  it("shows the root and its replies in order, or says there are none", () => {
    mount();
    expect(texts()).toEqual(["the root", "first reply"]);
    cleanup();

    mount([]);
    expect(screen.getByText("No replies yet.")).toBeInTheDocument();
  });

  it("shows a reply the member just sent at once, swaps in the saved one and drops a failed one", () => {
    mount();
    const temp = optimisticView({ id: "pending-1", body: "thanks", viewer: VIEWER });

    act(() => emitListEvent({ kind: "add", channelId: "c1", threadRootId: "root", view: temp }));
    expect(texts()).toEqual(["the root", "first reply", "thanks"]);
    expect(screen.getByText("Sending to Slack…")).toBeInTheDocument();

    act(() => emitListEvent({ kind: "swap", channelId: "c1", threadRootId: "root", tempId: "pending-1", view: { ...temp, id: "real" } }));
    expect(texts()).toEqual(["the root", "first reply", "thanks"]);

    act(() => emitListEvent({ kind: "drop", channelId: "c1", threadRootId: "root", tempId: "real" }));
    expect(texts()).toEqual(["the root", "first reply"]);
  });

  it("merges the thread the server fetched: new replies appear, edits and the root are updated", () => {
    mount();
    act(() =>
      emitListEvent({
        kind: "merge-thread",
        channelId: "c1",
        threadRootId: "root",
        views: [view("root", "the root (edited)", 0), view("r1", "first reply, edited", 1), view("r2", "second reply", 2)],
        ctx: CTX,
      }),
    );
    expect(screen.getAllByRole("article").map((a) => a.textContent)).toEqual([
      expect.stringContaining("the root (edited)"),
      expect.stringContaining("first reply, edited"),
      expect.stringContaining("second reply"),
    ]);
  });

  it("ignores another thread's, another conversation's and the conversation list's events", () => {
    mount();
    act(() => emitListEvent({ kind: "add", channelId: "c1", threadRootId: "other", view: optimisticView({ id: "pending-1", body: "elsewhere", viewer: VIEWER }) }));
    act(() => emitListEvent({ kind: "add", channelId: "c2", threadRootId: "root", view: optimisticView({ id: "pending-2", body: "elsewhere", viewer: VIEWER }) }));
    act(() => emitListEvent({ kind: "add", channelId: "c1", view: optimisticView({ id: "pending-3", body: "in the conversation", viewer: VIEWER }) }));
    act(() => emitListEvent({ kind: "merge", channelId: "c1", views: [view("r9", "newest in the conversation", 9)], ctx: CTX }));
    act(() => emitListEvent({ kind: "merge-thread", channelId: "c1", threadRootId: "other", views: [view("other", "root", 0), view("r8", "other thread", 8)], ctx: CTX }));
    expect(texts()).toEqual(["the root", "first reply"]);
  });

  it("starts from a fresh server render when the page refreshes", () => {
    const { rerender } = mount();
    rerender(<ThreadList channelId="c1" threadRootId="root" root={ROOT} replies={[view("r1", "first reply", 1), view("r2", "second reply", 2)]} ctx={CTX} canReact={false} />);
    expect(texts()).toEqual(["the root", "first reply", "second reply"]);
  });
});
