// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/(member)/chat/actions", () => ({ toggleChatReaction: vi.fn() }));
import MessageActions from "@/components/chat/MessageActions";
import MessageItem from "@/components/chat/MessageItem";
import { MESSAGE_CHANGE_EVENT, optimisticView } from "@/lib/chat/list-events";

beforeEach(cleanup);

const props = { channelId: "c1", messageId: "m1", body: "hi", custom: {}, canReact: false, canReply: false };

describe("MessageActions menu", () => {
  it("puts Edit and Delete in the more menu for the author, telling MessageBody by event", async () => {
    const seen: unknown[] = [];
    const on = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener(MESSAGE_CHANGE_EVENT, on);
    render(<MessageActions {...props} canChange />);
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Edit message" }));
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete message" }));
    window.removeEventListener(MESSAGE_CHANGE_EVENT, on);
    expect(seen).toEqual([
      { messageId: "m1", what: "edit" },
      { messageId: "m1", what: "delete" },
    ]);
  });

  it("leaves them out for everyone else", async () => {
    render(<MessageActions {...props} />);
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.queryByRole("menuitem", { name: /Edit message|Delete message/ })).not.toBeInTheDocument();
  });
});

describe("MessageItem", () => {
  it("renders nothing for a deleted message", () => {
    const view = { ...optimisticView({ id: "m1", body: "x", viewer: { memberId: "a", name: "A", photoUrl: null } }), contentState: "deleted" as const };
    const { container } = render(
      <MessageItem message={view} ctx={{ userNames: {}, userMembers: {}, channelIds: {}, channelNames: {}, customEmoji: {} }} channelId="c1" />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
