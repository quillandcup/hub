// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ChatMessageView } from "@/lib/chat/load";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/(member)/chat/actions", () => ({ toggleChatReaction: vi.fn(), editChatMessage: vi.fn(), deleteChatMessage: vi.fn() }));
vi.mock("@/components/member/MemberHoverCard", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/chat/MessageFiles", () => ({ default: () => null }));
import MessageItem from "@/components/chat/MessageItem";
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

  it("does not let the viewer change someone else's, a Slack-origin or an unsynced message", () => {
    for (const extra of [{ mine: false }, { fromHub: false }, { syncStatus: "failed" as const }]) {
      cleanup();
      mount(base(extra));
      expect(screen.queryByRole("menuitem", { name: "Edit" })).not.toBeInTheDocument();
    }
  });
});

describe("MessageItem deleted messages", () => {
  it("shows nothing for a deleted message without replies, or inside a thread", () => {
    const { container } = mount(base({ contentState: "deleted", body: null, replyCount: 0 }));
    expect(container).toBeEmptyDOMElement();
    cleanup();
    const inThread = render(<MessageItem message={base({ contentState: "deleted", body: null, replyCount: 2 })} ctx={CTX} channelId="c1" inThread />);
    expect(inThread.container).toBeEmptyDOMElement();
  });

  it("keeps only the replies link for a deleted root that has replies, with no tombstone", () => {
    mount(base({ contentState: "deleted", body: null, replyCount: 1, lastReplyAt: null }));
    expect(screen.getByRole("link", { name: /1 reply/ })).toHaveAttribute("href", expect.stringContaining("thread="));
    expect(screen.queryByText(/deleted/i)).not.toBeInTheDocument();
    cleanup();
    mount(base({ contentState: "deleted", body: null, replyCount: 3, lastReplyAt: "2026-10-02T00:00:00Z" }));
    expect(screen.getByRole("link", { name: /3 replies · last/ })).toBeInTheDocument();
  });
});
