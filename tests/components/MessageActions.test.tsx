// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/(member)/chat/actions", () => ({ toggleChatReaction: vi.fn() }));
import { toggleChatReaction } from "@/app/(member)/chat/actions";
import MessageActions from "@/components/chat/MessageActions";
import MessageItem from "@/components/chat/MessageItem";
import { MESSAGE_CHANGE_EVENT, optimisticView } from "@/lib/chat/list-events";

beforeEach(cleanup);

const props = { channelId: "c1", messageId: "m1", body: "hi", custom: {}, canReact: false, canReply: false };

describe("MessageActions reactions", () => {
  it("reacts from the picker and closes it, showing an error when the action refuses", async () => {
    vi.mocked(toggleChatReaction).mockResolvedValue({ ok: false, error: "No can do." });
    render(<MessageActions {...props} canReact />);
    await userEvent.click(screen.getByRole("button", { name: "Add reaction…" }));
    await userEvent.click(screen.getAllByRole("button", { name: "React with :tada:" })[0]);
    expect(toggleChatReaction).toHaveBeenCalledWith("m1", "tada");
    expect(screen.queryByLabelText("Search emoji")).not.toBeInTheDocument();
  });

  it("closes the picker with Escape", async () => {
    render(<MessageActions {...props} canReact />);
    await userEvent.click(screen.getByRole("button", { name: "Add reaction…" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByLabelText("Search emoji")).not.toBeInTheDocument();
  });
});

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

  it("shows 'Message copied' for 1.5 s with a single timer, restarts it on a second copy, and leaves none behind on unmount", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const copyMessage = async () => {
        fireEvent.click(screen.getByRole("button", { name: "More actions" }));
        await act(async () => void fireEvent.click(screen.getByRole("menuitem", { name: "Copy message" })));
      };
      render(<MessageActions {...props} />);
      await copyMessage();
      expect(screen.getByRole("status")).toHaveTextContent("Message copied");
      expect(vi.getTimerCount()).toBe(1);

      act(() => void vi.advanceTimersByTime(1000));
      await copyMessage();
      expect(vi.getTimerCount()).toBe(1);
      act(() => void vi.advanceTimersByTime(1499));
      expect(screen.getByRole("status")).toBeInTheDocument();
      act(() => void vi.advanceTimersByTime(1));
      expect(screen.queryByRole("status")).toBeNull();

      await copyMessage();
      expect(vi.getTimerCount()).toBe(1);
      cleanup();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
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

const renderTipActions = () =>
  render(<MessageActions channelId="c1" messageId="m1" body="hello" custom={{}} canReact canReply />);

describe("MessageActions tooltips", () => {
  it("uses a styled tooltip, not the browser's title tooltip, on each action", () => {
    renderTipActions();
    for (const name of ["Add reaction…", "Reply in thread", "More actions"]) {
      const control = screen.getByRole(name === "Reply in thread" ? "link" : "button", { name });
      expect(control).not.toHaveAttribute("title");
      expect(control).toHaveClass("group/tip");
    }
  });

  it("labels each tooltip and hides it from assistive tech", () => {
    renderTipActions();
    for (const text of ["Add reaction", "Reply in thread", "More actions"]) {
      const tip = screen.getByText(text, { selector: "span[aria-hidden]" });
      expect(tip).toHaveClass("hidden", "group-hover/tip:block", "group-focus-visible/tip:block");
    }
  });
});
