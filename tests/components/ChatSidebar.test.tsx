// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelSummary } from "@/lib/chat/load";

let pathname = "/chat";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

type Row = Record<string, unknown>;
let onInsert: (payload: { new: Row }) => void = () => {};
const subscribe = vi.fn();
const realtime: { on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> } = {
  on: vi.fn((_t: string, _f: unknown, cb: (p: { new: Row }) => void) => {
    onInsert = cb;
    return realtime;
  }),
  subscribe: vi.fn(() => {
    subscribe();
    return realtime;
  }),
};
vi.mock("@/lib/chat/live", () => ({ authenticateRealtime: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ channel: () => realtime, removeChannel: vi.fn() }) }));

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

    it("does not listen at all in sudo", async () => {
      render(<ChatSidebar channels={CHANNELS} unread={{}} selfMemberId={null} />);
      await flush();
      expect(subscribe).not.toHaveBeenCalled();
    });
  });
});
