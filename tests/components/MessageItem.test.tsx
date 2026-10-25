// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ChatMessageView } from "@/lib/chat/load";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/(member)/chat/actions", () => ({ toggleChatReaction: vi.fn(), editChatMessage: vi.fn(), deleteChatMessage: vi.fn() }));
vi.mock("@/components/member/MemberHoverCard", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/chat/MessageFiles", () => ({ default: () => null }));
import MessageItem, { systemNoticeText } from "@/components/chat/MessageItem";
import { optimisticView } from "@/lib/chat/list-events";

const CTX = { userNames: {}, userMembers: {}, channelIds: {}, channelNames: {}, customEmoji: {} };
const base = (extra: Partial<ChatMessageView> = {}): ChatMessageView => ({
  ...optimisticView({ id: "00000000-0000-4000-a000-0000000000d1", body: "hello", viewer: { memberId: "member-fern", name: "Fern", photoUrl: null } }),
  syncStatus: null,
  ...extra,
});
const mount = (message: ChatMessageView, canEdit = true, canReact = true) => render(<MessageItem message={message} ctx={CTX} channelId="c1" canEdit={canEdit} canReact={canReact} />);

beforeEach(cleanup);

describe("MessageItem actions menu", () => {
  it("offers Edit and Delete only on the viewer's own sent Hub message", async () => {
    mount(base());
    expect(screen.getByRole("button", { name: /more/i })).toBeInTheDocument();
  });

  it("has no action menu for a message that is still sending or whose text is hidden", () => {
    mount(base({ id: "pending-1" }));
    expect(screen.queryByRole("button", { name: /more/i })).not.toBeInTheDocument();
    cleanup();
    mount(base({ contentState: "hidden", body: null }));
    expect(screen.queryByRole("button", { name: /more/i })).not.toBeInTheDocument();
    expect(screen.getByText(/can't read this message/)).toBeInTheDocument();
  });

  it("does not let the viewer change someone else's, a Slack notice or an unsynced message", () => {
    for (const extra of [{ mine: false }, { system: true }, { syncStatus: "failed" as const }]) {
      cleanup();
      mount(base(extra));
      expect(screen.queryByRole("menuitem", { name: "Edit" })).not.toBeInTheDocument();
    }
  });
});

describe("MessageItem deleted messages", () => {
  it("shows nothing for a deleted message without replies, in the feed or a thread", () => {
    const { container } = mount(base({ contentState: "deleted", body: null, replyCount: 0 }));
    expect(container).toBeEmptyDOMElement();
    cleanup();
    const inThread = render(<MessageItem message={base({ contentState: "deleted", body: null, replyCount: 0 })} ctx={CTX} channelId="c1" inThread />);
    expect(inThread.container).toBeEmptyDOMElement();
  });

  it("shows a tombstone and the replies link for a deleted root that has replies", () => {
    mount(base({ contentState: "deleted", body: null, replyCount: 1, lastReplyAt: null }));
    expect(screen.getByText("This message was deleted.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /1 reply/ })).toHaveAttribute("href", expect.stringContaining("thread="));
    cleanup();
    mount(base({ contentState: "deleted", body: null, replyCount: 3, lastReplyAt: "2026-10-02T00:00:00Z" }));
    expect(screen.getByRole("link", { name: /3 replies · last/ })).toBeInTheDocument();
  });

  it("shows the tombstone without a replies link as the thread's first message", () => {
    render(<MessageItem message={base({ contentState: "deleted", body: null, replyCount: 2 })} ctx={CTX} channelId="c1" inThread />);
    expect(screen.getByText("This message was deleted.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("system notices", () => {
  const ctx = { ...CTX, userNames: { U1: "Cody", U2: "Ania" }, hubNames: { U1: "Cody Ray" } };

  it("names people the way the Hub does, not by the short name they go by in Slack, and falls back to that for unmatched ones", () => {
    expect(systemNoticeText("<@U2> was added to the channel by <@U1>", "Ania Ray", ctx)).toBe("Ania was added to the channel by Cody Ray");
    expect(systemNoticeText("<@U1> has joined the channel", "Cody Ray", { ...CTX, userNames: { U1: "Cody" } })).toBe("Cody has joined the channel");
  });

  it("starts a notice without a mention with the author's name, and renders as a quiet line", () => {
    expect(systemNoticeText("was removed from the channel by Cody Ray", "Ania Ray", ctx)).toBe("Ania Ray was removed from the channel by Cody Ray");
    render(<MessageItem message={base({ system: true, authorName: "Ania Ray", body: "was removed from the channel by Cody Ray" })} ctx={ctx} channelId="c1" canEdit canReact={false} />);
    expect(screen.getByText(/Ania Ray was removed from the channel by Cody Ray/)).toBeInTheDocument();
  });
});
